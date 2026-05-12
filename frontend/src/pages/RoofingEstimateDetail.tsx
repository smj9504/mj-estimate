import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Dropdown,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  AimOutlined,
  ArrowLeftOutlined,
  BankOutlined,
  CalculatorOutlined,
  CloudUploadOutlined,
  FilePdfOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import { roofingEstimateService } from '../services/roofingEstimateService';
import { companyService } from '../services/companyService';
import type {
  RoofingEstimate,
  RoofingEstimateUpdate,
  RoofingPricingInfo,
  EagleViewFace,
  EagleViewParseResult,
  WarrantyInfo,
} from '../types/roofingEstimate';
import { PHASE_LABELS, STATUS_COLORS } from '../types/roofingEstimate';
import type { Company } from '../types';
import RoofDiagram from '../components/roofing-estimate/RoofDiagram';

const { Title, Text } = Typography;
const { Panel } = Collapse;

const DEFAULT_MATERIAL_WARRANTY_TEXT =
  'All roofing materials installed under this contract are covered by the respective ' +
  "manufacturer's warranty. Shingle warranty coverage follows the manufacturer's published " +
  'terms, which typically include a Limited Lifetime Warranty for architectural shingles ' +
  'and a 25-year warranty for three-tab shingles. Coverage may be prorated after an initial ' +
  'non-prorated period. Warranty is transferable once to a subsequent owner within the first ' +
  '10 years of installation, subject to manufacturer requirements. The homeowner is responsible ' +
  'for registering the warranty with the manufacturer within the required timeframe to ensure ' +
  'full coverage. For complete warranty terms, refer to the manufacturer\'s warranty documentation ' +
  'provided at the time of installation.';

const DEFAULT_LABOR_WARRANTY_TEXT =
  'Our company provides a {years}-year workmanship warranty covering all labor performed under ' +
  'this contract, effective from the date of project completion. This warranty guarantees that ' +
  'all roofing work has been performed in accordance with manufacturer specifications and industry ' +
  'best practices. Should any defect in workmanship arise during the warranty period \u2014 including ' +
  'but not limited to leaks caused by improper installation, flashing failures, or inadequate ' +
  'sealing \u2014 we will repair or correct the deficiency at no additional cost to the homeowner.';

const DEFAULT_WARRANTY_EXCLUSIONS =
  'The following are excluded from all warranty coverage: damage caused by acts of God ' +
  '(hurricanes, tornadoes, hail, lightning, earthquakes); ice damming resulting from inadequate ' +
  'attic insulation or ventilation; damage caused by foot traffic, antenna/satellite dish ' +
  'installation, or other modifications performed by third parties after project completion; ' +
  'pre-existing structural damage not disclosed or discovered prior to installation; neglect ' +
  'or failure to perform routine maintenance (e.g., gutter cleaning, debris removal); damage ' +
  'resulting from improper repairs performed by unlicensed contractors; and normal wear and tear.';

const RoofingEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [eagleViewResult, setEagleViewResult] = useState<EagleViewParseResult | null>(null);
  const [selectedFaces, setSelectedFaces] = useState<string[]>([]);
  const [selectedStructures, setSelectedStructures] = useState<number[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const { data: estimate, isLoading } = useQuery({
    queryKey: ['roofing-estimate', id],
    queryFn: () => roofingEstimateService.getById(id!),
    enabled: !!id,
  });

  const { data: pricingInfo } = useQuery({
    queryKey: ['roofing-pricing-info'],
    queryFn: () => roofingEstimateService.getPricingInfo(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  const selectedCompany = useMemo(
    () => companies.find((c: Company) => c.id === form.getFieldValue('company_id')) || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, estimate?.company_id],
  );

  useEffect(() => {
    if (estimate) {
      form.setFieldsValue({
        ...estimate,
        shingle_type: estimate.shingle_spec?.type,
        shingle_brand: estimate.shingle_spec?.brand,
        shingle_product: estimate.shingle_spec?.product,
        shingle_color: estimate.shingle_spec?.color,
        decking_material: estimate.decking_spec?.material || 'osb_716',
        decking_free_sheets: estimate.decking_spec?.free_sheets_included ?? 2,
        decking_rate: estimate.decking_spec?.rate_per_sheet,
        decking_estimated: estimate.decking_spec?.estimated_sheets_needed ?? 0,
        underlayment_type: estimate.underlayment_spec?.type || 'synthetic',
        pipe_boot_type: estimate.flashing_spec?.pipe_boot_type || 'lifetime',
        gutter_included: estimate.gutter_spec?.included ?? false,
        gutter_style: estimate.gutter_spec?.style || 'k_style',
        gutter_size: estimate.gutter_spec?.size || 5,
        gutter_total_lf: estimate.gutter_spec?.total_lf,
        gutter_downspout_lf: estimate.gutter_spec?.downspout_lf,
        gutter_downspout_count: estimate.gutter_spec?.downspout_count,
        gutter_splash_blocks: estimate.gutter_spec?.splash_blocks,
        gutter_remove_existing: estimate.gutter_spec?.remove_existing,
        gutter_guards: estimate.gutter_spec?.gutter_guards,
        gutter_guard_type: estimate.gutter_spec?.guard_type,
        // Per-structure gutter fields
        ...(estimate.gutter_spec?.per_structure || []).reduce((acc: any, ps: any) => {
          const p = `gutter_struct_${ps.structure_index}`;
          acc[`${p}_included`] = ps.included;
          acc[`${p}_total_lf`] = ps.total_lf;
          acc[`${p}_ds_count`] = ps.downspout_count;
          acc[`${p}_ds_lf`] = ps.downspout_lf;
          acc[`${p}_splash`] = ps.splash_blocks;
          acc[`${p}_remove`] = ps.remove_existing;
          return acc;
        }, {}),
        hc_permit_option: estimate.hidden_costs?.permit_option ?? (estimate.hidden_costs?.permit === false ? 'none' : 'state'),
        hc_permit_custom_fee: estimate.hidden_costs?.permit_custom_fee,
        labor_warranty_years: estimate.warranty_info?.labor_warranty_years ?? 10,
        material_warranty_text: estimate.warranty_info?.material_warranty_text || DEFAULT_MATERIAL_WARRANTY_TEXT,
        labor_warranty_text: estimate.warranty_info?.labor_warranty_text || DEFAULT_LABOR_WARRANTY_TEXT,
        warranty_exclusions: estimate.warranty_info?.warranty_exclusions || DEFAULT_WARRANTY_EXCLUSIONS,
      });
      if (estimate.eagleview_data) {
        const evFaces = estimate.eagleview_data.faces || [];
        const evLines = estimate.eagleview_data.lines || [];
        const evStructures = estimate.eagleview_data.structures || [];
        setEagleViewResult({
          faces: evFaces,
          all_faces: evFaces,
          lines: evLines,
          structures: evStructures,
          total_sf: estimate.total_sf,
          squares: estimate.squares,
          predominant_pitch: estimate.predominant_pitch || undefined,
          ridge_lf: estimate.ridge_lf,
          hip_lf: estimate.hip_lf,
          valley_lf: estimate.valley_lf,
          eave_lf: estimate.eave_lf,
          rake_lf: estimate.rake_lf,
          step_flashing_lf: estimate.step_flashing_lf,
          penetration_count: estimate.penetration_count,
        });
        // Always set structure selection from saved data
        if (evStructures.length > 0) {
          setSelectedStructures(evStructures.map((s: any) => s.index));
        }
        // Restore face selection
        if (estimate.selected_faces?.length) {
          setSelectedFaces(estimate.selected_faces);
        } else if (evFaces.length > 0) {
          setSelectedFaces(evFaces.filter((f: any) => !f.is_accessory).map((f: any) => f.id));
        }
      }
    }
  }, [estimate, form]);

  const buildUpdatePayload = useCallback((): RoofingEstimateUpdate => {
    const values = form.getFieldsValue(true);
    return {
      property_address: values.property_address,
      city: values.city,
      state: values.state,
      zip_code: values.zip_code,
      building_type: values.building_type,
      year_built: values.year_built,
      stories: values.stories,
      hoa: values.hoa,
      roof_access: values.roof_access,
      measurement_source: values.measurement_source,
      total_sf: values.total_sf,
      squares: values.squares,
      predominant_pitch: values.predominant_pitch,
      pitch_multiplier: values.pitch_multiplier,
      ridge_lf: values.ridge_lf,
      hip_lf: values.hip_lf,
      valley_lf: values.valley_lf,
      eave_lf: values.eave_lf,
      rake_lf: values.rake_lf,
      step_flashing_lf: values.step_flashing_lf,
      penetration_count: values.penetration_count,
      skylight_count: values.skylight_count,
      chimney_count: values.chimney_count,
      waste_factor: values.waste_factor,
      roof_complexity: values.roof_complexity,
      full_tearoff: values.full_tearoff,
      layer_count: values.layer_count,
      overlay: values.overlay,
      existing_material: values.existing_material,
      insurance_job: values.insurance_job,
      shingle_spec: {
        type: values.shingle_type,
        brand: values.shingle_brand,
        product: values.shingle_product,
        color: values.shingle_color,
        rate_per_square: pricingInfo?.shingle_rates?.[values.shingle_type],
      },
      decking_spec: {
        material: values.decking_material,
        free_sheets_included: values.decking_free_sheets ?? 2,
        rate_per_sheet: values.decking_rate || pricingInfo?.decking_rates?.[values.decking_material],
        estimated_sheets_needed: values.decking_estimated ?? 0,
        re_nail_existing: values.re_nail_existing,
      },
      underlayment_spec: { type: values.underlayment_type },
      flashing_spec: {
        pipe_boot_type: values.pipe_boot_type,
        pipe_boots: values.penetration_count,
        chimney_flashing: values.chimney_count,
        skylight_flashing_kits: values.skylight_count,
      },
      ventilation_spec: {
        ridge_vent: values.ridge_vent ?? true,
        static_vents: values.static_vents ?? 0,
      },
      gutter_spec: values.gutter_included ? (() => {
        const base: any = {
          included: true,
          style: values.gutter_style,
          size: values.gutter_size,
          material: 'aluminum',
          downspout_size: '2x3',
          gutter_guards: values.gutter_guards,
          guard_type: values.gutter_guard_type,
        };
        // Multi-structure: per_structure gutter config
        const evStructures = eagleViewResult?.structures;
        if (evStructures && evStructures.length > 1) {
          base.per_structure = evStructures.map((s) => {
            const p = `gutter_struct_${s.index}`;
            return {
              structure_index: s.index,
              included: values[`${p}_included`] ?? (s.index === 0),
              total_lf: values[`${p}_total_lf`] || 0,
              downspout_count: values[`${p}_ds_count`] || 0,
              downspout_lf: values[`${p}_ds_lf`] || 0,
              splash_blocks: values[`${p}_splash`] || 0,
              remove_existing: values[`${p}_remove`] || false,
            };
          });
          // Aggregate totals for backward compat
          const included = base.per_structure.filter((ps: any) => ps.included);
          base.total_lf = included.reduce((s: number, ps: any) => s + (ps.total_lf || 0), 0);
          base.downspout_count = included.reduce((s: number, ps: any) => s + (ps.downspout_count || 0), 0);
          base.downspout_lf = included.reduce((s: number, ps: any) => s + (ps.downspout_lf || 0), 0);
          base.splash_blocks = included.reduce((s: number, ps: any) => s + (ps.splash_blocks || 0), 0);
          base.remove_existing = included.some((ps: any) => ps.remove_existing);
        } else {
          // Single structure
          base.total_lf = values.gutter_total_lf;
          base.downspout_lf = values.gutter_downspout_lf;
          base.downspout_count = values.gutter_downspout_count;
          base.splash_blocks = values.gutter_splash_blocks;
          base.remove_existing = values.gutter_remove_existing;
        }
        return base;
      })() : { included: false },
      hidden_costs: {
        dumpster: values.hc_dumpster ?? true,
        permit_option: values.hc_permit_option ?? 'state',
        permit_custom_fee: values.hc_permit_custom_fee ?? null,
        vent_cap_replace: values.hc_vent_cap ?? false,
        lead_rrp: values.hc_lead ?? true,
        satellite_removal: values.hc_satellite ?? false,
      },
      target_total: values.target_total || null,
      pricing_method: values.pricing_method,
      material_markup_pct: values.material_markup_pct,
      labor_markup_pct: values.labor_markup_pct,
      include_overhead_profit: values.include_overhead_profit,
      overhead_pct: values.overhead_pct,
      profit_pct: values.profit_pct,
      contingency_pct: values.contingency_pct,
      warranty_info: {
        labor_warranty_years: values.labor_warranty_years ?? 10,
        material_warranty_source: 'manufacturer',
        material_warranty_text: values.material_warranty_text || DEFAULT_MATERIAL_WARRANTY_TEXT,
        labor_warranty_text: values.labor_warranty_text || DEFAULT_LABOR_WARRANTY_TEXT,
        warranty_exclusions: values.warranty_exclusions || DEFAULT_WARRANTY_EXCLUSIONS,
      },
      notes: values.notes,
      claim_id: values.claim_id,
      company_id: values.company_id,
      // EagleView data (preserve for multi-structure calculation)
      ...(eagleViewResult ? {
        eagleview_data: {
          faces: eagleViewResult.all_faces,
          lines: eagleViewResult.lines,
          structures: eagleViewResult.structures,
        },
        selected_faces: selectedFaces.length > 0 ? selectedFaces : undefined,
      } : {}),
    };
  }, [form, pricingInfo, eagleViewResult, selectedFaces]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildUpdatePayload();
      await roofingEstimateService.update(id!, payload);
      queryClient.invalidateQueries({ queryKey: ['roofing-estimate', id] });
      message.success('Saved');
    } catch {
      message.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const payload = buildUpdatePayload();
      return roofingEstimateService.calculate(id!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roofing-estimate', id] });
      message.success('Calculation complete');
    },
    onError: () => message.error('Calculation failed'),
  });

  const handleEagleViewUpload = async (file: File) => {
    try {
      setUploadedFile(file);
      const result = await roofingEstimateService.parseEagleView(file);
      setEagleViewResult(result);

      // Auto-select all structures
      const allStructIndices = result.structures.map(s => s.index);
      setSelectedStructures(allStructIndices);

      // Apply to form
      form.setFieldsValue({
        measurement_source: 'eagleview',
        total_sf: result.total_sf,
        squares: result.squares,
        predominant_pitch: result.predominant_pitch,
        ridge_lf: result.ridge_lf,
        hip_lf: result.hip_lf,
        valley_lf: result.valley_lf,
        eave_lf: result.eave_lf,
        rake_lf: result.rake_lf,
        step_flashing_lf: result.step_flashing_lf,
        penetration_count: result.penetration_count,
      });
      const faceIds = result.faces.map(f => f.id);
      setSelectedFaces(faceIds);

      // Save to server immediately so data persists on reload
      if (id) {
        await roofingEstimateService.applyEagleView(
          id, file, faceIds, allStructIndices,
        );
        queryClient.invalidateQueries({ queryKey: ['roofing-estimate', id] });
      }

      const structInfo = result.structures.length > 1
        ? ` (${result.structures.length} structures)`
        : '';
      message.success(
        `EagleView parsed & saved: ${result.total_sf.toFixed(0)} SF, ` +
        `${result.faces.length} faces${structInfo}`
      );
    } catch {
      message.error('Failed to parse EagleView file');
    }
    return false;
  };

  const handleStructureToggle = async (structIdx: number, checked: boolean) => {
    const newSelected = checked
      ? [...selectedStructures, structIdx]
      : selectedStructures.filter(i => i !== structIdx);
    setSelectedStructures(newSelected);

    if (uploadedFile && newSelected.length > 0) {
      try {
        const result = await roofingEstimateService.parseEagleView(
          uploadedFile, newSelected,
        );
        setEagleViewResult(result);
        setSelectedFaces(result.faces.map(f => f.id));
        form.setFieldsValue({
          total_sf: result.total_sf,
          squares: result.squares,
          predominant_pitch: result.predominant_pitch,
          ridge_lf: result.ridge_lf,
          hip_lf: result.hip_lf,
          valley_lf: result.valley_lf,
          eave_lf: result.eave_lf,
          rake_lf: result.rake_lf,
          step_flashing_lf: result.step_flashing_lf,
          penetration_count: result.penetration_count,
        });
      } catch {
        message.error('Failed to re-parse with structure selection');
      }
    } else if (newSelected.length === 0) {
      form.setFieldsValue({ total_sf: 0, squares: 0 });
    }
  };

  const handleFaceToggle = (faceId: string, checked: boolean) => {
    const newSelected = checked
      ? [...selectedFaces, faceId]
      : selectedFaces.filter(id => id !== faceId);
    setSelectedFaces(newSelected);

    if (eagleViewResult) {
      const selectedFaceData = eagleViewResult.all_faces.filter(
        f => newSelected.includes(f.id) && !f.is_accessory
      );
      const totalSf = selectedFaceData.reduce((sum, f) => sum + f.area, 0);
      form.setFieldsValue({
        total_sf: Math.round(totalSf * 10) / 10,
        squares: Math.round(totalSf / 10) / 10,
      });
    }
  };

  const handleDiagramFaceToggle = (faceId: string) => {
    const isSelected = selectedFaces.includes(faceId);
    handleFaceToggle(faceId, !isSelected);
  };

  const lineItemColumns = [
    {
      title: 'Phase',
      dataIndex: 'phase',
      key: 'phase',
      width: 60,
      render: (p: number) => <Tag>{p}</Tag>,
    },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    {
      title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 80,
      align: 'right' as const,
      render: (v: number) => v?.toFixed(1),
    },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 50 },
    {
      title: 'Unit Price', dataIndex: 'unit_price', key: 'unit_price', width: 100,
      align: 'right' as const,
      render: (v: number) => `$${v?.toFixed(2)}`,
    },
    {
      title: 'Total', dataIndex: 'total', key: 'total', width: 110,
      align: 'right' as const,
      render: (v: number) => `$${v?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    },
    {
      title: 'Xactimate', dataIndex: 'xactimate_code', key: 'xact', width: 100,
      render: (v: string) => v ? <Tag color="blue">{v}</Tag> : null,
    },
  ];

  if (isLoading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!estimate) return <div style={{ padding: 24 }}>Estimate not found</div>;

  return (
    <div style={{ padding: '12px 8px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }} gutter={[8, 8]}>
        <Col xs={24} md="auto">
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/roofing-estimates')} />
            <Title level={3} style={{ margin: 0 }}>
              Roofing Estimate
            </Title>
            <Tag color={STATUS_COLORS[estimate.status] || 'default'}>
              {estimate.status?.toUpperCase()}
            </Tag>
          </Space>
        </Col>
        <Col xs={24} md="auto">
          <Space wrap>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              Save
            </Button>
            <Button
              type="primary"
              icon={<CalculatorOutlined />}
              onClick={() => calculateMutation.mutate()}
              loading={calculateMutation.isPending}
            >
              Calculate
            </Button>
            <Dropdown
              disabled={estimate.status === 'draft'}
              menu={{
                items: [
                  { key: 'detailed', label: 'PDF — Detailed (with pricing)' },
                  { key: 'lumpsum', label: 'PDF — Lump Sum (no pricing)' },
                  { type: 'divider' },
                  { key: 'detailed-nosig', label: 'Detailed (no signature)' },
                  { key: 'lumpsum-nosig', label: 'Lump Sum (no signature)' },
                ],
                onClick: ({ key }) => {
                  const isLumpsum = key.startsWith('lumpsum');
                  const showSig = !key.endsWith('-nosig');
                  roofingEstimateService.exportPdf(id!, {
                    pricing_mode: isLumpsum ? 'lumpsum' : 'detailed',
                    show_signature: showSig,
                  });
                },
              }}
            >
              <Button icon={<FilePdfOutlined />}>PDF</Button>
            </Dropdown>
          </Space>
        </Col>
      </Row>

      {/* Warnings */}
      {estimate.warning_flags?.map((w, i) => (
        <Alert key={i} message={w} type="warning" showIcon closable style={{ marginBottom: 8 }} />
      ))}

      {/* Totals Summary */}
      {estimate.status !== 'draft' && (
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={12} sm={8} md={3}><Statistic title="Subtotal" value={estimate.subtotal} prefix="$" precision={2} /></Col>
            <Col xs={12} sm={8} md={3}><Statistic title="Markup" value={estimate.markup_amount} prefix="$" precision={2} /></Col>
            <Col xs={12} sm={8} md={3}><Statistic title="Tax" value={estimate.tax_amount} prefix="$" precision={2} /></Col>
            <Col xs={12} sm={8} md={3}><Statistic title="Permit" value={estimate.permit_fee} prefix="$" precision={2} /></Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title="TOTAL"
                value={estimate.total}
                prefix="$"
                precision={2}
                valueStyle={{ color: '#1677ff', fontWeight: 'bold' }}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Statistic title="Area" value={estimate.squares} suffix="SQ" precision={1} />
            </Col>
            <Col xs={24} sm={12} md={5}>
              {(() => {
                const structures = estimate.eagleview_data?.structures || [];
                const pitch = estimate.predominant_pitch || 'N/A';
                if (structures.length > 1) {
                  return (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>Pitch (per structure)</Text>
                      <div>
                        {structures.map((s: any) => {
                          const label = (s.label || '').replace('Structure ', '#');
                          const range = s.pitch_min && s.pitch_max && s.pitch_min !== s.pitch_max
                            ? ` (${s.pitch_min}–${s.pitch_max})` : '';
                          return (
                            <Tag key={s.index} style={{ margin: '2px 4px 2px 0', fontSize: 11 }}>
                              {label}: {s.predominant_pitch}{range}
                            </Tag>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                const s = structures[0];
                const range = s?.pitch_min && s?.pitch_max && s.pitch_min !== s.pitch_max
                  ? ` (${s.pitch_min}–${s.pitch_max})` : '';
                return <Statistic title="Pitch" value={`${pitch}${range}`} />;
              })()}
            </Col>
          </Row>
          {estimate.target_total && estimate.adjustment_factor && (
            <Row style={{ marginTop: 8 }}>
              <Col span={24}>
                <Tag color={estimate.adjustment_factor > 1 ? 'red' : 'green'}>
                  Target: ${estimate.target_total.toLocaleString()} | Factor: {estimate.adjustment_factor.toFixed(4)}x
                </Tag>
              </Col>
            </Row>
          )}
        </Card>
      )}

      <Form form={form} layout="vertical" initialValues={{ stories: 1, layer_count: 1, waste_factor: 0.12, full_tearoff: true }}>
        <Tabs defaultActiveKey="1" items={[
          {
            key: '1',
            label: 'Project Info',
            children: (
              <Card>
                <Divider orientation="left">Company (for PDF)</Divider>
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item label="Company" name="company_id">
                      <Select
                        placeholder="Select a company..."
                        allowClear
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                        }
                        options={companies.map((c: Company) => ({
                          label: c.name,
                          value: c.id,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.company_id !== cur.company_id}>
                  {({ getFieldValue }) => {
                    const compId = getFieldValue('company_id');
                    const comp = companies.find((c: Company) => c.id === compId);
                    if (!comp) return null;
                    return (
                      <div style={{
                        background: '#f8fafc', border: '1px solid #e8e8e8',
                        borderRadius: 6, padding: '10px 16px', marginBottom: 16,
                      }}>
                        <Row gutter={16}>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Company</Text><br />
                            <Text strong><BankOutlined style={{ marginRight: 4 }} />{comp.name}</Text>
                            {comp.company_code && <Tag color="blue" style={{ marginLeft: 8, fontSize: 10 }}>{comp.company_code}</Tag>}
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Contact</Text><br />
                            <Text style={{ fontSize: 12 }}>{[comp.phone, comp.email].filter(Boolean).join(' | ') || '—'}</Text>
                          </Col>
                          <Col xs={24} sm={8}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Address</Text><br />
                            <Text style={{ fontSize: 12 }}>{[comp.address, comp.city, comp.state, comp.zipcode].filter(Boolean).join(', ') || '—'}</Text>
                          </Col>
                        </Row>
                      </div>
                    );
                  }}
                </Form.Item>

                <Divider orientation="left">Property</Divider>
                <Row gutter={16}>
                  <Col xs={24} md={12}><Form.Item label="Property Address" name="property_address"><AddressAutocomplete onSelect={(addr) => form.setFieldsValue({ city: addr.city, state: addr.state, zip_code: addr.zip })} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="City" name="city"><Input /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="State" name="state">
                      <Select options={[
                        { label: 'MD', value: 'MD' },
                        { label: 'VA', value: 'VA' },
                        { label: 'DC', value: 'DC' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Zip Code" name="zip_code"><Input /></Form.Item></Col>
                </Row>

                <Divider orientation="left">Building Details</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Building Type" name="building_type">
                      <Select options={pricingInfo?.building_types?.map(t => ({ label: t.toUpperCase(), value: t })) || []} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Year Built" name="year_built"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Stories" name="stories">
                      <Select options={[
                        { label: '1 Story', value: 1 },
                        { label: '2 Story', value: 2 },
                        { label: '3 Story', value: 3 },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="HOA" name="hoa" valuePropName="checked"><Switch /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Roof Access" name="roof_access">
                      <Select options={[
                        { label: 'Easy', value: 'easy' },
                        { label: 'Moderate', value: 'moderate' },
                        { label: 'Difficult', value: 'difficult' },
                      ]} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={8}><Form.Item label="Notes" name="notes"><Input.TextArea rows={3} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Insurance Job" name="insurance_job" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>
              </Card>
            ),
          },
          {
            key: '2',
            label: 'Measurement',
            children: (
              <Card>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col xs={24} md={12}>
                    <Card title="EagleView Upload" size="small">
                      <Upload
                        accept=".json,.JSON"
                        showUploadList={false}
                        beforeUpload={(file) => { handleEagleViewUpload(file); return false; }}
                      >
                        <Button icon={<CloudUploadOutlined />}>Upload EagleView JSON</Button>
                      </Upload>
                      {eagleViewResult && (
                        <div style={{ marginTop: 12 }}>
                          <Text type="success">
                            Parsed: {eagleViewResult.all_faces.length} faces,{' '}
                            {eagleViewResult.total_sf.toFixed(0)} SF total
                            {eagleViewResult.structures.length > 1 &&
                              ` (${eagleViewResult.structures.length} structures)`}
                          </Text>
                        </div>
                      )}
                    </Card>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Source" name="measurement_source">
                      <Select options={[
                        { label: 'EagleView', value: 'eagleview' },
                        { label: 'Manual', value: 'manual' },
                        { label: 'Satellite', value: 'satellite' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Roof Complexity" name="roof_complexity">
                      <Select options={pricingInfo?.roof_complexities?.map(c => ({
                        label: c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: c,
                      })) || []} />
                    </Form.Item>
                  </Col>
                </Row>

                {/* Structure selection (when multiple structures exist) */}
                {eagleViewResult && eagleViewResult.structures.length > 1 && (
                  <Card
                    title="Structures (select which to include in estimate)"
                    size="small"
                    style={{ marginBottom: 16 }}
                  >
                    <Row gutter={[16, 8]}>
                      {eagleViewResult.structures.map(s => (
                        <Col key={s.index} xs={24} sm={12} md={8}>
                          <Checkbox
                            checked={selectedStructures.includes(s.index)}
                            onChange={(e) => handleStructureToggle(s.index, e.target.checked)}
                          >
                            <Text strong>{s.label}</Text>
                            <br />
                            <Text type="secondary">
                              {s.total_sf.toLocaleString()} SF | {s.facet_count} facets | {s.predominant_pitch} | {s.complexity}
                            </Text>
                          </Checkbox>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                )}

                {/* Face selection for partial roof */}
                {eagleViewResult && eagleViewResult.all_faces.length > 0 && (
                  <Card title="Roof Faces (select for partial replacement)" size="small" style={{ marginBottom: 16 }}>
                    <Row gutter={[8, 8]}>
                      {eagleViewResult.all_faces
                        .filter(f => !f.is_accessory && selectedStructures.includes(f.structure_index))
                        .map(face => (
                        <Col key={face.id} xs={12} sm={8} md={6}>
                          <Checkbox
                            checked={selectedFaces.includes(face.id)}
                            onChange={(e) => handleFaceToggle(face.id, e.target.checked)}
                          >
                            <Text strong>
                              {eagleViewResult.structures.length > 1
                                ? `S${face.structure_index + 1}-`
                                : ''}
                              Face {face.designator}
                            </Text>
                            <br />
                            <Text type="secondary">{face.area.toFixed(0)} SF | {face.pitch}</Text>
                          </Checkbox>
                        </Col>
                      ))}
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    <Space>
                      <Button size="small" onClick={() => {
                        const all = eagleViewResult.all_faces
                          .filter(f => !f.is_accessory && selectedStructures.includes(f.structure_index))
                          .map(f => f.id);
                        setSelectedFaces(all);
                        const totalSf = eagleViewResult.all_faces
                          .filter(f => !f.is_accessory && selectedStructures.includes(f.structure_index))
                          .reduce((s, f) => s + f.area, 0);
                        form.setFieldsValue({ total_sf: Math.round(totalSf * 10) / 10, squares: Math.round(totalSf / 10) / 10 });
                      }}>Select All</Button>
                      <Button size="small" onClick={() => {
                        setSelectedFaces([]);
                        form.setFieldsValue({ total_sf: 0, squares: 0 });
                      }}>Deselect All</Button>
                      <Text>Selected: {selectedFaces.length} faces</Text>
                    </Space>
                  </Card>
                )}

                {/* Roof Diagram */}
                {(() => {
                  const diagramFaces = eagleViewResult?.all_faces
                    ?? estimate.eagleview_data?.faces
                    ?? [];
                  const diagramLines = eagleViewResult?.lines
                    ?? estimate.eagleview_data?.lines
                    ?? [];
                  const hasVertices = diagramFaces.some((f: any) => f.vertices?.length > 0);
                  if (!hasVertices) return null;

                  const visibleFaces = diagramFaces.filter(
                    (f: any) => selectedStructures.includes(f.structure_index),
                  );
                  const visibleLines = diagramLines.filter(
                    (l: any) => selectedStructures.includes(l.structure_index),
                  );
                  return (
                    <RoofDiagram
                      faces={visibleFaces}
                      lines={visibleLines}
                      selectedFaceIds={selectedFaces}
                      onFaceToggle={handleDiagramFaceToggle}
                    />
                  );
                })()}

                <Divider orientation="left">Measurements</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Total SF" name="total_sf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Squares" name="squares"><InputNumber style={{ width: '100%' }} step={0.1} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Predominant Pitch" name="predominant_pitch">
                      <Select options={Object.keys(pricingInfo?.pitch_multipliers || {}).map(p => ({ label: p, value: p }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Waste Factor" name="waste_factor"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={0.3} /></Form.Item></Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Ridge (LF)" name="ridge_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Hip (LF)" name="hip_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Valley (LF)" name="valley_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Eave (LF)" name="eave_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Rake (LF)" name="rake_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Step Flash (LF)" name="step_flashing_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                </Row>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Penetrations" name="penetration_count"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Skylights" name="skylight_count"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Chimneys" name="chimney_count"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                </Row>
              </Card>
            ),
          },
          {
            key: '3',
            label: 'Scope & Materials',
            children: (
              <Card>
                <Divider orientation="left">Tear-off Scope</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Full Tear-off" name="full_tearoff" valuePropName="checked"><Switch /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Existing Layers" name="layer_count">
                      <Select options={[
                        { label: '1 Layer', value: 1 },
                        { label: '2 Layers', value: 2 },
                        { label: '3 Layers', value: 3 },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Form.Item label="Existing Material" name="existing_material">
                      <Select options={pricingInfo?.existing_materials?.map(m => ({
                        label: m.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: m,
                      })) || []} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider orientation="left">Shingle Selection</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Shingle Type" name="shingle_type">
                      <Select options={pricingInfo?.shingle_types?.map(t => ({
                        label: t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: t,
                      })) || []} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Brand" name="shingle_brand">
                      <Select options={pricingInfo?.shingle_brands?.map(b => ({
                        label: b.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: b,
                      })) || []} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={12} md={6}><Form.Item label="Product" name="shingle_product"><Input placeholder="e.g. Timberline HDZ" /></Form.Item></Col>
                  <Col xs={12} sm={12} md={6}><Form.Item label="Color" name="shingle_color"><Input placeholder="e.g. Charcoal" /></Form.Item></Col>
                </Row>

                <Divider orientation="left">Underlayment</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Underlayment Type" name="underlayment_type">
                      <Select options={pricingInfo?.underlayment_types?.map(t => ({
                        label: t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: t,
                      })) || []} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider orientation="left">Flashing & Penetrations</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Pipe Boot Type" name="pipe_boot_type">
                      <Select options={pricingInfo?.pipe_boot_types?.map(t => ({
                        label: t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value: t,
                      })) || []} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Ridge Vent" name="ridge_vent" valuePropName="checked"><Switch defaultChecked /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Static Vents" name="static_vents"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                </Row>
              </Card>
            ),
          },
          {
            key: '4',
            label: 'Decking & Gutter',
            children: (
              <Card>
                <Divider orientation="left">Decking Clause</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Decking Material" name="decking_material">
                      <Select options={pricingInfo?.decking_materials?.map(m => ({
                        label: m.replace(/_/g, ' ').toUpperCase(),
                        value: m,
                      })) || []} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Free Sheets" name="decking_free_sheets"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Rate/Sheet ($)" name="decking_rate"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Est. Sheets Needed" name="decking_estimated"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Re-nail Existing" name="re_nail_existing" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>

                <Divider orientation="left">Gutter (Optional)</Divider>
                {/* Common gutter settings */}
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Include Gutter" name="gutter_included" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.gutter_included !== cur.gutter_included}>
                  {({ getFieldValue }) => getFieldValue('gutter_included') && (
                    <>
                      <Row gutter={16}>
                        <Col xs={12} sm={8} md={4}>
                          <Form.Item label="Style" name="gutter_style">
                            <Select options={pricingInfo?.gutter_styles?.map(s => ({
                              label: s.replace(/_/g, '-').replace(/\b\w/g, l => l.toUpperCase()),
                              value: s,
                            })) || []} />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4}>
                          <Form.Item label="Size" name="gutter_size">
                            <Select options={pricingInfo?.gutter_sizes?.map(s => ({ label: `${s}"`, value: s })) || []} />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4}><Form.Item label="Gutter Guards" name="gutter_guards" valuePropName="checked"><Switch /></Form.Item></Col>
                        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.gutter_guards !== cur.gutter_guards}>
                          {({ getFieldValue: gfv }) => gfv('gutter_guards') && (
                            <Col xs={12} sm={12} md={6}>
                              <Form.Item label="Guard Type" name="gutter_guard_type">
                                <Select options={pricingInfo?.gutter_guard_types?.map(t => ({
                                  label: t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                  value: t,
                                })) || []} />
                              </Form.Item>
                            </Col>
                          )}
                        </Form.Item>
                      </Row>

                      {/* Per-structure gutter when multi-structure */}
                      {eagleViewResult && eagleViewResult.structures.length > 1 ? (
                        <>
                          <Divider orientation="left" plain style={{ fontSize: 12 }}>Per-Structure Gutter</Divider>
                          {eagleViewResult.structures.map((s) => {
                            const fieldPrefix = `gutter_struct_${s.index}`;
                            return (
                              <Card key={s.index} size="small" style={{ marginBottom: 12, background: '#fafbfc' }}
                                title={<Text strong>{s.label} <Text type="secondary">({s.total_sf.toLocaleString()} SF)</Text></Text>}>
                                <Row gutter={16} align="middle">
                                  <Col xs={8} sm={6} md={3}>
                                    <Form.Item label="Include" name={`${fieldPrefix}_included`} valuePropName="checked"
                                      initialValue={s.index === 0}>
                                      <Switch size="small" />
                                    </Form.Item>
                                  </Col>
                                  <Form.Item noStyle shouldUpdate={(prev, cur) =>
                                    prev[`${fieldPrefix}_included`] !== cur[`${fieldPrefix}_included`]}>
                                    {({ getFieldValue: gfv2 }) => gfv2(`${fieldPrefix}_included`) && (
                                      <>
                                        <Col xs={8} sm={6} md={3}>
                                          <Form.Item label="Gutter LF" name={`${fieldPrefix}_total_lf`}>
                                            <InputNumber style={{ width: '100%' }} min={0} />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={8} sm={6} md={3}>
                                          <Form.Item label="DS Count" name={`${fieldPrefix}_ds_count`}>
                                            <InputNumber style={{ width: '100%' }} min={0} />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={8} sm={6} md={3}>
                                          <Form.Item label="DS (LF)" name={`${fieldPrefix}_ds_lf`}>
                                            <InputNumber style={{ width: '100%' }} min={0} />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={8} sm={6} md={3}>
                                          <Form.Item label="Splash" name={`${fieldPrefix}_splash`}>
                                            <InputNumber style={{ width: '100%' }} min={0} />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={8} sm={6} md={3}>
                                          <Form.Item label="Detach & Reset" name={`${fieldPrefix}_remove`} valuePropName="checked">
                                            <Switch size="small" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={12} sm={8} md={4} style={{ display: 'flex', alignItems: 'end', paddingBottom: 24 }}>
                                          <Button size="small" type="dashed" block onClick={() => {
                                            const evFaces = eagleViewResult.all_faces.filter(
                                              f => f.structure_index === s.index && !f.is_accessory
                                                && selectedFaces.includes(f.id));
                                            // Get eave lines for this structure
                                            const sLines = eagleViewResult.lines?.filter(
                                              ln => ln.structure_index === s.index && ln.type === 'EAVE') || [];
                                            const eaveLf = sLines.reduce((sum, ln) => sum + ln.length, 0);
                                            const stories = form.getFieldValue('stories') || 1;
                                            if (eaveLf <= 0) {
                                              message.warning(`No eave data for ${s.label}`);
                                              return;
                                            }
                                            const dsCount = Math.ceil(eaveLf / 40);
                                            form.setFieldsValue({
                                              [`${fieldPrefix}_total_lf`]: Math.round(eaveLf),
                                              [`${fieldPrefix}_ds_count`]: dsCount,
                                              [`${fieldPrefix}_ds_lf`]: Math.round(dsCount * stories * 10),
                                              [`${fieldPrefix}_splash`]: dsCount,
                                            });
                                            message.success(`${s.label}: ${Math.round(eaveLf)} LF gutter, ${dsCount} DS`);
                                          }}>
                                            Auto-Calc
                                          </Button>
                                        </Col>
                                      </>
                                    )}
                                  </Form.Item>
                                </Row>
                              </Card>
                            );
                          })}
                        </>
                      ) : (
                        /* Single structure gutter fields */
                        <>
                          <Row gutter={16}>
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item label="DS Spacing (ft)" name="downspout_spacing" initialValue={40}>
                                <InputNumber style={{ width: '100%' }} min={20} max={60} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item label="DS Height/Story (ft)" name="downspout_height_per_story" initialValue={10}>
                                <InputNumber style={{ width: '100%' }} min={5} max={20} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={8} md={4} style={{ display: 'flex', alignItems: 'end', paddingBottom: 24 }}>
                              <Button
                                type="dashed"
                                onClick={() => {
                                  const eaveLf = form.getFieldValue('eave_lf') || 0;
                                  const stories = form.getFieldValue('stories') || 1;
                                  const spacing = form.getFieldValue('downspout_spacing') || 40;
                                  const heightPerStory = form.getFieldValue('downspout_height_per_story') || 10;
                                  if (eaveLf <= 0) {
                                    message.warning('Eave LF is 0. Enter measurement data first.');
                                    return;
                                  }
                                  const gutterLf = eaveLf;
                                  const dsCount = Math.ceil(eaveLf / spacing);
                                  const dsLf = dsCount * stories * heightPerStory;
                                  form.setFieldsValue({
                                    gutter_total_lf: Math.round(gutterLf),
                                    gutter_downspout_count: dsCount,
                                    gutter_downspout_lf: Math.round(dsLf),
                                    gutter_splash_blocks: dsCount,
                                  });
                                  message.success(`Auto-calculated: ${Math.round(gutterLf)} LF gutter, ${dsCount} DS`);
                                }}
                                block
                              >
                                Auto-Calculate from Eave
                              </Button>
                            </Col>
                          </Row>
                          <Row gutter={16}>
                            <Col xs={12} sm={8} md={4}><Form.Item label="Gutter (LF)" name="gutter_total_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                            <Col xs={12} sm={8} md={4}><Form.Item label="Downspout Count" name="gutter_downspout_count"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                            <Col xs={12} sm={8} md={4}><Form.Item label="Downspout (LF)" name="gutter_downspout_lf"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                            <Col xs={12} sm={8} md={4}><Form.Item label="Splash Blocks" name="gutter_splash_blocks"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                          </Row>
                          <Row gutter={16}>
                            <Col xs={12} sm={8} md={4}><Form.Item label="Detach & Reset" name="gutter_remove_existing" valuePropName="checked"><Switch /></Form.Item></Col>
                          </Row>
                        </>
                      )}
                    </>
                  )}
                </Form.Item>
              </Card>
            ),
          },
          {
            key: '5',
            label: 'Costs & Pricing',
            children: (
              <Card>
                <Divider orientation="left">Additional Costs</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Dumpster" name="hc_dumpster" valuePropName="checked" initialValue={true}><Checkbox defaultChecked /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Lead RRP" name="hc_lead" valuePropName="checked"><Checkbox /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Vent Cap Replace" name="hc_vent_cap" valuePropName="checked"><Checkbox /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Satellite Removal" name="hc_satellite" valuePropName="checked"><Checkbox /></Form.Item></Col>
                </Row>

                <Divider orientation="left">Permit</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={12} md={6}>
                    <Form.Item label="Building Permit" name="hc_permit_option" initialValue="state">
                      <Select options={[
                        { label: 'No Permit', value: 'none' },
                        { label: 'By State (auto)', value: 'state' },
                        { label: 'MD — $275', value: 'MD' },
                        { label: 'VA — $250', value: 'VA' },
                        { label: 'DC — $350', value: 'DC' },
                        { label: 'Custom Amount', value: 'custom' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.hc_permit_option !== cur.hc_permit_option}>
                    {({ getFieldValue }) => getFieldValue('hc_permit_option') === 'custom' && (
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Custom Fee ($)" name="hc_permit_custom_fee">
                          <InputNumber style={{ width: '100%' }} min={0} step={25} placeholder="e.g. 300" />
                        </Form.Item>
                      </Col>
                    )}
                  </Form.Item>
                </Row>

                <Divider orientation="left">Markup & Pricing</Divider>
                <Row gutter={16}>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Material Markup %" name="material_markup_pct"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={1} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Labor Markup %" name="labor_markup_pct"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={1} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="Contingency %" name="contingency_pct"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={0.2} /></Form.Item></Col>
                  <Col xs={12} sm={8} md={4}><Form.Item label="O&P (Insurance)" name="include_overhead_profit" valuePropName="checked"><Switch /></Form.Item></Col>
                </Row>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.include_overhead_profit !== cur.include_overhead_profit}>
                  {({ getFieldValue }) => getFieldValue('include_overhead_profit') && (
                    <Row gutter={16}>
                      <Col xs={12} sm={8} md={4}><Form.Item label="Overhead %" name="overhead_pct"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={0.5} /></Form.Item></Col>
                      <Col xs={12} sm={8} md={4}><Form.Item label="Profit %" name="profit_pct"><InputNumber style={{ width: '100%' }} step={0.01} min={0} max={0.5} /></Form.Item></Col>
                    </Row>
                  )}
                </Form.Item>

                <Divider orientation="left"><AimOutlined /> Target Total (Reverse Pricing)</Divider>
                <Alert
                  message="Set a desired total and all line items will scale proportionally when you Calculate."
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
                <Row gutter={16} align="middle">
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item label="Target Total ($)" name="target_total">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        step={1000}
                        formatter={(v) => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                        parser={(v) => (v ? Number(v.replace(/,/g, '')) : 0) as any}
                        placeholder="e.g. 30000"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    {estimate.adjustment_factor && (
                      <Statistic
                        title="Adjustment Factor"
                        value={estimate.adjustment_factor}
                        precision={4}
                        suffix="x"
                        valueStyle={{
                          color: estimate.adjustment_factor > 1 ? '#cf1322' : '#3f8600',
                          fontSize: 16,
                        }}
                      />
                    )}
                  </Col>
                  <Col xs={12} sm={12} md={6}>
                    <Button
                      type="dashed"
                      onClick={() => {
                        form.setFieldsValue({ target_total: null });
                        message.info('Target total cleared. Click Calculate to restore original pricing.');
                      }}
                    >
                      Clear Target
                    </Button>
                  </Col>
                </Row>
              </Card>
            ),
          },
          {
            key: '6',
            label: 'Warranty',
            children: (
              <Card>
                <Alert
                  message="Warranty Information"
                  description="Material warranty follows the manufacturer's published terms. You can customize the labor warranty period and all warranty text below. These will appear on the exported PDF estimate."
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                <Divider orientation="left">Labor Warranty Period</Divider>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={6}>
                    <Form.Item label="Labor Warranty (Years)" name="labor_warranty_years">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        max={30}
                        placeholder="10"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={18}>
                    <Text type="secondary" style={{ display: 'block', marginTop: 30 }}>
                      Industry standard: 5-10 years for workmanship warranty. Premium contractors may offer up to 25 years.
                    </Text>
                  </Col>
                </Row>

                <Divider orientation="left">Material Warranty (Manufacturer)</Divider>
                <Form.Item
                  label="Material Warranty Text"
                  name="material_warranty_text"
                  extra="This warranty follows the product manufacturer's terms. Edit to match the specific shingle product selected."
                >
                  <Input.TextArea rows={5} />
                </Form.Item>

                <Divider orientation="left">Labor/Workmanship Warranty</Divider>
                <Form.Item
                  label="Workmanship Warranty Text"
                  name="labor_warranty_text"
                  extra="Use {years} as a placeholder for the labor warranty years entered above."
                >
                  <Input.TextArea rows={5} />
                </Form.Item>

                <Divider orientation="left">Warranty Exclusions</Divider>
                <Form.Item
                  label="Warranty Exclusions"
                  name="warranty_exclusions"
                  extra="Standard exclusions that apply to both material and labor warranties."
                >
                  <Input.TextArea rows={5} />
                </Form.Item>

                <Row>
                  <Col span={24}>
                    <Button
                      type="dashed"
                      onClick={() => {
                        form.setFieldsValue({
                          material_warranty_text: DEFAULT_MATERIAL_WARRANTY_TEXT,
                          labor_warranty_text: DEFAULT_LABOR_WARRANTY_TEXT,
                          warranty_exclusions: DEFAULT_WARRANTY_EXCLUSIONS,
                        });
                        message.info('Warranty text reset to defaults');
                      }}
                    >
                      Reset to Default Warranty Text
                    </Button>
                  </Col>
                </Row>
              </Card>
            ),
          },
          {
            key: '7',
            label: `Line Items (${estimate.line_items?.length || 0})`,
            children: (
              <Card>
                {estimate.line_items?.length ? (() => {
                  // Detect multi-structure from line items themselves
                  const structIndices = estimate.line_items
                    .map(li => li.structure_index ?? 0)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .sort();
                  const isMulti = structIndices.length > 1;

                  // Build structure info from structure_results or EagleView data
                  const getStructInfo = (sIdx: number) => {
                    const sr = estimate.structure_results?.find(s => s.structure_index === sIdx);
                    if (sr) return sr;
                    const evStruct = estimate.eagleview_data?.structures?.find((s: any) => s.index === sIdx);
                    const items = estimate.line_items.filter(li => (li.structure_index ?? 0) === sIdx);
                    const subtotal = items.reduce((sum, li) => sum + li.total, 0);
                    return {
                      structure_index: sIdx,
                      label: evStruct?.label || `Structure #${sIdx + 1}`,
                      included: true,
                      total_sf: evStruct?.total_sf,
                      squares: evStruct?.total_sf ? evStruct.total_sf / 100 : undefined,
                      predominant_pitch: evStruct?.predominant_pitch,
                      subtotal,
                      total: subtotal,
                    };
                  };

                  if (isMulti) {
                    return (
                      <>
                        {structIndices.map((sIdx) => {
                          const info = getStructInfo(sIdx);
                          const structItems = estimate.line_items.filter(
                            li => (li.structure_index ?? 0) === sIdx
                          );
                          if (!info.included || structItems.length === 0) return null;
                          const structSubtotal = structItems.reduce((sum, li) => sum + li.total, 0);
                          return (
                            <div key={sIdx} style={{ marginBottom: 24 }}>
                              <Row justify="space-between" align="middle"
                                style={{ marginBottom: 8, padding: '8px 12px', background: '#f0f5ff', borderRadius: 6 }}>
                                <Col>
                                  <Text strong style={{ fontSize: 15 }}>
                                    {info.label}
                                  </Text>
                                  {info.total_sf && (
                                    <Text type="secondary" style={{ marginLeft: 12 }}>
                                      {info.total_sf?.toLocaleString()} SF
                                      {info.squares && ` (${info.squares.toFixed(1)} SQ)`}
                                      {info.predominant_pitch && ` | ${info.predominant_pitch}`}
                                    </Text>
                                  )}
                                </Col>
                                <Col>
                                  <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px' }}>
                                    ${structSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </Tag>
                                </Col>
                              </Row>
                              <Table
                                columns={lineItemColumns}
                                dataSource={structItems}
                                rowKey="id"
                                pagination={false}
                                size="small"
                                scroll={{ x: 800 }}
                              />
                            </div>
                          );
                        })}
                        <Divider />
                        <Row justify="end">
                          <Col>
                            <Statistic
                              title="Combined Subtotal"
                              value={estimate.subtotal}
                              prefix="$"
                              precision={2}
                              valueStyle={{ fontWeight: 'bold' }}
                            />
                          </Col>
                        </Row>
                      </>
                    );
                  }
                  return (
                    <Table
                      columns={lineItemColumns}
                      dataSource={estimate.line_items}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      scroll={{ x: 800 }}
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={5}>
                            <Text strong>Subtotal</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="right">
                            <Text strong>
                              ${estimate.subtotal?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={6} />
                        </Table.Summary.Row>
                      )}
                    />
                  );
                })() : (
                  <Alert
                    message="No line items yet"
                    description="Click 'Calculate' to generate line items based on your inputs."
                    type="info"
                    showIcon
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

export default RoofingEstimateDetail;
