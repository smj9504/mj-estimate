import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
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
  Collapse,
  Checkbox,
  Upload,
  Drawer,
  Dropdown,
  Grid,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
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
  MailOutlined,
  SendOutlined,
  LoadingOutlined,
  FormOutlined,
  CameraOutlined,
  DownOutlined,
  FileAddOutlined,
  ScheduleOutlined,
  FileDoneOutlined,
  CloseCircleOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import { PageHeader, Pill, PropertyList, humanize, toneFromKey, useSheetModal, type TagTone } from '../components/common/ui';
import { tagTones } from '../styles/tokens';
import ClaimSection from '../components/client/ClaimSection';
import { WMStatusPill } from '../components/water-mitigation/wmStatus';
import { WorkOrderStatusPill } from '../components/work-order/workOrderUi';
import { useBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import { clientService, claimService, negotiationService, claimActivityService } from '../services/clientService';
import { fileService } from '../services/fileService';
import { companyService } from '../services/companyService';
import ClaimContractDashboard from '../components/contract/ClaimContractDashboard';
import ClientDocumentHub from '../components/client/ClientDocumentHub';
import ClaimNotes from '../components/client/ClaimNotes';
import ClaimPhotosSection from '../components/client/ClaimPhotosSection';
import ClaimTodos from '../components/client/ClaimTodos';
import AccuLynxArchiveTab from '../components/client/AccuLynxArchiveTab';
import { acculynxArchiveService } from '../services/acculynxArchiveService';
import {  } from '@ant-design/icons';
import { PaymentTracker, ProfitabilityTracker, EmailComposer, EmailHistory, ReceivedEmails } from '../components/claim-followup';
import type { ClaimContact } from '../components/claim-followup/EmailComposer';
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
import {
  ESTIMATE_ORIGIN_CONFIG,
  ESTIMATE_CATEGORY_CONFIG,
  CONTRACTOR_ESTIMATE_STAGE_ORDER,
  CONTRACTOR_ESTIMATE_STAGE_LABELS,
  WM_COST_STATUS_LABELS,
} from '../types/client';
import RebuildEstimateCompanySelect from '../components/claim-followup/RebuildEstimateCompanySelect';
import type { ColumnsType } from 'antd/es/table';

dayjs.extend(relativeTime);

const { Text } = Typography;
const { Option } = Select;

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
  { tone: TagTone; label: string }
> = {
  open:        { tone: 'blue',   label: 'Open' },
  negotiating: { tone: 'orange', label: 'Negotiating' },
  appraisal:   { tone: 'pink',   label: 'Appraisal' },
  settled:     { tone: 'green',  label: 'Settled' },
  closed:      { tone: 'gray',   label: 'Closed' },
  denied:      { tone: 'red',    label: 'Denied' },
};

const REVISION_TYPE_CONFIG: Record<
  ClaimNegotiation['revision_type'],
  { tone: TagTone; label: string }
> = {
  initial:       { tone: 'blue',   label: 'Initial' },
  supplement:    { tone: 'orange', label: 'Supplement' },
  re_inspection: { tone: 'purple', label: 'Re-Inspection' },
  // Same tone as the claim's Appraisal status
  appraisal:     { tone: 'pink',   label: 'Appraisal' },
  final:         { tone: 'green',  label: 'Final' },
};

const CONTRACTOR_STAGE_TONES: Record<string, TagTone> = {
  requested: 'gray',
  estimate_sent: 'blue',
  awaiting_approval: 'orange',
  approved_initial_received: 'green',
};

const formatCurrency = (amount?: number) =>
  amount != null
    ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

const formatDate = (dateStr?: string) =>
  dateStr ? dayjs(dateStr).format('MM/DD/YYYY') : '—';

// Activity type → drawn icon for the timeline
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  wm_sent_to_adjuster: <SendOutlined />,
  followup_created: <ScheduleOutlined />,
  estimate_received: <FileDoneOutlined />,
  estimate_denied: <CloseCircleOutlined />,
  rebuild_created: <HomeOutlined />,
  supplement_created: <FileAddOutlined />,
  payment_received: <DollarOutlined />,
  status_changed: <SwapOutlined />,
  note: <FormOutlined />,
};

