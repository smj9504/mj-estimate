/**
 * Training Jobs Component
 * Monitor and manage model training jobs
 */

import React, { useState, useEffect } from 'react';
import {
  Table,
  Tag,
  Progress,
  Space,
  Button,
  Modal,
  Typography,
  Row,
  Col,
  Statistic,
  Card,
  Alert,
  Descriptions
} from 'antd';
import {
  EyeOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import {
  getTrainingJob,
  type TrainingJob,
  type TrainingDataset
} from '../../services/mlTrainingService';

const { Text, Title } = Typography;

interface TrainingJobsProps {
  jobs: TrainingJob[];
  datasets: TrainingDataset[];
  onJobChange: () => void;
}

const TrainingJobs: React.FC<TrainingJobsProps> = ({ jobs, datasets, onJobChange }) => {
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null);
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);

  // Poll for running jobs
  useEffect(() => {
    const runningJobs = jobs.filter(
      job => job.status === 'training' || job.status === 'pending'
    );

    if (runningJobs.length > 0) {
      const interval = setInterval(() => {
        onJobChange();
      }, 10000); // Poll every 10 seconds

      return () => clearInterval(interval);
    }
  }, [jobs, onJobChange]);

  const handleViewDetails = async (jobId: string) => {
    try {
      const job = await getTrainingJob(jobId);
      setSelectedJob(job);
      setDetailsModalVisible(true);

      // Start polling if training
      if (job.status === 'training' || job.status === 'pending') {
        setPollingJobId(jobId);
      }
    } catch (error) {
      console.error('Failed to load job details:', error);
    }
  };

  // Poll for job details when modal is open
  useEffect(() => {
    if (pollingJobId && detailsModalVisible) {
      const interval = setInterval(async () => {
        try {
          const job = await getTrainingJob(pollingJobId);
          setSelectedJob(job);

          // Stop polling when complete
          if (job.status === 'completed' || job.status === 'failed') {
            setPollingJobId(null);
          }
        } catch (error) {
          console.error('Failed to poll job:', error);
        }
      }, 5000); // Poll every 5 seconds

      return () => clearInterval(interval);
    }
  }, [pollingJobId, detailsModalVisible]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockCircleOutlined />;
      case 'training':
        return <SyncOutlined spin />;
      case 'completed':
        return <CheckCircleOutlined />;
      case 'failed':
        return <CloseCircleOutlined />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'default',
      training: 'processing',
      completed: 'success',
      failed: 'error'
    };
    return colors[status] || 'default';
  };

  const getDatasetName = (datasetId: string) => {
    const dataset = datasets.find(d => d.id === datasetId);
    return dataset?.name || 'Unknown';
  };

  const columns = [
    {
      title: 'Job Name',
      dataIndex: 'job_name',
      key: 'name',
      render: (text: string, record: TrainingJob) => (
        <div>
          <div><strong>{text}</strong></div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {getDatasetName(record.dataset_id)}
          </Text>
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag icon={getStatusIcon(status)} color={getStatusColor(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_: any, record: TrainingJob) => {
        if (record.status === 'pending') {
          return <Text type="secondary">Waiting...</Text>;
        }

        if (record.status === 'training') {
          const progress = Math.round((record.current_epoch / record.total_epochs) * 100);
          return (
            <div>
              <Progress
                percent={progress}
                size="small"
                status="active"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Epoch {record.current_epoch}/{record.total_epochs}
              </Text>
            </div>
          );
        }

        if (record.status === 'completed') {
          return (
            <div>
              <Progress percent={100} size="small" status="success" />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Accuracy: {record.best_val_accuracy ? (record.best_val_accuracy * 100).toFixed(1) + '%' : 'N/A'}
              </Text>
            </div>
          );
        }

        return <Text type="danger">Failed</Text>;
      }
    },
    {
      title: 'Model',
      key: 'model',
      render: (_: any, record: TrainingJob) => (
        <div style={{ fontSize: 12 }}>
          <div>{record.model_architecture}</div>
          <Text type="secondary">{record.base_model}</Text>
        </div>
      )
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      render: (date: string) => new Date(date).toLocaleString()
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TrainingJob) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetails(record.job_id)}
        >
          Details
        </Button>
      )
    }
  ];

  return (
    <>
      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="job_id"
        pagination={{
          pageSize: 10,
          showTotal: (total) => `Total ${total} jobs`
        }}
      />

      {/* Job Details Modal */}
      <Modal
        title={selectedJob ? `Training Job: ${selectedJob.job_name}` : 'Job Details'}
        open={detailsModalVisible}
        onCancel={() => {
          setDetailsModalVisible(false);
          setSelectedJob(null);
          setPollingJobId(null);
        }}
        footer={null}
        width={900}
      >
        {selectedJob && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* Status Overview */}
            <Card>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title="Status"
                    value={selectedJob.status.toUpperCase()}
                    valueStyle={{
                      color:
                        selectedJob.status === 'completed'
                          ? '#52c41a'
                          : selectedJob.status === 'failed'
                          ? '#ff4d4f'
                          : '#1890ff'
                    }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Progress"
                    value={selectedJob.current_epoch}
                    suffix={`/ ${selectedJob.total_epochs}`}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Best Val Accuracy"
                    value={
                      selectedJob.best_val_accuracy
                        ? (selectedJob.best_val_accuracy * 100).toFixed(1)
                        : 'N/A'
                    }
                    suffix="%"
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="Best Val Loss"
                    value={
                      selectedJob.best_val_loss
                        ? selectedJob.best_val_loss.toFixed(4)
                        : 'N/A'
                    }
                  />
                </Col>
              </Row>

              {selectedJob.status === 'training' && (
                <div style={{ marginTop: 16 }}>
                  <Progress
                    percent={Math.round(
                      (selectedJob.current_epoch / selectedJob.total_epochs) * 100
                    )}
                    status="active"
                  />
                </div>
              )}

              {selectedJob.error_message && (
                <Alert
                  message="Training Failed"
                  description={selectedJob.error_message}
                  type="error"
                  style={{ marginTop: 16 }}
                  showIcon
                />
              )}
            </Card>

            {/* Job Information */}
            <Descriptions title="Job Information" bordered size="small">
              <Descriptions.Item label="Job ID" span={3}>
                {selectedJob.job_id}
              </Descriptions.Item>
              <Descriptions.Item label="Dataset" span={3}>
                {getDatasetName(selectedJob.dataset_id)}
              </Descriptions.Item>
              <Descriptions.Item label="Model Architecture" span={3}>
                {selectedJob.model_architecture}
              </Descriptions.Item>
              <Descriptions.Item label="Base Model" span={3}>
                {selectedJob.base_model}
              </Descriptions.Item>
              <Descriptions.Item label="Started At" span={3}>
                {selectedJob.started_at
                  ? new Date(selectedJob.started_at).toLocaleString()
                  : 'Not started'}
              </Descriptions.Item>
              <Descriptions.Item label="Completed At" span={3}>
                {selectedJob.completed_at
                  ? new Date(selectedJob.completed_at).toLocaleString()
                  : 'In progress'}
              </Descriptions.Item>
            </Descriptions>

            {/* Hyperparameters */}
            {selectedJob.hyperparameters && (
              <Card title="Hyperparameters" size="small">
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="Epochs">
                    {selectedJob.hyperparameters.epochs}
                  </Descriptions.Item>
                  <Descriptions.Item label="Batch Size">
                    {selectedJob.hyperparameters.batch_size}
                  </Descriptions.Item>
                  <Descriptions.Item label="Learning Rate">
                    {selectedJob.hyperparameters.learning_rate}
                  </Descriptions.Item>
                  <Descriptions.Item label="Optimizer">
                    AdamW
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            )}

            {/* Training Metrics */}
            {selectedJob.training_metrics && (
              <Card title="Training Metrics (Latest)" size="small">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title="Train Loss"
                      value={selectedJob.training_metrics.train_loss?.toFixed(4) || 'N/A'}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="Validation Loss"
                      value={selectedJob.training_metrics.val_loss?.toFixed(4) || 'N/A'}
                    />
                  </Col>
                </Row>

                {selectedJob.training_metrics.accuracy && (
                  <div style={{ marginTop: 16 }}>
                    <Title level={5}>Validation Accuracy by Attribute</Title>
                    <Row gutter={16}>
                      <Col span={6}>
                        <Statistic
                          title="Category"
                          value={(
                            selectedJob.training_metrics.accuracy.category * 100
                          ).toFixed(1)}
                          suffix="%"
                          valueStyle={{ color: '#52c41a' }}
                        />
                      </Col>
                      <Col span={6}>
                        <Statistic
                          title="Type"
                          value={(
                            selectedJob.training_metrics.accuracy.type * 100
                          ).toFixed(1)}
                          suffix="%"
                          valueStyle={{ color: '#1890ff' }}
                        />
                      </Col>
                      <Col span={6}>
                        <Statistic
                          title="Grade"
                          value={(
                            selectedJob.training_metrics.accuracy.grade * 100
                          ).toFixed(1)}
                          suffix="%"
                          valueStyle={{ color: '#722ed1' }}
                        />
                      </Col>
                      <Col span={6}>
                        <Statistic
                          title="Finish"
                          value={(
                            selectedJob.training_metrics.accuracy.finish * 100
                          ).toFixed(1)}
                          suffix="%"
                          valueStyle={{ color: '#faad14' }}
                        />
                      </Col>
                    </Row>
                  </div>
                )}
              </Card>
            )}

            {/* Model Path */}
            {selectedJob.model_path && (
              <Alert
                message="Model Saved"
                description={`Model saved at: ${selectedJob.model_path}`}
                type="success"
                showIcon
              />
            )}
          </Space>
        )}
      </Modal>
    </>
  );
};

export default TrainingJobs;
