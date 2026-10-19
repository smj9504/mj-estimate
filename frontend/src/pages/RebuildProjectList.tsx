import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Space, Modal, Form, Input, InputNumber,
  Select, message, Typography, Row, Col, Statistic, Badge, DatePicker,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, BuildOutlined, TeamOutlined, CheckCircleOutlined,
  ToolOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { rebuildService } from '../services/rebuildService';
import RebuildProjectDetailModal from '../components/rebuild/RebuildProjectDetailModal';
import {
  REBUILD_STATUSES, RebuildStatusPill, rebuildStatusLabel, formatCurrency,
} from '../components/rebuild/rebuildUi';
import ClaimSearchSelect from '../components/common/ClaimSearchSelect';
import type {
  RebuildProject, RebuildProjectCreate, RebuildContractor,
} from '../types/rebuild';
import type { ColumnsType } from 'antd/es/table';
import '../components/rebuild/rebuild.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

const RebuildProjectList: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [contractorModalOpen, setContractorModalOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState<RebuildProject | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [contractorForm] = Form.useForm();

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

  // ?project=<id> 로 진입하면 해당 프로젝트 상세를 자동으로 연다 (다른 화면에서 행 클릭 시)
  const [searchParams, setSearchParams] = useSearchParams();
  const openedProjectParam = useRef<string | null>(null);
  const projectParam = searchParams.get('project');
  useEffect(() => {
    if (!projectParam || openedProjectParam.current === projectParam) return;
    openedProjectParam.current = projectParam;
    setDetailProjectId(projectParam);
    searchParams.delete('project');
    setSearchParams(searchParams, { replace: true });
  }, [projectParam, searchParams, setSearchParams]);

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
    onSuccess: (_, { id }) => {
      message.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
      queryClient.invalidateQueries({ queryKey: ['rebuild-project', id] });
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Could not update the project'),
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

  const columns: ColumnsType<RebuildProject> = [
    {
      title: 'Property', key: 'property', ellipsis: true,
      render: (_, r) => <span className="rb-list-address">{r.property_address || r.title}</span>,
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
      render: (s: string) => <RebuildStatusPill status={s} />,
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
  ];

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <BuildOutlined style={{ marginRight: 8 }} />
          Rebuild Projects
        </Title>
        <Space wrap>
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
          options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))} />
      </Card>

      <Card>
        <Table dataSource={projects} columns={columns} rowKey="id" loading={isLoading}
          size="small" scroll={{ x: 800 }}
          pagination={{ pageSize: 20, showTotal: t => `${t} projects` }}
          onRow={(record) => ({
            onClick: () => setDetailProjectId(record.id),
            style: { cursor: 'pointer' },
          })} />
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
          <Form.Item name="claim_id" label="Claim" rules={[{ required: true, message: 'Please select a claim' }]}>
            <ClaimSearchSelect />
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
      <RebuildProjectDetailModal
        projectId={detailProjectId}
        open={!!detailProjectId}
        onClose={() => setDetailProjectId(null)}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['rebuild-projects'] });
          queryClient.invalidateQueries({ queryKey: ['rebuild-stats'] });
        }}
        onEdit={(p) => {
          editForm.setFieldsValue({
            title: p.title,
            description: p.description,
            scope_of_work: p.scope_of_work,
            property_address: p.property_address,
            status: p.status,
            priority: p.priority,
            contractor_id: p.contractor_id,
            insurance_estimate_amount: p.insurance_estimate_amount,
            contract_amount: p.contract_amount,
            final_invoice_amount: p.final_invoice_amount,
            start_date: p.start_date ? dayjs(p.start_date) : undefined,
            estimated_completion: p.estimated_completion ? dayjs(p.estimated_completion) : undefined,
            notes: p.notes,
          });
          setEditProject(p);
        }}
      />

      {/* Edit Project Modal */}
      <Modal title="Edit Project" open={!!editProject} width={600}
        onOk={() => editForm.validateFields().then(values => {
          if (editProject) {
            const payload = {
              ...values,
              start_date: values.start_date?.toISOString() || null,
              estimated_completion: values.estimated_completion?.toISOString() || null,
            };
            updateProjectMutation.mutate({ id: editProject.id, data: payload });
            setEditProject(null);
          }
        })}
        onCancel={() => { setEditProject(null); editForm.resetFields(); }}
        confirmLoading={updateProjectMutation.isPending}>
        <Form form={editForm} layout="vertical" size="small">
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="status" label="Status">
                <Select options={REBUILD_STATUSES.map(s => ({ value: s, label: rebuildStatusLabel(s) }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="Priority">
                <Select options={[
                  { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="contractor_id" label="Contractor">
            <Select allowClear placeholder="Select contractor"
              options={contractors.map((c: RebuildContractor) => ({ value: c.id, label: c.company_name }))} />
          </Form.Item>
          <Form.Item name="property_address" label="Property Address">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="insurance_estimate_amount" label="Insurance $">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contract_amount" label="Contract $">
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="final_invoice_amount" label="Final Invoice $">
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
          <Form.Item name="scope_of_work" label="Scope of Work">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

    </div>
  );
};

export default RebuildProjectList;