const ClaimActivityTimeline: React.FC<{ clientId: string; claimId: string }> = ({ clientId, claimId }) => {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['claim-activities', claimId],
    queryFn: () => claimActivityService.getActivities(clientId, claimId),
  });

  return (
    <ClaimSection title="Activity" count={activities.length || undefined}>
      {isLoading ? (
        <Spin size="small" />
      ) : activities.length === 0 ? (
        <div className="cl-empty">No activity recorded yet.</div>
      ) : (
        <ul className="cl-activity">
          {activities.map((activity: any) => (
            <li key={activity.id} className="cl-activity-item">
              <span className="cl-activity-icon" aria-hidden="true">
                {ACTIVITY_ICONS[activity.activity_type] || ACTIVITY_ICONS.note}
              </span>
              <div className="cl-activity-body">
                <div className="cl-activity-title">{activity.title}</div>
                {activity.description && <div className="cl-meta">{activity.description}</div>}
              </div>
              {activity.created_at && (
                <Tooltip title={dayjs(activity.created_at).format('MM/DD/YYYY h:mm A')}>
                  <span className="cl-activity-time">{dayjs(activity.created_at).fromNow()}</span>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </ClaimSection>
  );
};

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
  const { sheetProps } = useSheetModal('tall');

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
      {...sheetProps}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form form={form} layout="vertical" className="cl-form" onFinish={handleFinish} scrollToFirstError>
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
          <AddressAutocomplete
            onSelect={(addr) => form.setFieldsValue({
              city: addr.city,
              state: addr.state,
              zipcode: addr.zip,
            })}
          />
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

        <Form.Item className="ui-form-actions" style={{ marginBottom: 0, textAlign: 'right' }}>
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
  const { sheetProps } = useSheetModal('tall');
  const { sheetProps: paSheetProps } = useSheetModal();

  // PA contacts for the claim's Public Adjuster link. Loaded once the modal
  // opens rather than on page load, since most visits never edit a claim.
  const { data: paContacts = [], isLoading: paContactsLoading } = useQuery({
    queryKey: ['pa-contacts'],
    queryFn: () => companyService.listAllContacts('public_adjuster'),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const paContactOptions = React.useMemo(
    () => paContacts.map((c: any) => ({
      value: String(c.id),
      label: [c.name, c.company_name, c.email].filter(Boolean).join(' · '),
    })),
    [paContacts],
  );

  // "Add new PA" — so a PA that isn't in the directory yet can be created
  // here instead of sending the user off to the Company screen.
  const queryClient = useQueryClient();
  const [paModalOpen, setPaModalOpen] = useState(false);
  const [paSaving, setPaSaving] = useState(false);
  const [paForm] = Form.useForm();

  const { data: paCompanies = [] } = useQuery({
    queryKey: ['pa-companies'],
    queryFn: () => companyService.listCompaniesByType('public_adjuster'),
    enabled: paModalOpen,
    staleTime: 5 * 60 * 1000,
  });

  const handleCreatePaContact = async () => {
    const values = await paForm.validateFields();
    setPaSaving(true);
    try {
      // Either attach to an existing PA firm or create the firm first.
      let companyId: string = values.company_id;
      if (!companyId) {
        const company = await companyService.createCompany({
          name: values.new_company_name,
          company_type: 'public_adjuster',
        } as any);
        companyId = String((company as any).id);
      }

      const contact = await companyService.createContact(companyId, {
        name: values.name,
        email: values.email || undefined,
        phone: values.phone || undefined,
        title: values.title || undefined,
        is_primary: false,
        is_active: true,
      } as any);

      // Refresh the picker and select the contact we just made.
      await queryClient.invalidateQueries({ queryKey: ['pa-contacts'] });
      await queryClient.invalidateQueries({ queryKey: ['pa-companies'] });
      form.setFieldsValue({ pa_contact_id: String((contact as any).id) } as any);

      message.success('Public adjuster added');
      setPaModalOpen(false);
      paForm.resetFields();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Failed to add public adjuster');
    } finally {
      setPaSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      if (editingClaim) {
        form.setFieldsValue({
          pa_contact_id: editingClaim.pa_contact_id || undefined,
          claim_number: editingClaim.claim_number,
          insurance_company: editingClaim.insurance_company,
          insurance_policy_number: editingClaim.insurance_policy_number,
          insurance_deductible: editingClaim.insurance_deductible,
          deductible_discount: editingClaim.deductible_discount,
          adjuster_name: editingClaim.adjuster_name,
          adjuster_phone: editingClaim.adjuster_phone,
          adjuster_email: editingClaim.adjuster_email,
          date_of_loss: editingClaim.date_of_loss ? dayjs(editingClaim.date_of_loss) as any : undefined,
          loss_description: editingClaim.loss_description,
          status: editingClaim.status,
          appraisal_date: editingClaim.appraisal_date ? dayjs(editingClaim.appraisal_date) as any : undefined,
          estimate_origin: editingClaim.estimate_origin,
          contractor_estimate_stage: editingClaim.contractor_estimate_stage,
          rebuild_estimate_company_id: editingClaim.rebuild_estimate_company_id || undefined,
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
      // null clears it; the field only renders for appraisal claims
      appraisal_date: values.appraisal_date ? dayjs(values.appraisal_date).format('YYYY-MM-DD') : null,
      // '' clears it on an existing claim; a new claim just leaves it out
      rebuild_estimate_company_id: values.estimate_origin === 'contractor_prepared'
        ? (values.rebuild_estimate_company_id || (editingClaim ? '' : undefined))
        : undefined,
    };
    if (!values.claim_number) {
      Modal.confirm({
        title: 'Claim Number is empty',
        content: 'Claim number is not entered. You can add it later when you receive it from the insurance company. Continue without claim number?',
        okText: 'Continue',
        cancelText: 'Go Back',
        onOk: async () => {
          await onSubmit(payload);
        },
      });
      return;
    }
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
      {...sheetProps}
      destroyOnHidden
      maskClosable={false}
    >
      <Divider style={{ margin: '16px 0 24px' }} />
      <Form form={form} layout="vertical" className="cl-form" onFinish={handleFinish} scrollToFirstError>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="claim_number" label="Claim Number"
              tooltip="Insurance claim number (can be added later)">
              <Input placeholder="e.g. CLM-2024-001" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="status" label="Status" initialValue="open">
              <Select
                onChange={(v) => {
                  if (v === 'appraisal' && !form.getFieldValue('appraisal_date' as any)) {
                    form.setFieldsValue({ appraisal_date: dayjs() as any });
                  }
                }}
              >
                {Object.entries(CLAIM_STATUS_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* Shown while in appraisal, and afterwards so a settled claim keeps the date */}
        <Form.Item
          noStyle
          shouldUpdate={(prev, cur) =>
            prev.status !== cur.status || (prev as any).appraisal_date !== (cur as any).appraisal_date}
        >
          {({ getFieldValue }) =>
            getFieldValue('status') === 'appraisal' || getFieldValue('appraisal_date' as any) ? (
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="appraisal_date"
                    label="Moved to Appraisal"
                    tooltip="Appraisal is handled outside the supplement process, so no supplement estimate goes out after this date"
                  >
                    <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
                  </Form.Item>
                </Col>
              </Row>
            ) : null
          }
        </Form.Item>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="estimate_origin" label="Rebuild Estimate From"
              tooltip="Usually the insurance company writes it. Some ask us to submit one for approval instead; then a company other than the WM one writes it">
              <Select allowClear placeholder="Not determined yet">
                {Object.entries(ESTIMATE_ORIGIN_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.estimate_origin !== cur.estimate_origin}>
              {({ getFieldValue }) =>
                getFieldValue('estimate_origin') === 'contractor_prepared' ? (
                  <Form.Item name="contractor_estimate_stage" label="Contractor Estimate Stage">
                    <Select allowClear placeholder="Select stage">
                      {CONTRACTOR_ESTIMATE_STAGE_ORDER.map((val) => (
                        <Option key={val} value={val}>
                          {CONTRACTOR_ESTIMATE_STAGE_LABELS[val]}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </Col>
        </Row>

        {/* The carrier asked us for the rebuild estimate: a company other than
            the WM one writes and sends it */}
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.estimate_origin !== cur.estimate_origin}>
          {({ getFieldValue }) =>
            getFieldValue('estimate_origin') === 'contractor_prepared' ? (
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="rebuild_estimate_company_id"
                    label="Rebuild Estimate Written By"
                    tooltip="Must be a company other than the one that did the water mitigation"
                  >
                    <RebuildEstimateCompanySelect wmCompanyIds={editingClaim?.wm_company_ids} />
                  </Form.Item>
                </Col>
              </Row>
            ) : null
          }
        </Form.Item>

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
            <Form.Item name="deductible_discount" label="Deductible Discount"
              tooltip="Part of the deductible we waived for the homeowner. Comes out of company income.">
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

        <Divider orientation="left" plain style={{ marginBottom: 8 }}>Public Adjuster</Divider>
        <Row gutter={12}>
          <Col xs={24}>
            <Form.Item
              name="pa_contact_id"
              label="Public Adjuster"
              extra="Links the claim to a PA contact. Water mitigation sheet sync sets this automatically, but any claim can be linked here — including rebuild-only claims."
            >
              <Select
                allowClear
                showSearch
                loading={paContactsLoading}
                placeholder="No public adjuster"
                optionFilterProp="label"
                options={paContactOptions}
                popupRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '4px 0' }} />
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      style={{ width: '100%', textAlign: 'left' }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPaModalOpen(true)}
                    >
                      Add new public adjuster
                    </Button>
                  </>
                )}
              />
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

        <Form.Item className="ui-form-actions" style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {editingClaim ? 'Save Changes' : 'Create Claim'}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Modal
        title="Add Public Adjuster"
        open={paModalOpen}
        onOk={handleCreatePaContact}
        onCancel={() => { setPaModalOpen(false); paForm.resetFields(); }}
        confirmLoading={paSaving}
        okText="Add"
        destroyOnClose
        {...paSheetProps}
      >
        <Form form={paForm} layout="vertical" className="cl-form" preserve={false}>
          <Form.Item
            name="company_id"
            label="PA Company"
            extra="Leave empty to create a new company."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Select existing company"
              options={paCompanies.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.company_id !== cur.company_id}
          >
            {({ getFieldValue }) => !getFieldValue('company_id') && (
              <Form.Item
                name="new_company_name"
                label="New Company Name"
                rules={[{ required: true, message: 'Enter the PA company name' }]}
              >
                <Input placeholder="e.g. Fair Claims Advocates" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item
            name="name"
            label="Contact Name"
            rules={[{ required: true, message: 'Enter the contact name' }]}
          >
            <Input placeholder="e.g. Angel Seo" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ type: 'email', message: 'Invalid email' }]}
              >
                <Input placeholder="pa@example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="Phone">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="title" label="Title">
            <Input placeholder="e.g. Senior Public Adjuster" />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
};

// ─────────────────────────────────────────────
// Add Negotiation Modal
// ─────────────────────────────────────────────

// Editable amounts per extracted section, and the revision total each sums into
const SECTION_AMOUNT_FIELDS = [
  { key: 'rcv', label: 'RCV', width: 130, total: 'rcv_amount' },
  { key: 'depreciation', label: 'Depreciation', width: 130, total: 'depreciation_amount' },
  { key: 'deductible', label: 'Deductible', width: 120, total: 'deductible' },
  { key: 'net_acv', label: 'Net ACV', width: 130, total: 'acv_amount' },
] as const;

type SectionTotals = Record<(typeof SECTION_AMOUNT_FIELDS)[number]['total'], number>;

const sumSectionTotals = (sections: NegotiationSection[]): SectionTotals => ({
  rcv_amount: sections.reduce((s, sec) => s + (sec.rcv || 0), 0),
  acv_amount: sections.reduce((s, sec) => s + (sec.net_acv || 0), 0),
  depreciation_amount: sections.reduce((s, sec) => s + (sec.depreciation || 0), 0),
  deductible: sections.reduce((s, sec) => s + (sec.deductible || 0), 0),
});

interface SectionAmountsEditorProps {
  sections: NegotiationSection[];
  onChange: (sections: NegotiationSection[]) => void;
  isPhone: boolean;
}

/** Each section's amounts as inputs, with the revision total they sum to.
    Used when adding a revision from a PDF and when editing a saved one. */
const SectionAmountsEditor: React.FC<SectionAmountsEditorProps> = ({ sections, onChange, isPhone }) => {
  const totals = sumSectionTotals(sections);

  const handleSectionEdit = (idx: number, field: keyof NegotiationSection, value: number | null) => {
    const updated = [...sections];
    updated[idx] = { ...updated[idx], [field]: value ?? 0 };
    onChange(updated);
  };

  const sectionColumns: ColumnsType<NegotiationSection & { _idx: number }> = [
    {
      title: 'Section',
      dataIndex: 'section_name',
      key: 'section_name',
      width: 200,
      ellipsis: true,
    },
    ...SECTION_AMOUNT_FIELDS.map((f) => ({
      title: f.label,
      dataIndex: f.key,
      key: f.key,
      width: f.width,
      render: (val: number, record: NegotiationSection & { _idx: number }) => (
        <InputNumber
          size="small"
          prefix="$"
          value={val}
          onChange={(v) => handleSectionEdit(record._idx, f.key, v)}
          style={{ width: '100%' }}
          min={0}
          step={100}
        />
      ),
    })),
  ];

  // Phones: each section's amounts as a labelled two-by-two grid, total below
  return isPhone ? (
    <div className="cl-sec-edit">
      {sections.map((sec, idx) => (
        <div key={`${sec.section_name}-${idx}`} className="cl-sec-edit-item">
          <div className="cl-sec-edit-name">{sec.section_name}</div>
          <div className="cl-sec-edit-grid">
            {SECTION_AMOUNT_FIELDS.map((f) => (
              <label key={f.key} className="cl-sec-edit-field">
                <span>{f.label}</span>
                <InputNumber
                  prefix="$"
                  value={sec[f.key]}
                  onChange={(v) => handleSectionEdit(idx, f.key, v)}
                  style={{ width: '100%' }}
                  min={0}
                  step={100}
                  inputMode="decimal"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="cl-sec-edit-totals">
        <div className="cl-sec-edit-name">Total</div>
        <div className="cl-rev-section-grid">
          {SECTION_AMOUNT_FIELDS.map((f) => (
            <React.Fragment key={f.key}>
              <span>{f.label}</span>
              <span><strong>{formatCurrency(totals[f.total])}</strong></span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  ) : (
    <Table
      size="small"
      rowKey={(r) => `${r.section_name}-${r._idx}`}
      columns={sectionColumns}
      dataSource={sections.map((s, i) => ({ ...s, _idx: i }))}
      pagination={false}
      scroll={{ x: 600 }}
      style={{ marginBottom: 12 }}
      summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <Text strong>Total</Text>
            </Table.Summary.Cell>
            {SECTION_AMOUNT_FIELDS.map((f, i) => (
              <Table.Summary.Cell key={f.key} index={i + 1}>
                <Text strong>{formatCurrency(totals[f.total])}</Text>
              </Table.Summary.Cell>
            ))}
          </Table.Summary.Row>
        </Table.Summary>
      )}
    />
  );
};

interface NegotiationModalProps {
  open: boolean;
  clientId: string;
  claimId: string;
  onCancel: () => void;
  onSubmit: (values: Omit<ClaimNegotiationCreate, 'claim_id'>) => Promise<void>;
  loading: boolean;
  /** Preselected revision type (an appraisal claim's next estimate is usually the award) */
  defaultRevisionType?: ClaimNegotiation['revision_type'];
}

const NegotiationModal: React.FC<NegotiationModalProps> = ({
  open,
  clientId,
  claimId,
  onCancel,
  onSubmit,
  loading,
  defaultRevisionType,
}) => {
  const [form] = Form.useForm();
  const { isPhone, sheetProps } = useSheetModal('tall');
  const [activeTab, setActiveTab] = useState<'pdf' | 'manual'>('pdf');
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<PdfExtractionResult | null>(null);
  const [editedSections, setEditedSections] = useState<NegotiationSection[]>([]);

  React.useEffect(() => {
    if (open) {
      form.resetFields();
      if (defaultRevisionType) form.setFieldsValue({ revision_type: defaultRevisionType });
      setActiveTab('pdf');
      setExtraction(null);
      setEditedSections([]);
      setExtracting(false);
    }
  }, [open, form, defaultRevisionType]);

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

  const computedTotals = React.useMemo(
    () => (editedSections.length ? sumSectionTotals(editedSections) : null),
    [editedSections],
  );

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
      {...sheetProps}
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
                    {/* A long file name wraps on its own line; tag and Re-upload follow */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Text strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <FilePdfOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
                        {extraction.file_name}
                      </Text>
                      <Tag color="blue" style={{ margin: 0 }}>{editedSections.length} section(s)</Tag>
                      <Button
                        size="small"
                        style={{ marginLeft: 'auto' }}
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

                    <SectionAmountsEditor sections={editedSections} onChange={setEditedSections} isPhone={isPhone} />
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

      <Form form={form} layout="vertical" className="cl-form" onFinish={handleFinish} scrollToFirstError>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="revision_type" label="Revision Type"
              rules={[{ required: true, message: 'Revision type is required' }]}>
              <Select placeholder="Select type">
                {Object.entries(REVISION_TYPE_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="estimate_category" label="Category"
              tooltip="Revision numbers are tracked separately per category">
              <Select allowClear placeholder="Select category">
                {Object.entries(ESTIMATE_CATEGORY_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
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

        <Form.Item className="ui-form-actions" style={{ marginBottom: 0, textAlign: 'right' }}>
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
// Edit Negotiation Modal
// ─────────────────────────────────────────────

interface EditNegotiationModalProps {
  open: boolean;
  negotiation: ClaimNegotiation | null;
  onCancel: () => void;
  onSubmit: (values: Partial<ClaimNegotiationCreate>) => Promise<void>;
  loading: boolean;
}

/** Correct a saved revision by hand: an amount the PDF read wrong, or a typo
    in a manual entry. Revisions read from a PDF are corrected section by
    section and their totals follow; the rest edit the totals directly. */
const EditNegotiationModal: React.FC<EditNegotiationModalProps> = ({
  open,
  negotiation,
  onCancel,
  onSubmit,
  loading,
}) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  return (
    <Modal
      title={
        <Space>
          <EditOutlined />
          Edit Revision{negotiation ? ` #${negotiation.revision_number}` : ''}
        </Space>
      }
      open={open}
      onCancel={onCancel}
      footer={null}
      width={800}
      {...sheetProps}
      destroyOnHidden
      maskClosable={false}
    >
      {negotiation && (
        <EditNegotiationForm
          key={negotiation.id}
          negotiation={negotiation}
          isPhone={isPhone}
          onCancel={onCancel}
          onSubmit={onSubmit}
          loading={loading}
        />
      )}
    </Modal>
  );
};

// Mounted fresh for each revision, so the form and sections start from it
const EditNegotiationForm: React.FC<{
  negotiation: ClaimNegotiation;
  isPhone: boolean;
  onCancel: () => void;
  onSubmit: (values: Partial<ClaimNegotiationCreate>) => Promise<void>;
  loading: boolean;
}> = ({ negotiation, isPhone, onCancel, onSubmit, loading }) => {
  const [form] = Form.useForm();
  const [sections, setSections] = useState<NegotiationSection[]>(negotiation.sections_data ?? []);
  const hasSections = sections.length > 0;
  const fileId = negotiation.file_download_id;

  const handleFinish = async (values: any) => {
    // null clears a field the user emptied
    const payload: any = {
      revision_type: values.revision_type,
      estimate_category: values.estimate_category ?? null,
      date_received: values.date_received ? dayjs(values.date_received).format('YYYY-MM-DD') : null,
      received_from: values.received_from || null,
      notes: values.notes || null,
    };
    if (hasSections) {
      // The server sums the sections into the revision's totals
      payload.sections_data = sections;
    } else {
      payload.acv_amount = values.acv_amount ?? 0;
      payload.rcv_amount = values.rcv_amount ?? 0;
      payload.depreciation_amount = values.depreciation_amount ?? 0;
      payload.deductible = values.deductible ?? 0;
    }
    await onSubmit(payload);
  };

  return (
    <>
      <Divider style={{ margin: '16px 0 16px' }} />
      <Form
        form={form}
        layout="vertical"
        className="cl-form"
        onFinish={handleFinish}
        scrollToFirstError
        initialValues={{
          revision_type: negotiation.revision_type,
          estimate_category: negotiation.estimate_category ?? undefined,
          date_received: negotiation.date_received ? dayjs(negotiation.date_received) : undefined,
          received_from: negotiation.received_from,
          notes: negotiation.notes,
          acv_amount: negotiation.acv_amount,
          rcv_amount: negotiation.rcv_amount,
          depreciation_amount: negotiation.depreciation_amount,
          deductible: negotiation.deductible,
        }}
      >
        {fileId && (
          <div style={{ marginBottom: 12 }}>
            <a
              href={`${fileService.getDownloadUrl(fileId)}?inline=true`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ overflowWrap: 'anywhere' }}
            >
              <FilePdfOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />
              {negotiation.document_name || 'View PDF'}
            </a>
          </div>
        )}

        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="revision_type" label="Revision Type"
              rules={[{ required: true, message: 'Revision type is required' }]}>
              <Select placeholder="Select type">
                {Object.entries(REVISION_TYPE_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="estimate_category" label="Category">
              <Select allowClear placeholder="Select category">
                {Object.entries(ESTIMATE_CATEGORY_CONFIG).map(([val, cfg]) => (
                  <Option key={val} value={val}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="date_received" label="Date Received">
              <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
            </Form.Item>
          </Col>
        </Row>

        {hasSections ? (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
              Amounts by section, as read from the PDF. The revision's totals are the sum of these.
            </Text>
            <SectionAmountsEditor sections={sections} onChange={setSections} isPhone={isPhone} />
          </>
        ) : (
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="acv_amount" label="ACV Amount">
                <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} inputMode="decimal" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="rcv_amount" label="RCV Amount">
                <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} inputMode="decimal" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="depreciation_amount" label="Depreciation">
                <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} inputMode="decimal" />
              </Form.Item>
            </Col>
          </Row>
        )}

        <Row gutter={12}>
          {!hasSections && (
            <Col xs={24} sm={12}>
              <Form.Item name="deductible" label="Deductible">
                <InputNumber prefix="$" style={{ width: '100%' }} min={0} step={100} inputMode="decimal" />
              </Form.Item>
            </Col>
          )}
          <Col xs={24} sm={12}>
            <Form.Item name="received_from" label="Received From">
              <Input placeholder="e.g. Adjuster name" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Form.Item className="ui-form-actions" style={{ marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              Save Changes
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </>
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
  // Kept after the dialog closes so it doesn't empty while animating out
  const [editingNeg, setEditingNeg] = useState<ClaimNegotiation | null>(null);
  const [editNegOpen, setEditNegOpen] = useState(false);
  const [appraisalModalOpen, setAppraisalModalOpen] = useState(false);
  const [appraisalDate, setAppraisalDate] = useState<dayjs.Dayjs | null>(null);
  const [uploadingNegId, setUploadingNegId] = useState<string | null>(null);
  const [openSectionsId, setOpenSectionsId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const { sheetProps: appraisalSheetProps } = useSheetModal();

  const { data, isLoading } = useQuery({
    queryKey: ['negotiations', clientId, claim.id],
    queryFn: () => negotiationService.listByClaim(clientId, claim.id),
    refetchOnMount: 'always',
  });

  const negotiations = data?.negotiations ?? [];

  const createNegMutation = useMutation({
    mutationFn: (payload: Omit<ClaimNegotiationCreate, 'claim_id'>) =>
      negotiationService.create(clientId, claim.id, { ...payload, claim_id: claim.id }),
    onSuccess: () => {
      message.success('Negotiation revision added.');
      queryClient.invalidateQueries({ queryKey: ['negotiations', clientId, claim.id] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setNegModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to add revision.');
    },
  });

  const deleteNegMutation = useMutation({
    mutationFn: (negotiationId: string) =>
      negotiationService.delete(clientId, claim.id, negotiationId),
    onSuccess: () => {
      message.success('Insurance estimate deleted.');
      queryClient.invalidateQueries({ queryKey: ['negotiations', clientId, claim.id] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    },
    onError: () => message.error('Failed to delete.'),
  });

  // Hand edit of a saved revision; the claim's current amounts follow on the server
  const updateNegMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ClaimNegotiationCreate> }) =>
      negotiationService.update(clientId, claim.id, id, payload),
    onSuccess: () => {
      message.success('Revision updated.');
      queryClient.invalidateQueries({ queryKey: ['negotiations', clientId, claim.id] });
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setEditNegOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to update revision.');
    },
  });

  const openEditNeg = (record: ClaimNegotiation) => {
    setEditingNeg(record);
    setEditNegOpen(true);
  };

  // Appraisal: the claim leaves negotiation and is settled outside the
  // supplement process. The date stays once the claim settles.
  const inAppraisal = claim.status === 'appraisal';
  const wentToAppraisal = inAppraisal || !!claim.appraisal_date;

  const appraisalMutation = useMutation({
    mutationFn: (payload: Partial<ClaimCreate>) => claimService.update(clientId, claim.id, payload),
    onSuccess: (_data, payload) => {
      message.success(
        payload.status !== 'appraisal' ? 'Claim moved back to negotiation.'
          : inAppraisal ? 'Appraisal date updated.' : 'Claim moved to appraisal.',
      );
      queryClient.invalidateQueries({ queryKey: ['claims', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client', clientId] });
      setAppraisalModalOpen(false);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to update claim.');
    },
  });

  const openAppraisalModal = () => {
    setAppraisalDate(claim.appraisal_date ? dayjs(claim.appraisal_date) : dayjs());
    setAppraisalModalOpen(true);
  };

  // Sort by category then revision number. Delta compares against the previous
  // revision *within the same category* — comparing a WM revision against a
  // reconstruction one produces a meaningless difference.
  const sorted = [...negotiations].sort((a, b) => {
    const catA = a.estimate_category || '';
    const catB = b.estimate_category || '';
    if (catA !== catB) return catA.localeCompare(catB);
    return a.revision_number - b.revision_number;
  });

  const prevInCategory = (record: ClaimNegotiation): ClaimNegotiation | null => {
    const sameCat = sorted.filter(
      (n) => (n.estimate_category || '') === (record.estimate_category || ''),
    );
    const idx = sameCat.findIndex((n) => n.id === record.id);
    return idx > 0 ? sameCat[idx - 1] : null;
  };

  // The last estimate on file when the claim moved to appraisal: received
  // (or, without a received date, added) on or before the appraisal date.
  const revisionDate = (n: ClaimNegotiation) => dayjs(n.date_received || n.created_at);
  const isLater = (a: ClaimNegotiation, b: ClaimNegotiation) => {
    const da = revisionDate(a);
    const db = revisionDate(b);
    if (!da.isSame(db)) return da.isAfter(db);
    return dayjs(a.created_at).isAfter(dayjs(b.created_at));
  };
  const lastBeforeAppraisal = wentToAppraisal
    ? negotiations
        .filter((n) => !claim.appraisal_date
          || !revisionDate(n).isAfter(dayjs(claim.appraisal_date), 'day'))
        .reduce<ClaimNegotiation | null>((latest, n) => (!latest || isLater(n, latest) ? n : latest), null)
    : null;
  const appraisalAfter = !lastBeforeAppraisal
    ? 'before any carrier estimate'
    : `${lastBeforeAppraisal.revision_type === 'initial'
        ? 'after the initial estimate'
        : `after ${REVISION_TYPE_CONFIG[lastBeforeAppraisal.revision_type]?.label ?? 'revision'} #${lastBeforeAppraisal.revision_number}`
      } (RCV ${formatCurrency(lastBeforeAppraisal.rcv_amount)})`;

  // View / replace / delete the revision's PDF (table cell and phone row)
  const renderFileActions = (record: ClaimNegotiation) => {
    const fileId = record.file_download_id;
    return (
      <Space size={2} className="cl-row-actions">
        {fileId ? (
          <Tooltip title={record.document_name || 'View PDF'}>
            <a
              className="cl-file-link sup-pdf-link"
              href={`${fileService.getDownloadUrl(fileId)}?inline=true`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View PDF${record.document_name ? `: ${record.document_name}` : ''}`}
            >
              <FilePdfOutlined />
            </a>
          </Tooltip>
        ) : record.document_url ? (
          <Tooltip title="PDF file not found">
            <span className="cl-file-missing" aria-label="PDF file not found"><FilePdfOutlined /></span>
          </Tooltip>
        ) : null}
        <Upload
          accept=".pdf"
          maxCount={1}
          showUploadList={false}
          disabled={uploadingNegId === record.id}
          beforeUpload={async (file) => {
            if (file.type !== 'application/pdf') { message.error('PDF only'); return Upload.LIST_IGNORE; }
            setUploadingNegId(record.id);
            try {
              const uploaded = await fileService.uploadFiles([file], 'negotiation', claim.id, 'insurance_estimate');
              if (uploaded.length > 0) {
                await negotiationService.update(clientId, claim.id, record.id, {
                  file_id: uploaded[0].id,
                } as any);
                message.success('PDF replaced');
                queryClient.invalidateQueries({ queryKey: ['negotiations', clientId, claim.id] });
              }
            } catch { message.error('Failed to replace PDF'); }
            finally { setUploadingNegId(null); }
            return false;
          }}
        >
          <Tooltip title={fileId ? 'Replace PDF' : 'Upload PDF'}>
            <Button type="text" size="small"
              className="cl-touch-icon ui-icon-btn"
              aria-label={fileId ? 'Replace PDF' : 'Upload PDF'}
              icon={uploadingNegId === record.id ? <LoadingOutlined /> : <UploadOutlined />}
              disabled={uploadingNegId === record.id} />
          </Tooltip>
        </Upload>
        <Tooltip title="Edit amounts and details">
          <Button type="text" size="small"
            className="cl-touch-icon ui-icon-btn"
            aria-label="Edit revision"
            icon={<EditOutlined />}
            onClick={() => openEditNeg(record)} />
        </Tooltip>
        <Popconfirm
          title="Delete this insurance estimate?"
          description={`v${record.revision_number} (RCV ${formatCurrency(record.rcv_amount)}) will be permanently deleted.`}
          onConfirm={() => deleteNegMutation.mutate(record.id)}
          okText="Delete"
          okButtonProps={{ danger: true }}
          cancelText="Cancel"
        >
          <Tooltip title="Delete estimate">
            <Button type="text" size="small"
              className="cl-touch-icon ui-icon-btn ui-icon-btn--danger"
              aria-label="Delete estimate"
              icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
      </Space>
    );
  };

  // Phone: one block per revision with the same facts as the table row
  const renderPhoneRevision = (record: ClaimNegotiation) => {
    const typeCfg = REVISION_TYPE_CONFIG[record.revision_type];
    const catCfg = record.estimate_category ? ESTIMATE_CATEGORY_CONFIG[record.estimate_category] : null;
    const prev = prevInCategory(record);
    const delta = prev ? record.rcv_amount - prev.rcv_amount : null;
    const sections = record.sections_data ?? [];
    const sectionsOpen = openSectionsId === record.id;
    return (
      <div key={record.id} className="cl-rev">
        <div className="cl-rev-head">
          <Pill tone={typeCfg.tone}>{typeCfg.label}</Pill>
          {catCfg && <span className="cl-meta">{catCfg.label}</span>}
          <span className="cl-rev-num">#{record.revision_number}</span>
        </div>
        <div className="cl-rev-figures">
          <span>RCV <strong className="cl-money">{formatCurrency(record.rcv_amount)}</strong></span>
          <span>ACV <strong className="cl-money">{formatCurrency(record.acv_amount)}</strong></span>
          <span>Dep. <span className="cl-money">{formatCurrency(record.depreciation_amount)}</span></span>
        </div>
        {(delta !== null || record.date_received) && (
          <div className="cl-rev-figures">
            {delta !== null && (
              <Text type={delta > 0 ? 'success' : delta < 0 ? 'danger' : 'secondary'} style={{ fontSize: 13 }}>
                {delta > 0 ? '+' : ''}{formatCurrency(delta)} vs #{prev!.revision_number}
              </Text>
            )}
            {record.date_received && <span>Received {formatDate(record.date_received)}</span>}
          </div>
        )}
        <div className="cl-rev-foot">
          {sections.length > 0 ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              aria-expanded={sectionsOpen}
              onClick={() => setOpenSectionsId(sectionsOpen ? null : record.id)}
            >
              {sectionsOpen ? 'Hide sections' : `Show ${sections.length} section${sections.length > 1 ? 's' : ''}`}
            </Button>
          ) : <span />}
          {renderFileActions(record)}
        </div>
        {sectionsOpen && (
          <div className="cl-rev-sections">
            {sections.map((sec) => (
              <div key={sec.section_name} className="cl-rev-section">
                <div className="cl-rev-section-head">{sec.section_name}</div>
                <div className="cl-rev-section-grid">
                  <span>Line items</span><span>{formatCurrency(sec.line_item_total)}</span>
                  <span>Tax</span><span>{formatCurrency(sec.material_sales_tax)}</span>
                  <span>O&amp;P</span><span>{formatCurrency((sec.overhead_amount || 0) + (sec.profit_amount || 0))}</span>
                  <span>RCV</span><span>{formatCurrency(sec.rcv)}</span>
                  <span>Depreciation</span><span>{formatCurrency(sec.depreciation)}</span>
                  <span>Deductible</span><span>{formatCurrency(sec.deductible)}</span>
                  <span>Net ACV</span><span><strong>{formatCurrency(sec.net_acv)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const columns: ColumnsType<ClaimNegotiation> = [
    {
      title: '#',
      dataIndex: 'revision_number',
      key: 'revision_number',
      width: 40,
      align: 'center',
    },
    {
      title: 'Type',
      dataIndex: 'revision_type',
      key: 'revision_type',
      width: 90,
      render: (type: ClaimNegotiation['revision_type']) => {
        const cfg = REVISION_TYPE_CONFIG[type];
        return <Pill tone={cfg.tone}>{cfg.label}</Pill>;
      },
    },
    {
      title: 'Category',
      dataIndex: 'estimate_category',
      key: 'estimate_category',
      width: 140,
      className: 'cl-nowrap-cell',
      responsive: ['md'] as any,
      render: (cat: ClaimNegotiation['estimate_category']) => {
        if (!cat) return <Text type="secondary">—</Text>;
        return ESTIMATE_CATEGORY_CONFIG[cat]?.label || humanize(cat);
      },
    },
    {
      title: 'RCV',
      dataIndex: 'rcv_amount',
      key: 'rcv_amount',
      align: 'right',
      width: 110,
      render: (v: number) => <span className="cl-money cl-money--strong">{formatCurrency(v)}</span>,
    },
    {
      title: 'ACV',
      dataIndex: 'acv_amount',
      key: 'acv_amount',
      align: 'right',
      width: 110,
      responsive: ['sm'] as any,
      render: (v: number) => <span className="cl-money">{formatCurrency(v)}</span>,
    },
    {
      title: 'Dep.',
      dataIndex: 'depreciation_amount',
      key: 'depreciation_amount',
      align: 'right',
      width: 100,
      render: (v: number) => <span className="cl-money">{formatCurrency(v)}</span>,
      responsive: ['lg'] as any,
    },
    {
      title: 'Delta',
      key: 'delta',
      align: 'right',
      width: 90,
      responsive: ['sm'] as any,
      render: (_: any, record) => {
        const prev = prevInCategory(record);
        if (!prev) return <Text type="secondary">—</Text>;
        const delta = record.rcv_amount - prev.rcv_amount;
        if (delta === 0) return <Text type="secondary">$0</Text>;
        return (
          <span className={delta > 0 ? 'sup-diff-up' : 'sup-diff-down'}>
            {delta > 0 ? '+' : ''}{formatCurrency(delta)}
          </span>
        );
      },
    },
    {
      title: 'Date',
      dataIndex: 'date_received',
      key: 'date_received',
      width: 110,
      render: formatDate,
      responsive: ['md'] as any,
    },
    {
      title: '',
      key: 'pdf',
      width: 120,
      align: 'right',
      render: (_: any, record) => renderFileActions(record),
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
        className="cl-sections-table"
      />
    );
  };

  const origin = claim.estimate_origin ? ESTIMATE_ORIGIN_CONFIG[claim.estimate_origin] : null;

  return (
    <ClaimSection
      title="Negotiation history"
      count={negotiations.length || undefined}
      meta={
        <>
          {origin && (
            <Tooltip title={origin.description}>
              <span className="cl-meta">{origin.label}</span>
            </Tooltip>
          )}
          {claim.estimate_origin === 'contractor_prepared' && claim.contractor_estimate_stage && (
            <Pill tone={CONTRACTOR_STAGE_TONES[claim.contractor_estimate_stage] || 'gray'}>
              {CONTRACTOR_ESTIMATE_STAGE_LABELS[claim.contractor_estimate_stage]
                || humanize(claim.contractor_estimate_stage)}
            </Pill>
          )}
          {claim.estimate_origin === 'contractor_prepared' && claim.rebuild_estimate_company_name && (
            <span className="cl-meta">By {claim.rebuild_estimate_company_name}</span>
          )}
          {claim.wm_cost_status === 'paid_per_invoice' && (
            <Tooltip title="The insurance company pays our WM invoice as billed, so no WM estimate is expected">
              <span><Pill tone="green">{WM_COST_STATUS_LABELS.paid_per_invoice}</Pill></span>
            </Tooltip>
          )}
        </>
      }
      actions={
        <>
          {!wentToAppraisal && (claim.status === 'open' || claim.status === 'negotiating') && (
            <Tooltip title="The claim went to appraisal instead of more supplements">
              <Button size="small" type="text" onClick={openAppraisalModal}>
                Move to appraisal
              </Button>
            </Tooltip>
          )}
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setNegModalOpen(true)}>
            Add revision
          </Button>
        </>
      }
    >
      {wentToAppraisal && (
        <div className="cl-appraisal" role="note">
          <div style={{ minWidth: 0 }}>
            <div className="cl-appraisal-title">
              {inAppraisal ? 'In appraisal' : 'Went to appraisal'}
            </div>
            <div>
              {claim.appraisal_date
                ? `${inAppraisal ? 'Since' : 'On'} ${formatDate(claim.appraisal_date)}, ${appraisalAfter}`
                : appraisalAfter.charAt(0).toUpperCase() + appraisalAfter.slice(1)}
            </div>
            {inAppraisal && (
              <div className="cl-appraisal-note">
                Handled outside the supplement process: no supplement estimate goes out, and
                estimates added now don't open a supplement review. Add the award as an Appraisal revision.
              </div>
            )}
          </div>
          {inAppraisal && (
            <Space size={4} className="cl-appraisal-actions">
              <Button size="small" type="link" onClick={openAppraisalModal}>
                Change date
              </Button>
              <Popconfirm
                title="Move this claim back to negotiation?"
                description="For a claim marked by mistake. The appraisal date is cleared."
                okText="Move back"
                cancelText="Cancel"
                onConfirm={() => appraisalMutation.mutate({
                  status: negotiations.length > 0 ? 'negotiating' : 'open',
                  appraisal_date: null,
                })}
              >
                <Button size="small" type="link">Undo</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
      )}

      {claim.estimate_origin === 'contractor_prepared'
        && claim.contractor_estimate_stage !== 'approved_initial_received' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Carrier asked us to prepare the rebuild estimate"
          description={
            (claim.rebuild_estimate_company_name
              ? `Written and sent by ${claim.rebuild_estimate_company_name}. `
              : 'Pick the company that writes it on the claim: it can\'t be the company that did the water mitigation. ')
            + (claim.contractor_estimate_stage
              ? `Current stage: ${CONTRACTOR_ESTIMATE_STAGE_LABELS[claim.contractor_estimate_stage]}. `
                + 'The approved initial estimate from the carrier is not on file yet.'
              : 'No stage recorded yet. Set the stage on the claim to track progress.')
          }
        />
      )}

      {isPhone ? (
        isLoading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
        ) : sorted.length === 0 ? (
          <div className="cl-empty">No insurance estimates yet.</div>
        ) : (
          <div className="cl-rev-list">{sorted.map(renderPhoneRevision)}</div>
        )
      ) : (
      <Table<ClaimNegotiation>
        rowKey="id"
        columns={columns}
        dataSource={sorted}
        loading={isLoading}
        size="small"
        pagination={false}
        scroll={{ x: 640 }}
        className="cl-table"
        locale={{ emptyText: <div className="cl-empty">No insurance estimates yet.</div> }}
        expandable={{
          expandedRowRender,
          rowExpandable: (record) => !!record.sections_data && record.sections_data.length > 0,
        }}
      />
      )}

      <NegotiationModal
        open={negModalOpen}
        clientId={clientId}
        claimId={claim.id}
        onCancel={() => setNegModalOpen(false)}
        onSubmit={async (vals) => { await createNegMutation.mutateAsync(vals); }}
        loading={createNegMutation.isPending}
        defaultRevisionType={inAppraisal ? 'appraisal' : undefined}
      />

      <EditNegotiationModal
        open={editNegOpen}
        negotiation={editingNeg}
        onCancel={() => setEditNegOpen(false)}
        onSubmit={async (payload) => {
          if (editingNeg) await updateNegMutation.mutateAsync({ id: editingNeg.id, payload });
        }}
        loading={updateNegMutation.isPending}
      />

      <Modal
        title={inAppraisal ? 'Change appraisal date' : 'Move claim to appraisal'}
        open={appraisalModalOpen}
        onCancel={() => setAppraisalModalOpen(false)}
        onOk={() => appraisalMutation.mutate({
          status: 'appraisal',
          appraisal_date: appraisalDate ? appraisalDate.format('YYYY-MM-DD') : null,
        })}
        okText={inAppraisal ? 'Save' : 'Move to Appraisal'}
        okButtonProps={{ disabled: !appraisalDate }}
        confirmLoading={appraisalMutation.isPending}
        {...appraisalSheetProps}
        destroyOnHidden
      >
        {!inAppraisal && (
          <p style={{ marginTop: 0 }}>
            Appraisal is handled outside the supplement process. No supplement estimate goes out for
            this claim after this, and estimates added from now on won't open a supplement review.
          </p>
        )}
        <label style={{ display: 'block' }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
            Date it moved to appraisal
          </Text>
          <DatePicker
            value={appraisalDate}
            onChange={setAppraisalDate}
            format="MM/DD/YYYY"
            style={{ width: '100%' }}
          />
        </label>
      </Modal>
    </ClaimSection>
  );
};

// ─────────────────────────────────────────────
// Claim row (Claims and Financials tabs)
// ─────────────────────────────────────────────

const ClaimRowHead: React.FC<{ claim: Claim; showAmounts?: 'rcv' | 'both' }> = ({ claim, showAmounts = 'rcv' }) => {
  const statusCfg = CLAIM_STATUS_CONFIG[claim.status];
  const hasAmounts = claim.current_acv > 0 || claim.current_rcv > 0;
  const meta = [
    claim.insurance_company,
    claim.date_of_loss && `Loss ${formatDate(claim.date_of_loss)}`,
    hasAmounts && (showAmounts === 'both'
      ? `ACV ${formatCurrency(claim.current_acv)} · RCV ${formatCurrency(claim.current_rcv)}`
      : `RCV ${formatCurrency(claim.current_rcv)}`),
  ].filter(Boolean);
  return (
    <div className="cl-claim-head">
      <div className="cl-claim-title">
        <span className="cl-claim-num">{claim.claim_number || 'No claim #'}</span>
        {statusCfg && <Pill tone={statusCfg.tone}>{statusCfg.label}</Pill>}
      </div>
      {meta.length > 0 && <div className="cl-meta">{meta.join(' · ')}</div>}
    </div>
  );
};

const CompanyMark: React.FC<{ id?: string; name?: string }> = ({ id, name }) => {
  if (!name) return <span className="cl-meta">Unassigned</span>;
  const tone = tagTones[toneFromKey(id || name)];
  const code = name.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span className="cl-company">
      <span className="ui-monogram" aria-hidden="true" style={{ background: tone.bg, color: tone.text }}>
        {code || name.slice(0, 2)}
      </span>
      <span>{name}</span>
    </span>
  );
};

// In-app link that still opens in a new tab on ctrl/cmd-click
const useInAppLink = () => {
  const navigate = useNavigate();
  return (to: string) => ({
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  });
};

// The claim's facts: adjuster, deductible, estimate, loss description
const ClaimFacts: React.FC<{ claim: Claim; onEdit: () => void; onEmail: () => void }> = ({ claim, onEdit, onEmail }) => (
  <ClaimSection
    title="Claim"
    actions={(
      <Button size="small" type="text" icon={<EditOutlined />} onClick={onEdit}>
        Edit
      </Button>
    )}
  >
    <PropertyList
      labelWidth={104}
      items={[
        { key: 'num', label: 'Claim #', value: claim.claim_number },
        { key: 'dol', label: 'Date of loss', value: claim.date_of_loss ? formatDate(claim.date_of_loss) : null },
        {
          key: 'ded',
          label: 'Deductible',
          value: claim.insurance_deductible != null ? (
            <>
              <span className="cl-money">{formatCurrency(claim.insurance_deductible)}</span>
              {(claim.deductible_discount || 0) > 0 && (
                <span className="cl-meta"> · −{formatCurrency(claim.deductible_discount)} discount</span>
              )}
            </>
          ) : null,
        },
        {
          key: 'est',
          label: 'Estimate',
          value: claim.insurance_estimate_received
            ? <Pill tone="green" icon={<CheckCircleOutlined />}>Received</Pill>
            : <Pill tone="orange">Not received</Pill>,
        },
        {
          key: 'amounts',
          label: 'ACV / RCV',
          hideEmpty: true,
          value: (claim.current_acv > 0 || claim.current_rcv > 0) ? (
            <span className="cl-money">{formatCurrency(claim.current_acv)} / {formatCurrency(claim.current_rcv)}</span>
          ) : null,
        },
        {
          key: 'adj',
          label: 'Adjuster',
          value: (claim.adjuster_name || claim.adjuster_phone || claim.adjuster_email) ? (
            <div className="cl-contact">
              {claim.adjuster_name && <div>{claim.adjuster_name}</div>}
              {claim.adjuster_phone && (
                <a className="cl-contact-line" href={`tel:${claim.adjuster_phone.split(/ext/i)[0].replace(/[^\d+]/g, '')}`}>
                  {claim.adjuster_phone}
                </a>
              )}
              {claim.adjuster_email && (
                <Tooltip title="Send email">
                  <button type="button" className="cl-contact-line cl-link-btn" onClick={onEmail}>
                    {claim.adjuster_email}
                  </button>
                </Tooltip>
              )}
            </div>
          ) : null,
        },
        { key: 'loss', label: 'Loss', hideEmpty: true, value: claim.loss_description || null },
      ]}
    />
  </ClaimSection>
);

// Jobs and documents on the claim
const ClaimLinks: React.FC<{ claim: Claim }> = ({ claim }) => {
  const linkTo = useInAppLink();
  const counts = [
    { label: 'Invoices', n: claim.invoice_count },
    { label: 'Estimates', n: claim.estimate_count },
    { label: 'WM jobs', n: claim.wm_job_count },
    { label: 'Work orders', n: claim.work_order_count },
    { label: 'Cabinet estimates', n: claim.cabinet_estimate_count },
  ];
  const jobs = [
    ...(claim.wm_jobs ?? []).map(job => ({
      key: `wm-${job.id}`,
      to: `/water-mitigation/${job.id}`,
      title: job.property_address || job.claim_number || 'WM Job',
      kind: 'Water mitigation',
      status: <WMStatusPill status={job.status} />,
      companyId: job.company_id,
      company: job.company_name,
    })),
    ...(claim.rebuild_jobs ?? []).map(wo => ({
      key: `wo-${wo.id}`,
      to: `/work-order/${wo.id}`,
      title: wo.property_address || wo.work_order_number || 'Work Order',
      kind: wo.work_order_number ? `Rebuild · ${wo.work_order_number}` : 'Rebuild work order',
      status: wo.status ? <WorkOrderStatusPill status={wo.status} /> : null,
      companyId: wo.company_id,
      company: wo.company_name,
    })),
  ];

  return (
    <ClaimSection title="Jobs & documents">
      {jobs.length > 0 && (
        <ul className="cl-jobs">
          {jobs.map(job => (
            <li key={job.key}>
              <a className="cl-job" {...linkTo(job.to)}>
                <span className="cl-job-top">
                  {job.status}
                  <span className="cl-job-title">{job.title}</span>
                </span>
                <span className="cl-meta cl-job-meta">
                  <span>{job.kind}</span>
                  <CompanyMark id={job.companyId} name={job.company} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <dl className="cl-counts">
        {counts.map(c => (
          <div key={c.label} className={(c.n ?? 0) > 0 ? '' : 'is-zero'}>
            <dt>{c.label}</dt>
            <dd>{c.n ?? 0}</dd>
          </div>
        ))}
      </dl>
      {claim.plumber_report_id && (
        <a className="cl-link-line" {...linkTo(`/plumber-reports/${claim.plumber_report_id}`)}>
          <FileTextOutlined aria-hidden="true" /> Plumber report
        </a>
      )}
    </ClaimSection>
  );
};

// Sent and received mail for the claim, one view at a time
const ClaimEmailSection: React.FC<{ claimId: string; onSend: () => void }> = ({ claimId, onSend }) => {
  const [view, setView] = useState<'sent' | 'received'>('sent');
  return (
    <ClaimSection
      title="Email"
      meta={(
        <div className="cl-view-tabs" role="tablist" aria-label="Email view">
          {(['sent', 'received'] as const).map(v => (
            <Button
              key={v}
              type="text"
              size="small"
              role="tab"
              aria-selected={view === v}
              className={`ui-view-tab${view === v ? ' is-selected' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'sent' ? 'Sent' : 'Received'}
            </Button>
          ))}
        </div>
      )}
      actions={(
        <Button size="small" type="text" icon={<SendOutlined />} onClick={onSend}>
          Send Email
        </Button>
      )}
    >
      {/* Received: inbound mail matched to this claim, attachment or not -
          received_emails, plus the stored attachment files that email
          ingestion logged against the claim. */}
      {view === 'sent' ? <EmailHistory claimId={claimId} /> : <ReceivedEmails claimId={claimId} />}
    </ClaimSection>
  );
};

const ClaimPhotos: React.FC<{ claimId: string }> = ({ claimId }) => {
  const [open, setOpen] = useState(false);
  return (
    <ClaimSection
      title="Completion photos"
      actions={(
        <Button size="small" type="text" icon={<CameraOutlined />} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide photos' : 'Show photos'}
        </Button>
      )}
    >
      {open && <ClaimPhotosSection claimId={claimId} />}
    </ClaimSection>
  );
};

// One open claim: the work in the wide column, the claim's facts and
// activity beside it (one column below 1200px, facts first)
const ClaimPanel: React.FC<{
  claim: Claim;
  client: Client;
  onEdit: () => void;
  onEmail: () => void;
}> = ({ claim, client, onEdit, onEmail }) => (
  <div className="cl-claim">
    <div className="cl-claim-aside cl-claim-aside--top">
      <ClaimFacts claim={claim} onEdit={onEdit} onEmail={onEmail} />
      <ClaimLinks claim={claim} />
    </div>
    <div className="cl-claim-main">
      <NegotiationHistory clientId={client.id} claim={claim} />
      <ClaimContractDashboard
        claimId={claim.id}
        clientId={client.id}
        clientEmail={client.email || undefined}
      />
      <ClaimEmailSection claimId={claim.id} onSend={onEmail} />
      <div className="cl-claim-pair">
        <ClaimTodos clientId={client.id} claimId={claim.id} />
        <ClaimNotes clientId={client.id} claimId={claim.id} />
      </div>
      <ClaimPhotos claimId={claim.id} />
    </div>
    <div className="cl-claim-aside cl-claim-aside--bottom">
      <ClaimActivityTimeline clientId={client.id} claimId={claim.id} />
    </div>
  </div>
);

// ─────────────────────────────────────────────
// Claims Tab
// ─────────────────────────────────────────────

interface ClaimsTabProps {
  client: Client;
}

// Build claim-related contacts for email composer
function buildClaimContacts(claim: Claim, client: Client): ClaimContact[] {
  const contacts: ClaimContact[] = [];
  if (claim.adjuster_email) {
    contacts.push({
      name: claim.adjuster_name || 'Adjuster',
      email: claim.adjuster_email,
      role: 'adjuster',
      label: 'Adjuster',
    });
  }
  if (claim.pa_email) {
    contacts.push({
      name: claim.pa_name || claim.pa_company || 'Public Adjuster',
      email: claim.pa_email,
      role: 'pa',
      label: 'PA',
    });
  }
  // Client owners
  client.owners.forEach(o => {
    if (o.email) {
      contacts.push({
        name: o.name,
        email: o.email,
        role: 'owner',
        label: o.is_primary ? 'Owner (Primary)' : 'Owner',
      });
    }
  });
  // Client-level email
  if (client.email) {
    const ownerEmails = client.owners.map(o => o.email?.toLowerCase()).filter(Boolean);
    if (!ownerEmails.includes(client.email.toLowerCase())) {
      contacts.push({
        name: client.display_name,
        email: client.email,
        role: 'client',
        label: 'Client',
      });
    }
  }
  return contacts;
}

const ClaimsTab: React.FC<ClaimsTabProps> = ({ client }) => {
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<Claim | null>(null);
  const [emailDrawerClaim, setEmailDrawerClaim] = useState<Claim | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['claims', client.id],
    queryFn: () => claimService.listByClient(client.id),
    refetchOnMount: 'always',
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

  const handleClaimSubmit = async (values: ClaimCreate) => {
    if (editingClaim) {
      await updateClaimMutation.mutateAsync({ claimId: editingClaim.id, payload: values });
    } else {
      await createClaimMutation.mutateAsync(values);
    }
  };

  return (
    <div>
      <div className="cl-tab-toolbar">
        <span className="cl-meta">
          {isLoading ? '' : `${claims.length} claim${claims.length === 1 ? '' : 's'}`}
        </span>
        <Button
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
        <div className="cl-empty cl-empty--tab">No claims yet. Click "Add Claim" to get started.</div>
      ) : (
        <Collapse
          ghost
          className="ui-collapse-rows cl-claims"
          accordion
          defaultActiveKey={claims.length === 1 ? [claims[0].id] : undefined}
          items={claims.map((claim) => ({
            key: claim.id,
            label: <ClaimRowHead claim={claim} />,
            extra: (
              <Tooltip title="Send Email">
                <Button
                  type="text"
                  size="small"
                  className="cl-touch-icon ui-icon-btn"
                  aria-label="Send email"
                  icon={<MailOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmailDrawerClaim(claim);
                  }}
                />
              </Tooltip>
            ),
            children: (
              <ClaimPanel
                claim={claim}
                client={client}
                onEdit={() => {
                  setEditingClaim(claim);
                  setClaimModalOpen(true);
                }}
                onEmail={() => setEmailDrawerClaim(claim)}
              />
            ),
          }))}
        />
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

      {/* Email Composer Drawer */}
      <Drawer
        title={
          <Space>
            <SendOutlined />
            <span>
              Send Email - Claim #{emailDrawerClaim?.claim_number}
            </span>
          </Space>
        }
        placement="right"
        width={720}
        open={!!emailDrawerClaim}
        onClose={() => setEmailDrawerClaim(null)}
        destroyOnHidden
      >
        {emailDrawerClaim && (
          <EmailComposer
            claimId={emailDrawerClaim.id}
            contacts={buildClaimContacts(emailDrawerClaim, client)}
            templateValues={{
              claim_number: emailDrawerClaim.claim_number,
              property_address: client.address,
              homeowner_name: client.display_name,
              adjuster_name: emailDrawerClaim.adjuster_name,
              pa_name: emailDrawerClaim.pa_name,
              insurance_company: emailDrawerClaim.insurance_company,
            }}
            defaultTo={emailDrawerClaim.adjuster_email ? [emailDrawerClaim.adjuster_email] : []}
            defaultSubject={`Claim #${emailDrawerClaim.claim_number} - ${emailDrawerClaim.insurance_company || ''}`}
            onSent={() => {
              setEmailDrawerClaim(null);
              queryClient.invalidateQueries({ queryKey: ['sent-emails-claim', emailDrawerClaim.id] });
            }}
            onCancel={() => setEmailDrawerClaim(null)}
          />
        )}
      </Drawer>
    </div>
  );
};

// ─────────────────────────────────────────────
// All Documents Tab
// ─────────────────────────────────────────────

interface AllDocumentsTabProps {
  client: Client;
}

const DOC_STATUS_TONES: Record<string, TagTone> = {
  draft: 'gray',
  calculated: 'blue',
  completed: 'blue',
  approved: 'green',
  exported: 'purple',
  final: 'green',
  sent: 'blue',
};

const DocStatusPill: React.FC<{ status?: string }> = ({ status }) => {
  const value = status || 'draft';
  return <Pill tone={DOC_STATUS_TONES[value] || 'gray'}>{humanize(value)}</Pill>;
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
      render: (val?: string) => val || '—',
      responsive: ['sm'] as any,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      align: 'right',
      render: (v?: number) => <span className="cl-money">{formatCurrency(v)}</span>,
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
      render: (status: string) => <DocStatusPill status={status} />,
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
      render: (val?: string) => <span className="ui-ink-link">{val || '—'}</span>,
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
      render: (v?: number) => <span className="cl-money">{formatCurrency(v)}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: string) => <DocStatusPill status={status} />,
    },
    {
      title: 'Service Date',
      dataIndex: 'service_date',
      key: 'service_date',
      width: 120,
      render: formatDate,
      responsive: ['sm'] as any,
    },
  ];

  return (
    <div>
      <ClaimSection title="Cabinet estimates" count={cabinetEstimates.length} size="page">
        {cabinetEstimates.length === 0 ? (
          <div className="cl-empty">No cabinet estimates linked to this client.</div>
        ) : (
          <Table<CabinetEstimateSummary>
            rowKey="id"
            columns={cabColumns}
            dataSource={cabinetEstimates}
            pagination={false}
            size="small"
            className="cl-table"
            onRow={(record) => ({
              onClick: () => navigate(`/cabinet-estimates/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </ClaimSection>

      <ClaimSection title="Plumber reports" count={plumberReports.length} size="page">
        {plumberReports.length === 0 ? (
          <div className="cl-empty">No plumber reports linked to this client.</div>
        ) : (
          <Table<PlumberReportSummary>
            rowKey="id"
            columns={plumberColumns}
            dataSource={plumberReports}
            pagination={false}
            size="small"
            className="cl-table"
            onRow={(record) => ({
              onClick: () => navigate(`/plumber-reports/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </ClaimSection>

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
      render: (val?: string) => <span className="ui-ink-link">{val || 'Untitled'}</span>,
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
        ? <span className="cl-money">${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        : '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status?: string) => <DocStatusPill status={status} />,
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
    <ClaimSection title="Packing estimates" count={estimates.length} size="page">
      {estimates.length === 0 ? (
        <div className="cl-empty">No packing estimates linked to this client.</div>
      ) : (
        <Table
          rowKey="id"
          columns={packColumns}
          dataSource={estimates}
          pagination={false}
          size="small"
          className="cl-table"
          onRow={(record: any) => ({
            onClick: () => navigate(`/reconstruction-estimate/pack-calculator-new/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      )}
    </ClaimSection>
  );
};

// ─────────────────────────────────────────────
// Financials Tab (Payment Tracking + Profitability per Claim)
// ─────────────────────────────────────────────

interface FinancialsTabProps {
  client: Client;
}

const FinancialsTab: React.FC<FinancialsTabProps> = ({ client }) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['claims', client.id],
    queryFn: () => claimService.listByClient(client.id),
    refetchOnMount: 'always',
  });

  const claims = data?.claims ?? [];

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>;
  }

  if (claims.length === 0) {
    return (
      <div className="cl-empty cl-empty--tab">
        No claims yet. Add a claim first to track payments and profitability.
      </div>
    );
  }

  return (
    <Collapse
      ghost
      className="ui-collapse-rows cl-claims"
      defaultActiveKey={claims.map(c => c.id)}
      items={claims.map((claim) => ({
        key: claim.id,
        label: <ClaimRowHead claim={claim} showAmounts="both" />,
        children: (
          <div className="cl-fin">
            <ClaimSection title="Payment tracking">
              <PaymentTracker
                clientId={client.id}
                claimId={claim.id}
                claimNumber={claim.claim_number}
                insuranceCompany={claim.insurance_company}
                onClaimUpdate={() => {
                  queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
                }}
              />
            </ClaimSection>
            <ClaimSection title="Profitability">
              <ProfitabilityTracker
                clientId={client.id}
                claimId={claim.id}
                onUpdate={() => {
                  queryClient.invalidateQueries({ queryKey: ['claims', client.id] });
                }}
              />
            </ClaimSection>
          </div>
        ),
      }))}
    />
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
  useBreadcrumbTitle(client?.display_name || null);

  // Jobs archived from AccuLynx - the tab only shows when there are some
  const { data: archivedJobs = [], isLoading: archivedJobsLoading } = useQuery({
    queryKey: ['acculynx-archive-jobs', id],
    queryFn: () => acculynxArchiveService.listClientJobs(id!),
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

  // A client created by the AccuLynx import leads with its AccuLynx history;
  // a client the import matched to an existing one keeps it at the end
  const isAccuLynxImport = client.source === 'acculynx';
  const accuLynxHistoryTab = {
    key: 'acculynx-history',
    label: (
      <span className="cl-tab-label">
        AccuLynx History
        <span className="ui-tab-count">{archivedJobs.length}</span>
      </span>
    ),
    children: <AccuLynxArchiveTab jobs={archivedJobs} isLoading={archivedJobsLoading} />,
  };

  const tabItems = [
    ...(isAccuLynxImport ? [accuLynxHistoryTab] : []),
    {
      key: 'claims',
      label: (
        <span className="cl-tab-label">
          Claims
          {client.claim_count > 0 && <span className="ui-tab-count">{client.claim_count}</span>}
        </span>
      ),
      children: <ClaimsTab client={client} />,
    },
    {
      key: 'financials',
      label: 'Financials',
      children: <FinancialsTab client={client} />,
    },
    {
      key: 'document-hub',
      label: 'Document Hub',
      children: <ClientDocumentHub clientId={client.id} />,
    },
    {
      key: 'documents',
      label: 'Specialty Documents',
      children: <AllDocumentsTab client={client} />,
    },
    ...(!isAccuLynxImport && archivedJobs.length > 0 ? [accuLynxHistoryTab] : []),
  ];

  const createDocumentItems = [
    {
      key: 'estimate',
      label: 'Estimate',
      onClick: () => navigate('/create/estimate', { state: { presetClient: client } }),
    },
    {
      key: 'invoice',
      label: 'Invoice',
      onClick: () => navigate('/create/invoice', { state: { presetClient: client } }),
    },
    {
      key: 'plumber-report',
      label: "Plumber's Report",
      onClick: () => navigate('/create/plumber-report', { state: { presetClient: client } }),
    },
  ];

  return (
    <div className="cl-page">
      {/* Back navigation */}
      <Button
        icon={<ArrowLeftOutlined />}
        type="text"
        onClick={() => navigate('/clients')}
        style={{ marginBottom: 16, paddingLeft: 0 }}
      >
        Back to Clients
      </Button>

      {/* Name and actions; on phones the actions drop under the name */}
      <PageHeader
        title={client.display_name}
        meta={
          <Pill tone={client.is_active ? 'green' : 'gray'}>
            {client.is_active ? 'Active' : 'Inactive'}
          </Pill>
        }
        actions={
          <>
            <Dropdown menu={{ items: createDocumentItems }} trigger={['click']}>
              <Button type="primary" icon={<FileAddOutlined />}>
                Create Document <DownOutlined />
              </Button>
            </Dropdown>
            <Button icon={<EditOutlined />} onClick={() => setEditModalOpen(true)}>
              Edit
            </Button>
          </>
        }
      />

      {/* Client facts: contact on the left, insurance and notes on the right */}
      <div className="cl-facts">
        <PropertyList
          labelWidth={120}
          items={[
            {
              key: 'owners',
              label: client.owners.length > 1 ? 'Owners' : 'Owner',
              value: client.owners.length === 0 ? null : (
                <div className="cl-owners">
                  {client.owners.map((o, i) => (
                    <div key={i} className="cl-owner">
                      <span className="cl-owner-name">
                        {o.name}
                        {o.is_primary && client.owners.length > 1 && <Pill tone="gray">Primary</Pill>}
                      </span>
                      {(o.phone || o.email) && (
                        <span className="cl-meta">{[o.phone, o.email].filter(Boolean).join(' · ')}</span>
                      )}
                    </div>
                  ))}
                </div>
              ),
            },
            { key: 'address', label: 'Address', icon: <HomeOutlined />, value: fullAddress || null },
            { key: 'phone', label: 'Phone', icon: <PhoneOutlined />, value: client.phone || owner?.phone || null },
            { key: 'email', label: 'Email', icon: <MailOutlined />, value: client.email || owner?.email || null },
          ]}
        />
        <PropertyList
          labelWidth={120}
          items={[
            { key: 'ins', label: 'Insurance', value: client.insurance_company || null },
            { key: 'policy', label: 'Policy #', value: client.insurance_policy_number || null },
            {
              key: 'notes',
              label: 'Notes',
              value: client.notes ? <span className="cl-notes-text">{client.notes}</span> : null,
            },
          ]}
        />
      </div>

      <Tabs
        className="cl-tabs"
        defaultActiveKey={isAccuLynxImport ? 'acculynx-history' : 'claims'}
        items={tabItems}
      />

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
