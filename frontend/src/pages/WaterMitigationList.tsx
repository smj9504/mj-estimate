/**
 * Water Mitigation Job List Page
 * Displays all water mitigation jobs with filtering and actions
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Card,
  message,
  Popconfirm,
  Switch,
  Dropdown,
  Menu
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import waterMitigationService from '../services/waterMitigationService';
import type {
  WaterMitigationJob,
  JobFilters,
  JobStatus
} from '../types/waterMitigation';
import { JOB_STATUS_OPTIONS } from '../types/waterMitigation';
import JobFormModal from '../components/water-mitigation/JobFormModal';
import GoogleSheetsSyncButton from '../components/water-mitigation/GoogleSheetsSyncButton';

const { Search } = Input;
const { Option } = Select;

const WaterMitigationList: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<WaterMitigationJob[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<JobFilters>({
    page: 1,
    page_size: 20,
    active: true,  // Default: show active jobs only
    status: undefined,
    search: ''
  });
  const [formVisible, setFormVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<WaterMitigationJob | undefined>(undefined);

  // Load jobs
  const loadJobs = async () => {
    try {
      setLoading(true);
      const response = await waterMitigationService.getJobs(filters);
      setJobs(response.items);
      setTotal(response.total);
    } catch (error) {
      message.error('Failed to load jobs');
      console.error('Load jobs error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [filters]);

  // Handle search
  const handleSearch = (value: string) => {
    setFilters(prev => ({ ...prev, search: value, page: 1 }));
  };

  // Handle status filter change
  const handleStatusChange = (values: JobStatus[]) => {
    setFilters(prev => ({ ...prev, status: values.length > 0 ? values : undefined, page: 1 }));
  };

  // Handle active filter change
  const handleActiveChange = (value: string) => {
    const activeValue = value === 'all' ? undefined : value === 'active';
    setFilters(prev => ({ ...prev, active: activeValue, page: 1 }));
  };

  // Handle toggle active
  const handleToggleActive = async (jobId: string, currentActive: boolean) => {
    try {
      await waterMitigationService.toggleJobActive(jobId, !currentActive);
      message.success('Job status updated');
      loadJobs();
    } catch (error) {
      message.error('Failed to update job status');
      console.error('Toggle active error:', error);
    }
  };

  // Handle delete
  const handleDelete = async (jobId: string) => {
    try {
      await waterMitigationService.deleteJob(jobId);
      message.success('Job deleted successfully');
      loadJobs();
    } catch (error) {
      message.error('Failed to delete job');
      console.error('Delete error:', error);
    }
  };

  // Handle open create modal
  const handleOpenCreateModal = () => {
    setEditingJob(undefined);
    setFormVisible(true);
  };

  // Handle open edit modal
  const handleOpenEditModal = (job: WaterMitigationJob) => {
    setEditingJob(job);
    setFormVisible(true);
  };

  // Handle form success
  const handleFormSuccess = () => {
    setFormVisible(false);
    setEditingJob(undefined);
    loadJobs();
  };

  // Table columns
  const columns: ColumnsType<WaterMitigationJob> = [
    {
      title: 'Active',
      dataIndex: 'active',
      key: 'active',
      width: 80,
      render: (active: boolean, record) => (
        <Switch
          checked={active}
          onChange={() => handleToggleActive(record.id, active)}
          checkedChildren="ON"
          unCheckedChildren="OFF"
        />
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: JobStatus) => {
        const colors: Record<JobStatus, string> = {
          'Lead': 'blue',
          'Doc prepping': 'cyan',
          'Sent to adjuster': 'geekblue',
          'Follow up': 'orange',
          'Paperwork received': 'purple',
          'Check received': 'green',
          'Complete': 'success'
        };
        return <Tag color={colors[status]}>{status}</Tag>;
      }
    },
    {
      title: 'Property Address',
      dataIndex: 'property_address',
      key: 'property_address',
      ellipsis: true,
      render: (address: string, record) => (
        <a
          onClick={() => navigate(`/water-mitigation/${record.id}`)}
          style={{ color: '#1890ff', cursor: 'pointer' }}
        >
          {address}
        </a>
      )
    },
    {
      title: 'Homeowner',
      dataIndex: 'homeowner_name',
      key: 'homeowner_name',
      width: 150,
      ellipsis: true
    },
    {
      title: 'Insurance Company',
      dataIndex: 'insurance_company',
      key: 'insurance_company',
      width: 150,
      ellipsis: true
    },
    {
      title: 'Claim #',
      dataIndex: 'claim_number',
      key: 'claim_number',
      width: 120
    },
    {
      title: 'Photos',
      dataIndex: 'photo_count',
      key: 'photo_count',
      width: 80,
      render: (count: number) => count || 0
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => handleOpenEditModal(record)
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete',
                danger: true,
                onClick: () => {
                  // Show confirmation dialog
                  const confirmed = window.confirm('Delete this job?');
                  if (confirmed) {
                    handleDelete(record.id);
                  }
                }
              }
            ]
          }}
          trigger={['click']}
        >
          <Button type="text" icon={<MoreOutlined />} />
        </Dropdown>
      )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title="Water Mitigation Jobs"
        extra={
          <Space>
            <GoogleSheetsSyncButton
              onSyncComplete={loadJobs}
              type="default"
              size="middle"
              showStats={true}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreateModal}
            >
              New Job
            </Button>
          </Space>
        }
      >
        {/* Filters */}
        <Space style={{ marginBottom: 16, width: '100%' }} direction="vertical">
          <Space wrap>
            <Search
              placeholder="Search by address, homeowner, claim number..."
              allowClear
              onSearch={handleSearch}
              style={{ width: 400 }}
              prefix={<SearchOutlined />}
            />

            <Select
              mode="multiple"
              placeholder="Filter by status"
              style={{ minWidth: 200 }}
              onChange={handleStatusChange}
              allowClear
            >
              {JOB_STATUS_OPTIONS.map(option => (
                <Option key={option.value} value={option.value}>
                  {option.label}
                </Option>
              ))}
            </Select>

            <Select
              placeholder="Active status"
              style={{ width: 150 }}
              onChange={handleActiveChange}
              defaultValue="active"
            >
              <Option value="all">All</Option>
              <Option value="active">Active Only</Option>
              <Option value="inactive">Inactive Only</Option>
            </Select>
          </Space>
        </Space>

        {/* Table */}
        <Table
          columns={columns}
          dataSource={jobs}
          rowKey="id"
          loading={loading}
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total: total,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} jobs`,
            onChange: (page, pageSize) => {
              setFilters(prev => ({ ...prev, page, page_size: pageSize }));
            }
          }}
          scroll={{ x: 1200 }}
        />
      </Card>

      {/* Job Form Modal */}
      <JobFormModal
        visible={formVisible}
        onCancel={() => {
          setFormVisible(false);
          setEditingJob(undefined);
        }}
        onSuccess={handleFormSuccess}
        job={editingJob}
      />
    </div>
  );
};

export default WaterMitigationList;
