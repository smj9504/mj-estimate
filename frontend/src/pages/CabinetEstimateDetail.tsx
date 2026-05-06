import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Dropdown,
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
import { companyService } from '../services/companyService';
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

// ── Appliance Selector (inline component) ──
interface ApplianceOption { type: string; label: string; cost: number }
interface ApplianceSelectorProps {
  value?: { type: string; qty: number }[];
  onChange?: (val: { type: string; qty: number }[]) => void;
  options: ApplianceOption[];
}
const ApplianceSelector: React.FC<ApplianceSelectorProps> = ({ value = [], onChange, options }) => {
  const toggle = (type: string, checked: boolean) => {
    if (checked) {
      onChange?.([...value, { type, qty: 1 }]);
    } else {
      onChange?.(value.filter((v) => v.type !== type));
    }
  };
  const setQty = (type: string, qty: number) => {
    onChange?.(value.map((v) => (v.type === type ? { ...v, qty } : v)));
  };
  return (
    <Row gutter={[8, 4]}>
      {options.map((opt) => {
        const item = value.find((v) => v.type === opt.type);
        const checked = !!item;
        return (
          <Col xs={12} md={8} key={opt.type}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Checkbox checked={checked} onChange={(e) => toggle(opt.type, e.target.checked)}>
                <span style={{ fontSize: 12 }}>{opt.label}</span>
              </Checkbox>
              {checked && (
                <InputNumber
                  size="small" min={1} max={5} value={item?.qty || 1}
                  onChange={(v) => setQty(opt.type, v || 1)}
                  style={{ width: 50, fontSize: 11 }}
                />
              )}
              <Text type="secondary" style={{ fontSize: 10 }}>${opt.cost}</Text>
            </div>
          </Col>
        );
      })}
    </Row>
  );
};

const CabinetEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [perimeterBoxes, setPerimeterBoxes] = useState<CabinetBoxCreate[]>([]);
  const [islandBoxes, setIslandBoxes] = useState<CabinetBoxCreate[]>([]);
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

  // ── Fetch companies ──
  const { data: companies } = useQuery({
    queryKey: ['companies-list'],
    queryFn: () => companyService.getCompanies(),
    staleTime: 1000 * 60 * 10,
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
        company_id: estimate.company_id,
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
        sink_type: estimate.sink_type || 'single',
        include_countertop_reset: estimate.include_countertop_reset,
        include_hardware: estimate.include_hardware,
        include_crown_molding: estimate.include_crown_molding,
        include_backsplash: estimate.include_backsplash,
        backsplash_type: estimate.backsplash_type,
        backsplash_sqft: estimate.backsplash_sqft,
        include_toe_kick: estimate.include_toe_kick ?? true,
        include_countertop: estimate.include_countertop,
        include_drywall_repair: estimate.include_drywall_repair,
        drywall_repair_sqft: estimate.drywall_repair_sqft,
        include_painting: estimate.include_painting,
        painting_sqft: estimate.painting_sqft,
        include_appliance_rr: estimate.include_appliance_rr,
        appliance_list: estimate.appliance_list || [],
        include_dumpster: estimate.include_dumpster ?? true,
        delivery_floor: estimate.delivery_floor || 1,
        island_end_panel_sqft: estimate.island_end_panel_sqft || 0,
        island_back_panel_sqft: estimate.island_back_panel_sqft || 0,
        countertop_material: estimate.countertop_material,
        countertop_sqft: estimate.countertop_sqft,
        island_countertop_material: estimate.island_countertop_material,
        island_countertop_sqft: estimate.island_countertop_sqft,
        overview_text: estimate.overview_text,
        overhead_pct: (estimate.overhead_pct ?? 0.10) * 100,
        profit_pct: (estimate.profit_pct ?? 0.10) * 100,
        notes: estimate.notes,
      });
      const allBoxes = estimate.boxes.map((b) => ({
        code: b.code,
        cab_type: b.cab_type,
        location: (b.location || 'perimeter') as 'perimeter' | 'island',
        width_inches: b.width_inches,
        height_inches: b.height_inches,
        is_specialty: b.is_specialty,
        specialty_type: b.specialty_type || null,
        has_glass_door: b.has_glass_door || false,
        qty: b.qty,
        display_order: b.display_order,
      }));
      setPerimeterBoxes(allBoxes.filter((b) => b.location !== 'island'));
      setIslandBoxes(allBoxes.filter((b) => b.location === 'island'));
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
    mutationFn: (payload?: CabinetEstimateUpdate) =>
      cabinetEstimateService.calculate(id!, payload),
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

  // Merge perimeter + island boxes for API
  const allBoxes = [...perimeterBoxes, ...islandBoxes].map((b, i) => ({
    ...b,
    display_order: i,
  }));

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const payload: CabinetEstimateUpdate = {
        ...values,
        overhead_pct: (values.overhead_pct ?? 0) / 100,
        profit_pct: (values.profit_pct ?? 0) / 100,
        boxes: allBoxes,
      };
      saveMutation.mutate(payload);
    } catch {
      message.warning('Please fill required fields');
    }
  }, [form, allBoxes, saveMutation]);

  // ── Save & Calculate (single API call) ──
  const handleCalculate = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const payload: CabinetEstimateUpdate = {
        ...values,
        overhead_pct: (values.overhead_pct ?? 0) / 100,
        profit_pct: (values.profit_pct ?? 0) / 100,
        boxes: allBoxes,
      };
      calculateMutation.mutate(payload);
    } catch {
      message.warning('Please fill required fields before calculating');
    }
  }, [form, allBoxes, calculateMutation]);

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
    <div style={{ padding: '12px 8px' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }} gutter={[8, 8]}>
        <Col xs={24} md="auto">
          <Space wrap size="small">
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
        <Col xs={24} md="auto">
          <Space wrap size="small">
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
            <Dropdown
              disabled={estimate.status === 'draft'}
              menu={{
                items: [
                  { key: 'with-sig', label: 'PDF (with signature)' },
                  { key: 'no-sig', label: 'PDF (without signature)' },
                ],
                onClick: ({ key }) => {
                  cabinetEstimateService.exportPdf(id!, {
                    show_signature: key === 'with-sig',
                  });
                },
              }}
            >
              <Button icon={<FilePdfOutlined />} disabled={estimate.status === 'draft'}>
                PDF
              </Button>
            </Dropdown>
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
                {/* Company & Client */}
                <Card size="small" title="Company & Client" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_id" label="Company (for PDF)">
                        <Select
                          showSearch
                          allowClear
                          placeholder="Select company..."
                          filterOption={(input, option) =>
                            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                          }
                          options={companies?.map((c) => ({
                            label: c.name,
                            value: c.id,
                          })) || []}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
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
                    <Col xs={24} md={8}>
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
                <Card size="small" title="Cabinet Tier" style={{ marginBottom: 16 }}>
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="tier"
                        label="Tier"
                        rules={[{ required: true, message: 'Required' }]}
                      >
                        <Select
                          placeholder="Select tier"
                          options={pricingInfo?.tiers?.map((t) => ({ label: t, value: t })) || []}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Perimeter Cabinets */}
                <Card size="small" title="Perimeter Cabinets" style={{ marginBottom: 16 }}>
                  <CabinetBoxEditor boxes={perimeterBoxes} onChange={setPerimeterBoxes} location="perimeter" />
                </Card>

                {/* Island Cabinets + Panels + Countertop */}
                <Card size="small" title="Island" style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Island Cabinets</Text>
                  <CabinetBoxEditor boxes={islandBoxes} onChange={setIslandBoxes} location="island" />

                  <div style={{ borderTop: '1px solid #f0f0f0', margin: '16px 0', paddingTop: 12 }}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Island Panels</Text>
                    <Row gutter={16}>
                      {/* End Panel */}
                      <Col xs={24} md={12}>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>End Panel (Side)</Text>
                        <Row gutter={8}>
                          <Col xs={10} sm={10}>
                            <Form.Item label="LF" style={{ marginBottom: 4 }}>
                              <InputNumber
                                min={0} max={30} step={0.5}
                                style={{ width: '100%' }}
                                placeholder="0"
                                value={(() => {
                                  const sf = form.getFieldValue('island_end_panel_sqft') || 0;
                                  return sf > 0 ? Math.round(sf / 2.875 * 10) / 10 : undefined;
                                })()}
                                onChange={(lf) => {
                                  form.setFieldsValue({
                                    island_end_panel_sqft: lf ? Math.round(lf * 2.875 * 10) / 10 : 0,
                                  });
                                }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item label="Height" style={{ marginBottom: 4 }}>
                              <Select
                                defaultValue="base"
                                size="middle"
                                onChange={(h) => {
                                  const sf = form.getFieldValue('island_end_panel_sqft') || 0;
                                  if (sf <= 0) return;
                                  const oldH = h === 'base' ? 7 : 2.875;
                                  const newH = h === 'base' ? 2.875 : 7;
                                  const lf = sf / oldH;
                                  form.setFieldsValue({
                                    island_end_panel_sqft: Math.round(lf * newH * 10) / 10,
                                  });
                                }}
                                options={[
                                  { label: 'Base (34.5")', value: 'base' },
                                  { label: 'Tall (84")', value: 'tall' },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item name="island_end_panel_sqft" label="SF" style={{ marginBottom: 4 }}>
                              <InputNumber min={0} max={200} step={0.5} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Col>
                      {/* Back Panel */}
                      <Col xs={24} md={12}>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Back Panel</Text>
                        <Row gutter={8}>
                          <Col xs={10} sm={10}>
                            <Form.Item label="LF" style={{ marginBottom: 4 }}>
                              <InputNumber
                                min={0} max={30} step={0.5}
                                style={{ width: '100%' }}
                                placeholder="0"
                                value={(() => {
                                  const sf = form.getFieldValue('island_back_panel_sqft') || 0;
                                  return sf > 0 ? Math.round(sf / 2.875 * 10) / 10 : undefined;
                                })()}
                                onChange={(lf) => {
                                  form.setFieldsValue({
                                    island_back_panel_sqft: lf ? Math.round(lf * 2.875 * 10) / 10 : 0,
                                  });
                                }}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item label="Height" style={{ marginBottom: 4 }}>
                              <Select
                                defaultValue="base"
                                size="middle"
                                onChange={(h) => {
                                  const sf = form.getFieldValue('island_back_panel_sqft') || 0;
                                  if (sf <= 0) return;
                                  const oldH = h === 'base' ? 7 : 2.875;
                                  const newH = h === 'base' ? 2.875 : 7;
                                  const lf = sf / oldH;
                                  form.setFieldsValue({
                                    island_back_panel_sqft: Math.round(lf * newH * 10) / 10,
                                  });
                                }}
                                options={[
                                  { label: 'Base (34.5")', value: 'base' },
                                  { label: 'Tall (84")', value: 'tall' },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={7} sm={7}>
                            <Form.Item name="island_back_panel_sqft" label="SF" style={{ marginBottom: 4 }}>
                              <InputNumber min={0} max={200} step={0.5} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </Col>
                    </Row>
                    {pricingInfo && form.getFieldValue('tier') && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          End: ${pricingInfo.island_panel_pricing?.end_panel_per_sf?.[form.getFieldValue('tier') as string] || '—'}/SF
                          {' | '}
                          Back: ${pricingInfo.island_panel_pricing?.back_panel_per_sf?.[form.getFieldValue('tier') as string] || '—'}/SF
                          {' + $'}
                          {pricingInfo.island_panel_pricing?.install_per_sf || '—'}/SF install
                        </Text>
                      </div>
                    )}
                  </div>

                  {/* Island Countertop */}
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop !== cur.include_countertop}>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_countertop')) return null;
                      const islandBaseLf = islandBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      const suggestedSf = Math.round(islandBaseLf * 2.125 * 10) / 10;
                      return (
                        <div style={{ borderTop: '1px solid #f0f0f0', margin: '16px 0', paddingTop: 12 }}>
                          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Island Countertop</Text>
                          <Row gutter={16}>
                            <Col xs={12}>
                              <Form.Item name="island_countertop_material" label="Material">
                                <Select
                                  placeholder="Same as perimeter"
                                  allowClear
                                  options={[
                                    { label: 'Laminate ($35/SF)', value: 'Laminate' },
                                    { label: 'Butcher Block ($70/SF)', value: 'Butcher Block' },
                                    { label: 'Solid Surface ($75/SF)', value: 'Solid Surface' },
                                    { label: 'Granite ($95/SF)', value: 'Granite' },
                                    { label: 'Quartz ($110/SF)', value: 'Quartz' },
                                    { label: 'Quartzite ($130/SF)', value: 'Quartzite' },
                                    { label: 'Marble ($160/SF)', value: 'Marble' },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12}>
                              <Form.Item name="island_countertop_sqft" label="Area (SF)">
                                <InputNumber min={0} max={500} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {suggestedSf > 0 && (
                                <Space size={4}>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    Island Base LF({islandBaseLf.toFixed(1)}) x 2.125ft =
                                  </Text>
                                  <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                    onClick={() => form.setFieldsValue({ island_countertop_sqft: suggestedSf })}
                                  >
                                    {suggestedSf} SF 적용
                                  </Button>
                                </Space>
                              )}
                            </Col>
                          </Row>
                        </div>
                      );
                    }}
                  </Form.Item>
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
                      <Form.Item name="include_delivery" valuePropName="checked" style={{ marginBottom: 4 }}>
                        <Checkbox>Delivery</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_delivery !== cur.include_delivery}>
                        {({ getFieldValue }) =>
                          getFieldValue('include_delivery') ? (
                            <Form.Item name="delivery_floor" label="Floor" style={{ marginBottom: 0, marginLeft: 24 }}>
                              <Select
                                size="small"
                                style={{ width: 120 }}
                                options={[
                                  { label: '1st Floor', value: 1 },
                                  { label: '2nd Floor', value: 2 },
                                  { label: '3rd Floor+', value: 3 },
                                ]}
                              />
                            </Form.Item>
                          ) : null
                        }
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_plumbing" valuePropName="checked" style={{ marginBottom: 4 }}>
                        <Checkbox>Plumbing + Sink/Faucet/Disposal</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_plumbing !== cur.include_plumbing}>
                        {({ getFieldValue }) =>
                          getFieldValue('include_plumbing') ? (
                            <Form.Item name="sink_type" label="Sink Type" style={{ marginBottom: 0, marginLeft: 24 }}>
                              <Select size="small" style={{ width: 180 }} options={[
                                { label: 'Single Bowl ($445)', value: 'single' },
                                { label: 'Double Bowl ($585)', value: 'double' },
                              ]} />
                            </Form.Item>
                          ) : null
                        }
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop !== cur.include_countertop}>
                        {({ getFieldValue }) => {
                          const hasNewCountertop = getFieldValue('include_countertop');
                          if (hasNewCountertop) {
                            form.setFieldsValue({ include_countertop_reset: false });
                          }
                          return (
                            <Form.Item name="include_countertop_reset" valuePropName="checked">
                              <Checkbox disabled={hasNewCountertop}>
                                Countertop Reset
                                {hasNewCountertop && (
                                  <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                                    (N/A — new countertop selected)
                                  </Text>
                                )}
                              </Checkbox>
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_hardware" valuePropName="checked">
                        <Checkbox>Cabinet Hardware (Knobs/Pulls)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_crown_molding" valuePropName="checked">
                        <Checkbox>Crown Molding (Wall Cabinets)</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_toe_kick" valuePropName="checked">
                        <Checkbox>Toe Kick</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_appliance_rr" valuePropName="checked">
                        <Checkbox>Appliance Detach & Reset</Checkbox>
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={8}>
                      <Form.Item name="include_dumpster" valuePropName="checked">
                        <Checkbox>Dumpster / Trash Disposal</Checkbox>
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* Appliance list (shown when Appliance R&R checked) */}
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_appliance_rr !== cur.include_appliance_rr}>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_appliance_rr')) return null;
                      const APPLIANCE_OPTIONS = [
                        { type: 'refrigerator', label: 'Refrigerator', cost: 150 },
                        { type: 'range_gas', label: 'Range (Gas)', cost: 175 },
                        { type: 'range_electric', label: 'Range (Electric)', cost: 125 },
                        { type: 'cooktop_gas', label: 'Cooktop (Gas)', cost: 150 },
                        { type: 'cooktop_electric', label: 'Cooktop (Electric)', cost: 125 },
                        { type: 'wall_oven', label: 'Wall Oven', cost: 150 },
                        { type: 'dishwasher', label: 'Dishwasher', cost: 100 },
                        { type: 'microwave_otr', label: 'Microwave (OTR)', cost: 85 },
                        { type: 'hood_vent', label: 'Hood / Vent', cost: 75 },
                      ];
                      return (
                        <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0 12px', paddingTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                            Select appliances to detach & reset:
                          </Text>
                          <Form.Item name="appliance_list" noStyle>
                            <ApplianceSelector options={APPLIANCE_OPTIONS} />
                          </Form.Item>
                        </div>
                      );
                    }}
                  </Form.Item>
                </Card>

                {/* Countertop (Perimeter) */}
                <Card size="small" title="Countertop" style={{ marginBottom: 16 }}>
                  <Form.Item name="include_countertop" valuePropName="checked">
                    <Checkbox>Include Countertop</Checkbox>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_countertop !== cur.include_countertop}>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_countertop')) return null;
                      const perimBaseLf = perimeterBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      const suggestedSf = Math.round(perimBaseLf * 2.125 * 10) / 10;
                      return (
                        <Row gutter={16}>
                          <Col xs={24}>
                            <Text type="secondary" style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                              Perimeter countertop (Island countertop은 Island 카드에서 입력)
                            </Text>
                          </Col>
                          <Col xs={12}>
                            <Form.Item name="countertop_material" label="Material">
                              <Select
                                placeholder="Select material"
                                options={[
                                  { label: 'Laminate ($35/SF)', value: 'Laminate' },
                                  { label: 'Butcher Block ($70/SF)', value: 'Butcher Block' },
                                  { label: 'Solid Surface ($75/SF)', value: 'Solid Surface' },
                                  { label: 'Granite ($95/SF)', value: 'Granite' },
                                  { label: 'Quartz ($110/SF)', value: 'Quartz' },
                                  { label: 'Quartzite ($130/SF)', value: 'Quartzite' },
                                  { label: 'Marble ($160/SF)', value: 'Marble' },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={12}>
                            <Form.Item name="countertop_sqft" label="Area (SF)">
                              <InputNumber min={0} max={500} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                            </Form.Item>
                            {suggestedSf > 0 && (
                              <Space size={4}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  Perimeter Base LF({perimBaseLf.toFixed(1)}) x 2.125ft =
                                </Text>
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ countertop_sqft: suggestedSf })}
                                >
                                  {suggestedSf} SF 적용
                                </Button>
                              </Space>
                            )}
                          </Col>
                        </Row>
                      );
                    }}
                  </Form.Item>
                </Card>

                {/* Drywall & Painting */}
                <Card size="small" title="Drywall & Painting" style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                    Cabinet 제거 후 벽면 수리 및 도장. 면적은 wall cabinet 뒤쪽 벽 기준.
                  </Text>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="include_drywall_repair" valuePropName="checked">
                        <Checkbox>R&R Sheetrock (behind cabinets)</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_drywall_repair !== cur.include_drywall_repair}>
                        {({ getFieldValue }) => {
                          if (!getFieldValue('include_drywall_repair')) return null;
                          // Wall area behind cabinets: (base LF + wall LF) * avg height ~4ft
                          const totalLf = allBoxes.reduce((sum, b) => {
                            if (b.cab_type === 'base' || b.cab_type === 'wall')
                              return sum + (b.width_inches * b.qty) / 12;
                            return sum;
                          }, 0);
                          const suggestedDwSf = Math.round(totalLf * 4 * 10) / 10;
                          return (
                            <div>
                              <Form.Item name="drywall_repair_sqft" label="Drywall Area (SF)">
                                <InputNumber min={0} max={1000} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {suggestedDwSf > 0 && (
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ drywall_repair_sqft: suggestedDwSf })}
                                >
                                  추천: {suggestedDwSf} SF 적용 (LF x 4ft)
                                </Button>
                              )}
                            </div>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="include_painting" valuePropName="checked">
                        <Checkbox>Prep, Prime & Paint</Checkbox>
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev.include_painting !== cur.include_painting ||
                        prev.drywall_repair_sqft !== cur.drywall_repair_sqft
                      }>
                        {({ getFieldValue }) => {
                          if (!getFieldValue('include_painting')) return null;
                          const dwSf = getFieldValue('drywall_repair_sqft');
                          return (
                            <div>
                              <Form.Item name="painting_sqft" label="Paint Area (SF)">
                                <InputNumber min={0} max={1000} step={0.5} style={{ width: '100%' }} addonAfter="SF" />
                              </Form.Item>
                              {dwSf > 0 && (
                                <Button
                                  type="link"
                                  size="small"
                                  style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                  onClick={() => form.setFieldsValue({ painting_sqft: dwSf })}
                                >
                                  Drywall과 동일: {dwSf} SF 적용
                                </Button>
                              )}
                            </div>
                          );
                        }}
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Backsplash */}
                <Card size="small" title="Backsplash" style={{ marginBottom: 16 }}>
                  <Form.Item name="include_backsplash" valuePropName="checked">
                    <Checkbox>Include Backsplash</Checkbox>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) =>
                    prev.include_backsplash !== cur.include_backsplash
                  }>
                    {({ getFieldValue }) => {
                      if (!getFieldValue('include_backsplash')) return null;
                      const baseLf = allBoxes
                        .filter((b) => b.cab_type === 'base')
                        .reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
                      const suggestedSf = Math.round(baseLf * 1.5 * 10) / 10; // 18" height
                      return (
                        <div>
                          <Row gutter={16}>
                            <Col xs={12}>
                              <Form.Item name="backsplash_type" label="Backsplash Type">
                                <Select
                                  placeholder="Select type"
                                  options={pricingInfo?.backsplash_types?.map((bt) => ({
                                    label: `${bt.label} ($${bt.material_per_sf + bt.install_per_sf}/SF)`,
                                    value: bt.key,
                                  }))}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={12}>
                              <Form.Item name="backsplash_sqft" label="Area (sqft)">
                                <InputNumber
                                  min={0}
                                  max={500}
                                  step={0.5}
                                  style={{ width: '100%' }}
                                  placeholder="e.g. 30"
                                  addonAfter="SF"
                                />
                              </Form.Item>
                              {suggestedSf > 0 && (
                                <Space size={4}>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    Base LF({baseLf.toFixed(1)}) x 1.5ft =
                                  </Text>
                                  <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0, fontSize: 11, height: 'auto' }}
                                    onClick={() => form.setFieldsValue({ backsplash_sqft: suggestedSf })}
                                  >
                                    {suggestedSf} SF 적용
                                  </Button>
                                </Space>
                              )}
                            </Col>
                          </Row>
                        </div>
                      );
                    }}
                  </Form.Item>
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

                <Card size="small" title="PDF Overview" style={{ marginBottom: 16 }}>
                  <Form.Item name="overview_text">
                    <Input.TextArea
                      rows={4}
                      placeholder="All cabinets will feature matching industrial-grade cabinet board surfaces..."
                    />
                  </Form.Item>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Leave blank to use default text. Shown at top of PDF.
                  </Text>
                </Card>

                <Card size="small" title="Notes" style={{ marginBottom: 16 }}>
                  <Form.Item name="notes">
                    <Input.TextArea rows={3} placeholder="Internal notes (not shown on PDF)..." />
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
