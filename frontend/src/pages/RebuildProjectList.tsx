import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Statistic, Tooltip, Badge,
  Dropdown, Descriptions, DatePicker, Divider, Empty, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EllipsisOutlined, DeleteOutlined,
  BuildOutlined, TeamOutlined, FileTextOutlined, CheckCircleOutlined,
  ToolOutlined, HomeOutlined, DollarOutlined, SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { rebuildService } from '../services/rebuildService';
import type {
  RebuildProject, RebuildProjectCreate, RebuildContractor,
  RebuildCompletionDoc, ProjectStatus, PROJECT_STATUS_COLORS, DOC_TYPE_LABELS,
} from '../types/rebuild';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = {
  pending: 'default', assigned: 'blue', in_progress: 'processing',
  completed: 'green', invoiced: 'cyan', docs_sent: 'geekblue', closed: 'default',
};

const DOC_LABELS: Record<string, string> = {
  coc: 'COC', invoice: 'Invoice', completion_photo: 'Photos',
  warranty: 'Warranty', permit: 'Permit', lien_waiver: 'Lien Waiver', other: 'Other',
};

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const RebuildProjectList: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [contractorModalOpen, setContractorModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<RebuildProject | null>(null);
  const [createForm] = Form.useForm();
  const [contractorForm] = Form.useForm();
  const [docForm] = Form.useForm();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['rebuild-stats'],
    queryFn: () => rebuildService.getStats(),
  });
  const { data: projects = [], isLoading, refetch } = useQuery({
    queryKey: ['rebuild-projects', statusFilter],
    queryFn: () => rebuildService.listProjects({ status: statusFilter, page_size: 100 }),
  });
  const { data: contractors = [] } = useQuery({
    queryKey: ['rebuild-contractors'],
    queryFn: () => rebuildService.listContractors(),
  });

  const createProjectMutation = useMutation({
    mutationFn: (data: RebuildProjectCreate) => rebuildService.createProject(data),
    onSuccess: () => {
      message.success('Project created');
      setCreateModalOpen(false);
      createForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Failed'),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RebuildProject> }) =>
      rebuildService.updateProject(id, data),
    onSuccess: () => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
      if (selectedProject) rebuildService.getProject(selectedProject.id).then(setSelectedProject);
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => rebuildService.deleteProject(id),
    onSuccess: () => {
      message.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
    },
  });

  const createContractorMutation = useMutation({
    mutationFn: (data: Partial<RebuildContractor>) => rebuildService.createContractor(data),
    onSuccess: () => {
      message.success('Contractor added');
      setContractorModalOpen(false);
      contractorForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['rebuild-contractors'] });
    },
  });

  const createDocMutation = useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: Partial<RebuildCompletionDoc> }) =>
      rebuildService.createDoc(projectId, data),
    onSuccess: () => {
      message.success('Document added');
      setDocModalOpen(false);
      docForm.resetFields();
      if (selectedProject) rebuildService.getProject(selectedProject.id).then(setSelectedProject);
    },
  });

  const columns: ColumnsType<RebuildProject> = [
    {
      title: 'Property', key: 'property', ellipsis: true,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.title}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.property_address}</Text>
        </Space>
      ),
    },
    {
      title: 'Claim', key: 'claim', width: 120,
      render: (_, r) => <Text type="secondary">{r.claim_number || '-'}</Text>,
    },
    {
      title: 'Contractor', key: 'contractor', width: 150,
      render: (_, r) => r.contractor_name || <Text type="secondary">Unassigned</Text>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: (s: string) => <Tag color={STATUS_COLORS[s] || 'default'}>{s.replace('_', ' ').toUpperCase()}</Tag>,
    },
    {
      title: 'Contract $', dataIndex: 'contract_amount', width: 110, align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Docs', key: 'docs', width: 70, align: 'center',
      render: (_, r) => {
        const sent = [r.coc_sent, r.invoice_sent, r.photos_sent].filter(Boolean).length;
        return <Badge count={`${sent}/3`} style={{ backgroundColor: sent === 3 ? '#52c41a' : '#faad14' }} />;
      },
    },
    {
      title: '', key: 'actions', width: 80,
      render: (_, r) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => {
            rebuildService.getProject(r.id).then(p => { setSelectedProject(p); setDetailModalOpen(true); });
          }}>Detail</Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <BuildOutlined style={{ marginRight: 8 }} />
          Rebuild Projects
        </Title>
        <Space>
          <Button icon={<TeamOutlined />} onClick={() => setContractorModalOpen(true)}>Add Contractor</Button>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>New Project</Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          { title: 'In Progress', value: stats?.in_progress, icon: <ToolOutlined />, color: '#722ed1' },
          { title: 'Completed', value: stats?.completed, icon: <CheckCircleOutlined />, color: '#52c41a' },
          { title: 'Total $', value: stats?.total_contract_amount, icon: <DollarOutlined />, prefix: '$', color: '#1890ff' },
          { title: 'Contractors', value: stats?.total_contractors, icon: <TeamOutlined />, color: '#fa8c16' },
        ].map(s => (
          <Col xs={12} sm={6} key={s.title}>
            <Card size="small">
              <Statistic title={s.title} value={s.value || 0} prefix={s.prefix || s.icon}
                loading={statsLoading} valueStyle={{ fontSize: 20, color: s.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* Filter */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Select placeholder="Filter by status" allowClear style={{ width: 180 }}
          value={statusFilter} onChange={setStatusFilter}
          options={['pending','assigned','in_progress','completed','invoiced','docs_sent','closed']
            .map(s => ({ value: s, label: s.replace('_',' ').toUpperCase() }))} />
      </Card>

      <Card>
        <Table dataSource={projects} columns={columns} rowKey="id" loading={isLoading}
          size="small" scroll={{ x: 800 }}
          pagination={{ pageSize: 20, showTotal: t => `${t} projects` }} />
      </Card>

      {/* Create Project Modal */}
      <Modal title="Create Rebuild Project" open={createModalOpen} width={550}
        onOk={() => createForm.validateFields().then(v => {
          createProjectMutation.mutate({
            ...v,
            start_date: v.start_date?.toISOString(),
            estimated_completion: v.estimated_completion?.toISOString(),
          });
        })}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        confirmLoading={createProjectMutation.isPending}>
        <Form form={createForm} layout="vertical" size="small">
          <Form.Item name="claim_id" label="Claim ID" rules={[{ required: true }]}>
            <Input placeholder="Claim UUID" />
          </Form.Item>
          <Form.Item name="title" label="Project Title" rules={[{ required: true }]}>
            <Input placeholder="e.g., 123 Main St - Full Rebuild" />
          </Form.Item>
          <Form.Item name="contractor_id" label="Contractor">
            <Select allowClear placeholder="Assign contractor"
              options={contractors.map(c => ({ value: c.id, label: c.company_name }))} />
          </Form.Item>
          <Form.Item name="scope_of_work" label="Scope of Work">
            <TextArea rows={3} placeholder="Describe the work to be done" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="insurance_estimate_amount" label="Insurance Est. $">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contract_amount" label="Contract $">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="start_date" label="Start Date">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="estimated_completion" label="Est. Completion">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Add Contractor Modal */}
      <Modal title="Add Contractor" open={contractorModalOpen} width={450}
        onOk={() => contractorForm.validateFields().then(v => createContractorMutation.mutate(v))}
        onCancel={() => { setContractorModalOpen(false); contractorForm.resetFields(); }}
        confirmLoading={createContractorMutation.isPending}>
        <Form form={contractorForm} layout="vertical" size="small">
          <Form.Item name="company_name" label="Company Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="contact_name" label="Contact Name"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="Phone"><Input /></Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="Email"><Input /></Form.Item>
          <Form.Item name="specialty" label="Specialty">
            <Select options={['general','plumbing','electrical','flooring','painting','roofing','hvac','other']
              .map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Project Detail Modal */}
      <Modal title={selectedProject?.title} open={detailModalOpen} width={700} footer={null}
        onCancel={() => { setDetailModalOpen(false); setSelectedProject(null); }}>
        {selectedProject && (
          <div>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Claim #">{selectedProject.claim_number}</Descriptions.Item>
              <Descriptions.Item label="Contractor">{selectedProject.contractor_name || 'Unassigned'}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Select size="small" value={selectedProject.status} style={{ width: 140 }}
                  onChange={v => updateProjectMutation.mutate({ id: selectedProject.id, data: { status: v } })}
                  options={['pending','assigned','in_progress','completed','invoiced','docs_sent','closed']
                    .map(s => ({ value: s, label: s.replace('_',' ').toUpperCase() }))} />
              </Descriptions.Item>
              <Descriptions.Item label="Property">{selectedProject.property_address}</Descriptions.Item>
              <Descriptions.Item label="Insurance $">{formatCurrency(selectedProject.insurance_estimate_amount)}</Descriptions.Item>
              <Descriptions.Item label="Contract $">{formatCurrency(selectedProject.contract_amount)}</Descriptions.Item>
              <Descriptions.Item label="Start">{selectedProject.start_date ? dayjs(selectedProject.start_date).format('MM/DD/YYYY') : '-'}</Descriptions.Item>
              <Descriptions.Item label="Est. Completion">{selectedProject.estimated_completion ? dayjs(selectedProject.estimated_completion).format('MM/DD/YYYY') : '-'}</Descriptions.Item>
            </Descriptions>

            {selectedProject.scope_of_work && (
              <div style={{ marginBottom: 16 }}>
                <Text type="secondary">Scope of Work:</Text>
                <div style={{ whiteSpace: 'pre-wrap' }}>{selectedProject.scope_of_work}</div>
              </div>
            )}

            <Divider style={{ margin: '12px 0' }} />

            {/* Completion Documents */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>Completion Documents</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setDocModalOpen(true)}>Add Document</Button>
            </div>

            {(selectedProject.completion_docs || []).length === 0 ? (
              <Empty description="No documents yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table size="small" dataSource={selectedProject.completion_docs} rowKey="id" pagination={false}
                columns={[
                  { title: 'Type', dataIndex: 'doc_type', width: 120,
                    render: (t: string) => <Tag>{DOC_LABELS[t] || t}</Tag> },
                  { title: 'Title', dataIndex: 'title', ellipsis: true },
                  { title: 'Status', dataIndex: 'status', width: 100,
                    render: (s: string) => <Tag color={s === 'sent' ? 'green' : 'default'}>{s.toUpperCase()}</Tag> },
                  { title: 'File', dataIndex: 'file_name', width: 120, ellipsis: true,
                    render: (f?: string) => f || '-' },
                ]} />
            )}

            {/* Doc Status Summary */}
            <Divider style={{ margin: '12px 0' }} />
            <Space>
              <Tag color={selectedProject.coc_sent ? 'green' : 'default'}>COC {selectedProject.coc_sent ? 'Sent' : 'Pending'}</Tag>
              <Tag color={selectedProject.invoice_sent ? 'green' : 'default'}>Invoice {selectedProject.invoice_sent ? 'Sent' : 'Pending'}</Tag>
              <Tag color={selectedProject.photos_sent ? 'green' : 'default'}>Photos {selectedProject.photos_sent ? 'Sent' : 'Pending'}</Tag>
            </Space>
          </div>
        )}
      </Modal>

      {/* Add Document Modal */}
      <Modal title="Add Completion Document" open={docModalOpen} width={450}
        onOk={() => docForm.validateFields().then(v => {
          if (selectedProject) {
            createDocMutation.mutate({
              projectId: selectedProject.id,
              data: { ...v, project_id: selectedProject.id },
            });
          }
        })}
        onCancel={() => { setDocModalOpen(false); docForm.resetFields(); }}
        confirmLoading={createDocMutation.isPending}>
        <Form form={docForm} layout="vertical" size="small">
          <Form.Item name="doc_type" label="Document Type" rules={[{ required: true }]}>
            <Select options={Object.entries(DOC_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Document title" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RebuildProjectList;
