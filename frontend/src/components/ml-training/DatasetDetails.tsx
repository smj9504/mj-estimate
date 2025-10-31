/**
 * Dataset Details Component
 * Manage dataset images, labeling, and training preparation
 */

import React, { useState, useEffect } from 'react';
import {
  Tabs,
  Button,
  Table,
  Space,
  Tag,
  Upload,
  Modal,
  message,
  Statistic,
  Row,
  Col,
  Card,
  Progress,
  Alert,
  Typography,
  Popconfirm,
  InputNumber,
  Tooltip
} from 'antd';
import {
  UploadOutlined,
  ThunderboltOutlined,
  SplitCellsOutlined,
  RocketOutlined,
  DollarOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  getDatasetImages,
  addImagesToDataset,
  assignSplits,
  estimateLabelingCost,
  autoLabelImages,
  startTraining,
  type TrainingDataset,
  type TrainingImage,
  type CostEstimate
} from '../../services/mlTrainingService';
import api from '../../services/api';

const { TabPane } = Tabs;
const { Text, Title } = Typography;

// Helper function to extract error message
const getErrorMessage = (error: any): string => {
  if (error.response?.data?.detail) {
    const detail = error.response.data.detail;

    // Handle validation error array
    if (Array.isArray(detail)) {
      return detail.map((err: any) => err.msg || JSON.stringify(err)).join(', ');
    }

    // Handle object error
    if (typeof detail === 'object') {
      return detail.msg || detail.message || JSON.stringify(detail);
    }

    // Handle string error
    return detail;
  }

  return error.message || 'An error occurred';
};

interface DatasetDetailsProps {
  dataset: TrainingDataset;
  onClose: () => void;
}

