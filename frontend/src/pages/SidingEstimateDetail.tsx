import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Space, Tabs, Form, Input, InputNumber, Select, Switch,
  Table, Tag, message, Spin, Row, Col, Typography, Statistic, Popconfirm,
  Divider, Modal, Descriptions,
} from 'antd';
import {
  SaveOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined,
  ArrowLeftOutlined, EditOutlined, CalculatorOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import EagleViewUpload from '../components/siding-estimate/EagleViewUpload';
import { sidingEstimateService } from '../services/sidingEstimateService';
import type {
  SidingEstimate, SidingEstimateLineItem, EagleViewParseResponse,
} from '../types/sidingEstimate';
import { SIDING_PHASE_LABELS, SIDING_TYPES, SIDING_PROFILES } from '../types/sidingEstimate';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

const SidingEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [estimate, setEstimate] = useState<SidingEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [evData, setEvData] = useState<EagleViewParseResponse | null>(null);
  const [activeTab, setActiveTab] = useState('1');

  const [form] = Form.useForm();

  // Load existing estimate
  useEffect(() => {
    if (!isNew && id) {
      setLoading(true);
      sidingEstimateService.getById(id)
        .then(data => {
          setEstimate(data);
          form.setFieldsValue({
            property_address: data.property_address,
            city: data.city,
            state: data.state,
            zip_code: data.zip_code,
            building_type: data.building_type,
            year_built: data.year_built,
            stories: data.stories,
            siding_type: data.siding_spec?.type || 'vinyl',
            siding_profile: data.siding_spec?.profile || 'lap',
            house_wrap: data.weather_barrier_spec?.house_wrap ?? true,
            replace_fascia: data.soffit_fascia_spec?.replace_fascia ?? true,
            replace_soffit: data.soffit_fascia_spec?.replace_soffit ?? false,
            remove_siding: data.demo_spec?.remove_siding ?? true,
            dumpster: data.hidden_costs?.dumpster ?? true,
            scaffolding: data.hidden_costs?.scaffolding ?? false,
            gutter_detach_reset: data.hidden_costs?.gutter_detach_reset ?? false,
            overhead_pct: data.overhead_pct ?? 10,
            profit_pct: data.profit_pct ?? 10,
          });
        })
        .catch(() => message.error('Failed to load estimate'))
        .finally(() => setLoading(false));
    }
  }, [id, isNew, form]);

  // Handle EagleView parse result
  const handleEvParsed = useCallback((data: EagleViewParseResponse) => {
    setEvData(data);
    form.setFieldsValue({
      property_address: data.address,
      city: data.city,
      state: data.state,
      zip_code: data.zip_code,
    });
  }, [form]);

  // Save estimate
  const handleSave = async () => {
    const values = form.getFieldsValue();
    setSaving(true);

    try {
      const payload: any = {
        property_address: values.property_address,
        city: values.city,
        state: values.state,
        zip_code: values.zip_code,
        building_type: values.building_type,
        year_built: values.year_built,
        stories: values.stories,
        // Specs
        siding_spec: { type: values.siding_type, profile: values.siding_profile },
        weather_barrier_spec: { house_wrap: values.house_wrap },
        soffit_fascia_spec: {
          replace_fascia: values.replace_fascia,
          replace_soffit: values.replace_soffit,
        },
        demo_spec: { remove_siding: values.remove_siding, remove_trim: true },
        hidden_costs: {
          dumpster: values.dumpster,
          scaffolding: values.scaffolding,
          final_cleanup: true,
          gutter_detach_reset: values.gutter_detach_reset,
        },
        overhead_pct: values.overhead_pct,
        profit_pct: values.profit_pct,
      };

      // If from EagleView, include measurements
      if (evData) {
        payload.eagleview_report_id = evData.report_id;
        payload.eagleview_claim_id = evData.claim_id;
        payload.eagleview_data = evData.raw_data;
        payload.total_wall_area = evData.total_wall_area;
        payload.total_wall_area_net = evData.total_wall_area_less_penetrations;
        payload.total_siding_area = evData.total_siding_area;
        payload.total_siding_area_net = evData.total_siding_area_less_penetrations;
        payload.total_masonry_area = evData.total_masonry_area;
        payload.total_masonry_area_net = evData.total_masonry_area_less_penetrations;
        payload.total_wall_facets = evData.total_wall_facets;
        payload.total_windows_doors = evData.total_windows_and_doors;
        payload.total_windows_doors_area = evData.total_windows_and_doors_area;
        payload.total_windows_doors_perimeter = evData.total_windows_and_doors_perimeter;
        payload.fascia_lf = evData.fascia_lf;
        payload.inside_corners_lf = evData.inside_corners_lf;
        payload.outside_corners_lf = evData.outside_corners_lf;
        payload.obtuse_inside_corners_lf = evData.obtuse_inside_corners_lf;
        payload.obtuse_outside_corners_lf = evData.obtuse_outside_corners_lf;
        payload.inside_siding_corners_lf = evData.inside_siding_corners_lf;
        payload.outside_siding_corners_lf = evData.outside_siding_corners_lf;
        payload.top_siding_walls_lf = evData.top_siding_walls_lf;
        payload.bottom_siding_walls_lf = evData.bottom_siding_walls_lf;
      }

      let result: SidingEstimate;
      if (isNew) {
        result = await sidingEstimateService.create(payload);
        message.success('Estimate created');
        navigate(`/siding-estimates/${result.id}`, { replace: true });
      } else {
        result = await sidingEstimateService.update(id!, payload);
        message.success('Estimate saved');
      }
      setEstimate(result);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Generate line items
  const handleGenerate = async () => {
    if (!estimate?.id) return;
    setGenerating(true);
    try {
      const result = await sidingEstimateService.generate(estimate.id);
      setEstimate(result);
      setActiveTab('3');
      message.success(`Generated ${result.line_items.length} line items`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  // Delete line item
  const handleDeleteItem = async (itemId: string) => {
    if (!estimate?.id) return;
    try {
      await sidingEstimateService.deleteLineItem(estimate.id, itemId);
      const refreshed = await sidingEstimateService.getById(estimate.id);
      setEstimate(refreshed);
    } catch {
      message.error('Failed to delete item');
    }
  };

  // Group line items by phase
  const groupedItems = (estimate?.line_items || []).reduce((acc, item) => {
    if (!acc[item.phase]) acc[item.phase] = [];
    acc[item.phase].push(item);
    return acc;
  }, {} as Record<number, SidingEstimateLineItem[]>);

  const lineItemColumns = [
    {
      title: '#',
      dataIndex: 'display_order',
      width: 40,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      width: 80,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      width: 50,
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      width: 100,
      align: 'right' as const,
      render: (v: number) => `$${v.toFixed(2)}`,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <strong>${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>,
    },
    {
      title: '',
      width: 40,
      render: (_: any, record: SidingEstimateLineItem) => (
        <Popconfirm title="Delete?" onConfirm={() => handleDeleteItem(record.id)}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px' }}>
      {/* Header */}
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/siding-estimates')}>
            Back
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            {isNew ? 'New Siding Estimate' : `Siding Estimate`}
          </Title>
          {estimate?.eagleview_report_id && (
            <Tag color="blue">EV #{estimate.eagleview_report_id}</Tag>
          )}
          {estimate?.status && (
            <Tag color={estimate.status === 'draft' ? 'default' : 'green'}>
              {estimate.status}
            </Tag>
          )}
        </Space>
        <Space>
          {estimate?.id && (
            <Button
              type="default"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerate}
              loading={generating}
            >
              Generate Items
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            Save
          </Button>
        </Space>
      </Space>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        {/* Tab 1: EagleView Upload */}
        <TabPane tab="1. EagleView Report" key="1">
          {isNew && !estimate ? (
            <EagleViewUpload onParsed={handleEvParsed} />
          ) : (
            <Card title="EagleView Measurements" size="small">
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Siding Area (net)" value={estimate?.total_siding_area_net || 0} suffix="SF" valueStyle={{ color: '#1890ff' }} />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Masonry Area" value={estimate?.total_masonry_area_net || 0} suffix="SF" />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Windows & Doors" value={estimate?.total_windows_doors || 0} />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="W&D Perimeter" value={estimate?.total_windows_doors_perimeter || 0} suffix="LF" />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Fascia" value={estimate?.fascia_lf || 0} suffix="LF" />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Outside Corners" value={estimate?.outside_corners_lf || 0} suffix="LF" />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Inside Corners" value={estimate?.inside_corners_lf || 0} suffix="LF" />
                </Col>
                <Col xs={12} sm={8} md={6}>
                  <Statistic title="Wall Facets" value={estimate?.total_wall_facets || 0} />
                </Col>
              </Row>
            </Card>
          )}
        </TabPane>

        {/* Tab 2: Project Info & Specs */}
        <TabPane tab="2. Specs & Options" key="2">
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Card title="Property Info" size="small">
                  <Form.Item name="property_address" label="Address">
                    <Input />
                  </Form.Item>
                  <Row gutter={8}>
                    <Col span={10}>
                      <Form.Item name="city" label="City"><Input /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item name="state" label="State"><Input maxLength={2} /></Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="zip_code" label="Zip"><Input /></Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={8}>
                    <Col span={8}>
                      <Form.Item name="building_type" label="Building">
                        <Select options={[
                          { value: 'sfh', label: 'Single Family' },
                          { value: 'townhouse', label: 'Townhouse' },
                          { value: 'condo', label: 'Condo' },
                        ]} allowClear />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="year_built" label="Year Built">
                        <InputNumber style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="stories" label="Stories">
                        <InputNumber min={1} max={4} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              </Col>

              <Col xs={24} md={12}>
                <Card title="Siding Spec" size="small">
                  <Form.Item name="siding_type" label="Siding Type">
                    <Select options={SIDING_TYPES} />
                  </Form.Item>
                  <Form.Item name="siding_profile" label="Profile">
                    <Select options={SIDING_PROFILES} />
                  </Form.Item>
                </Card>
              </Col>
            </Row>

            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col xs={24} md={8}>
                <Card title="Demo Options" size="small">
                  <Form.Item name="remove_siding" label="Remove existing siding" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dumpster" label="Dumpster" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card title="Additional Work" size="small">
                  <Form.Item name="house_wrap" label="House Wrap" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="replace_fascia" label="Replace Fascia" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="replace_soffit" label="Replace Soffit" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="gutter_detach_reset" label="D&R Gutters" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="scaffolding" label="Scaffolding" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card title="O&P" size="small">
                  <Form.Item name="overhead_pct" label="Overhead %">
                    <InputNumber min={0} max={30} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                  <Form.Item name="profit_pct" label="Profit %">
                    <InputNumber min={0} max={30} style={{ width: '100%' }} addonAfter="%" />
                  </Form.Item>
                </Card>
              </Col>
            </Row>
          </Form>
        </TabPane>

        {/* Tab 3: Line Items */}
        <TabPane tab={`3. Line Items (${estimate?.line_items?.length || 0})`} key="3">
          {Object.keys(groupedItems).length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: 40 }}>
                <CalculatorOutlined style={{ fontSize: 48, color: '#999', marginBottom: 16 }} />
                <Title level={4} type="secondary">No line items yet</Title>
                <Text type="secondary">
                  Save the estimate first, then click "Generate Items" to auto-create line items from measurements.
                </Text>
              </div>
            </Card>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {Object.entries(groupedItems)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([phase, items]) => (
                  <Card
                    key={phase}
                    title={
                      <Space>
                        <Tag color="blue">Phase {phase}</Tag>
                        {SIDING_PHASE_LABELS[Number(phase)] || `Phase ${phase}`}
                      </Space>
                    }
                    size="small"
                    extra={
                      <Text strong>
                        ${items.reduce((sum, i) => sum + (i.total || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </Text>
                    }
                  >
                    <Table
                      columns={lineItemColumns}
                      dataSource={items}
                      rowKey="id"
                      size="small"
                      pagination={false}
                    />
                  </Card>
                ))}

              {/* Totals */}
              <Card size="small">
                <Row justify="end">
                  <Col xs={24} sm={12} md={8}>
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="Subtotal">
                        <strong>${(estimate?.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                      </Descriptions.Item>
                      {(estimate?.overhead_amount || 0) > 0 && (
                        <Descriptions.Item label={`Overhead (${estimate?.overhead_pct || 0}%)`}>
                          ${(estimate?.overhead_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </Descriptions.Item>
                      )}
                      {(estimate?.profit_amount || 0) > 0 && (
                        <Descriptions.Item label={`Profit (${estimate?.profit_pct || 0}%)`}>
                          ${(estimate?.profit_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </Descriptions.Item>
                      )}
                      <Descriptions.Item label="Total">
                        <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
                          ${(estimate?.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </Title>
                      </Descriptions.Item>
                    </Descriptions>
                  </Col>
                </Row>
              </Card>
            </Space>
          )}
        </TabPane>
      </Tabs>
    </div>
  );
};

export default SidingEstimateDetail;
