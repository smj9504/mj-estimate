import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Descriptions,
  Button,
  Space,
  Tag,
  Tabs,
  Table,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  DatePicker,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Divider,
  Spin,
  Alert,
  Tooltip,
  Statistic,
  Collapse,
  Badge,
  Checkbox,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  UserOutlined,
  FileTextOutlined,
  MinusCircleOutlined,
  DollarOutlined,
  SafetyOutlined,
  HomeOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { clientService, claimService, negotiationService } from '../services/clientService';
import type {
  Client,
  ClientCreate,
  OwnerInfo,
  Claim,
  ClaimCreate,
  ClaimStatus,
  ClaimNegotiation,
  ClaimNegotiationCreate,
} from '../types/client';
import type { ColumnsType } from 'antd/es/table';

const { Title, Text } = Typography;
const { Option } = Select;
const { Panel } = Collapse;

// ─────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

const CLAIM_STATUS_CONFIG: Record<
  ClaimStatus,
  { color: string; label: string }
> = {
  open:        { color: 'blue',    label: 'Open' },
  negotiating: { color: 'orange',  label: 'Negotiating' },
  settled:     { color: 'green',   label: 'Settled' },
  closed:      { color: 'default', label: 'Closed' },
  denied:      { color: 'red',     label: 'Denied' },
};

const REVISION_TYPE_CONFIG: Record<
  ClaimNegotiation['revision_type'],
  { color: string; label: string }
> = {
  initial:       { color: 'blue',   label: 'Initial' },
  supplement:    { color: 'orange', label: 'Supplement' },
  re_inspection: { color: 'purple', label: 'Re-Inspection' },
  appraisal:     { color: 'cyan',   label: 'Appraisal' },
  final:         { color: 'green',  label: 'Final' },
};

const formatCurrency = (amount?: number) =>
  amount != null
    ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

const formatDate = (dateStr?: string) =>
  dateStr ? dayjs(dateStr).format('MM/DD/YYYY') : '—';

const primaryOwner = (owners: OwnerInfo[]) =>
  owners.find((o) => o.is_primary) ?? owners[0];

// ─────────────────────────────────────────────
// Edit Client Modal
// ─────────────────────────────────────────────

interface EditClientModalProps {
  open: boolean;
  client: Client;
  onCancel: () => void;
  onSubmit: (values: Partial<ClientCreate>) => Promise<void>;
  loading: boolean;
}

