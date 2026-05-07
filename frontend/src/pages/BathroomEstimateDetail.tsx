import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CalculatorOutlined,
  CopyOutlined,
  FilePdfOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  RobotOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { bathroomEstimateService } from '../services/bathroomEstimateService';
import { clientService } from '../services/clientService';
import type {
  BathroomEstimate,
  BathroomEstimateUpdate,
  BathroomEstimateLineItem,
  BathroomEstimateHistory,
  BathroomPricingInfo,
} from '../types/bathroomEstimate';
import { PHASE_LABELS } from '../types/bathroomEstimate';
import SketchCanvas from '../components/sketch/SketchCanvas';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;

const formatLabel = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';

const BathroomEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('project');

  // ── Queries ──
  const { data: estimate, isLoading } = useQuery({
    queryKey: ['bathroom-estimate', id],
    queryFn: () => bathroomEstimateService.getById(id!),
    enabled: !!id,
  });

  const { data: pricingInfo } = useQuery({
    queryKey: ['bathroom-pricing-info'],
    queryFn: () => bathroomEstimateService.getPricingInfo(),
  });

  const { data: history } = useQuery({
    queryKey: ['bathroom-estimate-history', id],
    queryFn: () => bathroomEstimateService.getHistory(id!),
    enabled: !!id && activeTab === 'history',
  });

  // ── Client search ──
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientResults } = useQuery({
    queryKey: ['clients-search', clientSearch],
    queryFn: () => clientService.list({ search: clientSearch, limit: 10 }),
    enabled: clientSearch.length >= 2,
  });

  // ── Mutations ──
  const saveMutation = useMutation({
    mutationFn: (payload: BathroomEstimateUpdate) =>
      bathroomEstimateService.update(id!, payload),
    onSuccess: () => {
      message.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
    },
    onError: () => message.error('Save failed'),
  });

  const calculateMutation = useMutation({
    mutationFn: (payload: BathroomEstimateUpdate) =>
      bathroomEstimateService.calculate(id!, payload),
    onSuccess: () => {
      message.success('Calculated successfully');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      setActiveTab('result');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || 'Calculation failed'),
  });

  const overviewMutation = useMutation({
    mutationFn: () => bathroomEstimateService.generateOverview(id!),
    onSuccess: (data) => {
      form.setFieldsValue({ overview_text: data.overview_text });
      message.success('Overview generated');
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
    },
    onError: () => message.error('Overview generation failed'),
  });

  const cloneMutation = useMutation({
    mutationFn: () => bathroomEstimateService.clone(id!),
    onSuccess: (result) => {
      message.success('Cloned');
      navigate(`/bathroom-estimates/${result.id}`);
    },
  });

  // ── Form sync ──
  useEffect(() => {
    if (estimate) {
      form.setFieldsValue(estimate);
    }
  }, [estimate, form]);

  const handleSave = useCallback(() => {
    const values = form.getFieldsValue(true);
    saveMutation.mutate(values);
  }, [form, saveMutation]);

  const handleCalculate = useCallback(() => {
    const values = form.getFieldsValue(true);
    calculateMutation.mutate(values);
  }, [form, calculateMutation]);

  const selectOpts = (items: string[] | undefined) =>
    (items || []).map(v => ({ label: formatLabel(v), value: v }));

  const numOpts = (items: number[] | undefined) =>
    (items || []).map(v => ({ label: `${v}`, value: v }));

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  // ── Line items table columns ──
  const lineItemColumns = [
    { title: 'Phase', dataIndex: 'phase', key: 'phase', width: 60,
      render: (p: number) => <Tag>{p}</Tag> },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Qty', dataIndex: 'quantity', key: 'qty', width: 70, align: 'right' as const,
      render: (v: number) => v?.toFixed(1) },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 50 },
    { title: 'Rate', dataIndex: 'unit_price', key: 'rate', width: 90, align: 'right' as const,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: 'Total', dataIndex: 'total', key: 'total', width: 100, align: 'right' as const,
      render: (v: number) => `$${v?.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
    { title: 'Category', dataIndex: 'category', key: 'cat', width: 80,
      render: (c: string) => <Tag>{c}</Tag> },
  ];

  // Group line items by phase for summary
  const lineItems = estimate?.line_items || [];
  const phaseSummary = Object.entries(PHASE_LABELS).map(([phase, label]) => {
    const items = lineItems.filter(li => li.phase === Number(phase));
    const total = items.reduce((s, li) => s + li.total, 0);
    return { phase: Number(phase), label, total, count: items.length };
  }).filter(p => p.count > 0);

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }} gutter={[8, 8]}>
        <Col xs={24} md="auto">
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/bathroom-estimates')} />
            <Title level={3} style={{ margin: 0 }}>
              Bathroom Estimate
              {estimate?.status && (
                <Tag color={
                  estimate.status === 'draft' ? 'default' :
                  estimate.status === 'calculated' ? 'processing' :
                  estimate.status === 'approved' ? 'success' : 'purple'
                } style={{ marginLeft: 8 }}>
                  {estimate.status.toUpperCase()}
                </Tag>
              )}
            </Title>
          </Space>
        </Col>
        <Col xs={24} md="auto">
          <Space wrap>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
              Save
            </Button>
            <Button type="primary" icon={<CalculatorOutlined />} onClick={handleCalculate}
              loading={calculateMutation.isPending}>
              Calculate
            </Button>
            <Button icon={<FilePdfOutlined />} onClick={() => bathroomEstimateService.exportPdf(id!)}
              disabled={estimate?.status === 'draft'}>
              PDF
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => cloneMutation.mutate()}>
              Clone
            </Button>
          </Space>
        </Col>
      </Row>

      <Form form={form} layout="vertical" size="small">
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          // ════════ TAB 1: Project Info ════════
          {
            key: 'project',
            label: 'Project Info',
            children: (
              <Card>
                <Divider orientation="left">Client / Claim</Divider>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Client" name="claim_id">
                      <Select
                        showSearch
                        filterOption={false}
                        onSearch={setClientSearch}
                        placeholder="Search client..."
                        allowClear
                        options={(clientResults?.clients || []).flatMap((c: any) =>
                          (c.claims || [{ id: null, claim_number: 'No claim' }]).map((cl: any) => ({
                            label: `${c.display_name} — ${cl.claim_number || 'N/A'}`,
                            value: cl.id,
                          }))
                        )}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Client Name">
                      <Input value={estimate?.client_name || ''} disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Claim #">
                      <Input value={estimate?.claim_number || ''} disabled />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider orientation="left">Property</Divider>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item label="Property Address" name="property_address">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="City" name="city"><Input /></Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="State" name="state">
                      <Select options={[
                        { label: 'MD', value: 'MD' },
                        { label: 'VA', value: 'VA' },
                        { label: 'DC', value: 'DC' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Zip Code" name="zip_code"><Input /></Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Building Type" name="building_type">
                      <Select options={selectOpts(pricingInfo?.building_types)} allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Year Built" name="year_built">
                      <InputNumber style={{ width: '100%' }} min={1800} max={2030} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Bathroom Type" name="designation">
                      <Select options={selectOpts(pricingInfo?.designations)} allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Function" name="bath_function">
                      <Select options={selectOpts(pricingInfo?.bath_functions)} allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider orientation="left">Dimensions</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Length (ft)" name="length_ft">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Width (ft)" name="width_ft">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Height (ft)" name="height_ft">
                      <InputNumber style={{ width: '100%' }} min={7} max={12} step={0.5} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Floor SF (override)" name="floor_sf">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Wall SF (override)" name="wall_sf">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ),
          },

          // ════════ TAB 2: Demo Scope ════════
          {
            key: 'demo',
            label: 'Demo Scope',
            children: (
              <Card>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Demo Scope" name="demo_scope">
                      <Select
                        options={selectOpts(pricingInfo?.demo_scopes)}
                        allowClear
                        onChange={(value) => {
                          const presets: Record<string, Record<string, boolean>> = {
                            full_gut: { demo_floor: true, demo_walls: true, demo_ceiling: true,
                              replace_shower: true, replace_tub: true, replace_vanity: true,
                              replace_toilet: true, replace_floor: true },
                            floor_only: { demo_floor: true, demo_walls: false, demo_ceiling: false,
                              replace_floor: true },
                            walls_only: { demo_floor: false, demo_walls: true, demo_ceiling: false },
                            tub_shower_only: { demo_floor: false, demo_walls: false, demo_ceiling: false,
                              replace_shower: true, replace_tub: true },
                            vanity_only: { demo_floor: false, demo_walls: false, demo_ceiling: false,
                              replace_vanity: true },
                            toilet_only: { demo_floor: false, demo_walls: false, demo_ceiling: false,
                              replace_toilet: true },
                          };
                          if (value && presets[value]) {
                            form.setFieldsValue(presets[value]);
                          }
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Existing Tub Material" name="existing_tub_material">
                      <Select options={selectOpts(pricingInfo?.bathtub_materials)} allowClear />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider orientation="left" plain>Demolition Areas</Divider>
                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev.demo_floor !== cur.demo_floor ||
                  prev.demo_walls !== cur.demo_walls ||
                  prev.demo_ceiling !== cur.demo_ceiling
                }>
                  {() => (
                    <>
                      <Row gutter={16} align="middle">
                        <Col xs={12} sm={8} md={4}>
                          <Form.Item name="demo_floor" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Floor</Checkbox>
                          </Form.Item>
                        </Col>
                        {form.getFieldValue('demo_floor') && (
                          <Col xs={12} sm={8} md={4}>
                            <Form.Item label="Floor SF" name="demo_floor_sf" style={{ marginBottom: 8 }}>
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                            </Form.Item>
                          </Col>
                        )}
                        <Col xs={12} sm={8} md={4}>
                          <Form.Item name="demo_walls" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Walls</Checkbox>
                          </Form.Item>
                        </Col>
                        {form.getFieldValue('demo_walls') && (
                          <Col xs={12} sm={8} md={4}>
                            <Form.Item label="Wall SF" name="demo_wall_sf" style={{ marginBottom: 8 }}>
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                            </Form.Item>
                          </Col>
                        )}
                        <Col xs={12} sm={8} md={4}>
                          <Form.Item name="demo_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Ceiling</Checkbox>
                          </Form.Item>
                        </Col>
                        {form.getFieldValue('demo_ceiling') && (
                          <Col xs={12} sm={8} md={4}>
                            <Form.Item label="Ceiling SF" name="demo_ceiling_sf" style={{ marginBottom: 8 }}>
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                            </Form.Item>
                          </Col>
                        )}
                      </Row>
                      {(form.getFieldValue('demo_floor') || form.getFieldValue('demo_walls') || form.getFieldValue('demo_ceiling')) && (
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                          Leave SF blank to use bathroom dimensions. Override only if demo area differs.
                        </Text>
                      )}
                    </>
                  )}
                </Form.Item>

                <Divider orientation="left" plain>Fixture Replacement</Divider>
                <Row gutter={[16, 8]}>
                  {[
                    ['replace_shower', 'Replace Shower'],
                    ['replace_tub', 'Replace Tub'],
                    ['replace_vanity', 'Replace Vanity'],
                    ['replace_toilet', 'Replace Toilet'],
                    ['replace_floor', 'Replace Floor'],
                  ].map(([name, label]) => (
                    <Col xs={12} sm={8} md={4} key={name}>
                      <Form.Item name={name} valuePropName="checked" style={{ marginBottom: 8 }}>
                        <Checkbox>{label}</Checkbox>
                      </Form.Item>
                    </Col>
                  ))}
                </Row>

                <Divider orientation="left" plain>Conditions</Divider>
                <Row gutter={[16, 8]}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item name="water_damage" valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>Water Damage</Checkbox>
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item name="mold_suspected" valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>Mold Suspected</Checkbox>
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ),
          },

          // ════════ TAB 3: Sketch ════════
          {
            key: 'sketch',
            label: (
              <span>
                <EditOutlined style={{ marginRight: 4 }} />
                Sketch
              </span>
            ),
            children: (
              <Card
                title="Bathroom Floor Plan & Tile Estimation"
                extra={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Draw walls, place fixtures (tub, shower, vanity, toilet), then use the Tile tool to estimate tile quantities
                  </Text>
                }
              >
                <SketchCanvas
                  instanceId={`bathroom-estimate-${id}`}
                  documentType="estimate"
                  documentId={id}
                  height="700px"
                  showSidebar={true}
                  showToolbar={true}
                  showStatusBar={true}
                />
              </Card>
            ),
          },

          // ════════ TAB 4: Shower & Tub ════════
          {
            key: 'shower_tub',
            label: 'Shower & Tub',
            children: (
              <Card>
                <Collapse defaultActiveKey={['shower', 'bathtub']}>
                  <Panel header="Shower" key="shower">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Type" name={['shower_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.shower_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Enclosure" name={['shower_spec', 'enclosure']}>
                          <Select options={selectOpts(pricingInfo?.enclosure_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Showerhead" name={['shower_spec', 'showerhead_type']}>
                          <Select options={selectOpts(pricingInfo?.showerhead_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Trim Brand" name={['shower_spec', 'trim_brand']}>
                          <Select options={selectOpts(pricingInfo?.trim_brands)} allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Trim Grade" name={['shower_spec', 'trim_grade']}>
                          <Select options={selectOpts(pricingInfo?.trim_grades)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Niches" name={['shower_spec', 'niches']}>
                          <InputNumber style={{ width: '100%' }} min={0} max={3} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['shower_spec', 'bench']} valuePropName="checked">
                          <Checkbox>Bench</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['shower_spec', 'valve_replace']} valuePropName="checked">
                          <Checkbox>Replace Valve</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>Custom Tile (if applicable)</Divider>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Tile Material" name={['shower_spec', 'tile_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Pattern" name={['shower_spec', 'tile_spec', 'pattern']}>
                          <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile SF" name={['shower_spec', 'tile_spec', 'sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Size" name={['shower_spec', 'tile_spec', 'size']}>
                          <Input placeholder="12x24" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Bathtub" key="bathtub">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Type" name={['bathtub_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.bathtub_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Material" name={['bathtub_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.bathtub_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Drain" name={['bathtub_spec', 'drain_location']}>
                          <Select options={[
                            { label: 'Left', value: 'left' },
                            { label: 'Right', value: 'right' },
                            { label: 'Center', value: 'center' },
                          ]} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['bathtub_spec', 'jetted']} valuePropName="checked">
                          <Checkbox>Jetted/Whirlpool</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 4: Vanity & Toilet ════════
          {
            key: 'vanity_toilet',
            label: 'Vanity & Toilet',
            children: (
              <Card>
                <Collapse defaultActiveKey={['vanity', 'toilet']}>
                  <Panel header="Vanity" key="vanity">
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Width" name={['vanity_spec', 'width']}>
                          <Select options={numOpts(pricingInfo?.vanity_widths)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Sinks" name={['vanity_spec', 'sinks']}>
                          <Select options={[{ label: '1', value: 1 }, { label: '2', value: 2 }]} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Source" name={['vanity_spec', 'source']}>
                          <Select options={selectOpts(pricingInfo?.vanity_sources)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Countertop" name={['vanity_spec', 'top_material']}>
                          <Select options={selectOpts(pricingInfo?.vanity_top_materials)} allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Mounting" name={['vanity_spec', 'mounting']}>
                          <Select options={selectOpts(pricingInfo?.vanity_mountings)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Faucet Type" name={['vanity_spec', 'faucet_type']}>
                          <Select options={selectOpts(pricingInfo?.faucet_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Mirror" name={['vanity_spec', 'mirror_type']}>
                          <Select options={selectOpts(pricingInfo?.mirror_types)} allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Toilet" key="toilet">
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={8}>
                        <Form.Item label="Type" name={['toilet_spec', 'type']}>
                          <Select options={selectOpts(pricingInfo?.toilet_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['toilet_spec', 'bidet_seat']} valuePropName="checked">
                          <Checkbox>Bidet Seat</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['toilet_spec', 'flange_repair']} valuePropName="checked">
                          <Checkbox>Flange Repair</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 5: Floor & Walls ════════
          {
            key: 'floor_walls',
            label: 'Floor & Walls',
            children: (
              <Card>
                <Collapse defaultActiveKey={['floor', 'walls', 'substrate']}>
                  <Panel header="Floor" key="floor">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Material" name={['floor_spec', 'material']}>
                          <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Pattern" name={['floor_spec', 'pattern']}>
                          <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Size" name={['floor_spec', 'size']}>
                          <Input placeholder="12x24" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['floor_spec', 'heated_floor']} valuePropName="checked">
                          <Checkbox>Heated Floor</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Walls & Paint" key="walls">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Paint Grade" name={['walls_spec', 'paint_grade']}>
                          <Select options={selectOpts(pricingInfo?.paint_grades)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Baseboard" name={['walls_spec', 'baseboard_material']}>
                          <Select options={selectOpts(pricingInfo?.baseboard_materials)} allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Substrate" key="substrate">
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label={<Space size={4}>Durock SF<Tooltip title="Cement backer board (sq ft). Used behind tile in wet areas like showers/tub surrounds. Moisture & mold resistant."><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'durock_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label={<Space size={4}>Greenboard SF<Tooltip title="Moisture-resistant drywall (sq ft). Used on bathroom walls/ceilings where water doesn't directly contact. Not for shower interiors."><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'greenboard_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label={<Space size={4}>Waterproofing<Tooltip title="Waterproof membrane/coating (e.g. RedGard, Hydroban, Kerdi) applied over Durock before tiling in wet areas."><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'waterproof_type']}>
                          <Select options={selectOpts(pricingInfo?.waterproof_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label={<Space size={4}>Waterproof SF<Tooltip title="Total area (sq ft) to be waterproofed. Typically shower walls/floor and tub surround where water directly contacts."><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'waterproof_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['substrate_spec', 'subfloor_repair']} valuePropName="checked">
                          <Checkbox>Subfloor Repair</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Repair SF" name={['substrate_spec', 'subfloor_repair_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 6: Plumbing & Electrical ════════
          {
            key: 'trades',
            label: 'Plumbing & Electrical',
            children: (
              <Card>
                <Collapse defaultActiveKey={['plumbing', 'electrical']}>
                  <Panel header="Plumbing" key="plumbing">
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Shutoff Valves" name={['plumbing_spec', 'valve_replace_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Supply Lines" name={['plumbing_spec', 'supply_line_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['plumbing_spec', 'drain_modification']} valuePropName="checked">
                          <Checkbox>Drain Mod</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['plumbing_spec', 'pressure_balance_valve']} valuePropName="checked">
                          <Checkbox>Pressure Balance</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['plumbing_spec', 'rough_inspection']} valuePropName="checked">
                          <Checkbox>Inspection</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Electrical" key="electrical">
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="GFCI Outlets" name={['electrical_spec', 'gfci_count']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Vanity Lights" name={['electrical_spec', 'vanity_lights']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['electrical_spec', 'ceiling_fixture']} valuePropName="checked">
                          <Checkbox>Ceiling Light</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Fan CFM" name={['electrical_spec', 'exhaust_fan_cfm']}>
                          <Select options={numOpts(pricingInfo?.exhaust_fan_cfms)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Fan Switch" name={['electrical_spec', 'exhaust_fan_switch']}>
                          <Select options={selectOpts(pricingInfo?.exhaust_fan_switch_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['electrical_spec', 'inspection']} valuePropName="checked">
                          <Checkbox>Inspection</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 7: Accessories & Hidden Costs ════════
          {
            key: 'accessories',
            label: 'Accessories',
            children: (
              <Card>
                <Collapse defaultActiveKey={['acc', 'hidden', 'overview']}>
                  <Panel header="Accessories" key="acc">
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Finish" name={['accessories_spec', 'finish']}>
                          <Select options={selectOpts(pricingInfo?.accessory_finishes)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Grade" name={['accessories_spec', 'grade']}>
                          <Select options={selectOpts(pricingInfo?.accessory_grades)} allowClear />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      {[
                        ['towel_bars', 'Towel Bars'],
                        ['hand_towel_rings', 'Hand Towel Rings'],
                        ['tp_holders', 'TP Holders'],
                        ['robe_hooks', 'Robe Hooks'],
                        ['grab_bars', 'Grab Bars'],
                        ['corner_shelves', 'Corner Shelves'],
                      ].map(([key, label]) => (
                        <Col xs={12} sm={8} md={4} key={key}>
                          <Form.Item label={label} name={['accessories_spec', key]}>
                            <InputNumber style={{ width: '100%' }} min={0} max={10} />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </Panel>
                  <Panel header="Hidden Costs" key="hidden">
                    <Row gutter={[16, 8]}>
                      {[
                        ['dumpster', 'Dumpster'],
                        ['floor_protection', 'Floor Protection'],
                        ['caulk', 'Caulking'],
                        ['final_clean', 'Final Clean'],
                        ['punch_list', 'Punch List'],
                        ['mobilization', 'Mobilization'],
                        ['drywall_patch', 'Drywall Patch'],
                        ['trim_paint', 'Trim Paint'],
                      ].map(([key, label]) => (
                        <Col xs={12} sm={12} md={6} key={key}>
                          <Form.Item name={['hidden_costs', key]} valuePropName="checked" style={{ marginBottom: 4 }}>
                            <Checkbox>{label}</Checkbox>
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Row gutter={16} style={{ marginTop: 8 }}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Patch SF" name={['hidden_costs', 'drywall_patch_sf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Trim Paint LF" name={['hidden_costs', 'trim_paint_lf']}>
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Overview & O&P" key="overview">
                    <Row gutter={16}>
                      <Col xs={24} md={16}>
                        <Form.Item label={
                          <Space>
                            Overview Note
                            <Tooltip title="Auto-generate overview based on estimate specs">
                              <Button size="small" icon={<RobotOutlined />}
                                onClick={() => overviewMutation.mutate()}
                                loading={overviewMutation.isPending}>
                                Generate
                              </Button>
                            </Tooltip>
                          </Space>
                        } name="overview_text">
                          <TextArea rows={6} placeholder="Project overview for client-facing PDF..." />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider orientation="left" plain>Overhead & Profit (Optional)</Divider>
                    <Row gutter={16}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item name="include_overhead_profit" valuePropName="checked">
                          <Checkbox>Include O&P</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Overhead %" name="overhead_pct">
                          <InputNumber style={{ width: '100%' }} min={0} max={0.5} step={0.01}
                            formatter={v => `${((v || 0) * 100).toFixed(0)}%`}
                            parser={v => parseFloat(v?.replace('%', '') || '0') / 100 as any} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Profit %" name="profit_pct">
                          <InputNumber style={{ width: '100%' }} min={0} max={0.5} step={0.01}
                            formatter={v => `${((v || 0) * 100).toFixed(0)}%`}
                            parser={v => parseFloat(v?.replace('%', '') || '0') / 100 as any} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={24} md={16}>
                        <Form.Item label="Notes" name="notes">
                          <TextArea rows={3} placeholder="Internal notes..." />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 8: Result ════════
          {
            key: 'result',
            label: `Result${estimate?.total ? ` ($${estimate.total.toLocaleString()})` : ''}`,
            children: (
              <Card>
                {lineItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Text type="secondary">No calculation yet. Click "Calculate" to generate line items.</Text>
                  </div>
                ) : (
                  <>
                    {/* Phase summary */}
                    <Card size="small" style={{ marginBottom: 16, background: '#f7fafc' }}>
                      <Title level={5}>Phase Summary</Title>
                      {phaseSummary.map(p => (
                        <Row key={p.phase} justify="space-between" style={{ padding: '4px 0' }}>
                          <Col><Text>{p.phase}. {p.label}</Text></Col>
                          <Col><Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                        </Row>
                      ))}
                      <Divider style={{ margin: '8px 0' }} />
                      <Row justify="space-between">
                        <Col><Text strong>Subtotal</Text></Col>
                        <Col><Text strong>${(estimate?.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                      </Row>
                      {estimate?.include_overhead_profit && (
                        <>
                          <Row justify="space-between">
                            <Col><Text>Overhead ({((estimate?.overhead_pct || 0) * 100).toFixed(0)}%)</Text></Col>
                            <Col><Text>${(estimate?.overhead_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                          </Row>
                          <Row justify="space-between">
                            <Col><Text>Profit ({((estimate?.profit_pct || 0) * 100).toFixed(0)}%)</Text></Col>
                            <Col><Text>${(estimate?.profit_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                          </Row>
                        </>
                      )}
                      <Row justify="space-between">
                        <Col><Text>Sales Tax (material)</Text></Col>
                        <Col><Text>${(estimate?.tax_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Col>
                      </Row>
                      <Divider style={{ margin: '8px 0' }} />
                      <Row justify="space-between">
                        <Col><Title level={4} style={{ margin: 0 }}>GRAND TOTAL</Title></Col>
                        <Col><Title level={4} style={{ margin: 0 }}>${(estimate?.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Title></Col>
                      </Row>
                    </Card>

                    {/* Methodology */}
                    {estimate?.methodology_notes && (
                      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                        {estimate.methodology_notes}
                      </Text>
                    )}

                    {/* Warnings */}
                    {(estimate?.warning_flags || []).length > 0 && (
                      <Card size="small" style={{ marginBottom: 16, borderColor: '#faad14' }}>
                        <Title level={5} style={{ color: '#faad14' }}>Warnings</Title>
                        {estimate!.warning_flags!.map((w, i) => (
                          <Text key={i} style={{ display: 'block' }}>⚠ {w}</Text>
                        ))}
                      </Card>
                    )}

                    {/* Detailed line items */}
                    <Table
                      columns={lineItemColumns}
                      dataSource={lineItems}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 700 }}
                    />
                  </>
                )}
              </Card>
            ),
          },

          // ════════ TAB 9: History ════════
          {
            key: 'history',
            label: 'History',
            children: (
              <Card>
                {(history || []).length === 0 ? (
                  <Text type="secondary">No history yet.</Text>
                ) : (
                  <Timeline
                    items={(history || []).map((h: BathroomEstimateHistory) => ({
                      children: (
                        <div>
                          <Text strong>v{h.version_number}</Text>
                          <Text type="secondary" style={{ marginLeft: 8 }}>
                            {h.change_description}
                          </Text>
                          <br />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                          </Text>
                        </div>
                      ),
                    }))}
                  />
                )}
              </Card>
            ),
          },
        ]} />
      </Form>
    </div>
  );
};

export default BathroomEstimateDetail;
