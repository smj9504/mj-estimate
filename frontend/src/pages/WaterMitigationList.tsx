/**
 * Water Mitigation Job List Page
 * Displays all water mitigation jobs with filtering and actions
 * Responsive: mobile card layout, desktop table layout
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
  Switch,
  Dropdown,
  Grid,
  List,
  Typography
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  RightOutlined
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
const { Text } = Typography;
const { useBreakpoint } = Grid;

const STATUS_COLORS: Record<JobStatus, string> = {
  'Lead': 'blue',
  'Doc prepping': 'cyan',
  'Sent to adjuster': 'geekblue',
  'Follow up': 'orange',
  'Paperwork received': 'purple',
  'Check received': 'green',
  'Complete': 'success'
};

const WaterMitigationList: React.FC = () => {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<WaterMitigationJob[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<JobFilters>({
    page: 1,
    page_size: 20,
    active: true,
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

  const handleSearch = (value: string) => {
    setFilters(prev => ({ ...prev, search: value, page: 1 }));
  };

  const handleStatusChange = (values: JobStatus[]) => {
    setFilters(prev => ({ ...prev, status: values.length > 0 ? values : undefined, page: 1 }));
  };

  const handleActiveChange = (value: string) => {
    const activeValue = value === 'all' ? undefined : value === 'active';
    setFilters(prev => ({ ...prev, active: activeValue, page: 1 }));
  };

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

  const handleOpenCreateModal = () => {
    setEditingJob(undefined);
    setFormVisible(true);
  };

  const handleOpenEditModal = (job: WaterMitigationJob) => {
    setEditingJob(job);
    setFormVisible(true);
  };

  const handleFormSuccess = () => {
    setFormVisible(false);
    setEditingJob(undefined);
    loadJobs();
  };

  // Table columns (desktop)
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
      render: (status: JobStatus) => (
        <Tag color={STATUS_COLORS[status]}>{status}</Tag>
      )
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
      title: 'Company',
      dataIndex: 'company',
      key: 'company',
      width: 120,
      ellipsis: true,
      render: (company: { id: string; name: string; company_code?: string } | undefined) =>
        company ? (
          <Tag color="blue">{company.company_code || company.name}</Tag>
        ) : null
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

  // Mobile card item renderer
  const renderMobileItem = (job: WaterMitigationJob) => (
    <List.Item
      style={{ padding: '12px 0' }}
      actions={[
        <Dropdown
          key="actions"
          menu={{
            items: [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: 'Edit',
                onClick: () => handleOpenEditModal(job)
              },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete',
                danger: true,
                onClick: () => {
                  const confirmed = window.confirm('Delete this job?');
                  if (confirmed) handleDelete(job.id);
                }
              }
            ]
          }}
          trigger={['click']}
        >
          <Button type="text" icon={<MoreOutlined />} />
        </Dropdown>
      ]}
    >
      <div
        style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
        onClick={() => navigate(`/water-mitigation/${job.id}`)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Tag color={STATUS_COLORS[job.status]}>{job.status}</Tag>
          {job.company && (
            <Tag color="blue">{job.company.company_code || job.company.name}</Tag>
          )}
          {!job.active && <Tag>INACTIVE</Tag>}
        </div>
        <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2 }}>
          {job.property_address}
        </Text>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {job.homeowner_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>{job.homeowner_name}</Text>
          )}
          {job.claim_number && (
            <Text type="secondary" style={{ fontSize: 12 }}>Claim: {job.claim_number}</Text>
          )}
          {(job.photo_count ?? 0) > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>Photos: {job.photo_count}</Text>
          )}
        </div>
      </div>
    </List.Item>
  );

  return (
    <div style={{ padding: isMobile ? '0' : '24px' }}>
      <Card
        title="Water Mitigation Jobs"
        extra={
          <Space size={isMobile ? 'small' : 'middle'}>
            {!isMobile && (
              <GoogleSheetsSyncButton
                onSyncComplete={loadJobs}
                type="default"
                size="middle"
                showStats={true}
              />
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreateModal}
            >
              {isMobile ? 'New' : 'New Job'}
            </Button>
          </Space>
        }
        styles={{
          header: isMobile ? { padding: '0 12px' } : undefined,
          body: isMobile ? { padding: '12px' } : undefined
        }}
      >
        {/* Filters */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 8,
            flexWrap: 'wrap'
          }}>
            <Search
              placeholder="Search address, homeowner, claim..."
              allowClear
              onSearch={handleSearch}
              style={{ width: isMobile ? '100%' : 400, minWidth: 0 }}
              prefix={<SearchOutlined />}
            />

            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              flex: isMobile ? undefined : 1
            }}>
              <Select
                mode="multiple"
                placeholder="Filter by status"
                style={{ minWidth: isMobile ? '100%' : 200, flex: isMobile ? '1 1 100%' : undefined }}
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
                style={{ width: isMobile ? '100%' : 150 }}
                onChange={handleActiveChange}
                defaultValue="active"
              >
                <Option value="all">All</Option>
                <Option value="active">Active Only</Option>
                <Option value="inactive">Inactive Only</Option>
              </Select>
            </div>
          </div>
        </div>

        {/* Mobile: Card List / Desktop: Table */}
        {isMobile ? (
          <List
            dataSource={jobs}
            loading={loading}
            renderItem={renderMobileItem}
            pagination={{
              current: filters.page,
              pageSize: filters.page_size,
              total: total,
              size: 'small',
              showTotal: (total) => `${total} jobs`,
              onChange: (page, pageSize) => {
                setFilters(prev => ({ ...prev, page, page_size: pageSize }));
              }
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={jobs}
            rowKey="id"
            loading={loading}
            onRow={(record) => ({
              onClick: (e) => {
                // Don't navigate if clicking on a link, button, or dropdown
                const target = e.target as HTMLElement;
                if (target.closest('a, button, .ant-dropdown-trigger, .ant-btn')) return;
                navigate(`/water-mitigation/${record.id}`);
              },
              style: { cursor: 'pointer' }
            })}
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
        )}
      </Card>

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
