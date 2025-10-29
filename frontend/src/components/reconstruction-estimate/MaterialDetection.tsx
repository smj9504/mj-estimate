/**
 * Material Detection Component
 *
 * AI-powered construction material detection from uploaded images.
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Card,
  Button,
  Upload,
  Table,
  Tag,
  Progress,
  Alert,
  Space,
  Statistic,
  Row,
  Col,
  Modal,
  Select,
  Slider,
  message,
  Spin,
  Empty,
  Tooltip
} from 'antd';
import {
  CloudUploadOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  EyeOutlined,
  DeleteOutlined,
  ApiOutlined,
  DownloadOutlined,
  FileExcelOutlined
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import materialDetectionService from '../../services/materialDetectionService';
import type {
  MaterialDetectionJob,
  DetectedMaterial,
  JobStatus,
  ProviderType,
  MaterialDetectionHealth
} from '../../types/materialDetection';

interface MaterialDetectionProps {
  reconstructionEstimateId?: string;
  onMaterialsDetected?: (materials: DetectedMaterial[]) => void;
}

const MaterialDetection: React.FC<MaterialDetectionProps> = ({
  reconstructionEstimateId,
  onMaterialsDetected
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadedImageIds, setUploadedImageIds] = useState<string[]>([]);
  const [currentJob, setCurrentJob] = useState<MaterialDetectionJob | null>(null);
  const [detectedMaterials, setDetectedMaterials] = useState<DetectedMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [health, setHealth] = useState<MaterialDetectionHealth | null>(null);

  // Detection settings
  const [provider, setProvider] = useState<ProviderType>('google_vision');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);

  // Check service health on mount
  useEffect(() => {
    checkHealth();
  }, []);

  // Handle paste event for Ctrl+V image upload
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];

      // Extract all images from clipboard
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            // Rename file with timestamp to avoid duplicates
            const timestamp = new Date().getTime();
            const newFile = new File([file], `pasted-image-${timestamp}-${i}.png`, { type: file.type });
            imageFiles.push(newFile);
          }
        }
      }

      // Upload all pasted images
      if (imageFiles.length > 0) {
        message.info(`${imageFiles.length} image(s) pasted from clipboard`);

        for (const file of imageFiles) {
          try {
            const tempImageId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Create upload file object
            const uploadFile: UploadFile = {
              uid: tempImageId,
              name: file.name,
              status: 'done',
              url: URL.createObjectURL(file),
              originFileObj: file as any,
              response: { id: tempImageId }
            };

            setFileList(prev => [...prev, uploadFile]);
            setUploadedImageIds(prev => [...prev, tempImageId]);
          } catch (error) {
            console.error('Failed to process pasted image:', error);
            message.error(`Failed to process image: ${file.name}`);
          }
        }
      }
    };

    // Add paste event listener
    document.addEventListener('paste', handlePaste);

    // Cleanup
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  // Poll job status when processing
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (currentJob && currentJob.status === 'processing') {
      setPolling(true);
      intervalId = setInterval(async () => {
        try {
          const updatedJob = await materialDetectionService.getJob(currentJob.id);
          setCurrentJob(updatedJob);

          if (updatedJob.status === 'completed') {
            setDetectedMaterials(updatedJob.detected_materials || []);
            setPolling(false);
            message.success(`Detection completed! ${updatedJob.total_materials_detected} material(s) found.`);

            if (onMaterialsDetected) {
              onMaterialsDetected(updatedJob.detected_materials || []);
            }
          } else if (updatedJob.status === 'failed') {
            setPolling(false);
            message.error(`Detection failed: ${updatedJob.error_message}`);
          }
        } catch (error) {
          console.error('Failed to poll job status:', error);
          setPolling(false);
        }
      }, 2000); // Poll every 2 seconds
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [currentJob, onMaterialsDetected]);

  const checkHealth = async () => {
    try {
      const healthStatus = await materialDetectionService.getHealth();
      setHealth(healthStatus);
    } catch (error) {
      console.error('Failed to check health:', error);
      message.error('Failed to check material detection service health');
    }
  };

  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;

    try {
      // Upload file to backend using axios
      const formData = new FormData();
      formData.append('files', file);  // Note: parameter name is 'files'
      formData.append('context', 'material_detection');
      formData.append('context_id', reconstructionEstimateId || 'temp');
      formData.append('category', 'material_detection_image');
      formData.append('description', `Material detection image: ${file.name}`);

      const response = await axios.post('/api/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      // API returns { data: [...], total, message }
      const fileId = response.data.data?.[0]?.id;

      if (!fileId) {
        console.error('Upload response:', response.data);
        throw new Error('No file ID returned from server');
      }

      setUploadedImageIds(prev => [...prev, fileId]);
      onSuccess({ id: fileId }, file);
      message.success(`${file.name} uploaded successfully`);
    } catch (error: any) {
      console.error('Upload failed:', error);
      const errorMessage = error.response?.data?.detail || error.message || 'Upload failed';
      onError(error);
      message.error(`${file.name} upload failed: ${errorMessage}`);
    }
  };

  const handleRemove = (file: UploadFile) => {
    const imageId = (file.response as any)?.id;
    if (imageId) {
      setUploadedImageIds(prev => prev.filter(id => id !== imageId));
    }
  };

  const startDetection = async () => {
    if (uploadedImageIds.length === 0) {
      message.warning('Please upload images first');
      return;
    }

    setLoading(true);

    try {
      const result = await materialDetectionService.createJob({
        provider,
        confidence_threshold: confidenceThreshold,
        image_ids: uploadedImageIds,
        reconstruction_estimate_id: reconstructionEstimateId,
        job_name: `Material Detection - ${new Date().toLocaleString('en-US')}`
      });

      message.success('Material detection job started');

      // Fetch the created job
      const job = await materialDetectionService.getJob(result.job_id);
      setCurrentJob(job);
    } catch (error: any) {
      console.error('Failed to start detection:', error);

      // Handle FastAPI validation errors
      let errorMessage = 'Failed to start material detection';
      if (error.response?.data?.detail) {
        if (Array.isArray(error.response.data.detail)) {
          // Pydantic validation errors
          errorMessage = error.response.data.detail
            .map((err: any) => err.msg || JSON.stringify(err))
            .join(', ');
        } else if (typeof error.response.data.detail === 'string') {
          errorMessage = error.response.data.detail;
        }
      }

      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    if (!currentJob) {
      message.warning('No job to export');
      return;
    }

    try {
      const blob = await materialDetectionService.exportJobCSV(currentJob.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `materials_${currentJob.id}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('CSV exported successfully');
    } catch (error: any) {
      console.error('Failed to export CSV:', error);
      message.error('Failed to export CSV');
    }
  };

  const handleExportExcel = async () => {
    if (!currentJob) {
      message.warning('No job to export');
      return;
    }

    try {
      const blob = await materialDetectionService.exportJobExcel(currentJob.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `materials_${currentJob.id}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('Excel exported successfully');
    } catch (error: any) {
      console.error('Failed to export Excel:', error);
      message.error('Failed to export Excel');
    }
  };

  const getStatusTag = (status: JobStatus) => {
    const statusConfig = {
      pending: { color: 'default', icon: <SyncOutlined spin />, text: 'Pending' },
      processing: { color: 'processing', icon: <SyncOutlined spin />, text: 'Processing' },
      completed: { color: 'success', icon: <CheckCircleOutlined />, text: 'Completed' },
      failed: { color: 'error', icon: <CloseCircleOutlined />, text: 'Failed' }
    };

    const config = statusConfig[status];
    return <Tag color={config.color} icon={config.icon}>{config.text}</Tag>;
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.9) return '#52c41a'; // Green
    if (confidence >= 0.7) return '#faad14'; // Orange
    return '#ff4d4f'; // Red
  };

  const columns = [
    {
      title: 'Image ID',
      dataIndex: 'image_id',
      key: 'image_id',
      width: 120,
      ellipsis: true,
      render: (id: string) => (
        <Tooltip title={id}>
          <code>{id.substring(0, 8)}...</code>
        </Tooltip>
      )
    },
    {
      title: 'Material Category',
      dataIndex: 'material_category',
      key: 'material_category',
      render: (category: string) => <Tag color="blue">{category}</Tag>
    },
    {
      title: 'Material Type',
      dataIndex: 'material_type',
      key: 'material_type',
      render: (type: string) => type || '-'
    },
    {
      title: 'Grade',
      dataIndex: 'material_grade',
      key: 'material_grade',
      render: (grade: string) => grade || '-'
    },
    {
      title: 'Finish',
      dataIndex: 'material_finish',
      key: 'material_finish',
      render: (finish: string) => finish || '-'
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence_score',
      key: 'confidence_score',
      width: 120,
      render: (confidence: number) => (
        <Space>
          <Progress
            type="circle"
            percent={Math.round(confidence * 100)}
            width={40}
            strokeColor={getConfidenceColor(confidence)}
          />
          <span>{(confidence * 100).toFixed(1)}%</span>
        </Space>
      ),
      sorter: (a: DetectedMaterial, b: DetectedMaterial) => a.confidence_score - b.confidence_score
    },
    {
      title: 'Reviewed',
      dataIndex: 'reviewed',
      key: 'reviewed',
      width: 100,
      render: (reviewed: boolean) =>
        reviewed ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>Reviewed</Tag>
        ) : (
          <Tag>Not Reviewed</Tag>
        )
    }
  ];

  const availableProvider = health?.providers.find(p => p.available);

  return (
    <Card
      title={
        <Space>
          <RobotOutlined />
          <span>AI Material Detection</span>
        </Space>
      }
      extra={
        health && (
          <Space>
            <ApiOutlined />
            <Tag color={health.status === 'healthy' ? 'success' : 'error'}>
              {health.status === 'healthy' ? 'Healthy' : 'Error'}
            </Tag>
            {availableProvider && (
              <Tag color="blue">{availableProvider.provider_name}</Tag>
            )}
          </Space>
        )
      }
    >
      {health && !health.providers.some(p => p.available) && (
        <Alert
          type="error"
          message="Material detection service unavailable"
          description="No detection providers are currently available. Please check server configuration."
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Upload Section */}
      <Card
        type="inner"
        title="Image Upload"
        extra={
          <Tooltip title="You can paste images from clipboard using Ctrl+V">
            <Tag color="blue">💡 Ctrl+V Supported</Tag>
          </Tooltip>
        }
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Upload
            listType="picture-card"
            fileList={fileList}
            onChange={({ fileList }) => setFileList(fileList)}
            customRequest={handleUpload}
            onRemove={handleRemove}
            accept="image/*"
            multiple
          >
            {fileList.length < 10 && (
              <div>
                <CloudUploadOutlined style={{ fontSize: 24 }} />
                <div style={{ marginTop: 8 }}>Upload Image</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  or Ctrl+V
                </div>
              </div>
            )}
          </Upload>

          <Row gutter={16}>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <label>Detection Provider</label>
                <Select
                  value={provider}
                  onChange={setProvider}
                  style={{ width: '100%' }}
                  disabled={!health?.providers.some(p => p.available)}
                >
                  {health?.providers.map(p => (
                    <Select.Option key={p.provider_name} value={p.provider_name} disabled={!p.available}>
                      {p.provider_name} {p.available ? '' : '(Unavailable)'}
                    </Select.Option>
                  ))}
                </Select>
              </Space>
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <label>Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%</label>
                <Slider
                  value={confidenceThreshold}
                  onChange={(value) => setConfidenceThreshold(value)}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  marks={{
                    0.1: '10%',
                    0.5: '50%',
                    1.0: '100%'
                  }}
                  tooltip={{ formatter: (value) => `${((value || 0) * 100).toFixed(0)}%` }}
                />
              </Space>
            </Col>
          </Row>

          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={startDetection}
            loading={loading}
            disabled={uploadedImageIds.length === 0 || !availableProvider}
            block
            size="large"
          >
            Start Material Detection
          </Button>
        </Space>
      </Card>

      {/* Job Status */}
      {currentJob && (
        <Card type="inner" title="Job Status" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <div>
                <div style={{ marginBottom: 8, fontSize: 14, color: '#999' }}>Status</div>
                {getStatusTag(currentJob.status)}
              </div>
            </Col>
            <Col span={6}>
              <Statistic title="Total Images" value={currentJob.total_images} />
            </Col>
            <Col span={6}>
              <Statistic title="Processed Images" value={currentJob.processed_images} suffix={`/ ${currentJob.total_images}`} />
            </Col>
            <Col span={6}>
              <Statistic title="Materials Found" value={currentJob.total_materials_detected} />
            </Col>
          </Row>

          {currentJob.status === 'processing' && (
            <Progress
              percent={Math.round((currentJob.processed_images / currentJob.total_images) * 100)}
              status="active"
              style={{ marginTop: 16 }}
            />
          )}

          {currentJob.avg_confidence !== null && currentJob.avg_confidence !== undefined && (
            <Statistic
              title="Average Confidence"
              value={currentJob.avg_confidence * 100}
              precision={1}
              suffix="%"
              style={{ marginTop: 16 }}
            />
          )}
        </Card>
      )}

      {/* Detected Materials */}
      {detectedMaterials.length > 0 && (
        <Card
          type="inner"
          title={`Detected Materials (${detectedMaterials.length})`}
          extra={
            <Space>
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExportCSV}
                disabled={!currentJob || currentJob.status !== 'completed'}
              >
                Export CSV
              </Button>
              <Button
                type="primary"
                icon={<FileExcelOutlined />}
                onClick={handleExportExcel}
                disabled={!currentJob || currentJob.status !== 'completed'}
              >
                Export Excel
              </Button>
            </Space>
          }
        >
          <Table
            columns={columns}
            dataSource={detectedMaterials}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            size="small"
          />
        </Card>
      )}

      {currentJob && detectedMaterials.length === 0 && currentJob.status === 'completed' && (
        <Empty description="No materials detected" />
      )}

      {polling && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>Detecting materials...</div>
        </div>
      )}
    </Card>
  );
};

export default MaterialDetection;
