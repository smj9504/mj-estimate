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
  Upload,
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
  UploadOutlined,
  FilePdfOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { clientService, claimService, negotiationService } from '../services/clientService';
import ClaimContractDashboard from '../components/contract/ClaimContractDashboard';
import { PaymentTracker, ProfitabilityTracker } from '../components/claim-followup';
import type {
  Client,
  ClientCreate,
  OwnerInfo,
  Claim,
  ClaimCreate,
  ClaimStatus,
  ClaimNegotiation,
  ClaimNegotiationCreate,
  NegotiationSection,
  PdfExtractionResult,
  CabinetEstimateSummary,
  PlumberReportSummary,
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
  clientId: string;
  claimId: string;
  onCancel: () => void;
  onSubmit: (values: Omit<ClaimNegotiationCreate, 'claim_id'>) => Promise<void>;
  loading: boolean;
}

const NegotiationModal: React.FC<NegotiationModalProps> = ({
  open,
  clientId,
  claimId,
  onCancel,
  onSubmit,
  loading,
}) => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState<'pdf' | 'manual'>('pdf');
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<PdfExtractionResult | null>(null);
  const [editedSections, setEditedSections] = useState<NegotiationSection[]>([]);

  React.useEffect(() => {
    if (open) {
      form.resetFields();
      setActiveTab('pdf');
      setExtraction(null);
      setEditedSections([]);
      setExtracting(false);
    }
  }, [open, form]);

  const handlePdfUpload = async (file: File) => {
    setExtracting(true);
    try {
      const result = await negotiationService.extractPdf(clientId, claimId, file);
      setExtraction(result);
      setEditedSections(result.sections || []);
      message.success(`Extracted ${result.sections.length} section(s) from PDF`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to extract PDF');
    } finally {
      setExtracting(false);
    }
    return false; // prevent antd auto upload
  };

  const handleSectionEdit = (idx: number, field: keyof NegotiationSection, value: number | null) => {
    setEditedSections((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value ?? 0 };
      return updated;
    });
  };

  const computedTotals = React.useMemo(() => {
    if (!editedSections.length) return null;
    return {
      rcv_amount: editedSections.reduce((s, sec) => s + (sec.rcv || 0), 0),
      acv_amount: editedSections.reduce((s, sec) => s + (sec.net_acv || 0), 0),
      depreciation_amount: editedSections.reduce((s, sec) => s + (sec.depreciation || 0), 0),
      deductible: editedSections.reduce((s, sec) => s + (sec.deductible || 0), 0),
    };
  }, [editedSections]);

  const handleFinish = async (values: any) => {
    const payload: any = {
      ...values,
      date_received: values.date_received
        ? dayjs(values.date_received).format('YYYY-MM-DD')
        : undefined,
    };

    if (activeTab === 'pdf' && extraction && editedSections.length > 0) {
      payload.sections_data = editedSections;
      payload.file_id = extraction.file_id;
      if (computedTotals) {
        payload.acv_amount = computedTotals.acv_amount;
        payload.rcv_amount = computedTotals.rcv_amount;
        payload.depreciation_amount = computedTotals.depreciation_amount;
        payload.deductible = computedTotals.deductible;
      }
    }

    await onSubmit(payload);
  };

  const sectionColumns: ColumnsType<NegotiationSection & { _idx: number }> = [
    {
      title: 'Section',
      dataIndex: 'section_name',
      key: 'section_name',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'RCV',
      dataIndex: 'rcv',
      key: 'rcv',
      width: 130,
      render: (val: number, record) => (
        <InputNumber
          size="small"
          prefix="$"
          value={val}
          onChange={(v) => handleSectionEdit(record._idx, 'rcv', v)}
          style={{ width: '100%' }}
          min={0}
          step={100}
        />
      ),
    },
    {
      title: 'Depreciation',
      dataIndex: 'depreciation',
      key: 'depreciation',
      width: 130,
      render: (val: number, record) => (
        <InputNumber
          size="small"
          prefix="$"
          value={val}
          onChange={(v) => handleSectionEdit(record._idx, 'depreciation', v)}
          style={{ width: '100%' }}
          min={0}
          step={100}
        />
      ),
    },
    {
      title: 'Deductible',
      dataIndex: 'deductible',
      key: 'deductible',
      width: 120,
      render: (val: number, record) => (
        <InputNumber
          size="small"
          prefix="$"
          value={val}
          onChange={(v) => handleSectionEdit(record._idx, 'deductible', v)}
          style={{ width: '100%' }}
          min={0}
          step={100}
        />
      ),
    },
    {
      title: 'Net ACV',
      dataIndex: 'net_acv',
      key: 'net_acv',
      width: 130,
      render: (val: number, record) => (
        <InputNumber
          size="small"
          prefix="$"
          value={val}
          onChange={(v) => handleSectionEdit(record._idx, 'net_acv', v)}
          style={{ width: '100%' }}
          min={0}
          step={100}
        />
      ),
    },
  ];

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
      width={800}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 16px' }} />

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'pdf' | 'manual')}
        items={[
          {
            key: 'pdf',
            label: (
              <span><FilePdfOutlined /> Upload Insurance Estimate</span>
            ),
            children: (
              <div>
                {!extraction && (
                  <Upload.Dragger
                    accept=".pdf"
                    showUploadList={false}
                    beforeUpload={handlePdfUpload}
                    disabled={extracting}
                    style={{ marginBottom: 16 }}
                  >
                    {extracting ? (
                      <div style={{ padding: '20px 0' }}>
                        <Spin size="large" />
                        <p style={{ marginTop: 12, color: '#666' }}>
                          Analyzing insurance estimate PDF...
                        </p>
                      </div>
                    ) : (
                      <div style={{ padding: '20px 0' }}>
                        <p className="ant-upload-drag-icon">
                          <UploadOutlined style={{ fontSize: 32, color: '#1890ff' }} />
                        </p>
                        <p className="ant-upload-text">
                          Drag & drop insurance estimate PDF here
                        </p>
                        <p className="ant-upload-hint">
                          AI will extract summary sections and amounts automatically
                        </p>
                      </div>
                    )}
                  </Upload.Dragger>
                )}

                {extraction && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Space>
                        <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                        <Text strong>{extraction.file_name}</Text>
                        <Tag color="blue">{editedSections.length} section(s)</Tag>
                      </Space>
                      <Button
                        size="small"
                        onClick={() => { setExtraction(null); setEditedSections([]); }}
                      >
                        Re-upload
                      </Button>
                    </div>

                    {extraction.validation.is_valid ? (
                      <Alert
                        type="success"
                        message="All amounts verified"
                        icon={<CheckCircleOutlined />}
                        showIcon
                        style={{ marginBottom: 12 }}
                      />
                    ) : (
                      <Alert
                        type="warning"
                        message="Verification warnings"
                        description={
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {extraction.validation.warnings.map((w, i) => (
                              <li key={i} style={{ fontSize: 12 }}>{w}</li>
                            ))}
                          </ul>
                        }
                        icon={<WarningOutlined />}
                        showIcon
                        style={{ marginBottom: 12 }}
                      />
                    )}

                    <Table
                      size="small"
                      rowKey="section_name"
                      columns={sectionColumns}
                      dataSource={editedSections.map((s, i) => ({ ...s, _idx: i }))}
                      pagination={false}
                      scroll={{ x: 600 }}
                      style={{ marginBottom: 12 }}
                      summary={() =>
                        computedTotals ? (
                          <Table.Summary fixed>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0}>
                                <Text strong>Total</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={1}>
                                <Text strong>{formatCurrency(computedTotals.rcv_amount)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={2}>
                                <Text strong>{formatCurrency(computedTotals.depreciation_amount)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3}>
                                <Text strong>{formatCurrency(computedTotals.deductible)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={4}>
                                <Text strong>{formatCurrency(computedTotals.acv_amount)}</Text>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          </Table.Summary>
                        ) : null
                      }
                    />
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'manual',
            label: (
              <span><EditOutlined /> Manual Entry</span>
            ),
            children: null, // Manual fields are shared below
          },
        ]}
      />

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

        {activeTab === 'manual' && (
          <>
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
          </>
        )}

        {activeTab === 'pdf' && (
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="received_from" label="Received From">
                <Input placeholder="e.g. Adjuster name" />
              </Form.Item>
            </Col>
          </Row>
        )}

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={activeTab === 'pdf' && !extraction}
            >
              Add Revision
            </Button>
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
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
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
      title: 'Date',
      dataIndex: 'date_received',
      key: 'date_received',
      render: formatDate,
      responsive: ['md'],
    },
    {
      title: '',
      key: 'pdf',
      width: 40,
      render: (_: any, record) =>
        record.document_url ? (
          <Tooltip title={record.document_name || 'Download PDF'}>
            <a href={`/api/files/download/${record.document_url}`} target="_blank" rel="noopener noreferrer">
              <FilePdfOutlined style={{ color: '#ff4d4f' }} />
            </a>
          </Tooltip>
        ) : null,
    },
  ];

  // Expandable row renderer for sections
  const expandedRowRender = (record: ClaimNegotiation) => {
    if (!record.sections_data || record.sections_data.length === 0) return null;
    const secCols: ColumnsType<NegotiationSection> = [
      { title: 'Section', dataIndex: 'section_name', key: 'section_name', ellipsis: true },
      { title: 'Line Items', dataIndex: 'line_item_total', key: 'line_item_total', align: 'right', render: formatCurrency },
      { title: 'Tax', dataIndex: 'material_sales_tax', key: 'material_sales_tax', align: 'right', render: formatCurrency },
      { title: 'O&P', key: 'op', align: 'right', render: (_: any, sec) => formatCurrency((sec.overhead_amount || 0) + (sec.profit_amount || 0)) },
      { title: 'RCV', dataIndex: 'rcv', key: 'rcv', align: 'right', render: formatCurrency },
      { title: 'Depreciation', dataIndex: 'depreciation', key: 'depreciation', align: 'right', render: formatCurrency },
      { title: 'Deductible', dataIndex: 'deductible', key: 'deductible', align: 'right', render: formatCurrency },
      { title: 'Net ACV', dataIndex: 'net_acv', key: 'net_acv', align: 'right', render: (v: number) => <Text strong>{formatCurrency(v)}</Text> },
    ];
    return (
      <Table<NegotiationSection>
        rowKey="section_name"
        columns={secCols}
        dataSource={record.sections_data}
        pagination={false}
        size="small"
        style={{ margin: '0 0 0 20px' }}
      />
    );
  };

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
        expandable={{
          expandedRowRender,
          rowExpandable: (record) => !!record.sections_data && record.sections_data.length > 0,
        }}
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
        <Col>
          <Space>
            <FileTextOutlined style={{ color: '#eb2f96' }} />
            <Text type="secondary">Cabinet Estimates: <strong>{claim.cabinet_estimate_count}</strong></Text>
          </Space>
        </Col>
        {claim.plumber_report_id && (
          <Col>
            <Space>
              <FileTextOutlined style={{ color: '#13c2c2' }} />
              <Text type="secondary">
                <a
                  href={`/plumber-reports/${claim.plumber_report_id}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'inherit' }}
                >
                  Plumber Report
                </a>
              </Text>
            </Space>
          </Col>
        )}
      </Row>

      <NegotiationModal
        open={negModalOpen}
        clientId={clientId}
        claimId={claim.id}
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
          record.work_order_count +
          record.cabinet_estimate_count +
          (record.plumber_report_id ? 1 : 0);
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

                {/* Payment Tracking */}
                <Divider style={{ margin: '16px 0 12px' }} />
                <Text strong style={{ fontSize: 14, marginBottom: 8, display: 'block' }}>
                  <DollarOutlined style={{ marginRight: 6 }} />
                  Payment Tracking
                </Text>
                <PaymentTracker
                  clientId={client.id}
                  claimId={claim.id}
                  claimNumber={claim.claim_number}
                  insuranceCompany={claim.insurance_company}
                  onClaimUpdate={() => {
                    queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
                  }}
                />

                {/* Profitability Tracker */}
                <Divider style={{ margin: '16px 0 12px' }} />
                <Text strong style={{ fontSize: 14, marginBottom: 8, display: 'block' }}>
                  <DollarOutlined style={{ marginRight: 6 }} />
                  Profitability
                </Text>
                <ProfitabilityTracker
                  clientId={client.id}
                  claimId={claim.id}
                  onUpdate={() => {
                    queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
                  }}
                />

                {/* Contract Dashboard */}
                <Divider style={{ margin: '16px 0 12px' }} />
                <ClaimContractDashboard
                  claimId={claim.id}
                  clientId={client.id}
                />
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
// All Documents Tab
// ─────────────────────────────────────────────

interface AllDocumentsTabProps {
  client: Client;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'cyan',
  final: 'green',
  sent: 'blue',
};

const AllDocumentsTab: React.FC<AllDocumentsTabProps> = ({ client }) => {
  const navigate = useNavigate();

  const cabinetEstimates = client.cabinet_estimates ?? [];
  const plumberReports = client.plumber_reports ?? [];

  // Helper: find claim_number by claim_id
  const claimNumberMap = new Map(client.claims.map((c) => [c.id, c.claim_number]));

  const cabColumns: ColumnsType<CabinetEstimateSummary> = [
    {
      title: 'Address',
      dataIndex: 'property_address',
      key: 'property_address',
      render: (val?: string) => val || '—',
    },
    {
      title: 'Tier',
      dataIndex: 'tier',
      key: 'tier',
      width: 120,
      render: (val?: string) => val ? <Tag>{val}</Tag> : '—',
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Claim',
      dataIndex: 'claim_id',
      key: 'claim_id',
      width: 140,
      render: (claimId?: string) =>
        claimId ? (
          <Text type="secondary">{claimNumberMap.get(claimId) || '—'}</Text>
        ) : '—',
      responsive: ['md'] as any,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => (
        <Tag color={STATUS_COLOR[status] || 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 110,
      render: formatDate,
      responsive: ['lg'] as any,
    },
  ];

  const plumberColumns: ColumnsType<PlumberReportSummary> = [
    {
      title: 'Report #',
      dataIndex: 'report_number',
      key: 'report_number',
      render: (val?: string) => <Text strong>{val || '—'}</Text>,
    },
    {
      title: 'Technician',
      dataIndex: 'technician_name',
      key: 'technician_name',
      render: (val?: string) => val || '—',
      responsive: ['md'] as any,
    },
    {
      title: 'Total',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 120,
      align: 'right',
      render: formatCurrency,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: string) => (
        <Tag color={STATUS_COLOR[status || ''] || 'default'}>{status || 'draft'}</Tag>
      ),
    },
    {
      title: 'Service Date',
      dataIndex: 'service_date',
      key: 'service_date',
      width: 120,
      render: formatDate,
    },
  ];

  return (
    <div>
      {/* Cabinet Estimates */}
      <Card
        title={
          <Space>
            <FileTextOutlined style={{ color: '#eb2f96' }} />
            <span>Cabinet Estimates ({cabinetEstimates.length})</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
        size="small"
      >
        {cabinetEstimates.length === 0 ? (
          <Text type="secondary">No cabinet estimates linked to this client.</Text>
        ) : (
          <Table<CabinetEstimateSummary>
            rowKey="id"
            columns={cabColumns}
            dataSource={cabinetEstimates}
            pagination={false}
            size="small"
            onRow={(record) => ({
              onClick: () => navigate(`/cabinet-estimates/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      {/* Plumber Reports */}
      <Card
        title={
          <Space>
            <FileTextOutlined style={{ color: '#13c2c2' }} />
            <span>Plumber Reports ({plumberReports.length})</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        {plumberReports.length === 0 ? (
          <Text type="secondary">No plumber reports linked to this client.</Text>
        ) : (
          <Table<PlumberReportSummary>
            rowKey="id"
            columns={plumberColumns}
            dataSource={plumberReports}
            pagination={false}
            size="small"
            onRow={(record) => ({
              onClick: () => navigate(`/plumber-reports/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      {/* Packing Estimates */}
      <PackingEstimatesCard clientId={client.id} />
    </div>
  );
};

// ─────────────────────────────────────────────
// Packing Estimates Card (inside AllDocumentsTab)
// ─────────────────────────────────────────────

const PackingEstimatesCard: React.FC<{ clientId: string }> = ({ clientId }) => {
  const navigate = useNavigate();
  const { data: packData } = useQuery({
    queryKey: ['packing-estimates', clientId],
    queryFn: async () => {
      const { listEstimates } = await import('../services/packingEstimateService');
      return listEstimates({ client_id: clientId });
    },
    enabled: !!clientId,
  });

  const estimates = packData?.items ?? [];

  const packColumns = [
    {
      title: 'Estimate Name',
      dataIndex: 'calculation_name',
      key: 'calculation_name',
      render: (val?: string) => <Text strong>{val || 'Untitled'}</Text>,
    },
    {
      title: 'Address',
      dataIndex: 'project_address',
      key: 'project_address',
      render: (val?: string) => val || '—',
      responsive: ['md'] as any,
    },
    {
      title: 'Rooms',
      dataIndex: 'total_rooms',
      key: 'total_rooms',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Total',
      dataIndex: 'grand_total',
      key: 'grand_total',
      width: 120,
      align: 'right' as const,
      render: (val?: number) => val
        ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        : '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: string) => (
        <Tag color={
          status === 'approved' ? 'success'
          : status === 'completed' ? 'processing'
          : 'default'
        }>
          {status || 'draft'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 110,
      render: formatDate,
      responsive: ['lg'] as any,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined style={{ color: '#722ed1' }} />
          <span>Packing Estimates ({estimates.length})</span>
        </Space>
      }
      size="small"
    >
      {estimates.length === 0 ? (
        <Text type="secondary">No packing estimates linked to this client.</Text>
      ) : (
        <Table
          rowKey="id"
          columns={packColumns}
          dataSource={estimates}
          pagination={false}
          size="small"
          onRow={(record: any) => ({
            onClick: () => navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      )}
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