const DatasetDetails: React.FC<DatasetDetailsProps> = ({ dataset, onClose }) => {
  const [images, setImages] = useState<TrainingImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [autoLabeling, setAutoLabeling] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [trainingModalVisible, setTrainingModalVisible] = useState(false);
  const [trainingParams, setTrainingParams] = useState({
    epochs: 10,
    batch_size: 16,
    learning_rate: 0.00002
  });

  useEffect(() => {
    loadImages();
  }, [dataset.id]);

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

      // Add pasted images to file list
      if (imageFiles.length > 0) {
        message.info(`${imageFiles.length} image(s) pasted from clipboard`);

        const newUploadFiles: UploadFile[] = imageFiles.map((file, index) => ({
          uid: `paste_${Date.now()}_${index}`,
          name: file.name,
          status: 'done',
          url: URL.createObjectURL(file),
          originFileObj: file as any
        }));

        setFileList(prev => [...prev, ...newUploadFiles]);
      }
    };

    // Add paste event listener
    document.addEventListener('paste', handlePaste);

    // Cleanup
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  const loadImages = async () => {
    setLoading(true);
    try {
      const data = await getDatasetImages(dataset.id);
      setImages(data);
    } catch (error) {
      message.error('Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning('Please select images to upload');
      return;
    }

    setUploading(true);
    try {
      const fileIds: string[] = [];

      // Upload files
      for (const file of fileList) {
        if (file.originFileObj) {
          const formData = new FormData();
          formData.append('files', file.originFileObj);
          formData.append('context', 'material_detection_training');
          formData.append('context_id', dataset.id);
          formData.append('category', 'training_image');
          formData.append('description', `Training image: ${file.name}`);

          const response = await api.post('/api/files/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });

          if (response.data && response.data.data && response.data.data.length > 0) {
            fileIds.push(response.data.data[0].id);
          }
        }
      }

      // Add to dataset
      await addImagesToDataset(dataset.id, fileIds);

      message.success(`Uploaded ${fileIds.length} images`);
      setFileList([]);
      loadImages();
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to upload images');
    } finally {
      setUploading(false);
    }
  };

  const handleEstimateCost = async () => {
    const unlabeledCount = images.filter(img => img.labeling_status === 'pending').length;
    if (unlabeledCount === 0) {
      message.info('All images are already labeled');
      return;
    }

    try {
      const estimate = await estimateLabelingCost(unlabeledCount, 'high');
      setCostEstimate(estimate);
    } catch (error) {
      message.error('Failed to estimate cost');
    }
  };

  const handleAutoLabel = async () => {
    const unlabeledImages = images.filter(img => img.labeling_status === 'pending');
    if (unlabeledImages.length === 0) {
      message.info('All images are already labeled');
      return;
    }

    setAutoLabeling(true);
    try {
      const result = await autoLabelImages(
        dataset.id,
        unlabeledImages.map(img => img.id),
        0.0,
        'high'
      );

      message.success(
        <div>
          <div>Auto-labeling started!</div>
          <div>Cost: ${result.estimated_cost.toFixed(2)}</div>
          <div>Time: ~{result.estimated_time_minutes} minutes</div>
          <div>Refreshing every 5 seconds...</div>
        </div>
      );

      // Poll for updates every 5 seconds
      const pollInterval = setInterval(async () => {
        const updatedImages = await getDatasetImages(dataset.id);
        setImages(updatedImages);

        // Check if all images are labeled
        const pendingImages = updatedImages.filter(img => img.labeling_status === 'pending');
        if (pendingImages.length === 0) {
          clearInterval(pollInterval);
          message.success('Auto-labeling completed!');
        }
      }, 5000);

      // Stop polling after estimated time + buffer
      setTimeout(() => {
        clearInterval(pollInterval);
        loadImages();
      }, (result.estimated_time_minutes * 60 + 30) * 1000);
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to start auto-labeling');
    } finally {
      setAutoLabeling(false);
    }
  };

  const handleAssignSplits = async () => {
    if (dataset.labeled_images === 0) {
      message.warning('Please label images before assigning splits');
      return;
    }

    setAssigning(true);
    try {
      const result = await assignSplits(dataset.id);
      message.success(
        <div>
          <div>Splits assigned successfully!</div>
          <div>Train: {result.splits.train} | Val: {result.splits.val} | Test: {result.splits.test}</div>
        </div>
      );
      loadImages();
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to assign splits');
    } finally {
      setAssigning(false);
    }
  };

  const handleStartTraining = async () => {
    try {
      const result = await startTraining(dataset.id, {
        job_name: `Training ${dataset.name}`,
        ...trainingParams
      });

      message.success(
        <div>
          <div>Training started!</div>
          <div>Estimated time: ~{result.estimated_time_minutes} minutes</div>
        </div>
      );

      setTrainingModalVisible(false);
      onClose();
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to start training');
    }
  };

  const getLabelingStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'default',
      auto_labeled: 'processing',
      manual_review: 'warning',
      verified: 'success'
    };
    return colors[status] || 'default';
  };

  const imageColumns = [
    {
      title: 'Image',
      key: 'image',
      width: 100,
      render: (_: any, record: TrainingImage) => {
        // Use file_id to get image from API preview endpoint
        const imageUrl = record.file_id
          ? `/api/files/preview/${record.file_id}`
          : record.image_url;

        return (
          <img
            src={imageUrl}
            alt="Training image"
            style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }}
            onError={(e) => {
              // Fallback to placeholder on error
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="60" height="60"%3E%3Crect fill="%23ddd" width="60" height="60"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3ENo Image%3C/text%3E%3C/svg%3E';
            }}
          />
        );
      }
    },
    {
      title: 'Labeling Status',
      dataIndex: 'labeling_status',
      key: 'status',
      render: (status: string) => (
        <Tag color={getLabelingStatusColor(status)}>
          {status.replace('_', ' ').toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Split',
      dataIndex: 'split_type',
      key: 'split',
      render: (split?: string) => split ? <Tag>{split.toUpperCase()}</Tag> : <Text type="secondary">-</Text>
    },
    {
      title: 'Materials',
      key: 'materials',
      render: (_: any, record: TrainingImage) => {
        const materials = record.detected_materials || [];
        if (materials.length === 0 && record.material_category) {
          // Legacy single-material display
          return (
            <div style={{ fontSize: 12 }}>
              <div>{record.material_category}</div>
              {record.category_confidence && (
                <Text type="secondary">{record.category_confidence}% confidence</Text>
              )}
            </div>
          );
        }

        // Multi-material display
        return (
          <div style={{ fontSize: 12 }}>
            <div><strong>{materials.length} material{materials.length !== 1 ? 's' : ''} detected</strong></div>
            {materials.slice(0, 2).map((m, idx) => (
              <div key={idx}>
                {idx + 1}. {m.category || 'Unknown'} {m.subcategory ? `(${m.subcategory})` : ''}
              </div>
            ))}
            {materials.length > 2 && <Text type="secondary">+ {materials.length - 2} more...</Text>}
          </div>
        );
      }
    },
    {
      title: 'Auto',
      dataIndex: 'auto_labeled',
      key: 'auto',
      render: (auto: boolean) => auto ? <ThunderboltOutlined style={{ color: '#1890ff' }} /> : null
    }
  ];

  // Expandable row renderer for detailed material view
  const expandedRowRender = (record: TrainingImage) => {
    const materials = record.detected_materials || [];

    if (materials.length === 0) {
      return (
        <div style={{ padding: 16, background: '#fafafa' }}>
          <Text type="secondary">No materials detected yet. Try auto-labeling this image.</Text>
        </div>
      );
    }

    const materialColumns = [
      {
        title: '#',
        dataIndex: 'material_order',
        key: 'order',
        width: 50
      },
      {
        title: 'Category',
        dataIndex: 'category',
        key: 'category',
        render: (text: string) => <Tag color="blue">{text || '-'}</Tag>
      },
      {
        title: 'Type',
        key: 'type',
        render: (_: any, material: any) => (
          <span>{material.subcategory || material.material_type || '-'}</span>
        )
      },
      {
        title: 'Species',
        dataIndex: 'species',
        key: 'species',
        render: (text: string) => text || '-'
      },
      {
        title: 'Grade',
        dataIndex: 'grade',
        key: 'grade',
        render: (text: string) => text || '-'
      },
      {
        title: 'Density',
        dataIndex: 'density',
        key: 'density',
        render: (text: string, material: any) => (
          <Tooltip title="Critical for carpet pricing">
            <span style={{ color: text ? '#52c41a' : undefined }}>
              {text || '-'}
              {material.density_confidence && ` (${material.density_confidence}%)`}
            </span>
          </Tooltip>
        )
      },
      {
        title: 'Pattern',
        dataIndex: 'pattern',
        key: 'pattern',
        render: (text: string, material: any) => (
          <Tooltip title="Critical for carpet/tile pricing">
            <span style={{ color: text ? '#52c41a' : undefined }}>
              {text || '-'}
              {material.pattern_confidence && ` (${material.pattern_confidence}%)`}
            </span>
          </Tooltip>
        )
      },
      {
        title: 'Condition',
        dataIndex: 'condition',
        key: 'condition',
        render: (text: string) => {
          const color = text?.toLowerCase().includes('damaged') ? 'red' :
                       text?.toLowerCase().includes('good') ? 'green' : 'default';
          return text ? <Tag color={color}>{text}</Tag> : '-';
        }
      },
      {
        title: 'Coverage',
        dataIndex: 'coverage_percentage',
        key: 'coverage',
        render: (percent: number) => percent ? `${percent}%` : '-'
      },
      {
        title: 'Confidence',
        dataIndex: 'category_confidence',
        key: 'confidence',
        render: (conf: number) => conf ? (
          <Progress
            percent={conf}
            size="small"
            strokeColor={conf > 80 ? '#52c41a' : conf > 60 ? '#faad14' : '#ff4d4f'}
          />
        ) : '-'
      }
    ];

    return (
      <div style={{ padding: 16, background: '#fafafa' }}>
        <Title level={5}>Detected Materials ({materials.length})</Title>
        <Table
          columns={materialColumns}
          dataSource={materials}
          rowKey="id"
          pagination={false}
          size="small"
        />
        {materials[0]?.pricing_notes && (
          <Alert
            message="Pricing Notes"
            description={materials[0].pricing_notes}
            type="info"
            style={{ marginTop: 12 }}
            showIcon
          />
        )}
      </div>
    );
  };

  const unlabeledCount = images.filter(img => img.labeling_status === 'pending').length;
  const canTrain = dataset.labeled_images > 0 && images.some(img => img.split_type);

  return (
    <div>
      {/* Stats Overview */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Statistic title="Total Images" value={images.length} />
        </Col>
        <Col span={6}>
          <Statistic
            title="Labeled"
            value={images.filter(img => img.labeling_status !== 'pending').length}
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="Unlabeled"
            value={unlabeledCount}
            valueStyle={{ color: unlabeledCount > 0 ? '#faad14' : '#52c41a' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="Verified"
            value={images.filter(img => img.labeling_status === 'verified').length}
          />
        </Col>
      </Row>

      <Tabs defaultActiveKey="images">
        <TabPane tab="Images" key="images">
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* Upload Section */}
            <Card
              title="Upload Images"
              size="small"
              extra={
                <Tooltip title="You can paste images from clipboard using Ctrl+V">
                  <Tag color="blue" icon={<InfoCircleOutlined />}>💡 Ctrl+V Supported</Tag>
                </Tooltip>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Upload
                  fileList={fileList}
                  onChange={({ fileList }) => setFileList(fileList)}
                  beforeUpload={() => false}
                  accept="image/*"
                  multiple
                >
                  <Button icon={<UploadOutlined />}>Select Images</Button>
                </Upload>

                <Button
                  type="primary"
                  onClick={handleUpload}
                  loading={uploading}
                  disabled={fileList.length === 0}
                >
                  Upload {fileList.length} Images
                </Button>
              </Space>
            </Card>

            {/* Auto-Labeling Section */}
            <Card title="Auto-Labeling (GPT-4 Vision)" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert
                  message={`${unlabeledCount} images need labeling`}
                  description={
                    costEstimate ? (
                      <div>
                        <div>💰 Estimated Cost: ${costEstimate.total_cost.toFixed(2)}</div>
                        <div>⏱️ Estimated Time: ~{costEstimate.estimated_time_minutes} minutes</div>
                      </div>
                    ) : (
                      'Click "Estimate Cost" to calculate'
                    )
                  }
                  type={unlabeledCount > 0 ? 'warning' : 'success'}
                  showIcon
                />

                <Space>
                  <Button
                    icon={<DollarOutlined />}
                    onClick={handleEstimateCost}
                    disabled={unlabeledCount === 0}
                  >
                    Estimate Cost
                  </Button>

                  <Popconfirm
                    title="Start Auto-Labeling?"
                    description={
                      costEstimate ? (
                        <div>
                          <div>This will cost ~${costEstimate.total_cost.toFixed(2)}</div>
                          <div>Continue?</div>
                        </div>
                      ) : (
                        'Please estimate cost first'
                      )
                    }
                    onConfirm={handleAutoLabel}
                    okText="Start"
                    disabled={!costEstimate || unlabeledCount === 0}
                  >
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      loading={autoLabeling}
                      disabled={!costEstimate || unlabeledCount === 0}
                    >
                      Start Auto-Labeling
                    </Button>
                  </Popconfirm>
                </Space>
              </Space>
            </Card>

            {/* Images Table */}
            <Table
              columns={imageColumns}
              dataSource={images}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              expandable={{
                expandedRowRender,
                rowExpandable: (record) => record.detected_materials && record.detected_materials.length > 0
              }}
            />
          </Space>
        </TabPane>

        <TabPane tab="Training Preparation" key="training">
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* Assign Splits */}
            <Card title="Assign Train/Val/Test Splits" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>
                  Split labeled images into training ({dataset.train_split}%),
                  validation ({dataset.val_split}%), and test ({dataset.test_split}%) sets.
                </Text>

                <Button
                  type="primary"
                  icon={<SplitCellsOutlined />}
                  onClick={handleAssignSplits}
                  loading={assigning}
                  disabled={dataset.labeled_images === 0}
                >
                  Assign Splits
                </Button>

                {images.some(img => img.split_type) && (
                  <Alert
                    message="Splits assigned"
                    description={
                      <div>
                        <div>Train: {images.filter(img => img.split_type === 'train').length}</div>
                        <div>Val: {images.filter(img => img.split_type === 'val').length}</div>
                        <div>Test: {images.filter(img => img.split_type === 'test').length}</div>
                      </div>
                    }
                    type="success"
                    showIcon
                  />
                )}
              </Space>
            </Card>

            {/* Start Training */}
            <Card title="Start Training" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                {canTrain ? (
                  <>
                    <Alert
                      message="Ready to train!"
                      description="Dataset is prepared and ready for model training."
                      type="success"
                      showIcon
                    />

                    <Button
                      type="primary"
                      size="large"
                      icon={<RocketOutlined />}
                      onClick={() => setTrainingModalVisible(true)}
                    >
                      Start Training
                    </Button>
                  </>
                ) : (
                  <Alert
                    message="Not ready"
                    description="Please label images and assign splits before training."
                    type="warning"
                    showIcon
                  />
                )}
              </Space>
            </Card>
          </Space>
        </TabPane>
      </Tabs>

      {/* Training Parameters Modal */}
      <Modal
        title="Start Model Training"
        open={trainingModalVisible}
        onCancel={() => setTrainingModalVisible(false)}
        onOk={handleStartTraining}
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Alert
            message="Training Configuration"
            description="Configure hyperparameters for model training. Training will run in the background."
            type="info"
            showIcon
          />

          <div>
            <Text strong>Epochs:</Text>
            <br />
            <InputNumber
              min={1}
              max={100}
              value={trainingParams.epochs}
              onChange={(val) => setTrainingParams({ ...trainingParams, epochs: val || 10 })}
              style={{ width: '100%' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Number of training epochs (recommended: 10-20)
            </Text>
          </div>

          <div>
            <Text strong>Batch Size:</Text>
            <br />
            <InputNumber
              min={1}
              max={64}
              value={trainingParams.batch_size}
              onChange={(val) => setTrainingParams({ ...trainingParams, batch_size: val || 16 })}
              style={{ width: '100%' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Batch size for training (recommended: 16-32)
            </Text>
          </div>

          <div>
            <Text strong>Learning Rate:</Text>
            <br />
            <InputNumber
              min={0.000001}
              max={0.001}
              step={0.000001}
              value={trainingParams.learning_rate}
              onChange={(val) => setTrainingParams({ ...trainingParams, learning_rate: val || 0.00002 })}
              style={{ width: '100%' }}
              precision={6}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Learning rate (recommended: 0.00001-0.0001)
            </Text>
          </div>

          <Alert
            message="Estimated Training Time"
            description={`~${trainingParams.epochs * 2} minutes`}
            type="info"
            showIcon
            icon={<ClockCircleOutlined />}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default DatasetDetails;
