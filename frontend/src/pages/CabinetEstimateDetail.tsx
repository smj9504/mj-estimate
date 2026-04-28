import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CalculatorOutlined,
  CopyOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cabinetEstimateService } from '../services/cabinetEstimateService';
import { clientService, claimService } from '../services/clientService';
import CabinetBoxEditor from '../components/cabinet-estimate/CabinetBoxEditor';
import CabinetEstimateResult from '../components/cabinet-estimate/CabinetEstimateResult';
import CabinetPurchaseOrder from '../components/cabinet-estimate/CabinetPurchaseOrder';
import CabinetEstimateHistory from '../components/cabinet-estimate/CabinetEstimateHistory';
import type { CabinetBoxCreate, CabinetEstimate, CabinetEstimateUpdate } from '../types/cabinetEstimate';
import type { Claim } from '../types/client';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  draft: 'default',
  calculated: 'processing',
  approved: 'success',
  exported: 'purple',
};

const CabinetEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [boxes, setBoxes] = useState<CabinetBoxCreate[]>([]);
  const [activeTab, setActiveTab] = useState('edit');
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);

  // ── Fetch pricing options ──
  const { data: pricingInfo } = useQuery({
    queryKey: ['cabinet-pricing-info'],
    queryFn: () => cabinetEstimateService.getPricingInfo(),
    staleTime: 1000 * 60 * 30,
  });

  // ── Fetch estimate ──
  const { data: estimate, isLoading } = useQuery({
    queryKey: ['cabinet-estimate', id],
    queryFn: () => cabinetEstimateService.getById(id!),
    enabled: !!id,
  });

  // ── Search clients ──
  const { data: clientSearchResults, isFetching: isSearching } = useQuery({
    queryKey: ['client-search-cabinet', clientSearch],
    queryFn: () => clientService.search(clientSearch, 20),
    enabled: clientSearch.length >= 2,
    staleTime: 1000 * 60,
  });

  // ── Load claims when client is selected ──
  const loadClaimsForClient = useCallback(async (clientId: string) => {
    try {
      const result = await claimService.listByClient(clientId);
      setClaims(result.claims || []);
    } catch {
      setClaims([]);
    }
  }, []);

  // ── Auto-fill from client ──
  const handleClientSelect = useCallback(async (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clientSearchResults?.clients?.find((c) => c.id === clientId);
    if (client) {
      const addr = [client.address, client.city, client.state, client.zipcode]
        .filter(Boolean)
        .join(', ');
      form.setFieldsValue({
        property_address: form.getFieldValue('property_address') || addr,
        zip_code: form.getFieldValue('zip_code') || client.zipcode,
      });
    }
    await loadClaimsForClient(clientId);
  }, [clientSearchResults, form, loadClaimsForClient]);

  const handleClaimSelect = useCallback((claimId: string) => {
    form.setFieldsValue({ claim_id: claimId });
    const claim = claims.find((c) => c.id === claimId);
    if (claim) {
      // If address/zip still empty, try to fill from claim's insurance info
    }
  }, [claims, form]);

  // ── Populate form when estimate loads ──
  useEffect(() => {
    if (estimate) {
      // If estimate has a claim, load client's claims for the dropdown
      if (estimate.claim_id && estimate.client_name) {
        setClientSearch(estimate.client_name);
      }
      form.setFieldsValue({
        claim_id: estimate.claim_id,
        property_address: estimate.property_address,
        zip_code: estimate.zip_code,
        layout_type: estimate.layout_type,
        kitchen_size_sqft: estimate.kitchen_size_sqft,
        ceiling_height: estimate.ceiling_height,
        has_soffit: estimate.has_soffit,
        tier: estimate.tier,
        box_material: estimate.box_material,
        finish: estimate.finish,
        door_style: estimate.door_style,
        include_demo: estimate.include_demo,
        include_install: estimate.include_install,
        include_delivery: estimate.include_delivery,
        include_plumbing: estimate.include_plumbing,
        include_countertop_reset: estimate.include_countertop_reset,
        include_hardware: estimate.include_hardware,
        countertop_material: estimate.countertop_material,
        countertop_sqft: estimate.countertop_sqft,
        overhead_pct: (estimate.overhead_pct || 0.10) * 100,
        profit_pct: (estimate.profit_pct || 0.10) * 100,
        notes: estimate.notes,
      });
      setBoxes(
        estimate.boxes.map((b) => ({
          code: b.code,
          cab_type: b.cab_type,
          width_inches: b.width_inches,
          height_inches: b.height_inches,
          is_specialty: b.is_specialty,
          specialty_type: b.specialty_type || null,
          qty: b.qty,
          display_order: b.display_order,
        }))
      );
    }
  }, [estimate, form]);

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: (payload: CabinetEstimateUpdate) =>
      cabinetEstimateService.update(id!, payload),
    onSuccess: () => {
      message.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate', id] });
    },
    onError: () => message.error('Failed to save'),
  });

  const calculateMutation = useMutation({
    mutationFn: () => cabinetEstimateService.calculate(id!),
    onSuccess: () => {
      message.success('Calculation complete');
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate', id] });
      queryClient.invalidateQueries({ queryKey: ['cabinet-estimate-history', id] });
      setActiveTab('result');
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Calculation failed');
    },
  });

  const cloneMutation = useMutation({
    mutationFn: () => cabinetEstimateService.clone(id!),
    onSuccess: (result) => {
      message.success('Cloned');
      navigate(`/cabinet-estimates/${result.id}`);
    },
  });

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const payload: CabinetEstimateUpdate = {
        ...values,
        overhead_pct: (values.overhead_pct || 10) / 100,
        profit_pct: (values.profit_pct || 10) / 100,
        boxes,
      };
      saveMutation.mutate(payload);
    } catch {
      message.warning('Please fill required fields');
    }
  }, [form, boxes, saveMutation]);

  // ── Save & Calculate ──
  const handleCalculate = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const payload: CabinetEstimateUpdate = {
        ...values,
        overhead_pct: (values.overhead_pct || 10) / 100,
        profit_pct: (values.profit_pct || 10) / 100,
        boxes,
      };
      await cabinetEstimateService.update(id!, payload);
      calculateMutation.mutate();
    } catch {
      message.warning('Please fill required fields before calculating');
    }
  }, [form, boxes, id, calculateMutation]);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!estimate) {
    return <Alert type="error" message="Estimate not found" />;
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/cabinet-estimates')}>
              Back
            </Button>
            <Title level={4} style={{ margin: 0 }}>
              Cabinet Estimate
            </Title>
            <Tag color={STATUS_COLORS[estimate.status]}>{estimate.status.toUpperCase()}</Tag>
            {estimate.claim_number && <Tag>Claim: {estimate.claim_number}</Tag>}
            {estimate.client_name && <Text type="secondary">{estimate.client_name}</Text>}
          </Space>
        </Col>
        <Col>
          <Space>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
              Save
            </Button>
            <Button
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={handleCalculate}
              loading={calculateMutation.isPending}
            >
              Save & Calculate
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => cloneMutation.mutate()}>
              Clone
            </Button>
            <Button
              icon={<FilePdfOutlined />}
              onClick={() => cabinetEstimateService.exportPdf(id!)}
              disabled={estimate.status === 'draft'}
            >
              PDF
            </Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() => cabinetEstimateService.exportExcel(id!)}
              disabled={!estimate.boxes?.length}
            >
              Excel
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Tabs */}
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane tab="Edit" key="edit">
          <Form form={form} layout="vertical" size="middle">
            <Row gutter={24}>
              {/* Left column: Project Info + Kitchen + Scope */}
              <Col xs={24} lg={16}>
                {/* Client & Claim */}
                <Card size="small" title="Client & Claim (Optional)" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item label="Search Client">
                        <Select
                          showSearch
                          allowClear
                          placeholder="Type client name or address..."
                          filterOption={false}
                          loading={isSearching}
                          onSearch={(val) => setClientSearch(val)}
                          onSelect={(val: string) => handleClientSelect(val)}
                          onClear={() => {
                            setSelectedClientId(null);
                            setClaims([]);
                            form.setFieldsValue({ claim_id: null });
                          }}
                          value={selectedClientId}
                          notFoundContent={
                            clientSearch.length < 2
                              ? <Text type="secondary">Type 2+ characters to search</Text>
                              : isSearching
                                ? <Spin size="small" />
                                : <Text type="secondary">No clients found</Text>
                          }
                          options={clientSearchResults?.clients?.map((c) => ({
                            label: `${c.display_name}${c.address ? ` — ${c.address}` : ''}`,
                            value: c.id,
                          })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="claim_id" label="Claim (Optional)">
                        <Select
                          allowClear
                          placeholder={claims.length ? 'Select a claim...' : 'Select client first'}
                          disabled={!claims.length}
                          onSelect={(val: string) => handleClaimSelect(val)}
                          options={claims.map((c) => ({
                            label: `${c.claim_number}${c.insurance_company ? ` (${c.insurance_company})` : ''} — ${c.status}`,
                            value: c.id,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  {estimate.client_name && !selectedClientId && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Currently linked: {estimate.client_name}
                      {estimate.claim_number ? ` / Claim #${estimate.claim_number}` : ''}
                    </Text>
                  )}
                </Card>

                {/* Project Info */}
                <Card size="small" title="Project Information" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="property_address" label="Property Address">
                        <Input placeholder="123 Main St, Bethesda, MD 20815" />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="zip_code" label="Zip Code">
                        <Input placeholder="20815" maxLength={10} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="layout_type" label="Layout">
                        <Select
                          placeholder="Select"
                          allowClear
                          options={pricingInfo?.layout_types?.map((t) => ({ label: t, value: t })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="kitchen_size_sqft" label="Kitchen Size (sqft)">
                        <InputNumber style={{ width: '100%' }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="ceiling_height" label="Ceiling Height (ft)">
                        <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="has_soffit" valuePropName="checked">
                    <Checkbox>Has Soffit</Checkbox>
                  </Form.Item>
                </Card>

                {/* Specifications */}
                <Card size="small" title="Specifications" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name="tier"
                        label="Tier"
                        rules={[{ required: true, message: 'Required' }]}
                      >
                        <Select
                          placeholder="Select"
                          options={pricingInfo?.tiers?.map((t) => ({ label: t, value: t })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name="box_material"
                        label="Box Material"
                        rules={[{ required: true, message: 'Required' }]}
                      >
                        <Select
                          placeholder="Select"
                          options={pricingInfo?.materials?.map((m) => ({ label: m, value: m })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name="finish"
                        label="Finish"
                        rules={[{ required: true, message: 'Required' }]}
                      >
                        <Select
                          placeholder="Select"
                          options={pricingInfo?.finishes?.map((f) => ({ label: f, value: f })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="door_style" label="Door Style">
                        <Select
                          placeholder="Select"
                          options={pricingInfo?.door_styles?.map((d) => ({ label: d, value: d })) || []}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Cabinet Boxes */}
                <Card size="small" title="Cabinet Boxes" style={{ marginBottom: 16 }}>
                  <CabinetBoxEditor boxes={boxes} onChange={setBoxes} />
                </Card>

                {/* Scope of Work */}
                <Card size="small" title="Scope of Work" style={{ marginBottom: 16 }}>
                  <Row gutter={[16, 8]}>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_demo" valuePropName="checked">
                        <Checkbox>Demolition & Removal</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_install" valuePropName="checked">
                        <Checkbox>Installation</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_delivery" valuePropName="checked">
                        <Checkbox>Delivery</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_plumbing" valuePropName="checked">
                        <Checkbox>Plumbing (Disconnect + Reconnect)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_countertop_reset" valuePropName="checked">
                        <Checkbox>Countertop Reset</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_hardware" valuePropName="checked">
                        <Checkbox>Cabinet Hardware (Knobs/Pulls)</Checkbox>
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              </Col>

              {/* Right column: O&P + Notes */}
              <Col xs={24} lg={8}>
                <Card size="small" title="Overhead & Profit" style={{ marginBottom: 16 }}>
                  <Form.Item name="overhead_pct" label="Overhead (%)">
                    <InputNumber min={0} max={50} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                  <Form.Item name="profit_pct" label="Profit (%)">
                    <InputNumber min={0} max={50} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                </Card>

                <Card size="small" title="Notes" style={{ marginBottom: 16 }}>
                  <Form.Item name="notes">
                    <Input.TextArea rows={4} placeholder="Additional notes..." />
                  </Form.Item>
                </Card>

                {estimate.total > 0 && (
                  <Card
                    size="small"
                    style={{ marginBottom: 16, background: '#f0f5ff', borderColor: '#adc6ff' }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary">Current Total</Text>
                      <Title level={3} style={{ margin: '4px 0 0' }}>
                        ${estimate.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </Title>
                    </div>
                  </Card>
                )}

                <CabinetEstimateHistory estimateId={id!} />
              </Col>
            </Row>
          </Form>
        </Tabs.TabPane>

        <Tabs.TabPane tab="Estimate Result" key="result" disabled={estimate.status === 'draft'}>
          <CabinetEstimateResult estimate={estimate} />
        </Tabs.TabPane>

        <Tabs.TabPane tab="Purchase Order" key="purchase-order" disabled={!estimate.boxes?.length}>
          <CabinetPurchaseOrder estimateId={id!} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default CabinetEstimateDetail;
