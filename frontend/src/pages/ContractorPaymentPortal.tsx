import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Card, Button, Typography, Space, Tag, Form, Input, InputNumber,
  Select, DatePicker, Switch, Upload, message, Spin, Result, List,
  Statistic, Row, Col, Divider, Empty,
} from 'antd';
import {
  ArrowLeftOutlined, CameraOutlined, CheckCircleOutlined,
  DollarOutlined, FileImageOutlined, PlusOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  contractorPortalService,
  type ClaimListItem,
  type PaymentSummary,
  type ContractorPayment,
} from '../services/contractorPortalService';

const { Title, Text } = Typography;

const CATEGORY_OPTIONS = [
  { value: 'water_mitigation', label: 'Water Mitigation', color: '#1890ff' },
  { value: 'pack_in_out', label: 'Pack-in / Pack-out', color: '#722ed1' },
  { value: 'rebuild_interior', label: 'Rebuild (Interior)', color: '#fa8c16' },
  { value: 'roofing', label: 'Roofing', color: '#13c2c2' },
  { value: 'siding', label: 'Siding', color: '#52c41a' },
  { value: 'other', label: 'Other', color: '#595959' },
];

const PAYMENT_TYPE_OPTIONS = [
  { value: 'insurance', label: '1st Check (ACV)' },
  { value: 'depreciation_recovery', label: '2nd Check (Dep)' },
  { value: 'supplement', label: 'Supplement' },
  { value: 'deductible', label: 'Deductible' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  insurance: '1st Check (ACV)',
  depreciation_recovery: '2nd Check (Dep)',
  supplement: 'Supplement',
  deductible: 'Deductible',
  other: 'Other',
};

const getCategoryColor = (cat?: string) =>
  CATEGORY_OPTIONS.find(o => o.value === cat)?.color || '#595959';

const getCategoryLabel = (cat?: string) =>
  CATEGORY_OPTIONS.find(o => o.value === cat)?.label || cat || 'Other';

const formatCurrency = (val?: number) => {
  if (val == null) return '$0.00';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type Step = 'loading' | 'invalid' | 'claims' | 'payments';

const ContractorPaymentPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();

  // Determine mode: token-based or auth-based (any logged-in user can access)
  const isAuthMode = useMemo(() => !token && !!user, [token, user]);
  const companyId = useMemo(() => user?.company_id || null, [user]);

  const [step, setStep] = useState<Step>('loading');
  const [contactName, setContactName] = useState('');
  const [claims, setClaims] = useState<ClaimListItem[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<ClaimListItem | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [checkPhotoFileId, setCheckPhotoFileId] = useState<string | null>(null);
  const [checkPhotoUploading, setCheckPhotoUploading] = useState(false);
  const [form] = Form.useForm();

  // Initialize on mount
  useEffect(() => {
    (async () => {
      try {
        if (isAuthMode) {
          // Auth mode: show all claims (or filtered by company_id if set)
          setContactName(user?.full_name || user?.first_name || 'Contractor');
          const claimList = await contractorPortalService.getClaimsByCompany(companyId || undefined);
          setClaims(claimList);
          setStep('claims');
        } else if (token) {
          // Token mode
          const res = await contractorPortalService.validateToken(token);
          if (!res.valid) { setStep('invalid'); return; }
          setContactName(res.contact_name || '');
          const claimList = await contractorPortalService.getClaims(token);
          setClaims(claimList);
          setStep('claims');
        } else {
          setStep('invalid');
        }
      } catch {
        setStep('invalid');
      }
    })();
  }, [token, isAuthMode, companyId]);

  const selectClaim = async (claim: ClaimListItem) => {
    setSelectedClaim(claim);
    setLoading(true);
    try {
      const data = isAuthMode
        ? await contractorPortalService.getPaymentsByCompany(claim.claim_id, companyId || '')
        : await contractorPortalService.getPayments(token!, claim.claim_id);
      setPaymentData(data);
      setStep('payments');
    } catch {
      message.error('Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  const refreshPayments = async () => {
    if (!selectedClaim) return;
    try {
      const data = isAuthMode
        ? await contractorPortalService.getPaymentsByCompany(selectedClaim.claim_id, companyId || '')
        : await contractorPortalService.getPayments(token!, selectedClaim.claim_id);
      setPaymentData(data);
      const claimList = isAuthMode
        ? await contractorPortalService.getClaimsByCompany(companyId || undefined)
        : await contractorPortalService.getClaims(token!);
      setClaims(claimList);
    } catch { /* silent */ }
  };

  const handleSubmitPayment = async (values: any) => {
    if (!selectedClaim) return;
    setSubmitting(true);
    try {
      const payload = {
        payment_type: values.payment_type,
        payment_category: values.payment_category,
        amount: values.amount,
        check_number: values.check_number,
        check_date: values.check_date?.toISOString(),
        received_date: values.received_date?.toISOString(),
        pa_fee_deducted: values.pa_fee_deducted ?? true,
        pa_fee_amount: values.pa_fee_amount,
        gross_amount: values.gross_amount,
        memo: values.memo,
        check_photo_file_id: checkPhotoFileId || undefined,
        company_id: companyId || undefined,
      };
      if (isAuthMode) {
        await contractorPortalService.createPaymentByCompany(selectedClaim.claim_id, payload);
      } else {
        await contractorPortalService.createPayment(token!, selectedClaim.claim_id, payload);
      }
      message.success('Payment recorded!');
      form.resetFields();
      setCheckPhotoFileId(null);
      setShowForm(false);
      await refreshPayments();
    } catch {
      message.error('Failed to save payment');
    } finally {
      setSubmitting(false);
    }
  };

  const paFeePercentage = paymentData?.expected?.pa_fee_percentage || 20;

  const recalcPaFee = (changedAmount?: number) => {
    const amount = changedAmount ?? form.getFieldValue('amount');
    const deducted = form.getFieldValue('pa_fee_deducted');
    if (deducted && amount && amount > 0) {
      // amount is net (after PA fee). Gross = amount / (1 - paPct/100)
      const paPct = paFeePercentage / 100;
      const gross = +(amount / (1 - paPct)).toFixed(2);
      const paFee = +(gross - amount).toFixed(2);
      form.setFieldsValue({ pa_fee_amount: paFee, gross_amount: gross });
    }
  };

  // ── Render ──

  if (step === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (step === 'invalid') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <Result status="error" title="Invalid Link" subTitle="This portal link is invalid or has been deactivated. Please contact your administrator." />
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    maxWidth: 640, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', background: '#f5f5f5',
    fontSize: 16,
  };

  // Large input style for senior-friendly UI
  const lgInputStyle: React.CSSProperties = { width: '100%', fontSize: 18, height: 48 };

  // ── Claims List ──
  if (step === 'claims') {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0 }}>Payment Portal</Title>
          <Text style={{ fontSize: 16, color: '#666' }}>Welcome, {contactName}</Text>
        </div>

        {claims.length === 0 ? (
          <Empty description={<span style={{ fontSize: 16 }}>No claims assigned</span>} />
        ) : (
          <List
            dataSource={claims}
            renderItem={(claim) => (
              <Card
                hoverable
                style={{ marginBottom: 12, borderLeft: `5px solid ${(claim.remaining || 0) > 0 ? '#fa8c16' : '#52c41a'}`, padding: '4px 0' }}
                styles={{ body: { padding: '16px 20px' } }}
                onClick={() => selectClaim(claim)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: 18 }}>
                      {claim.address || 'No address'}
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 14 }}>
                        {claim.company_name} {claim.role ? `(${claim.role.replace(/reconstruction/g, 'Rebuild').replace(/water_mitigation/g, 'WM').replace(/plumber/g, 'Plumber').replace(/moving/g, 'Moving')})` : ''}
                      </Text>
                    </div>
                    {(claim.insurance_company || claim.claim_number) && (
                      <div><Text type="secondary" style={{ fontSize: 13 }}>
                        {claim.insurance_company}{claim.insurance_company && claim.claim_number ? ': ' : ''}{claim.claim_number}
                      </Text></div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 110 }}>
                    <div><Text style={{ fontSize: 17, color: '#52c41a', fontWeight: 600 }}>{formatCurrency(claim.received_total)}</Text></div>
                    <div><Text type="secondary" style={{ fontSize: 13 }}>of {formatCurrency(claim.expected_amount)}</Text></div>
                  </div>
                </div>
              </Card>
            )}
          />
        )}
      </div>
    );
  }

  // ── Payment Dashboard ──
  if (step === 'payments' && selectedClaim && paymentData) {
    const { expected, grand_total, total_by_category, payments } = paymentData;

    return (
      <div style={containerStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Button
            type="text" icon={<ArrowLeftOutlined style={{ fontSize: 20 }} />}
            style={{ width: 44, height: 44 }}
            onClick={() => { setStep('claims'); setSelectedClaim(null); setShowForm(false); }}
          />
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 19 }}>{selectedClaim.address}</Text>
            <div><Text type="secondary" style={{ fontSize: 14 }}>{selectedClaim.company_name}</Text></div>
          </div>
        </div>

        {/* Summary */}
        <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
          <Row gutter={12}>
            <Col span={8}>
              <Statistic title={<span style={{ fontSize: 13 }}>Expected</span>}
                value={(expected.rcv || 0) - (expected.deductible || 0)} prefix="$" precision={0}
                valueStyle={{ fontSize: 20 }} />
            </Col>
            <Col span={8}>
              <Statistic title={<span style={{ fontSize: 13 }}>Received</span>}
                value={grand_total} prefix="$" precision={0}
                valueStyle={{ fontSize: 20, color: '#52c41a' }} />
            </Col>
            <Col span={8}>
              <Statistic title={<span style={{ fontSize: 13 }}>Remaining</span>}
                value={Math.max(0, (expected.rcv || 0) - (expected.deductible || 0) - grand_total)} prefix="$" precision={0}
                valueStyle={{ fontSize: 20, color: (expected.rcv || 0) - (expected.deductible || 0) - grand_total > 0 ? '#fa8c16' : '#52c41a' }} />
            </Col>
          </Row>
          {Object.keys(total_by_category).length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(total_by_category).map(([cat, amt]) => (
                <Tag key={cat} color={getCategoryColor(cat)} style={{ fontSize: 13, padding: '2px 8px' }}>
                  {getCategoryLabel(cat)}: {formatCurrency(amt)}
                </Tag>
              ))}
            </div>
          )}
        </Card>

        {/* Add Payment Button / Form */}
        {!showForm ? (
          <Button type="primary" block icon={<PlusOutlined />}
            style={{ marginBottom: 16, height: 52, fontSize: 18 }} onClick={() => setShowForm(true)}>
            Record Payment
          </Button>
        ) : (
          <Card title={<span style={{ fontSize: 18 }}>Record Payment</span>} style={{ marginBottom: 16 }}
            extra={<Button type="text" style={{ fontSize: 15 }} onClick={() => { setShowForm(false); form.resetFields(); setCheckPhotoFileId(null); }}>Cancel</Button>}>
            <Form form={form} layout="vertical" size="large" onFinish={handleSubmitPayment}
              initialValues={{ payment_type: 'insurance', pa_fee_deducted: true }}
              style={{ fontSize: 16 }}>

              <Form.Item name="amount" label={<span style={{ fontSize: 16, fontWeight: 600 }}>Check Amount (received)</span>}
                rules={[{ required: true, message: 'Enter amount' }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ ...lgInputStyle, fontSize: 22, height: 54 }}
                  formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={v => v?.replace(/[,$]/g, '') as any}
                  onChange={(v) => recalcPaFee(v as number)}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="payment_category" label={<span style={{ fontSize: 15 }}>Category</span>}>
                    <Select placeholder="Select" allowClear options={CATEGORY_OPTIONS} style={{ height: 44 }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="payment_type" label={<span style={{ fontSize: 15 }}>Payment Type</span>}>
                    <Select allowClear options={PAYMENT_TYPE_OPTIONS} style={{ height: 44 }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="check_number" label={<span style={{ fontSize: 15 }}>Check #</span>}>
                    <Input placeholder="Check number" style={lgInputStyle} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="check_date" label={<span style={{ fontSize: 15 }}>Check Date</span>}>
                    <DatePicker style={{ ...lgInputStyle }} />
                  </Form.Item>
                </Col>
              </Row>

              {/* PA Fee Section */}
              <Divider style={{ margin: '12px 0', fontSize: 15 }}>PA Fee ({paFeePercentage}%)</Divider>
              <Row gutter={12} align="middle">
                <Col span={8}>
                  <Form.Item name="pa_fee_deducted" label={<span style={{ fontSize: 15 }}>Deducted?</span>} valuePropName="checked">
                    <Switch defaultChecked onChange={(checked) => {
                      if (checked) recalcPaFee();
                      else form.setFieldsValue({ pa_fee_amount: undefined, gross_amount: undefined });
                    }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.pa_fee_deducted !== cur.pa_fee_deducted || prev.pa_fee_amount !== cur.pa_fee_amount}>
                    {({ getFieldValue }) => getFieldValue('pa_fee_deducted') ? (
                      <Form.Item name="pa_fee_amount" label={<span style={{ fontSize: 15 }}>PA Fee</span>}>
                        <InputNumber min={0} step={0.01} prefix="$" style={lgInputStyle} readOnly
                          formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                          parser={v => v?.replace(/[,$]/g, '') as any} />
                      </Form.Item>
                    ) : null}
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item noStyle shouldUpdate>
                    {({ getFieldValue }) => getFieldValue('pa_fee_deducted') && getFieldValue('gross_amount') ? (
                      <Form.Item name="gross_amount" label={<span style={{ fontSize: 15 }}>Gross</span>}>
                        <InputNumber min={0} step={0.01} prefix="$" style={lgInputStyle} readOnly
                          formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                          parser={v => v?.replace(/[,$]/g, '') as any} />
                      </Form.Item>
                    ) : null}
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="gross_amount" hidden><InputNumber /></Form.Item>

              {/* Check Photo */}
              <Form.Item label={<span style={{ fontSize: 15 }}>Check Photo</span>}>
                {checkPhotoFileId ? (
                  <Space size="middle">
                    <Tag color="green" style={{ fontSize: 14, padding: '4px 12px' }}><CheckCircleOutlined /> Photo uploaded</Tag>
                    <Button type="link" danger style={{ fontSize: 14 }}
                      onClick={() => setCheckPhotoFileId(null)}>Remove</Button>
                  </Space>
                ) : (
                  <Upload
                    accept="image/*,.pdf"
                    capture="environment"
                    maxCount={1}
                    showUploadList={false}
                    beforeUpload={async (file) => {
                      if (!token && !isAuthMode) return Upload.LIST_IGNORE;
                      setCheckPhotoUploading(true);
                      try {
                        const res = isAuthMode
                          ? await contractorPortalService.uploadCheckPhotoAuth(file as unknown as File)
                          : await contractorPortalService.uploadCheckPhoto(token!, file as unknown as File);
                        setCheckPhotoFileId(res.file_id);
                        message.success('Photo uploaded');
                      } catch {
                        message.error('Upload failed');
                      } finally {
                        setCheckPhotoUploading(false);
                      }
                      return false;
                    }}
                  >
                    <Button icon={checkPhotoUploading ? <Spin size="small" /> : <CameraOutlined />}
                      disabled={checkPhotoUploading}
                      style={{ height: 48, fontSize: 16, padding: '0 24px' }}>
                      {checkPhotoUploading ? 'Uploading...' : 'Take Photo / Upload'}
                    </Button>
                  </Upload>
                )}
              </Form.Item>

              <Form.Item name="memo" label={<span style={{ fontSize: 15 }}>Memo</span>}>
                <Input.TextArea rows={3} placeholder="Additional notes" style={{ fontSize: 16 }} />
              </Form.Item>

              <Button type="primary" htmlType="submit" block loading={submitting}
                style={{ height: 52, fontSize: 18, fontWeight: 600 }}>
                Save Payment
              </Button>
            </Form>
          </Card>
        )}

        {/* Payment History */}
        <Card title={<span style={{ fontSize: 17 }}>Payment History ({payments.length})</span>}>
          {payments.length === 0 ? (
            <Empty description={<span style={{ fontSize: 15 }}>No payments recorded yet</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              dataSource={payments}
              renderItem={(p: ContractorPayment) => (
                <List.Item style={{ padding: '12px 0' }}>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space size={6}>
                        <Tag color={getCategoryColor(p.payment_category)} style={{ fontSize: 13, padding: '2px 8px', margin: 0 }}>
                          {getCategoryLabel(p.payment_category)}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          {PAYMENT_TYPE_LABELS[p.payment_type || ''] || p.payment_type}
                        </Text>
                      </Space>
                      <Text strong style={{ fontSize: 18 }}>{formatCurrency(p.amount)}</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        {p.check_number ? `Check #${p.check_number}` : ''}
                        {p.check_date ? ` · ${dayjs(p.check_date).format('MM/DD/YY')}` : ''}
                      </Text>
                      <Space size={6}>
                        {p.pa_fee_deducted && p.pa_fee_amount && (
                          <Text type="secondary" style={{ fontSize: 12 }}>PA fee: {formatCurrency(p.pa_fee_amount)}</Text>
                        )}
                        {p.check_photo_file_id && <FileImageOutlined style={{ color: '#52c41a', fontSize: 15 }} />}
                        {p.source === 'contractor_portal' && <Tag style={{ fontSize: 12, margin: 0 }} color="blue">Portal</Tag>}
                      </Space>
                    </div>
                    {p.notes && <div style={{ marginTop: 2 }}><Text type="secondary" style={{ fontSize: 13 }}>{p.notes}</Text></div>}
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>
      </div>
    );
  }

  return null;
};

export default ContractorPaymentPortal;
