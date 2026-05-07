/**
 * Material Order Page
 * Generates roofing/siding material order lists with PDF export.
 * Flow: Input measurements → Calculate → Review/Edit → Export PDF
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Table,
  Tabs,
  Space,
  Typography,
  Divider,
  Row,
  Col,
  message,
  Tooltip,
  Tag,
  DatePicker,
  Upload,
  Checkbox,
} from 'antd';
import {
  CalculatorOutlined,
  FilePdfOutlined,
  ShoppingCartOutlined,
  ReloadOutlined,
  HomeOutlined,
  AppstoreOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { materialOrderService } from '../services/materialOrderService';
import type {
  ScopeType,
  MaterialItem,
  MaterialOrderResponse,
  MaterialCategory,
  OutputType,
} from '../types/materialOrder';
import { CATEGORY_LABELS as CAT_LABELS } from '../types/materialOrder';

const { Title, Text } = Typography;
const { Option } = Select;

const BRAND_OPTIONS = ['CertainTeed', 'GAF', 'Owens Corning'];

const COMPLEXITY_OPTIONS = [
  { value: 'Simple', label: 'Simple (≤8% waste)' },
  { value: 'Normal', label: 'Normal (≤13% waste)' },
  { value: 'Complex', label: 'Complex (≤18% waste)' },
];

const MaterialOrderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [scopeType, setScopeType] = useState<ScopeType>('roofing');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<MaterialOrderResponse | null>(null);
  const [editedMaterials, setEditedMaterials] = useState<MaterialItem[]>([]);
  const [viewMode, setViewMode] = useState<'supply_order' | 'full_estimate'>('full_estimate');
  const [eagleViewParsed, setEagleViewParsed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedOrderId, setSavedOrderId] = useState<string | null>(id && id !== 'new' ? id : null);
  const [includeSnowGuards, setIncludeSnowGuards] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(true);

  // ── Load existing order ──
  useEffect(() => {
    if (id && id !== 'new') {
      materialOrderService.getById(id).then((order) => {
        setSavedOrderId(order.id);
        setScopeType(order.scope_type);
        form.setFieldsValue({
          property_address: order.property_address,
          report_number: order.report_number,
          brand: order.brand,
          product: order.product,
          color: order.color,
          waste_pct: order.waste_pct,
          delivery_date: undefined, // DatePicker needs moment/dayjs
        });

        // Populate measurement fields
        if (order.measurements) {
          form.setFieldsValue(order.measurements);
        }

        // Set result for rendering table
        if (order.items && order.items.length > 0) {
          setResult({
            scope_type: order.scope_type,
            property_address: order.property_address || '',
            report_number: order.report_number || '',
            delivery_date: order.delivery_date,
            brand: order.brand || '',
            product: order.product,
            color: order.color,
            measurements: order.measurements || {},
            materials: order.items,
            notes: order.notes || [],
          });
          setEditedMaterials(order.items);
        }
      }).catch(() => {
        message.error('Failed to load material order');
      });
    }
  }, [id, form]);

  // ── EagleView Upload ──
  const handleEagleViewUpload = useCallback(async (file: File) => {
    try {
      setUploading(true);
      const result = await materialOrderService.parseEagleView(file);

      // Auto-fill job info + roofing measurement fields
      form.setFieldsValue({
        property_address: result.property_address || form.getFieldValue('property_address'),
        report_number: result.report_number || form.getFieldValue('report_number'),
        total_area_sf: result.total_area_sf,
        squares: result.squares,
        squares_with_waste: result.squares_with_waste,
        eaves_lf: result.eaves_lf,
        rakes_lf: result.rakes_lf,
        ridges_lf: result.ridges_lf,
        hips_lf: result.hips_lf,
        valleys_lf: result.valleys_lf,
        step_flashing_lf: result.step_flashing_lf,
        drip_edge_lf: result.drip_edge_lf,
        penetration_count: result.penetration_count,
        waste_pct: result.waste_pct,
        structure_complexity: result.structure_complexity,
      });

      setEagleViewParsed(true);
      const structInfo = result.structures && result.structures.length > 1
        ? ` (${result.structures.length} structures)`
        : '';
      message.success(
        `EagleView parsed: ${result.total_area_sf.toFixed(0)} SF, ` +
        `${result.squares.toFixed(1)} SQ${structInfo}`
      );
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to parse EagleView file');
      setEagleViewParsed(false);
    } finally {
      setUploading(false);
    }
  }, [form]);

  // ── Calculate ──
  const handleCalculate = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const payload: any = {
        scope_type: scopeType,
        property_address: values.property_address || '',
        report_number: values.report_number || '',
        delivery_date: values.delivery_date?.format('MM/DD/YYYY') || undefined,
        brand: values.brand || 'CertainTeed',
        product: values.product || undefined,
        color: values.color || undefined,
        waste_pct: values.waste_pct || (scopeType === 'roofing' ? 12 : 10),
      };

      if (scopeType === 'roofing') {
        const sq = values.squares || 0;
        const wastePct = values.waste_pct || 12;
        payload.roofing_measurements = {
          total_area_sf: values.total_area_sf || 0,
          squares: sq,
          squares_with_waste: values.squares_with_waste || sq * (1 + wastePct / 100),
          eaves_lf: values.eaves_lf || 0,
          rakes_lf: values.rakes_lf || 0,
          ridges_lf: values.ridges_lf || 0,
          hips_lf: values.hips_lf || 0,
          valleys_lf: values.valleys_lf || 0,
          step_flashing_lf: values.step_flashing_lf || 0,
          flashing_lf: values.flashing_lf || 0,
          drip_edge_lf: values.drip_edge_lf || 0,
          penetration_count: values.penetration_count || 0,
          waste_pct: wastePct,
          structure_complexity: values.structure_complexity || undefined,
          include_snow_guards: includeSnowGuards,
          roof_pitch: includeSnowGuards ? (values.roof_pitch || undefined) : undefined,
          rafter_length_lf: includeSnowGuards ? (values.rafter_length_lf || undefined) : undefined,
        };
      } else {
        payload.siding_measurements = {
          net_siding_sqft: values.net_siding_sqft || 0,
          masonry_sqft: values.masonry_sqft || 0,
          wd_perimeter_lf: values.wd_perimeter_lf || 0,
          wd_area_sqft: values.wd_area_sqft || 0,
          wd_count: values.wd_count || 0,
          fascia_lf: values.fascia_lf || 0,
          bottom_wall_lf: values.bottom_wall_lf || 0,
          top_wall_lf: values.top_wall_lf || 0,
          outside_corner_lf: values.outside_corner_lf || 0,
          inside_corner_lf: values.inside_corner_lf || 0,
          waste_pct: values.waste_pct || 10,
        };
      }

      const response = await materialOrderService.calculate(payload);
      setResult(response);
      // Store materials with ai_qty for reset tracking
      const withAiQty = response.materials.map((m) => ({
        ...m,
        ai_qty: m.qty,
      }));
      setEditedMaterials(withAiQty);
      message.success('Material quantities calculated successfully');
    } catch (err: any) {
      if (err?.errorFields) return; // form validation
      message.error(err?.response?.data?.detail || 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }, [form, scopeType]);

  // ── Edit material qty/price ──
  const updateMaterial = useCallback((index: number, field: keyof MaterialItem, value: any) => {
    setEditedMaterials((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const resetToAiQty = useCallback((index: number) => {
    setEditedMaterials((prev) => {
      const updated = [...prev];
      if (updated[index].ai_qty != null) {
        updated[index] = { ...updated[index], qty: updated[index].ai_qty! };
      }
      return updated;
    });
  }, []);

  // ── Add / Remove items ──
  const addItem = useCallback(() => {
    setEditedMaterials((prev) => [
      ...prev,
      {
        category: 'misc' as MaterialCategory,
        item: '',
        qty: 1,
        unit: 'EA',
        formula: 'Manual',
        note: '',
        unit_price: null,
        ai_qty: null, // null = manually added
      },
    ]);
  }, []);

  const removeItem = useCallback((index: number) => {
    setEditedMaterials((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Save to DB ──
  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const values = form.getFieldsValue();
      const payload = {
        scope_type: scopeType,
        property_address: values.property_address || '',
        report_number: values.report_number || '',
        delivery_date: values.delivery_date?.format?.('MM/DD/YYYY') || values.delivery_date || undefined,
        brand: values.brand || 'CertainTeed',
        product: values.product || undefined,
        color: values.color || undefined,
        waste_pct: values.waste_pct || 12,
        status: 'draft',
        measurements: result?.measurements || {},
        notes: result?.notes || [],
        items: editedMaterials.map((m) => ({
          category: m.category,
          item: m.item,
          qty: m.qty,
          unit: m.unit,
          formula: m.formula || undefined,
          note: m.note || undefined,
          unit_price: m.unit_price || undefined,
          ai_qty: m.ai_qty ?? undefined,
        })),
      };

      if (savedOrderId) {
        await materialOrderService.update(savedOrderId, payload);
        message.success('Material order updated');
      } else {
        const saved = await materialOrderService.save(payload);
        setSavedOrderId(saved.id);
        navigate(`/material-order/${saved.id}`, { replace: true });
        message.success('Material order saved');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [form, scopeType, result, editedMaterials, savedOrderId, navigate]);

  // ── Export PDF ──
  const handleExport = useCallback(async (outputType: OutputType) => {
    if (!result) return;
    try {
      setExporting(true);
      await materialOrderService.exportPdf({
        scope_type: result.scope_type,
        output_type: outputType,
        property_address: result.property_address,
        report_number: result.report_number,
        delivery_date: result.delivery_date,
        brand: result.brand,
        product: result.product,
        color: result.color,
        measurements: result.measurements,
        materials: editedMaterials,
        notes: result.notes,
        include_notes: includeNotes,
      });
      message.success(
        outputType === 'supply_order'
          ? 'Supply Order PDF downloaded'
          : 'Internal Estimate PDF downloaded'
      );
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [result, editedMaterials, includeNotes]);

  // ── Grand total ──
  const grandTotal = useMemo(() => {
    return editedMaterials.reduce((sum, m) => {
      return sum + (m.qty * (m.unit_price || 0));
    }, 0);
  }, [editedMaterials]);

  // ── Table columns ──
  const getColumns = useCallback(() => {
    const baseColumns: any[] = [
      {
        title: '#',
        width: 45,
        render: (_: any, __: any, idx: number) => idx + 1,
        align: 'center' as const,
      },
      {
        title: 'Category',
        dataIndex: 'category',
        width: 120,
        render: (cat: MaterialCategory, _: MaterialItem, idx: number) => (
          <Select
            size="small"
            value={cat}
            onChange={(val) => updateMaterial(idx, 'category', val)}
            style={{ width: '100%' }}
          >
            {(Object.keys(CAT_LABELS) as MaterialCategory[]).map((k) => (
              <Option key={k} value={k}>{CAT_LABELS[k]}</Option>
            ))}
          </Select>
        ),
      },
      {
        title: 'Description',
        dataIndex: 'item',
        render: (text: string, _: MaterialItem, idx: number) => (
          <Input
            size="small"
            value={text}
            placeholder="Item description"
            onChange={(e) => updateMaterial(idx, 'item', e.target.value)}
          />
        ),
      },
      {
        title: 'Qty',
        dataIndex: 'qty',
        width: 90,
        render: (qty: number, _: MaterialItem, idx: number) => {
          const isEdited = editedMaterials[idx]?.ai_qty != null && qty !== editedMaterials[idx]?.ai_qty;
          return (
            <InputNumber
              size="small"
              min={0}
              value={qty}
              onChange={(val) => updateMaterial(idx, 'qty', val || 0)}
              style={{
                width: '100%',
                backgroundColor: isEdited ? '#fff7e6' : undefined,
              }}
            />
          );
        },
      },
      {
        title: 'U/M',
        dataIndex: 'unit',
        width: 70,
        align: 'center' as const,
        render: (unit: string, _: MaterialItem, idx: number) => (
          <Select
            size="small"
            value={unit}
            onChange={(val) => updateMaterial(idx, 'unit', val)}
            style={{ width: '100%' }}
          >
            {['BD', 'RL', 'PC', 'BX', 'EA', 'TB', 'CTN', 'SQ', 'LF', 'SF'].map((u) => (
              <Option key={u} value={u}>{u}</Option>
            ))}
          </Select>
        ),
      },
      {
        title: 'Formula',
        dataIndex: 'formula',
        width: 180,
        ellipsis: true,
        render: (f: string) => <Text type="secondary" style={{ fontSize: 12 }}>{f}</Text>,
      },
    ];

    if (viewMode === 'full_estimate') {
      baseColumns.push(
        {
          title: 'Unit $',
          dataIndex: 'unit_price',
          width: 100,
          render: (price: number | null, _: MaterialItem, idx: number) => (
            <InputNumber
              size="small"
              min={0}
              step={0.01}
              prefix="$"
              value={price || undefined}
              placeholder="-"
              onChange={(val) => updateMaterial(idx, 'unit_price', val || null)}
              style={{ width: '100%' }}
            />
          ),
        },
        {
          title: 'Subtotal',
          width: 100,
          align: 'right' as const,
          render: (_: any, record: MaterialItem) => {
            const sub = record.qty * (record.unit_price || 0);
            return sub > 0 ? (
              <Text strong>${sub.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
            ) : (
              <Text type="secondary">-</Text>
            );
          },
        },
      );
    }

    baseColumns.push({
      title: 'Note',
      dataIndex: 'note',
      width: 140,
      ellipsis: true,
      render: (n: string) => <Text type="secondary" style={{ fontSize: 12 }}>{n}</Text>,
    });

    baseColumns.push({
      title: '',
      width: 65,
      render: (_: any, record: MaterialItem, idx: number) => {
        const isEdited = record.ai_qty != null && record.qty !== record.ai_qty;
        return (
          <Space size={0}>
            {isEdited && (
              <Tooltip title="Reset to calculated value">
                <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => resetToAiQty(idx)} />
              </Tooltip>
            )}
            <Tooltip title="Remove item">
              <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => removeItem(idx)} />
            </Tooltip>
          </Space>
        );
      },
    });

    return baseColumns;
  }, [viewMode, editedMaterials, updateMaterial, resetToAiQty, removeItem]);

  // ── Roofing measurement fields ──
  const renderRoofingFields = () => (
    <Row gutter={[16, 8]}>
      <Col span={6}><Form.Item label="Total Area (SF)" name="total_area_sf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Squares" name="squares"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Squares w/ Waste" name="squares_with_waste"><InputNumber min={0} step={0.1} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Waste %" name="waste_pct" initialValue={12}><InputNumber min={0} max={50} style={{ width: '100%' }} /></Form.Item></Col>

      <Col span={6}><Form.Item label="Eaves (LF)" name="eaves_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Rakes (LF)" name="rakes_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Ridges (LF)" name="ridges_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Hips (LF)" name="hips_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>

      <Col span={6}><Form.Item label="Valleys (LF)" name="valleys_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Step Flashing (LF)" name="step_flashing_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Flashing (LF)" name="flashing_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Drip Edge (LF)" name="drip_edge_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Penetrations" name="penetration_count"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>

      <Col span={6}>
        <Form.Item label="Complexity" name="structure_complexity">
          <Select allowClear placeholder="Select">
            {COMPLEXITY_OPTIONS.map((o) => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </Form.Item>
      </Col>

      <Col span={24}>
        <Divider orientation="left" style={{ margin: '4px 0 12px' }}>
          <Checkbox
            checked={includeSnowGuards}
            onChange={(e) => setIncludeSnowGuards(e.target.checked)}
          >
            <Text strong>Include Snow Guards</Text>
          </Checkbox>
        </Divider>
      </Col>

      {includeSnowGuards && (
        <>
          <Col span={6}>
            <Form.Item
              label="Roof Pitch (X/12)"
              name="roof_pitch"
              extra="e.g. 6 for 6/12"
            >
              <InputNumber min={1} max={24} step={1} style={{ width: '100%' }} placeholder="e.g. 6" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item
              label="Rafter Length (ft)"
              name="rafter_length_lf"
              extra="Horizontal run from eave to ridge"
            >
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} placeholder="e.g. 18" />
            </Form.Item>
          </Col>
        </>
      )}
    </Row>
  );

  // ── Siding measurement fields ──
  const renderSidingFields = () => (
    <Row gutter={[16, 8]}>
      <Col span={6}><Form.Item label="Net Siding Area (SF)" name="net_siding_sqft"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Masonry Area (SF)" name="masonry_sqft"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="W&D Perimeter (LF)" name="wd_perimeter_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="W&D Area (SF)" name="wd_area_sqft"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>

      <Col span={6}><Form.Item label="W&D Count" name="wd_count"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Fascia (LF)" name="fascia_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Bottom Wall (LF)" name="bottom_wall_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Top Wall (LF)" name="top_wall_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>

      <Col span={6}><Form.Item label="Outside Corner (LF)" name="outside_corner_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Inside Corner (LF)" name="inside_corner_lf"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
      <Col span={6}><Form.Item label="Waste %" name="waste_pct" initialValue={10}><InputNumber min={0} max={50} style={{ width: '100%' }} /></Form.Item></Col>
    </Row>
  );

  return (
    <div style={{ padding: '16px' }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        <ShoppingCartOutlined style={{ marginRight: 8 }} />
        Material Order
      </Title>

      {/* ── Step 1: Job Setup ── */}
      <Card
        title="Job Information & Measurements"
        style={{ marginBottom: 16 }}
        extra={
          <Tabs
            activeKey={scopeType}
            onChange={(key) => {
              setScopeType(key as ScopeType);
              setResult(null);
              setEditedMaterials([]);
              setEagleViewParsed(false);
              form.resetFields();
            }}
            items={[
              { key: 'roofing', label: <><HomeOutlined /> Roofing</> },
              { key: 'siding', label: <><AppstoreOutlined /> Siding</> },
            ]}
            size="small"
          />
        }
      >
        <Form form={form} layout="vertical" size="middle">
          {/* Job meta */}
          <Row gutter={[16, 8]}>
            <Col span={8}>
              <Form.Item label="Property Address" name="property_address">
                <Input placeholder="123 Main St, City, State" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="EagleView Report #" name="report_number">
                <Input placeholder="Report #" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="Delivery Date" name="delivery_date">
                <DatePicker style={{ width: '100%' }} format="MM/DD/YYYY" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="Brand" name="brand" initialValue="CertainTeed">
                <Select>
                  {BRAND_OPTIONS.map((b) => <Option key={b} value={b}>{b}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item label="Product" name="product">
                <Input placeholder="e.g. Landmark AR" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 8]}>
            <Col span={4}>
              <Form.Item label="Color" name="color">
                <Input placeholder="e.g. Weathered Wood" />
              </Form.Item>
            </Col>
          </Row>

          {/* EagleView Upload (Roofing only for now) */}
          {scopeType === 'roofing' && (
            <div style={{ margin: '8px 0 16px', padding: '12px 16px', background: '#f6f8fa', borderRadius: 6, border: '1px dashed #d0d5dd' }}>
              <Space align="center">
                <Upload
                  accept=".json,.JSON"
                  showUploadList={false}
                  beforeUpload={(file) => { handleEagleViewUpload(file); return false; }}
                >
                  <Button icon={<CloudUploadOutlined />} loading={uploading}>
                    Upload EagleView JSON
                  </Button>
                </Upload>
                {eagleViewParsed && (
                  <Text type="success">
                    <CheckCircleOutlined style={{ marginRight: 4 }} />
                    Measurements auto-filled from EagleView
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  EagleView Premium Report JSON export
                </Text>
              </Space>
            </div>
          )}

          <Divider orientation="left" style={{ margin: '8px 0 16px' }}>
            {scopeType === 'roofing' ? 'Roofing Measurements' : 'Siding Measurements'}
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {eagleViewParsed && scopeType === 'roofing'
                ? '(auto-filled from EagleView — editable)'
                : '(from EagleView Report Summary)'}
            </Text>
          </Divider>

          {scopeType === 'roofing' ? renderRoofingFields() : renderSidingFields()}

          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Button
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={handleCalculate}
              loading={loading}
              size="large"
            >
              Generate Material List
            </Button>
          </div>
        </Form>
      </Card>

      {/* ── Step 2: Results ── */}
      {result && (
        <Card
          title="Material Order List"
          style={{ marginBottom: 16 }}
          extra={
            <Space>
              <Tabs
                activeKey={viewMode}
                onChange={(key) => setViewMode(key as 'supply_order' | 'full_estimate')}
                items={[
                  { key: 'supply_order', label: 'Supply Order View' },
                  { key: 'full_estimate', label: 'Full Estimate View' },
                ]}
                size="small"
              />
              <Divider type="vertical" />
              <Checkbox
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
              >
                Include Notes
              </Checkbox>
              <Button
                icon={<ShoppingCartOutlined />}
                onClick={() => handleExport('supply_order')}
                loading={exporting}
              >
                Supply Order PDF
              </Button>
              <Button
                type="primary"
                icon={<FilePdfOutlined />}
                onClick={() => handleExport('internal_estimate')}
                loading={exporting}
              >
                Internal Estimate PDF
              </Button>
              <Divider type="vertical" />
              <Button
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                {savedOrderId ? 'Update' : 'Save'}
              </Button>
            </Space>
          }
        >
          <Table
            dataSource={editedMaterials}
            columns={getColumns()}
            pagination={false}
            size="small"
            rowKey={(_, idx) => String(idx)}
            bordered
            summary={() => {
              if (viewMode !== 'full_estimate') return null;
              return (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={7} align="right">
                    <Text strong style={{ fontSize: 14 }}>Total Material Cost:</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong style={{ fontSize: 14, color: '#1B3A5C' }}>
                      ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} colSpan={2} />
                </Table.Summary.Row>
              );
            }}
          />

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addItem}
            style={{ width: '100%', marginTop: 8 }}
          >
            Add Item
          </Button>

          {/* Notes */}
          {result.notes.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: '#fffbe6', borderRadius: 6 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Notes:</Text>
              {result.notes.map((note, i) => (
                <Text key={i} style={{ display: 'block', fontSize: 13 }}>• {note}</Text>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default MaterialOrderPage;
