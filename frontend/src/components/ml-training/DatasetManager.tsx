/**
 * Dataset Manager Component
 * Create and manage training datasets
 */

import React, { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  Tag,
  Typography,
  Progress,
  Tooltip,
  Popconfirm,
  message
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import {
  createDataset,
  deleteDataset,
  type TrainingDataset
} from '../../services/mlTrainingService';
import DatasetDetails from './DatasetDetails';

const { Text } = Typography;

// Helper function to extract error message
const getErrorMessage = (error: any): string => {
  if (error.response?.data?.detail) {
    const detail = error.response.data.detail;
    if (Array.isArray(detail)) {
      return detail.map((err: any) => err.msg || JSON.stringify(err)).join(', ');
    }
    if (typeof detail === 'object') {
      return detail.msg || detail.message || JSON.stringify(detail);
    }
    return detail;
  }
  return error.message || 'An error occurred';
};

interface DatasetManagerProps {
  datasets: TrainingDataset[];
  onDatasetChange: () => void;
}

const DatasetManager: React.FC<DatasetManagerProps> = ({
  datasets,
  onDatasetChange
}) => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<TrainingDataset | null>(null);
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);

  const handleCreateDataset = async (values: any) => {
    setCreating(true);
    try {
      await createDataset({
        name: values.name,
        description: values.description,
        train_split: values.train_split || 70,
        val_split: values.val_split || 20,
        test_split: values.test_split || 10
      });

      message.success('Dataset created successfully');
      setCreateModalVisible(false);
      form.resetFields();
      onDatasetChange();
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to create dataset');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDataset = async (datasetId: string) => {
    try {
      await deleteDataset(datasetId);
      message.success('Dataset deleted successfully');
      onDatasetChange();
    } catch (error: any) {
      message.error(getErrorMessage(error) || 'Failed to delete dataset');
    }
  };

  const handleViewDetails = (dataset: TrainingDataset) => {
    setSelectedDataset(dataset);
    setDetailsModalVisible(true);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'default',
      labeling: 'processing',
      ready: 'success',
      training: 'warning'
    };
    return colors[status] || 'default';
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: TrainingDataset) => (
        <div>
          <div><strong>{text}</strong></div>
          {record.description && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.description}
            </Text>
          )}
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={getStatusColor(status)}>
          {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Images',
      key: 'images',
      render: (_: any, record: TrainingDataset) => (
        <div>
          <div>Total: {record.total_images}</div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Labeled: {record.labeled_images} | Verified: {record.verified_images}
            </Text>
          </div>
          <Progress
            percent={
              record.total_images > 0
                ? Math.round((record.labeled_images / record.total_images) * 100)
                : 0
            }
            size="small"
            status={record.labeled_images === record.total_images ? 'success' : 'active'}
          />
        </div>
      )
    },
    {
      title: 'Splits',
      key: 'splits',
      render: (_: any, record: TrainingDataset) => (
        <div style={{ fontSize: 12 }}>
          <div>Train: {record.train_split}%</div>
          <div>Val: {record.val_split}%</div>
          <div>Test: {record.test_split}%</div>
        </div>
      )
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleDateString()
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: TrainingDataset) => (
        <Space>
          <Tooltip title="View Details">
            <Button
              type="link"
              icon={<EyeOutlined />}
              onClick={() => handleViewDetails(record)}
            />
          </Tooltip>

          {record.status === 'ready' && (
            <Tooltip title="Ready for Training">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
            </Tooltip>
          )}

          <Popconfirm
            title="Delete this dataset?"
            description="This action cannot be undone."
            onConfirm={() => handleDeleteDataset(record.id)}
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          Create Dataset
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={datasets}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showTotal: (total) => `Total ${total} datasets`
        }}
      />

      {/* Create Dataset Modal */}
      <Modal
        title="Create Training Dataset"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={creating}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateDataset}
        >
          <Form.Item
            name="name"
            label="Dataset Name"
            rules={[{ required: true, message: 'Please enter dataset name' }]}
          >
            <Input placeholder="e.g., Construction Materials v1" />
          </Form.Item>

          <Form.Item
            name="description"
            label="Description"
          >
            <Input.TextArea
              rows={3}
              placeholder="Optional description of this dataset"
            />
          </Form.Item>

          <Text strong style={{ display: 'block', marginBottom: 16 }}>
            Train/Validation/Test Splits
          </Text>

          <Space size="large">
            <Form.Item
              name="train_split"
              label="Train %"
              initialValue={70}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} />
            </Form.Item>

            <Form.Item
              name="val_split"
              label="Validation %"
              initialValue={20}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} />
            </Form.Item>

            <Form.Item
              name="test_split"
              label="Test %"
              initialValue={10}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Dataset Details Modal */}
      {selectedDataset && (
        <Modal
          title={`Dataset: ${selectedDataset.name}`}
          open={detailsModalVisible}
          onCancel={() => {
            setDetailsModalVisible(false);
            setSelectedDataset(null);
          }}
          footer={null}
          width={1000}
        >
          <DatasetDetails
            dataset={selectedDataset}
            onClose={() => {
              setDetailsModalVisible(false);
              setSelectedDataset(null);
              onDatasetChange();
            }}
          />
        </Modal>
      )}
    </>
  );
};

export default DatasetManager;