const EditClientModal: React.FC<EditClientModalProps> = ({
  open,
  client,
  onCancel,
  onSubmit,
  loading,
}) => {
  const [form] = Form.useForm<ClientCreate>();

  React.useEffect(() => {
    if (open) {
      form.setFieldsValue({
        display_name: client.display_name,
        owners: client.owners.length > 0 ? client.owners : [{ name: '', is_primary: true }],
        address: client.address,
        city: client.city,
        state: client.state,
        zipcode: client.zipcode,
        phone: client.phone,
        email: client.email,
        insurance_company: client.insurance_company,
        insurance_policy_number: client.insurance_policy_number,
        notes: client.notes,
      });
    }
  }, [open, client, form]);

  const handleFinish = async (values: ClientCreate) => {
    const owners = values.owners ?? [];
    const hasPrimary = owners.some((o) => o.is_primary);
    if (!hasPrimary && owners.length > 0) owners[0].is_primary = true;
    await onSubmit({ ...values, owners });
  };

  return (
    <Modal
      title={
        <Space>
          <EditOutlined />
          Edit Client
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={760}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form form={form} layout="vertical" onFinish={handleFinish} scrollToFirstError>
        <Form.Item
          name="display_name"
          label="Display Name"
          rules={[{ required: true, message: 'Display name is required' }]}
        >
          <Input />
        </Form.Item>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Owners</Divider>
        <Form.List
          name="owners"
          rules={[
            {
              validator: async (_, owners) => {
                if (!owners || owners.length < 1)
                  return Promise.reject(new Error('At least one owner is required'));
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Card key={key} size="small" style={{ marginBottom: 12, background: '#fafafa' }}
                  extra={
                    fields.length > 1 ? (
                      <MinusCircleOutlined
                        style={{ color: '#ff4d4f', cursor: 'pointer' }}
                        onClick={() => remove(name)}
                      />
                    ) : null
                  }
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={10}>
                      <Form.Item {...restField} name={[name, 'name']} label="Name"
                        rules={[{ required: true, message: 'Required' }]} style={{ marginBottom: 8 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={7}>
                      <Form.Item {...restField} name={[name, 'phone']} label="Phone" style={{ marginBottom: 8 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={7}>
                      <Form.Item {...restField} name={[name, 'email']} label="Email"
                        rules={[{ type: 'email', message: 'Invalid email' }]} style={{ marginBottom: 8 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item {...restField} name={[name, 'is_primary']} valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Checkbox>Primary contact</Checkbox>
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ))}
              <Form.Item>
                <Button type="dashed" onClick={() => add({ name: '', is_primary: false })} icon={<PlusOutlined />} block>
                  Add Owner
                </Button>
                <Form.ErrorList errors={errors} />
              </Form.Item>
            </>
          )}
        </Form.List>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Address</Divider>
        <Form.Item name="address" label="Street Address">
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={10}><Form.Item name="city" label="City"><Input /></Form.Item></Col>
          <Col xs={24} sm={7}>
            <Form.Item name="state" label="State">
              <Select showSearch allowClear>
                {US_STATES.map((s) => <Option key={s} value={s}>{s}</Option>)}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={7}><Form.Item name="zipcode" label="Zipcode"><Input /></Form.Item></Col>
        </Row>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Contact</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="phone" label="Phone"><Input /></Form.Item></Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Invalid email' }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Insurance</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="insurance_company" label="Insurance Company"><Input /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="insurance_policy_number" label="Policy Number"><Input /></Form.Item></Col>
        </Row>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>Save Changes</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─────────────────────────────────────────────
// Add / Edit Claim Modal
// ─────────────────────────────────────────────

interface ClaimModalProps {
  open: boolean;
  clientId: string;
  editingClaim?: Claim | null;
  onCancel: () => void;
  onSubmit: (values: ClaimCreate) => Promise<void>;
  loading: boolean;
}

const ClaimModal: React.FC<ClaimModalProps> = ({
  open,
  clientId,
  editingClaim,
  onCancel,
  onSubmit,
  loading,
}) => {
  const [form] = Form.useForm<ClaimCreate>();

  React.useEffect(() => {
    if (open) {
      if (editingClaim) {
        form.setFieldsValue({
          claim_number: editingClaim.claim_number,
          insurance_company: editingClaim.insurance_company,
          insurance_policy_number: editingClaim.insurance_policy_number,
          insurance_deductible: editingClaim.insurance_deductible,
          adjuster_name: editingClaim.adjuster_name,
          adjuster_phone: editingClaim.adjuster_phone,
          adjuster_email: editingClaim.adjuster_email,
          date_of_loss: editingClaim.date_of_loss ? dayjs(editingClaim.date_of_loss) as any : undefined,
          loss_description: editingClaim.loss_description,
          status: editingClaim.status,
          notes: editingClaim.notes,
          initial_acv: editingClaim.current_acv,
          initial_rcv: editingClaim.current_rcv,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, editingClaim, form]);

  const handleFinish = async (values: any) => {
    const payload: ClaimCreate = {
      ...values,
      client_id: clientId,
      date_of_loss: values.date_of_loss ? dayjs(values.date_of_loss).format('YYYY-MM-DD') : undefined,
    };
    await onSubmit(payload);
  };

  return (
    <Modal
      title={
        <Space>
          <SafetyOutlined />
          {editingClaim ? 'Edit Claim' : 'Add New Claim'}
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={700}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form form={form} layout="vertical" onFinish={handleFinish} scrollToFirstError>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="claim_number" label="Claim Number"
              rules={[{ required: true, message: 'Claim number is required' }]}>
              <Input placeholder="CLM-2024-001" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="status" label="Status" initialValue="open">
              <Select>
                {Object.entries(CLAIM_STATUS_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Insurance Details</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="insurance_company" label="Insurance Company">
              <Input placeholder="e.g. Allstate" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="insurance_policy_number" label="Policy Number">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="insurance_deductible" label="Deductible">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="date_of_loss" label="Date of Loss">
              <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Adjuster</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="adjuster_name" label="Adjuster Name">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="adjuster_phone" label="Adjuster Phone">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="adjuster_email" label="Adjuster Email"
              rules={[{ type: 'email', message: 'Invalid email' }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Initial Amounts</Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="initial_acv" label="Initial ACV">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="initial_rcv" label="Initial RCV">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="loss_description" label="Loss Description">
          <Input.TextArea rows={2} placeholder="Brief description of the loss event..." />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingClaim ? 'Save Changes' : 'Create Claim'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─────────────────────────────────────────────
// Add Negotiation Modal
// ─────────────────────────────────────────────

interface NegotiationModalProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (values: Omit<ClaimNegotiationCreate, 'claim_id'>) => Promise<void>;
  loading: boolean;
}

const NegotiationModal: React.FC<NegotiationModalProps> = ({
  open,
  onCancel,
  onSubmit,
  loading,
}) => {
  const [form] = Form.useForm<Omit<ClaimNegotiationCreate, 'claim_id'>>();

  React.useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const handleFinish = async (values: any) => {
    const payload = {
      ...values,
      date_received: values.date_received
        ? dayjs(values.date_received).format('YYYY-MM-DD')
        : undefined,
    };
    await onSubmit(payload);
  };

  return (
    <Modal
      title={
        <Space>
          <DollarOutlined />
          Add Negotiation Revision
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={600}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form form={form} layout="vertical" onFinish={handleFinish} scrollToFirstError>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="revision_type" label="Revision Type"
              rules={[{ required: true, message: 'Revision type is required' }]}>
              <Select placeholder="Select type">
                {Object.entries(REVISION_TYPE_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="date_received" label="Date Received">
              <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="acv_amount" label="ACV Amount">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="rcv_amount" label="RCV Amount">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="depreciation_amount" label="Depreciation">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="deductible" label="Deductible">
              <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="received_from" label="Received From">
              <Input placeholder="e.g. Adjuster name" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>Add Revision</Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─────────────────────────────────────────────
// Negotiation History Table (inside Collapse)
// ─────────────────────────────────────────────

interface NegotiationHistoryProps {
  clientId: string;
  claim: Claim;
}

const NegotiationHistory: React.FC<NegotiationHistoryProps> = ({ clientId, claim }) => {
  const [negModalOpen, setNegModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['negotiations', clientId, claim.id],
    queryFn: () => negotiationService.listByClaim(clientId, claim.id),
  });

  const negotiations = data?.negotiations ?? [];

  const createNegMutation = useMutation({
    mutationFn: (payload: Omit<ClaimNegotiationCreate, 'claim_id'>) =>
      negotiationService.create(clientId, claim.id, { ...payload, claim_id: claim.id }),
    onSuccess: () => {
      message.success('Negotiation revision added.');
      queryClient.invalidateQueries({ queryKey: ['negotiations', clientId, claim.id] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      setNegModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to add revision.');
    },
  });

  // Sort by revision number for delta calculation
  const sorted = [...negotiations].sort((a, b) => a.revision_number - b.revision_number);

  const columns: ColumnsType<ClaimNegotiation> = [
    {
      title: 'Rev #',
      dataIndex: 'revision_number',
      key: 'revision_number',
      width: 60,
      align: 'center',
    },
    {
      title: 'Type',
      dataIndex: 'revision_type',
      key: 'revision_type',
      width: 130,
      render: (type: ClaimNegotiation['revision_type']) => {
        const cfg = REVISION_TYPE_CONFIG[type];
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'ACV',
      dataIndex: 'acv_amount',
      key: 'acv_amount',
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'RCV',
      dataIndex: 'rcv_amount',
      key: 'rcv_amount',
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Depreciation',
      dataIndex: 'depreciation_amount',
      key: 'depreciation_amount',
      align: 'right',
      render: formatCurrency,
      responsive: ['lg'],
    },
    {
      title: 'Delta RCV',
      key: 'delta',
      align: 'right',
      render: (_: any, record) => {
        const idx = sorted.findIndex((n) => n.id === record.id);
        if (idx <= 0) return <Text type="secondary">—</Text>;
        const prev = sorted[idx - 1];
        const delta = record.rcv_amount - prev.rcv_amount;
        if (delta === 0) return <Text type="secondary">$0.00</Text>;
        return (
          <Text type={delta > 0 ? 'success' : 'danger'}>
            {delta > 0 ? '+' : ''}{formatCurrency(delta)}
          </Text>
        );
      },
    },
    {
      title: 'Date Received',
      dataIndex: 'date_received',
      key: 'date_received',
      render: formatDate,
      responsive: ['md'],
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong>Negotiation History</Text>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setNegModalOpen(true)}>
          Add Revision
        </Button>
      </div>

      <Table<ClaimNegotiation>
        rowKey="id"
        columns={columns}
        dataSource={sorted}
        loading={isLoading}
        size="small"
        pagination={false}
        scroll={{ x: 600 }}
      />

      {/* Linked Documents */}
      <Divider style={{ margin: '16px 0 8px' }} />
      <Row gutter={16}>
        <Col>
          <Space>
            <FileTextOutlined style={{ color: '#1890ff' }} />
            <Text type="secondary">Invoices: <strong>{claim.invoice_count}</strong></Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <FileTextOutlined style={{ color: '#52c41a' }} />
            <Text type="secondary">Estimates: <strong>{claim.estimate_count}</strong></Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <FileTextOutlined style={{ color: '#722ed1' }} />
            <Text type="secondary">WM Jobs: <strong>{claim.wm_job_count}</strong></Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <FileTextOutlined style={{ color: '#fa8c16' }} />
            <Text type="secondary">Work Orders: <strong>{claim.work_order_count}</strong></Text>
          </Space>
        </Col>
      </Row>

      <NegotiationModal
        open={negModalOpen}
        onCancel={() => setNegModalOpen(false)}
        onSubmit={async (vals) => { await createNegMutation.mutateAsync(vals); }}
        loading={createNegMutation.isPending}
      />
    </div>
  );
};

// ─────────────────────────────────────────────
// Claims Tab
// ─────────────────────────────────────────────

interface ClaimsTabProps {
  client: Client;
}

const ClaimsTab: React.FC<ClaimsTabProps> = ({ client }) => {
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['claims', client.id],
    queryFn: () => claimService.listByClient(client.id),
  });

  const claims = data?.claims ?? [];

  const createClaimMutation = useMutation({
    mutationFn: (payload: ClaimCreate) => claimService.create(client.id, payload),
    onSuccess: () => {
      message.success('Claim created.');
      queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
      queryClient.invalidateQueries({ queryKey: ['client', client.id] });
      setClaimModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to create claim.');
    },
  });

  const updateClaimMutation = useMutation({
    mutationFn: ({ claimId, payload }: { claimId: string; payload: Partial<ClaimCreate> }) =>
      claimService.update(client.id, claimId, payload),
    onSuccess: () => {
      message.success('Claim updated.');
      queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
      setClaimModalOpen(false);
      setEditingClaim(null);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to update claim.');
    },
  });

  const deleteClaimMutation = useMutation({
    mutationFn: (claimId: string) => claimService.delete(client.id, claimId),
    onSuccess: () => {
      message.success('Claim deleted.');
      queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to delete claim.');
    },
  });

  const handleClaimSubmit = async (values: ClaimCreate) => {
    if (editingClaim) {
      await updateClaimMutation.mutateAsync({ claimId: editingClaim.id, payload: values });
    } else {
      await createClaimMutation.mutateAsync(values);
    }
  };

  const columns: ColumnsType<Claim> = [
    {
      title: 'Claim #',
      dataIndex: 'claim_number',
      key: 'claim_number',
      render: (num: string) => <Text strong>{num}</Text>,
    },
    {
      title: 'Insurance Co.',
      dataIndex: 'insurance_company',
      key: 'insurance_company',
      render: (val?: string) => val || '—',
      responsive: ['md'],
    },
    {
      title: 'Date of Loss',
      dataIndex: 'date_of_loss',
      key: 'date_of_loss',
      render: formatDate,
      responsive: ['md'],
    },
    {
      title: 'ACV',
      dataIndex: 'current_acv',
      key: 'current_acv',
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'RCV',
      dataIndex: 'current_rcv',
      key: 'current_rcv',
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: ClaimStatus) => {
        const cfg = CLAIM_STATUS_CONFIG[status];
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Docs',
      key: 'docs',
      align: 'center',
      width: 80,
      render: (_: any, record) => {
        const total =
          record.invoice_count +
          record.estimate_count +
          record.wm_job_count +
          record.work_order_count;
        return <Badge count={total} style={{ backgroundColor: total > 0 ? '#1890ff' : '#d9d9d9' }} />;
      },
      responsive: ['sm'],
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 90,
      align: 'center',
      render: (_: any, record) => (
        <Space size="small">
          <Tooltip title="Edit claim">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingClaim(record);
                setClaimModalOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this claim?"
            description="All negotiations linked to this claim will also be removed."
            onConfirm={() => deleteClaimMutation.mutate(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
          >
            <Button type="text" size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingClaim(null);
            setClaimModalOpen(true);
          }}
        >
          Add Claim
        </Button>
      </div>

      {claims.length === 0 && !isLoading ? (
        <Card style={{ textAlign: 'center', padding: '40px 0' }}>
          <SafetyOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
          <div>
            <Text type="secondary">No claims yet. Click "Add Claim" to get started.</Text>
          </div>
        </Card>
      ) : (
        <Collapse accordion>
          {claims.map((claim) => {
            const statusCfg = CLAIM_STATUS_CONFIG[claim.status];
            return (
              <Panel
                key={claim.id}
                header={
                  <Row align="middle" gutter={16} style={{ width: '100%' }}>
                    <Col flex="auto">
                      <Space wrap>
                        <Text strong>{claim.claim_number}</Text>
                        {claim.insurance_company && (
                          <Text type="secondary">{claim.insurance_company}</Text>
                        )}
                        <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
                      </Space>
                    </Col>
                    <Col>
                      <Space size="large">
                        <span>
                          <Text type="secondary" style={{ fontSize: 12 }}>ACV </Text>
                          <Text strong>{formatCurrency(claim.current_acv)}</Text>
                        </span>
                        <span>
                          <Text type="secondary" style={{ fontSize: 12 }}>RCV </Text>
                          <Text strong>{formatCurrency(claim.current_rcv)}</Text>
                        </span>
                      </Space>
                    </Col>
                  </Row>
                }
              >
                {/* Claim detail header */}
                <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="Claim Number">{claim.claim_number}</Descriptions.Item>
                  <Descriptions.Item label="Date of Loss">{formatDate(claim.date_of_loss)}</Descriptions.Item>
                  <Descriptions.Item label="Deductible">
                    {formatCurrency(claim.insurance_deductible)}
                  </Descriptions.Item>
                  {claim.adjuster_name && (
                    <Descriptions.Item label="Adjuster">{claim.adjuster_name}</Descriptions.Item>
                  )}
                  {claim.adjuster_phone && (
                    <Descriptions.Item label="Adjuster Phone">{claim.adjuster_phone}</Descriptions.Item>
                  )}
                  {claim.loss_description && (
                    <Descriptions.Item label="Loss Description" span={3}>
                      {claim.loss_description}
                    </Descriptions.Item>
                  )}
                </Descriptions>

                {/* Negotiation table */}
                <NegotiationHistory clientId={client.id} claim={claim} />
              </Panel>
            );
          })}
        </Collapse>
      )}

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}

      <ClaimModal
        open={claimModalOpen}
        clientId={client.id}
        editingClaim={editingClaim}
        onCancel={() => {
          setClaimModalOpen(false);
          setEditingClaim(null);
        }}
        onSubmit={handleClaimSubmit}
        loading={createClaimMutation.isPending || updateClaimMutation.isPending}
      />
    </div>
  );
};

// ─────────────────────────────────────────────
// All Documents Tab (placeholder)
// ─────────────────────────────────────────────

interface AllDocumentsTabProps {
  client: Client;
}

const AllDocumentsTab: React.FC<AllDocumentsTabProps> = ({ client }) => {
  const totalInvoices =
    client.standalone_invoice_count +
    client.claims.reduce((sum, c) => sum + c.invoice_count, 0);
  const totalEstimates =
    client.standalone_estimate_count +
    client.claims.reduce((sum, c) => sum + c.estimate_count, 0);
  const totalWmJobs =
    client.standalone_wm_job_count +
    client.claims.reduce((sum, c) => sum + c.wm_job_count, 0);
  const totalWorkOrders =
    client.standalone_work_order_count +
    client.claims.reduce((sum, c) => sum + c.work_order_count, 0);

  return (
    <Card>
      <Row gutter={[24, 24]}>
        <Col xs={12} sm={6}>
          <Statistic title="Invoices" value={totalInvoices} prefix={<FileTextOutlined />} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Estimates" value={totalEstimates} prefix={<FileTextOutlined />} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="WM Jobs" value={totalWmJobs} prefix={<FileTextOutlined />} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Work Orders" value={totalWorkOrders} prefix={<FileTextOutlined />} />
        </Col>
      </Row>
      <Divider />
      <div style={{ textAlign: 'center', padding: '32px 0', color: '#8c8c8c' }}>
        <FileTextOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
        Document listing coming soon.
      </div>
    </Card>
  );
};

// ─────────────────────────────────────────────
// ClientDetail Page
// ─────────────────────────────────────────────

const ClientDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);

  const {
    data: client,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientService.getById(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<ClientCreate>) => clientService.update(id!, payload),
    onSuccess: () => {
      message.success('Client updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setEditModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to update client.');
    },
  });

  // ── Loading / Error states ─────────────────
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <Alert
        message="Error"
        description="Failed to load client information."
        type="error"
        showIcon
        action={
          <Button size="small" onClick={() => navigate('/clients')}>
            Back to Clients
          </Button>
        }
        style={{ margin: '24px 0' }}
      />
    );
  }

  // ── Derived values ─────────────────────────
  const owner = primaryOwner(client.owners);
  const fullAddress = [client.address, client.city, client.state, client.zipcode]
    .filter(Boolean)
    .join(', ');

  const tabItems = [
    {
      key: 'claims',
      label: (
        <Space>
          <SafetyOutlined />
          Claims
          {client.claim_count > 0 && (
            <Badge count={client.claim_count} style={{ backgroundColor: '#1890ff' }} />
          )}
        </Space>
      ),
      children: <ClaimsTab client={client} />,
    },
    {
      key: 'documents',
      label: (
        <Space>
          <FileTextOutlined />
          All Documents
        </Space>
      ),
      children: <AllDocumentsTab client={client} />,
    },
  ];

  return (
    <div>
      {/* Back navigation */}
      <Button
        icon={<ArrowLeftOutlined />}
        type="text"
        onClick={() => navigate('/clients')}
        style={{ marginBottom: 16, paddingLeft: 0 }}
      >
        Back to Clients
      </Button>

      {/* Client Info Card */}
      <Card
        style={{ marginBottom: 24 }}
        title={
          <Space>
            <UserOutlined style={{ color: '#1890ff' }} />
            <Title level={4} style={{ margin: 0 }}>{client.display_name}</Title>
            <Tag color={client.is_active ? 'success' : 'default'}>
              {client.is_active ? 'Active' : 'Inactive'}
            </Tag>
          </Space>
        }
        extra={
          <Button icon={<EditOutlined />} onClick={() => setEditModalOpen(true)}>
            Edit
          </Button>
        }
      >
        <Row gutter={[32, 16]}>
          {/* Owners */}
          <Col xs={24} md={12}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Owners
              </Text>
            </div>
            {client.owners.length === 0 ? (
              <Text type="secondary">—</Text>
            ) : (
              client.owners.map((o, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <Space wrap>
                    <Text strong>
                      {o.name}
                      {o.is_primary && (
                        <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>Primary</Tag>
                      )}
                    </Text>
                    {o.phone && (
                      <Text type="secondary">
                        <PhoneOutlined style={{ marginRight: 4 }} />
                        {o.phone}
                      </Text>
                    )}
                    {o.email && <Text type="secondary">{o.email}</Text>}
                  </Space>
                </div>
              ))
            )}
          </Col>

          {/* Contact & Address */}
          <Col xs={24} md={12}>
            <Descriptions size="small" column={1}>
              {fullAddress && (
                <Descriptions.Item
                  label={<><HomeOutlined style={{ marginRight: 4 }} />Address</>}
                >
                  {fullAddress}
                </Descriptions.Item>
              )}
              {(client.phone || owner?.phone) && (
                <Descriptions.Item
                  label={<><PhoneOutlined style={{ marginRight: 4 }} />Phone</>}
                >
                  {client.phone || owner?.phone}
                </Descriptions.Item>
              )}
              {(client.email || owner?.email) && (
                <Descriptions.Item label="Email">
                  {client.email || owner?.email}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Col>

          {/* Insurance */}
          {(client.insurance_company || client.insurance_policy_number) && (
            <Col xs={24}>
              <Divider style={{ margin: '0 0 12px' }} />
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Insurance
                </Text>
              </div>
              <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                {client.insurance_company && (
                  <Descriptions.Item label="Company">{client.insurance_company}</Descriptions.Item>
                )}
                {client.insurance_policy_number && (
                  <Descriptions.Item label="Policy #">{client.insurance_policy_number}</Descriptions.Item>
                )}
              </Descriptions>
            </Col>
          )}

          {/* Notes */}
          {client.notes && (
            <Col xs={24}>
              <Divider style={{ margin: '0 0 12px' }} />
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Notes
              </Text>
              <div style={{ marginTop: 6 }}>
                <Text>{client.notes}</Text>
              </div>
            </Col>
          )}
        </Row>
      </Card>

      {/* Tabs */}
      <Card>
        <Tabs defaultActiveKey="claims" items={tabItems} />
      </Card>

      {/* Edit Modal */}
      <EditClientModal
        open={editModalOpen}
        client={client}
        onCancel={() => setEditModalOpen(false)}
        onSubmit={async (vals) => { await updateMutation.mutateAsync(vals); }}
        loading={updateMutation.isPending}
      />
    </div>
  );
};

export default ClientDetail;
