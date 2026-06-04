import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
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
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Modal,
  Dropdown,
  Popconfirm,
} from 'antd';
import {
  ArrowLeftOutlined,
  CalculatorOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  FilePdfOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  RobotOutlined,
  EditOutlined,
  BookOutlined,
  AimOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import { bathroomEstimateService } from '../services/bathroomEstimateService';
import { clientService } from '../services/clientService';
import { companyService } from '../services/companyService';
import type {
  BathroomEstimate,
  BathroomEstimateUpdate,
  BathroomEstimateLineItem,
  BathroomEstimateHistory,
  BathroomPricingInfo,
} from '../types/bathroomEstimate';
import { PHASE_LABELS } from '../types/bathroomEstimate';
import BESketchTab from '../components/bathroom-estimate/sketch/BESketchTab';
import type { SketchFixtureSync } from '../components/bathroom-estimate/sketch/BESketchTab';

const RegisterBidItemModal = React.lazy(() => import('../components/supplement/RegisterBidItemModal'));

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Panel } = Collapse;
const round2 = (n: number) => Math.round(n * 100) / 100;

const formatLabel = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';

const BathroomEstimateDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('project');
  const [registerBidItemOpen, setRegisterBidItemOpen] = useState(false);

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

  const [guideOpen, setGuideOpen] = useState(false);
  const { data: companyResults } = useQuery({
    queryKey: ['companies-list'],
    queryFn: () => companyService.getCompanies(),
  });

  // Auto-fill address when client/claim is selected
  const handleClaimSelect = useCallback((claimId: string | null) => {
    if (!clientResults?.clients) return;
    let client: any = null;
    if (claimId) {
      // Find client by claim id
      client = (clientResults.clients as any[]).find((c: any) =>
        (c.claims || []).some((cl: any) => cl.id === claimId)
      );
    } else {
      // "No claim" selected — use first client in results (most recently searched)
      client = (clientResults.clients as any[])[0];
    }
    if (client) {
      form.setFieldsValue({
        property_address: client.address || '',
        city: client.city || '',
        state: client.state || '',
        zip_code: client.zipcode || '',
      });
    }
  }, [clientResults, form]);

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
      // Preset default accessories only if spec is completely empty (never saved)
      const acc = estimate.accessories_spec;
      if (!acc || (acc.towel_bars == null && acc.tp_holders == null && acc.hand_towel_rings == null && acc.finish == null)) {
        estimate.accessories_spec = {
          ...acc,
          towel_bars: 1,
          tp_holders: 1,
          hand_towel_rings: 1,
          robe_hooks: 1,
          finish: 'chrome',
          grade: 'mid',
        };
      }
      // Ensure auto-include flags have explicit boolean values
      // so unchecking properly sends false (not undefined) to backend.
      // Fixture auto-includes (GFCI, fan, vanity light) default OFF — user opts in.
      // Finish/substrate auto-includes default ON — commonly needed.
      // Ensure JSONB spec fields are objects (not null) for Ant Design nested form paths
      estimate.floor_spec = estimate.floor_spec || {};
      estimate.walls_spec = estimate.walls_spec || {};
      estimate.shower_spec = estimate.shower_spec || {};
      estimate.bathtub_spec = estimate.bathtub_spec || {};
      // Default curtain_rod to true for bathtub replacements (opt-out)
      if (estimate.replace_tub) {
        estimate.bathtub_spec = {
          ...estimate.bathtub_spec,
          curtain_rod: estimate.bathtub_spec.curtain_rod ?? true,
        };
      }
      estimate.vanity_spec = estimate.vanity_spec || {};
      estimate.toilet_spec = estimate.toilet_spec || {};
      estimate.accessories_spec = estimate.accessories_spec || {};
      estimate.plumbing_spec = estimate.plumbing_spec || {};
      estimate.electrical_spec = estimate.electrical_spec || {};
      estimate.substrate_spec = estimate.substrate_spec || {};

      const hc = estimate.hidden_costs || {};
      estimate.hidden_costs = {
        ...hc,
        // Auto-include items
        drywall_skim_coat: hc.drywall_skim_coat ?? true,
        subfloor_allowance: hc.subfloor_allowance ?? true,
        auto_gfci: hc.auto_gfci ?? false,
        auto_exhaust_fan: hc.auto_exhaust_fan ?? false,
        auto_ceiling_paint: hc.auto_ceiling_paint ?? true,
        mold_resistant_drywall: hc.mold_resistant_drywall ?? true,
      };
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

  // ── Sketch → Form sync ──
  const handleSketchChange = useCallback((sketchData: any) => {
    form.setFieldValue('sketch_data', sketchData);
  }, [form]);

  const handleFixtureSync = useCallback((sync: SketchFixtureSync) => {
    const current = form.getFieldsValue(true);
    const updates: Record<string, any> = {};

    // Room dimensions
    if (sync.length_ft) updates.length_ft = sync.length_ft;
    if (sync.width_ft) updates.width_ft = sync.width_ft;
    if (sync.floor_sf) updates.floor_sf = sync.floor_sf;
    if (sync.wall_sf) updates.wall_sf = sync.wall_sf;
    if (sync.paint_wall_sf != null) updates.paint_wall_sf = sync.paint_wall_sf;

    // Replace & demo flags
    // When sketch adds/removes a fixture, sync the action flags.
    // If user already chose D&R for a fixture, don't override to replace.
    const syncFixtureAction = (fixture: string, hasFixture?: boolean) => {
      if (hasFixture === undefined) return;
      if (hasFixture) {
        // Fixture exists on sketch: set replace only if D&R not already chosen
        if (!current[`detach_reset_${fixture}`]) {
          updates[`replace_${fixture}`] = true;
        }
      } else {
        // Fixture removed from sketch: clear both flags
        updates[`replace_${fixture}`] = false;
        updates[`detach_reset_${fixture}`] = false;
      }
    };
    syncFixtureAction('tub', sync.replace_tub);
    syncFixtureAction('shower', sync.replace_shower);
    syncFixtureAction('vanity', sync.replace_vanity);
    syncFixtureAction('toilet', sync.replace_toilet);
    syncFixtureAction('mirror', sync.replace_mirror);
    if (sync.demo_walls !== undefined) updates.demo_walls = sync.demo_walls;

    // Merge specs (keep existing form values, override with sketch values)
    if (sync.bathtub_spec) {
      updates.bathtub_spec = { ...(current.bathtub_spec || {}), ...sync.bathtub_spec };
    }
    if (sync.shower_spec) {
      updates.shower_spec = {
        ...(current.shower_spec || {}),
        ...sync.shower_spec,
        tile_spec: { ...(current.shower_spec?.tile_spec || {}), ...(sync.shower_spec.tile_spec || {}) },
      };
    }
    if (sync.vanity_spec) {
      // Merge vanity items: sketch provides dimensions, keep user's other settings
      const curItems: any[] = current.vanity_spec?.items || [];
      const syncItems: any[] = sync.vanity_spec.items || [];
      const mergedItems = syncItems.map((si: any, i: number) => ({
        ...(curItems[i] || { sinks: 1 }),
        ...si,
      }));
      updates.vanity_spec = { items: mergedItems };
    }

    if (sync.walls_spec) {
      updates.walls_spec = { ...(current.walls_spec || {}), ...sync.walls_spec };
    }
    if (sync.tile_wall_sf != null) updates.tile_wall_sf = sync.tile_wall_sf;

    if (sync.hidden_costs) {
      updates.hidden_costs = { ...(current.hidden_costs || {}), ...sync.hidden_costs };
    }

    // Auto-calculate substrate_spec from shower/tub dimensions
    const mergedShower = updates.shower_spec || current.shower_spec || {};
    const mergedTub = updates.bathtub_spec || current.bathtub_spec || {};
    const replaceShower = updates.replace_shower ?? current.replace_shower;
    let wetSF = 0;

    // Shower tile walls (custom_tile or curbless need backer board)
    const sType = mergedShower.type || '';
    if (replaceShower && (sType === 'custom_tile' || sType === 'curbless')) {
      const sw = mergedShower.width_in || 0;
      const sd = mergedShower.depth_in || 0;
      const sh = mergedShower.tile_height_in || 0;
      if (sw && sd && sh) {
        wetSF += (sw + 2 * sd) * sh / 144;
      }
    }

    // Tub surround tile
    if (mergedTub.surround_tile) {
      const tl = mergedTub.tub_length_in || 0;
      const td = mergedTub.tub_depth_in || 30;
      const tsh = mergedTub.surround_height_in || 0;
      if (tl && tsh) {
        wetSF += (tl + 2 * td) * tsh / 144;
      }
    }

    wetSF = Math.round(wetSF * 10) / 10;

    if (wetSF > 0) {
      const curSub = current.substrate_spec || {};
      updates.substrate_spec = {
        ...curSub,
        durock_sf: wetSF,
        waterproof_type: curSub.waterproof_type || 'redgard',
        waterproof_sf: wetSF,
      };
    }

    form.setFieldsValue(updates);
  }, [form]);

  // ── Line Item mutations (must be before early return) ──
  const [editingItem, setEditingItem] = useState<any>(null);
  const [addingPhase, setAddingPhase] = useState<number | null>(null);

  const lineItemMutation = useMutation({
    mutationFn: async (args: { action: string; itemId?: string; phase?: number; data?: any }) => {
      if (args.action === 'update') return bathroomEstimateService.updateLineItem(id!, args.itemId!, args.data);
      if (args.action === 'delete') return bathroomEstimateService.deleteLineItem(id!, args.itemId!);
      if (args.action === 'add') return bathroomEstimateService.addLineItem(id!, args.data);
      if (args.action === 'deletePhase') return bathroomEstimateService.deletePhase(id!, args.phase!);
      throw new Error('Unknown action');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bathroom-estimate', id] });
      setEditingItem(null);
      setAddingPhase(null);
    },
    onError: () => message.error('Operation failed'),
  });

  const selectOpts = (items: string[] | undefined) =>
    (items || []).map(v => ({ label: formatLabel(v), value: v }));

  const numOpts = (items: number[] | undefined) =>
    (items || []).map(v => ({ label: `${v}`, value: v }));

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  // ── Line items table columns (per-phase, editable) ──
  const lineItemColumns = [
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Qty', dataIndex: 'quantity', key: 'qty', width: 70, align: 'right' as const,
      render: (v: number) => v?.toFixed(1) },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 50 },
    { title: 'Rate', dataIndex: 'unit_price', key: 'rate', width: 90, align: 'right' as const,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: 'Total', dataIndex: 'total', key: 'total', width: 100, align: 'right' as const,
      render: (v: number) => `$${v?.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
    { title: '', key: 'actions', width: 70, render: (_: any, record: any) => (
      <Space size={4}>
        <Button type="text" size="small" icon={<EditOutlined />}
          onClick={(e) => { e.stopPropagation(); setEditingItem({ ...record }); }} />
        <Popconfirm title="Delete this item?" onConfirm={() => lineItemMutation.mutate({ action: 'delete', itemId: record.id })}
          okButtonProps={{ loading: lineItemMutation.isPending }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    )},
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
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
        <Space wrap>
            <Button
              icon={<AuditOutlined />}
              onClick={() => setRegisterBidItemOpen(true)}
              disabled={!estimate || estimate.status === 'draft'}
              title="Register as Bid Item in Supplement"
            >
              Add to Supplement
            </Button>
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saveMutation.isPending}>
              Save
            </Button>
            <Button type="primary" icon={<CalculatorOutlined />} onClick={handleCalculate}
              loading={calculateMutation.isPending}>
              Calculate
            </Button>
            <Dropdown
              disabled={estimate?.status === 'draft'}
              menu={{
                items: [
                  {
                    key: 'pdf-detailed',
                    label: 'PDF - Detailed (with signature)',
                    icon: <FilePdfOutlined />,
                    onClick: async () => {
                      const doExport = () => {
                        const capture = (window as any).__beSketchCapture;
                        const sketchImage = typeof capture === 'function' ? capture() : undefined;
                        bathroomEstimateService.exportPdf(id!, {
                          sketch_image: sketchImage,
                          show_breakdown_prices: true,
                          show_signature: true,
                          address: estimate?.property_address,
                        });
                      };
                      try {
                        const result = await bathroomEstimateService.validateForExport(id!);
                        if (result.warnings.length > 0) {
                          Modal.confirm({
                            title: 'Material Allowance Warnings',
                            content: (
                              <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
                                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                              </ul>
                            ),
                            okText: 'Export Anyway',
                            cancelText: 'Cancel',
                            onOk: doExport,
                          });
                        } else {
                          doExport();
                        }
                      } catch { doExport(); }
                    },
                  },
                  {
                    key: 'pdf-detailed-nosig',
                    label: 'PDF - Detailed (no signature)',
                    icon: <FilePdfOutlined />,
                    onClick: async () => {
                      const doExport = () => {
                        const capture = (window as any).__beSketchCapture;
                        const sketchImage = typeof capture === 'function' ? capture() : undefined;
                        bathroomEstimateService.exportPdf(id!, {
                          sketch_image: sketchImage,
                          show_breakdown_prices: true,
                          show_signature: false,
                          address: estimate?.property_address,
                        });
                      };
                      try {
                        const result = await bathroomEstimateService.validateForExport(id!);
                        if (result.warnings.length > 0) {
                          Modal.confirm({
                            title: 'Material Allowance Warnings',
                            content: (
                              <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
                                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                              </ul>
                            ),
                            okText: 'Export Anyway',
                            cancelText: 'Cancel',
                            onOk: doExport,
                          });
                        } else {
                          doExport();
                        }
                      } catch { doExport(); }
                    },
                  },
                  { type: 'divider' as const },
                  {
                    key: 'pdf-clean',
                    label: 'PDF - Clean (with signature)',
                    icon: <FilePdfOutlined />,
                    onClick: async () => {
                      const doExport = () => {
                        const capture = (window as any).__beSketchCapture;
                        const sketchImage = typeof capture === 'function' ? capture() : undefined;
                        bathroomEstimateService.exportPdf(id!, {
                          sketch_image: sketchImage,
                          show_breakdown_prices: false,
                          show_signature: true,
                          address: estimate?.property_address,
                        });
                      };
                      try {
                        const result = await bathroomEstimateService.validateForExport(id!);
                        if (result.warnings.length > 0) {
                          Modal.confirm({
                            title: 'Material Allowance Warnings',
                            content: (
                              <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
                                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                              </ul>
                            ),
                            okText: 'Export Anyway',
                            cancelText: 'Cancel',
                            onOk: doExport,
                          });
                        } else {
                          doExport();
                        }
                      } catch { doExport(); }
                    },
                  },
                  {
                    key: 'pdf-clean-nosig',
                    label: 'PDF - Clean (no signature)',
                    icon: <FilePdfOutlined />,
                    onClick: async () => {
                      const doExport = () => {
                        const capture = (window as any).__beSketchCapture;
                        const sketchImage = typeof capture === 'function' ? capture() : undefined;
                        bathroomEstimateService.exportPdf(id!, {
                          sketch_image: sketchImage,
                          show_breakdown_prices: false,
                          show_signature: false,
                          address: estimate?.property_address,
                        });
                      };
                      try {
                        const result = await bathroomEstimateService.validateForExport(id!);
                        if (result.warnings.length > 0) {
                          Modal.confirm({
                            title: 'Material Allowance Warnings',
                            content: (
                              <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
                                {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                              </ul>
                            ),
                            okText: 'Export Anyway',
                            cancelText: 'Cancel',
                            onOk: doExport,
                          });
                        } else {
                          doExport();
                        }
                      } catch { doExport(); }
                    },
                  },
                ],
              }}
            >
              <Button icon={<FilePdfOutlined />}>
                PDF <DownOutlined />
              </Button>
            </Dropdown>
            <Button icon={<CopyOutlined />} onClick={() => cloneMutation.mutate()}>
              Clone
            </Button>
            <Button icon={<BookOutlined />} onClick={() => setGuideOpen(true)}>
              Guide
            </Button>
        </Space>
      </div>

      <Modal
        title="Plumbing & Electrical Guide"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={null}
        width={720}
      >
        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
          <Title level={5}>Plumbing (Phase 2)</Title>
          <Table
            size="small"
            pagination={false}
            dataSource={[
              { key: '1', item: 'Shutoff Valve', when: '15yr+ homes nearly always. Toilet×1 + Vanity×2 = 3', cost: '$135/EA' },
              { key: '2', item: 'Supply Line', when: 'Replace with valve. Same count as valves', cost: '$65/EA' },
              { key: '3', item: 'Drain Modification', when: 'Tub→Shower conversion, vanity relocation', cost: '$350/EA' },
              { key: '4', item: 'Pressure Balance Valve', when: 'All shower remodels (code required)', cost: '$425/EA' },
              { key: '5', item: 'Rough Inspection', when: 'Any plumbing work (county inspection)', cost: '$150/EA' },
            ]}
            columns={[
              { title: 'Item', dataIndex: 'item', width: 170 },
              { title: 'When Needed', dataIndex: 'when' },
              { title: 'Cost', dataIndex: 'cost', width: 90, align: 'right' as const },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Electrical (Phase 2)</Title>
          <Table
            size="small"
            pagination={false}
            dataSource={[
              { key: '1', item: 'GFCI Outlet', when: 'Min 1 per bath (code). Dual sink = 2', cost: '$210/EA' },
              { key: '2', item: 'Vanity Light', when: 'Vanity replacement typically includes lighting', cost: '$185/EA' },
              { key: '3', item: 'Ceiling Fixture', when: 'Existing light replacement or addition', cost: '$195/EA' },
              { key: '4', item: 'Exhaust Fan', when: 'No window = code required. Recommend 80CFM', cost: '$325-695' },
              { key: '5', item: 'Fan Switch', when: 'Upgrade: standard / timer / humidity sensor', cost: '$35-125' },
              { key: '6', item: 'Heated Floor', when: 'Optional (client request)', cost: '$12/SF+$525' },
              { key: '7', item: 'Elec. Inspection', when: 'Any electrical work (county inspection)', cost: '$125/EA' },
            ]}
            columns={[
              { title: 'Item', dataIndex: 'item', width: 140 },
              { title: 'When Needed', dataIndex: 'when' },
              { title: 'Cost', dataIndex: 'cost', width: 100, align: 'right' as const },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Common Scenarios</Title>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ margin: '4px 0' }}><Tag color="blue">Basic</Tag> Toilet + Vanity only: Valve×3 + Supply×3 + GFCI + Fan 80CFM = <strong>~$1,420</strong></p>
            <p style={{ margin: '4px 0' }}><Tag color="green">Standard</Tag> + Shower: + Pressure Balance + Vanity Light = <strong>~$2,030</strong></p>
            <p style={{ margin: '4px 0' }}><Tag color="orange">Full</Tag> + Heated Floor 50SF: + GFCI×2 + Heated + Inspections = <strong>~$3,680</strong></p>
          </div>
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5}>Auto-Set Rules</Title>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <p style={{ margin: '4px 0' }}>Shower Replace → <Tag>pressure_balance_valve</Tag> <Tag>valve×1</Tag></p>
            <p style={{ margin: '4px 0' }}>Toilet Replace → <Tag>valve×1</Tag> <Tag>supply×1</Tag></p>
            <p style={{ margin: '4px 0' }}>Vanity Replace → <Tag>valve×2</Tag> <Tag>supply×2</Tag></p>
            <p style={{ margin: '4px 0' }}>All Remodels → <Tag color="red">GFCI ≥ 1</Tag> <Tag color="red">exhaust fan</Tag></p>
            <p style={{ margin: '4px 0' }}>Custom Tile Shower → <Tag>rough_inspection</Tag></p>
          </div>
        </div>
      </Modal>

      <Form form={form} layout="vertical" size="small">
        <Tabs activeKey={activeTab} onChange={setActiveTab} destroyOnHidden={false} items={[
          // ════════ TAB 1: Project Info ════════
          {
            key: 'project',
            forceRender: true,
            label: 'Project Info',
            children: (
              <Card>
                <Divider orientation="left">Company</Divider>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Company" name="company_id">
                      <Select
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        placeholder="Select company..."
                        allowClear
                        options={(companyResults || []).map((c: any) => ({
                          label: c.name,
                          value: c.id,
                        }))}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Divider orientation="left">Client / Claim</Divider>
                <Row gutter={16}>
                  <Col xs={24} sm={12} md={8}>
                    <Form.Item label="Client" name="claim_id">
                      <Select
                        showSearch
                        filterOption={false}
                        onSearch={setClientSearch}
                        onChange={handleClaimSelect}
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
                      <AddressAutocomplete
                        onSelect={(addr) => form.setFieldsValue({
                          city: addr.city,
                          state: addr.state,
                          zip_code: addr.zip,
                        })}
                      />
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
            forceRender: true,
            label: 'Demo Scope',
            children: (
              <Card>
                <Divider orientation="left" plain>Demolition Areas</Divider>
                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev.demo_ceiling !== cur.demo_ceiling ||
                  prev.floor_spec?.material !== cur.floor_spec?.material ||
                  prev.replace_shower !== cur.replace_shower ||
                  prev.shower_spec?.type !== cur.shower_spec?.type ||
                  prev.bathtub_spec?.surround_tile !== cur.bathtub_spec?.surround_tile
                }>
                  {() => {
                    const hasFloorMaterial = !!form.getFieldValue(['floor_spec', 'material']);
                    const showerType = form.getFieldValue(['shower_spec', 'type']);
                    const hasCustomShower = form.getFieldValue('replace_shower') && (showerType === 'custom_tile' || showerType === 'curbless');
                    const hasSurroundTile = !!form.getFieldValue(['bathtub_spec', 'surround_tile']);
                    const autoFloor = hasFloorMaterial;
                    const autoWalls = hasCustomShower || hasSurroundTile;
                    const autoLabel = <Tag color="blue" style={{ marginLeft: 4, fontSize: 10, lineHeight: '16px' }}>auto</Tag>;
                    return (
                      <Row gutter={16} align="middle">
                        {autoFloor && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item
                              label={<>{`Floor SF`}{autoLabel}</>}
                              name="demo_floor_sf"
                              style={{ marginBottom: 8 }}
                            >
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        {autoWalls && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item
                              label={<>{`Wall SF`}{autoLabel}</>}
                              name="demo_wall_sf"
                              style={{ marginBottom: 8 }}
                            >
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        <Col xs={12} sm={6} md={4}>
                          <Form.Item name="demo_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Ceiling</Checkbox>
                          </Form.Item>
                        </Col>
                        {form.getFieldValue('demo_ceiling') && (
                          <Col xs={12} sm={8} md={5}>
                            <Form.Item label="Ceiling SF" name="demo_ceiling_sf" style={{ marginBottom: 8 }}>
                              <InputNumber style={{ width: '100%' }} min={0} placeholder="= room SF" />
                            </Form.Item>
                          </Col>
                        )}
                        {!autoFloor && !autoWalls && (
                          <Col span={24}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Floor and wall demo are auto-included when floor material or tile shower/surround is set.
                            </Text>
                          </Col>
                        )}
                      </Row>
                    );
                  }}
                </Form.Item>

                <Divider orientation="left" plain>Fixture Scope</Divider>
                <Form.Item noStyle shouldUpdate={(prev: any, cur: any) =>
                  prev.replace_shower !== cur.replace_shower ||
                  prev.replace_tub !== cur.replace_tub ||
                  prev.replace_vanity !== cur.replace_vanity ||
                  prev.replace_toilet !== cur.replace_toilet ||
                  prev.detach_reset_shower !== cur.detach_reset_shower ||
                  prev.detach_reset_tub !== cur.detach_reset_tub ||
                  prev.detach_reset_vanity !== cur.detach_reset_vanity ||
                  prev.detach_reset_toilet !== cur.detach_reset_toilet ||
                  prev.replace_mirror !== cur.replace_mirror ||
                  prev.detach_reset_mirror !== cur.detach_reset_mirror ||
                  prev.replace_vanity_light !== cur.replace_vanity_light ||
                  prev.detach_reset_vanity_light !== cur.detach_reset_vanity_light
                }>
                  {() => {
                    const getAction = (fixture: string) => {
                      if (form.getFieldValue(`replace_${fixture}`)) return 'replace';
                      if (form.getFieldValue(`detach_reset_${fixture}`)) return 'detach_reset';
                      return 'none';
                    };
                    const setAction = (fixture: string, action: string) => {
                      const updates: Record<string, any> = {
                        [`replace_${fixture}`]: action === 'replace',
                        [`detach_reset_${fixture}`]: action === 'detach_reset',
                      };
                      if (fixture === 'tub' && action === 'replace') {
                        const spec = form.getFieldValue('bathtub_spec') || {};
                        if (spec.curtain_rod === undefined || spec.curtain_rod === null) {
                          updates.bathtub_spec = { ...spec, curtain_rod: true };
                        }
                      }
                      form.setFieldsValue(updates);
                    };
                    return (
                      <Row gutter={[16, 8]}>
                        {[
                          ['shower', 'Shower'],
                          ['tub', 'Bathtub'],
                          ['vanity', 'Vanity'],
                          ['toilet', 'Toilet'],
                        ].map(([key, label]) => (
                          <Col xs={24} sm={12} md={6} key={key}>
                            <div style={{ marginBottom: 8 }}>
                              <Text strong style={{ display: 'block', marginBottom: 4 }}>{label}</Text>
                              <Radio.Group
                                value={getAction(key)}
                                onChange={(e) => setAction(key, e.target.value)}
                                size="small"
                              >
                                <Radio.Button value="none">None</Radio.Button>
                                <Radio.Button value="replace">Replace</Radio.Button>
                                <Radio.Button value="detach_reset">D&R</Radio.Button>
                              </Radio.Group>
                            </div>
                          </Col>
                        ))}
                        {form.getFieldValue('replace_vanity') && (
                          <>
                            <Col xs={24} sm={12} md={6}>
                              <div style={{ marginBottom: 8 }}>
                                <Text strong style={{ display: 'block', marginBottom: 4 }}>Mirror</Text>
                                <Radio.Group
                                  value={
                                    form.getFieldValue('replace_mirror') ? 'replace' :
                                    form.getFieldValue('detach_reset_mirror') ? 'detach_reset' : 'none'
                                  }
                                  onChange={(e) => {
                                    form.setFieldsValue({
                                      replace_mirror: e.target.value === 'replace',
                                      detach_reset_mirror: e.target.value === 'detach_reset',
                                    });
                                  }}
                                  size="small"
                                >
                                  <Radio.Button value="none">None</Radio.Button>
                                  <Radio.Button value="replace">New</Radio.Button>
                                  <Radio.Button value="detach_reset">D&R</Radio.Button>
                                </Radio.Group>
                              </div>
                            </Col>
                            <Col xs={24} sm={12} md={6}>
                              <div style={{ marginBottom: 8 }}>
                                <Text strong style={{ display: 'block', marginBottom: 4 }}>Vanity Light</Text>
                                <Radio.Group
                                  value={
                                    form.getFieldValue('replace_vanity_light') ? 'replace' :
                                    form.getFieldValue('detach_reset_vanity_light') ? 'detach_reset' : 'none'
                                  }
                                  onChange={(e) => {
                                    form.setFieldsValue({
                                      replace_vanity_light: e.target.value === 'replace',
                                      detach_reset_vanity_light: e.target.value === 'detach_reset',
                                    });
                                  }}
                                  size="small"
                                >
                                  <Radio.Button value="none">None</Radio.Button>
                                  <Radio.Button value="replace">New</Radio.Button>
                                  <Radio.Button value="detach_reset">D&R</Radio.Button>
                                </Radio.Group>
                              </div>
                            </Col>
                          </>
                        )}
                      </Row>
                    );
                  }}
                </Form.Item>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                  Replace = new fixture (material + labor) | D&R = Detach & Reset (labor only, reinstall same fixture)
                </Text>

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

                <Form.Item noStyle shouldUpdate={(prev, cur) =>
                  prev.water_damage !== cur.water_damage ||
                  prev.demo_already_done !== cur.demo_already_done ||
                  prev.repair_drywall_walls !== cur.repair_drywall_walls ||
                  prev.repair_drywall_ceiling !== cur.repair_drywall_ceiling ||
                  prev.repair_subfloor !== cur.repair_subfloor ||
                  prev.demo_cement_board !== cur.demo_cement_board
                }>
                  {() => form.getFieldValue('water_damage') ? (
                    <>
                      <Row gutter={[16, 8]} style={{ marginBottom: 8 }}>
                        <Col xs={24} sm={16} md={12}>
                          <Form.Item
                            name="water_damage_source"
                            label="Damage Source (plumber already repaired)"
                            style={{ marginBottom: 8 }}
                            tooltip="Plumbing for this fixture is excluded from the estimate"
                          >
                            <Select allowClear placeholder="Select damage source">
                              <Select.Option value="shower">Shower</Select.Option>
                              <Select.Option value="bathtub">Bathtub</Select.Option>
                              <Select.Option value="vanity">Vanity / Sink</Select.Option>
                              <Select.Option value="toilet">Toilet</Select.Option>
                              <Select.Option value="supply_line">Supply Line</Select.Option>
                              <Select.Option value="other">Other</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>

                      <Divider orientation="left" plain>Water Damage Repair</Divider>
                      <Row gutter={[16, 8]} style={{ marginBottom: 8 }}>
                        <Col xs={24}>
                          <Form.Item name="demo_already_done" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Demo Already Completed (by mitigation team)</Checkbox>
                          </Form.Item>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                            {form.getFieldValue('demo_already_done')
                              ? 'Demo costs will be excluded. Check areas above that were already demolished, then select repairs needed below.'
                              : 'Uncheck if demo has not been done yet — demo costs will be included in the estimate.'}
                          </Text>
                        </Col>
                      </Row>
                      <Row gutter={16} align="middle">
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_drywall_walls" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Walls (Drywall)</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_drywall_walls') ? undefined : 'none' }}>
                          <Form.Item label="Wall SF" name="repair_drywall_walls_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_drywall_ceiling" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Ceiling (Drywall)</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_drywall_ceiling') ? undefined : 'none' }}>
                          <Form.Item label="Ceiling SF" name="repair_drywall_ceiling_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="repair_subfloor" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Repair Subfloor</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('repair_subfloor') ? undefined : 'none' }}>
                          <Form.Item label="Floor SF" name="repair_subfloor_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                        Leave SF blank to use bathroom dimensions. Walls use moisture-resistant drywall; ceiling uses mold-resistant when water damage present.
                      </Text>

                      <Row gutter={16} align="middle" style={{ marginTop: 4 }}>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name="demo_cement_board" valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Cement Board Repair</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={4} style={{ display: form.getFieldValue('demo_cement_board') ? undefined : 'none' }}>
                          <Form.Item label="Damaged SF" name="demo_cement_board_sf" style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} placeholder="SF" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={16} md={10} style={{ display: form.getFieldValue('demo_cement_board') ? undefined : 'none' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Damaged section will be removed and replaced with new Durock. Only the damaged area + overlap to nearest studs is replaced — undamaged board is reused.
                          </Text>
                        </Col>
                      </Row>
                    </>
                  ) : null}
                </Form.Item>

              </Card>
            ),
          },

          // ════════ TAB 3: Sketch ════════
          {
            key: 'sketch',
            forceRender: true,
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
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ height: 700 }}>
                  <BESketchTab
                    estimateId={id!}
                    estimateData={form.getFieldsValue()}
                    initialSketchData={estimate?.sketch_data as any}
                    isActive={activeTab === 'sketch'}
                    onSketchChange={handleSketchChange}
                    onFixtureSync={handleFixtureSync}
                  />
                </div>
              </Card>
            ),
          },

          // ════════ TAB 4: Shower & Tub ════════
          {
            key: 'shower_tub',
            forceRender: true,
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
                        <Form.Item label="Door Type" name={['shower_spec', 'door_type']}>
                          <Select options={selectOpts(pricingInfo?.shower_door_types)} allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Door Opening (in)" name={['shower_spec', 'door_width_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 60" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Showerhead" name={['shower_spec', 'showerhead_type']}>
                          <Select options={selectOpts(pricingInfo?.showerhead_types)} allowClear />
                        </Form.Item>
                      </Col>
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
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Width (in)" name={['shower_spec', 'width_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 60" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Depth (in)" name={['shower_spec', 'depth_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 36" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile Height (in)" name={['shower_spec', 'tile_height_in']}>
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="e.g. 84" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item label="Tile SF" name={['shower_spec', 'tile_spec', 'sf']}
                          tooltip="Leave blank to auto-calculate from dimensions">
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                        </Form.Item>
                      </Col>
                    </Row>
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
                        <Form.Item label="Tile Size" name={['shower_spec', 'tile_spec', 'size']}>
                          <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x24" />
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
                        <Form.Item name={['bathtub_spec', 'jetted']} valuePropName="checked">
                          <Checkbox>Jetted/Whirlpool</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['bathtub_spec', 'curtain_rod']} valuePropName="checked">
                          <Checkbox>Curtain Rod</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.bathtub_spec?.type !== cur?.bathtub_spec?.type ||
                      prev?.bathtub_spec?.surround_tile !== cur?.bathtub_spec?.surround_tile
                    }>
                      {() => form.getFieldValue(['bathtub_spec', 'type']) === 'drop_in' && (
                        <>
                          <Divider orientation="left" plain style={{ margin: '8px 0' }}>Surround Tile</Divider>
                          <Row gutter={16} align="middle">
                            <Col xs={12} sm={8} md={4}>
                              <Form.Item name={['bathtub_spec', 'surround_tile']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                <Checkbox>Surround Tile</Checkbox>
                              </Form.Item>
                            </Col>
                          </Row>
                          <div style={{ display: form.getFieldValue(['bathtub_spec', 'surround_tile']) ? undefined : 'none' }}>
                              <Row gutter={16} align="middle">
                                <Col xs={16} sm={10} md={6}>
                                  <Form.Item label="Tub Size" name={['bathtub_spec', 'tub_size_preset']} style={{ marginBottom: 8 }}>
                                    <Select
                                      placeholder="Select tub size"
                                      onChange={(val: string) => {
                                        const presets: Record<string, { length: number; depth: number; sf: number }> = {
                                          '60x30': { length: 60, depth: 30, sf: 60 },
                                          '60x32': { length: 60, depth: 32, sf: 62 },
                                          '66x32': { length: 66, depth: 32, sf: 65 },
                                          '66x36': { length: 66, depth: 36, sf: 69 },
                                          '72x36': { length: 72, depth: 36, sf: 72 },
                                          '72x42': { length: 72, depth: 42, sf: 78 },
                                          '60x42_corner': { length: 60, depth: 42, sf: 72 },
                                          '60x60_corner': { length: 60, depth: 60, sf: 90 },
                                        };
                                        const p = val ? presets[val] : null;
                                        if (p) {
                                          form.setFieldsValue({
                                            bathtub_spec: {
                                              ...form.getFieldValue('bathtub_spec'),
                                              tub_length_in: p.length,
                                              tub_depth_in: p.depth,
                                              surround_height_in: 72,
                                              surround_tile_sf: p.sf,
                                            },
                                          });
                                        }
                                      }}
                                      options={[
                                        { label: '60" × 30" (Standard) — 60 SF', value: '60x30' },
                                        { label: '60" × 32" — 62 SF', value: '60x32' },
                                        { label: '66" × 32" — 65 SF', value: '66x32' },
                                        { label: '66" × 36" (Large) — 69 SF', value: '66x36' },
                                        { label: '72" × 36" (XL) — 72 SF', value: '72x36' },
                                        { label: '72" × 42" (Soaking) — 78 SF', value: '72x42' },
                                        { label: '60" × 42" (Corner) — 72 SF', value: '60x42_corner' },
                                        { label: '60" × 60" (Corner/Garden) — 90 SF', value: '60x60_corner' },
                                      ]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col xs={8} sm={6} md={4}>
                                  <Form.Item label="Surround SF" name={['bathtub_spec', 'surround_tile_sf']} style={{ marginBottom: 8 }}
                                    tooltip={'3-wall surround, 72" height (standard)'}>
                                    <InputNumber style={{ width: '100%' }} min={0} addonAfter="SF" />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Row gutter={16}>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Material" name={['bathtub_spec', 'surround_tile_material']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear placeholder="porcelain" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Pattern" name={['bathtub_spec', 'surround_tile_pattern']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear placeholder="straight" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Size" name={['bathtub_spec', 'surround_tile_size']} style={{ marginBottom: 8 }}>
                                    <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x24" />
                                  </Form.Item>
                                </Col>
                              </Row>
                          </div>
                        </>
                      )}
                    </Form.Item>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 4: Vanity & Toilet ════════
          {
            key: 'vanity_toilet',
            forceRender: true,
            label: 'Vanity & Toilet',
            children: (
              <Card>
                <Collapse defaultActiveKey={['vanity', 'toilet']}>
                  <Panel header="Vanity" key="vanity">
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', borderRadius: 4, fontSize: 11, color: '#666' }}>
                      <Text strong style={{ fontSize: 12 }}>Vanity Complete includes:</Text>
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                        <span>🪵 Cabinet (source/size)</span>
                        <span>🪨 Countertop + sink(s)</span>
                        <span>🚰 Faucet + drain</span>
                        <span>🪞 Mirror</span>
                        <span>🔧 Mounting hardware</span>
                        <span>📐 Supply lines + shutoffs</span>
                      </div>
                    </div>
                    <Form.List name={['vanity_spec', 'items']}>
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...restField }, idx) => (
                            <Card
                              key={key}
                              size="small"
                              title={`Vanity ${idx + 1}`}
                              style={{ marginBottom: 12 }}
                              extra={fields.length > 1 && (
                                <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)} />
                              )}
                            >
                              <Row gutter={16}>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Width" {...restField} name={[name, 'width']}>
                                    <Select options={numOpts(pricingInfo?.vanity_widths)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Sinks" {...restField} name={[name, 'sinks']}>
                                    <Select options={[{ label: '1', value: 1 }, { label: '2', value: 2 }]} />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Source" {...restField} name={[name, 'source']}>
                                    <Select options={selectOpts(pricingInfo?.vanity_sources)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Countertop" {...restField} name={[name, 'top_material']}>
                                    <Select options={selectOpts(pricingInfo?.vanity_top_materials)} allowClear />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Row gutter={16}>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Mounting" {...restField} name={[name, 'mounting']}>
                                    <Select options={selectOpts(pricingInfo?.vanity_mountings)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Faucet Type" {...restField} name={[name, 'faucet_type']}>
                                    <Select options={selectOpts(pricingInfo?.faucet_types)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Mirror" {...restField} name={[name, 'mirror_type']}>
                                    <Select options={selectOpts(pricingInfo?.mirror_types)} allowClear />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          <Button type="dashed" onClick={() => add({ sinks: 1 })} block icon={<PlusOutlined />}>
                            Add Vanity
                          </Button>
                        </>
                      )}
                    </Form.List>
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
            forceRender: true,
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
                          <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear placeholder="12x24" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['floor_spec', 'heated_floor']} valuePropName="checked">
                          <Checkbox>Heated Floor</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                  <Panel header="Walls & Paint / Tile" key="walls">
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.wall_sf !== cur?.wall_sf || prev?.paint_wall_sf !== cur?.paint_wall_sf
                    }>
                      {({ getFieldValue }) => {
                        const wallSF = getFieldValue('wall_sf');
                        const paintSF = getFieldValue('paint_wall_sf');
                        return wallSF ? (
                          <div style={{ marginBottom: 12, padding: '6px 12px', background: '#f6f6f6', borderRadius: 4, fontSize: 12 }}>
                            Total Wall: <strong>{wallSF} SF</strong>
                            {paintSF != null && paintSF !== wallSF && (
                              <span style={{ marginLeft: 12 }}>
                                Paintable: <strong>{paintSF} SF</strong>
                                <span style={{ color: '#999', marginLeft: 4 }}>
                                  (−{Math.round((wallSF - paintSF) * 10) / 10} SF covered by shower/tub)
                                </span>
                              </span>
                            )}
                          </div>
                        ) : null;
                      }}
                    </Form.Item>
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={8}>
                        <Form.Item label="Wall Finish" name={['walls_spec', 'wall_finish']}>
                          <Select
                            allowClear
                            placeholder="Select wall finish"
                            onChange={(v) => {
                              // Clear conflicting fields when switching
                              if (v === 'paint') {
                                form.setFieldsValue({ walls_spec: { tile_walls: false } });
                              } else if (v === 'tile') {
                                form.setFieldsValue({ walls_spec: { paint_walls: false } });
                              }
                            }}
                            options={[
                              { label: 'Paint', value: 'paint' },
                              { label: 'Tile', value: 'tile' },
                              { label: 'Paint + Tile (partial)', value: 'paint_and_tile' },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        <Form.Item name={['walls_spec', 'paint_ceiling']} valuePropName="checked">
                          <Checkbox>Paint Ceiling</Checkbox>
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item label="Baseboard" name={['walls_spec', 'baseboard_material']}>
                          <Select allowClear options={[
                            { label: 'Standard (PVC)', value: 'pvc' },
                            { label: 'Tile Base', value: 'tile' },
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.walls_spec?.wall_finish !== cur?.walls_spec?.wall_finish
                    }>
                      {({ getFieldValue }) => {
                        const finish = getFieldValue(['walls_spec', 'wall_finish']);
                        const showPaint = finish === 'paint' || finish === 'paint_and_tile';
                        const showTile = finish === 'tile' || finish === 'paint_and_tile';
                        return (
                          <>
                            {showPaint && (
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Paint Grade" name={['walls_spec', 'paint_grade']}>
                                    <Select options={selectOpts(pricingInfo?.paint_grades)} allowClear />
                                  </Form.Item>
                                </Col>
                                {finish === 'paint_and_tile' && (
                                  <Col xs={12} sm={8} md={4}>
                                    <Form.Item label="Paint SF" name={['walls_spec', 'paint_wall_sf']}
                                      tooltip="Wall area to paint (excluding tiled portions)">
                                      <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                                    </Form.Item>
                                  </Col>
                                )}
                              </Row>
                            )}
                            {showTile && (
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Wall SF" name={['walls_spec', 'tile_wall_sf']}
                                    tooltip="Wall area to tile. Auto-filled from sketch.">
                                    <InputNumber style={{ width: '100%' }} min={0} placeholder="auto" />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Tile Material" name={['walls_spec', 'tile_material']}>
                                    <Select options={selectOpts(pricingInfo?.tile_materials)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={12} md={6}>
                                  <Form.Item label="Tile Pattern" name={['walls_spec', 'tile_pattern']}>
                                    <Select options={selectOpts(pricingInfo?.tile_patterns)} allowClear />
                                  </Form.Item>
                                </Col>
                                <Col xs={12} sm={8} md={4}>
                                  <Form.Item label="Tile Size" name={['walls_spec', 'tile_size']}>
                                    <Select options={selectOpts(pricingInfo?.tile_sizes)} allowClear />
                                  </Form.Item>
                                </Col>
                              </Row>
                            )}
                          </>
                        );
                      }}
                    </Form.Item>
                    <Row gutter={16}>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev?.walls_spec?.baseboard_material !== cur?.walls_spec?.baseboard_material
                      }>
                        {({ getFieldValue }) => {
                          const bbMat = getFieldValue(['walls_spec', 'baseboard_material']);
                          const hidden = !bbMat || bbMat === 'tile';
                          return (
                            <Col xs={12} sm={8} md={4} style={{ display: hidden ? 'none' : undefined }}>
                              <Form.Item name={['walls_spec', 'quarter_round']} valuePropName="checked">
                                <Checkbox>+ Quarter Round</Checkbox>
                              </Form.Item>
                            </Col>
                          );
                        }}
                      </Form.Item>
                    </Row>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Form.Item noStyle shouldUpdate={(prev, cur) =>
                        prev?.repair_drywall_walls !== cur?.repair_drywall_walls ||
                        prev?.repair_drywall_walls_sf !== cur?.repair_drywall_walls_sf
                      }>
                        {({ getFieldValue }) => {
                          const repairWallsActive = getFieldValue('repair_drywall_walls');
                          return repairWallsActive ? (
                            <Row gutter={16} style={{ marginBottom: 8 }}>
                              <Col span={24}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  <AuditOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                                  Drywall repair — "Water Damage Repair" 항목에서 이미 포함됨
                                  {getFieldValue('repair_drywall_walls_sf') ? ` (${getFieldValue('repair_drywall_walls_sf')} SF)` : ''}
                                </Text>
                              </Col>
                            </Row>
                          ) : (
                            <Row gutter={16}>
                              <Col xs={12} sm={8} md={5}>
                                <Form.Item name={['hidden_costs', 'drywall_patch']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                  <Checkbox>Drywall Patch</Checkbox>
                                </Form.Item>
                              </Col>
                              <Col xs={8} sm={6} md={4}>
                                <Form.Item label="SF" name={['hidden_costs', 'drywall_patch_sf']} style={{ marginBottom: 8 }}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={5}>
                                <Form.Item name={['hidden_costs', 'drywall_patch_full']} valuePropName="checked" style={{ marginBottom: 8 }}>
                                  <Checkbox>Full (hang, tape, mud, prime)</Checkbox>
                                </Form.Item>
                              </Col>
                            </Row>
                          );
                        }}
                      </Form.Item>
                      <Row gutter={16}>
                        <Col xs={12} sm={8} md={5}>
                          <Form.Item name={['hidden_costs', 'trim_paint']} valuePropName="checked" style={{ marginBottom: 8 }}>
                            <Checkbox>Trim Paint</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={8} sm={6} md={4}>
                          <Form.Item label="LF" name={['hidden_costs', 'trim_paint_lf']} style={{ marginBottom: 8 }}>
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Auto-include (uncheck to disable)</Text>
                      <Row gutter={[16, 4]}>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'auto_ceiling_paint']} valuePropName="checked"
                            style={{ marginBottom: 2 }}
                            tooltip="Auto-include ceiling paint when demo scope is set"
                          >
                            <Checkbox><Text style={{ fontSize: 12 }}>Ceiling paint</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'drywall_skim_coat']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Drywall skim coat</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'mold_resistant_drywall']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Mold-resistant drywall</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  </Panel>
                  <Panel header={
                    <Space size={6}>
                      Substrate
                      <Tooltip title={
                        <div>
                          <div>• Prefab Surround (One Piece / Kit) → Durock, Waterproofing 불필요</div>
                          <div>• Custom Tile / Curbless → Durock + Waterproofing 필수</div>
                          <div>• 바닥 타일 교체 → Floor Cement Board 필수 (자동 계산)</div>
                          <div>• Vanity / Toilet만 교체 → Substrate 불필요</div>
                        </div>
                      }>
                        <QuestionCircleOutlined style={{ color: '#999', fontSize: 14 }} />
                      </Tooltip>
                    </Space>
                  } key="substrate">
                    <Form.Item noStyle shouldUpdate={(prev, cur) =>
                      prev?.shower_spec?.type !== cur?.shower_spec?.type ||
                      prev?.shower_spec?.tile_spec?.sf !== cur?.shower_spec?.tile_spec?.sf ||
                      prev?.shower_spec?.width_in !== cur?.shower_spec?.width_in ||
                      prev?.shower_spec?.depth_in !== cur?.shower_spec?.depth_in ||
                      prev?.shower_spec?.tile_height_in !== cur?.shower_spec?.tile_height_in ||
                      prev?.bathtub_spec?.surround_tile_sf !== cur?.bathtub_spec?.surround_tile_sf ||
                      prev?.bathtub_spec?.surround_tile !== cur?.bathtub_spec?.surround_tile ||
                      prev?.replace_shower !== cur?.replace_shower ||
                      prev?.floor_spec?.material !== cur?.floor_spec?.material ||
                      prev?.floor_sf !== cur?.floor_sf ||
                      prev?.length_ft !== cur?.length_ft ||
                      prev?.width_ft !== cur?.width_ft
                    }>
                      {() => {
                        // Auto-calculate wet-area SF from shower/tub
                        const vals = form.getFieldsValue();
                        let wetSF = 0;
                        if (vals.replace_shower && vals.shower_spec?.type === 'custom_tile') {
                          const ts = vals.shower_spec?.tile_spec?.sf;
                          if (ts) {
                            wetSF += ts;
                          } else {
                            const sw = vals.shower_spec?.width_in || 0;
                            const sd = vals.shower_spec?.depth_in || 0;
                            const sh = vals.shower_spec?.tile_height_in || 0;
                            if (sw && sd && sh) wetSF += (sw + 2 * sd) * sh / 144;
                          }
                        }
                        if (vals.bathtub_spec?.surround_tile) {
                          wetSF += vals.bathtub_spec?.surround_tile_sf || 0;
                        }
                        wetSF = Math.round(wetSF * 10) / 10;

                        return (
                          <>
                            {wetSF > 0 && (
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                                Auto-calculated from tile areas: Shower + Tub Surround = <Text strong>{wetSF} SF</Text> (Durock & Waterproofing).
                                Leave blank to use auto value, or enter to override.
                              </Text>
                            )}
                            <Row gutter={16}>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Durock SF<Tooltip title={`Cement backer board for wet areas. ${wetSF > 0 ? `Auto: ${wetSF} SF from shower/tub tile areas.` : 'Enter manually.'} Override if needed.`}><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'durock_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder={wetSF > 0 ? `auto: ${wetSF}` : '0'} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Greenboard SF<Tooltip title="Moisture-resistant drywall. Used on bathroom walls/ceilings not directly in wet areas."><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'greenboard_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={12} md={6}>
                                <Form.Item label="Waterproofing" name={['substrate_spec', 'waterproof_type']}>
                                  <Select
                                    options={selectOpts(pricingInfo?.waterproof_types)}
                                    allowClear
                                    placeholder="RedGard (default)"
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8} md={4}>
                                <Form.Item label={<Space size={4}>Waterproof SF<Tooltip title={`Waterproofing area. ${wetSF > 0 ? `Auto: same as Durock (${wetSF} SF).` : 'Enter manually.'}`}><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip></Space>} name={['substrate_spec', 'waterproof_sf']}>
                                  <InputNumber style={{ width: '100%' }} min={0} placeholder={wetSF > 0 ? `auto: ${wetSF}` : '0'} />
                                </Form.Item>
                              </Col>
                            </Row>
                          </>
                        );
                      }}
                    </Form.Item>
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
            forceRender: true,
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
                    <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12 }}>
                      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Auto-include (uncheck to disable)</Text>
                      <Row gutter={[16, 4]}>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'auto_gfci']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>GFCI outlet</Text></Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={8} md={6}>
                          <Form.Item name={['hidden_costs', 'auto_exhaust_fan']} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>Exhaust fan</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  </Panel>
                  <Panel header="Permit Triggers" key="permits">
                    <Row gutter={[16, 4]}>
                      {[
                        ['valve_body_replace', 'Shower valve body replacement'],
                        ['fixture_relocation', 'Fixture location change'],
                        ['new_plumbing_line', 'New plumbing line'],
                        ['new_electrical_circuit', 'New electrical circuit'],
                      ].map(([key, label]) => (
                        <Col xs={12} sm={12} key={key}>
                          <Form.Item name={['hidden_costs', key]} valuePropName="checked" style={{ marginBottom: 2 }}>
                            <Checkbox><Text style={{ fontSize: 12 }}>{label}</Text></Checkbox>
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                      Check items that trigger permit requirements. Permit fee auto-included when any trigger is checked.
                    </Text>
                  </Panel>
                </Collapse>
              </Card>
            ),
          },

          // ════════ TAB 7: Accessories & Costs ════════
          {
            key: 'accessories',
            forceRender: true,
            label: 'Accessories & Costs',
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
                  <Panel header="Optional Costs" key="optional-costs">
                    <Row gutter={[16, 8]}>
                      <Col xs={12} sm={12} md={6}>
                        <Form.Item name={['hidden_costs', 'mobilization']} valuePropName="checked" style={{ marginBottom: 4 }}>
                          <Checkbox>Mobilization / Setup</Checkbox>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                      Dumpster, floor protection, caulking, and final clean are always included in the estimate.
                    </Text>
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
                    <Divider orientation="left" plain><AimOutlined /> Target Total (Reverse Pricing)</Divider>
                    <Alert
                      message="Set a desired total and all line items will scale proportionally when you Calculate. The final total will always meet or exceed the target."
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
                            placeholder="e.g. 12000"
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={12} sm={8} md={4}>
                        {estimate?.adjustment_factor && (
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
            forceRender: true,
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

                    {estimate?.target_total && estimate?.adjustment_factor && (
                      <Alert
                        message={`Target: $${estimate.target_total.toLocaleString()} | Factor: ${estimate.adjustment_factor.toFixed(4)}x`}
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                      />
                    )}

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

                    {/* Detailed line items grouped by phase */}
                    <Collapse
                      defaultActiveKey={phaseSummary.map(p => String(p.phase))}
                      style={{ background: 'transparent' }}
                    >
                      {phaseSummary.map(p => {
                        const phaseItems = lineItems.filter(li => li.phase === p.phase);
                        return (
                          <Panel
                            header={
                              <Row justify="space-between" align="middle" style={{ width: '100%', paddingRight: 8 }}>
                                <Col><Text strong>Phase {p.phase}: {p.label}</Text> <Tag>{p.count} items</Tag></Col>
                                <Col>
                                  <Space>
                                    <Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                                    <Popconfirm
                                      title={`Delete Phase ${p.phase}: ${p.label}?`}
                                      description="All items in this phase will be removed and remaining phases will be renumbered."
                                      onConfirm={(e) => { e?.stopPropagation(); lineItemMutation.mutate({ action: 'deletePhase', phase: p.phase }); }}
                                      onCancel={(e) => e?.stopPropagation()}
                                      okButtonProps={{ danger: true, loading: lineItemMutation.isPending }}
                                    >
                                      <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                        onClick={(e) => e.stopPropagation()} />
                                    </Popconfirm>
                                  </Space>
                                </Col>
                              </Row>
                            }
                            key={String(p.phase)}
                          >
                            <Table
                              columns={lineItemColumns}
                              dataSource={phaseItems}
                              rowKey="id"
                              size="small"
                              pagination={false}
                              scroll={{ x: 600 }}
                              summary={() => (
                                <Table.Summary.Row>
                                  <Table.Summary.Cell index={0} colSpan={4}>
                                    <Text strong>Phase {p.phase} Subtotal</Text>
                                  </Table.Summary.Cell>
                                  <Table.Summary.Cell index={4} align="right">
                                    <Text strong>${p.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                                  </Table.Summary.Cell>
                                  <Table.Summary.Cell index={5} />
                                </Table.Summary.Row>
                              )}
                            />
                            <Button type="dashed" size="small" icon={<PlusOutlined />}
                              style={{ marginTop: 8 }}
                              onClick={() => setAddingPhase(p.phase)}>
                              Add Item
                            </Button>
                          </Panel>
                        );
                      })}
                    </Collapse>

                    {/* Edit Line Item Modal */}
                    <Modal
                      title="Edit Line Item"
                      open={!!editingItem}
                      onCancel={() => setEditingItem(null)}
                      onOk={() => {
                        if (!editingItem) return;
                        const { id: itemId, estimate_id: _eid, created_at: _ca, display_order: _do, ...updates } = editingItem;
                        updates.total = round2(updates.quantity * updates.unit_price);
                        lineItemMutation.mutate({ action: 'update', itemId, data: updates });
                      }}
                      confirmLoading={lineItemMutation.isPending}
                      destroyOnHidden
                    >
                      {editingItem && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Description</Text>
                            <Input value={editingItem.description}
                              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })} />
                          </div>
                          <Row gutter={12}>
                            <Col span={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Phase</Text>
                              <InputNumber style={{ width: '100%' }} min={1} max={10}
                                value={editingItem.phase}
                                onChange={(v) => setEditingItem({ ...editingItem, phase: v })} />
                            </Col>
                            <Col span={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Qty</Text>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.1}
                                value={editingItem.quantity}
                                onChange={(v) => setEditingItem({ ...editingItem, quantity: v })} />
                            </Col>
                            <Col span={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Unit</Text>
                              <Select style={{ width: '100%' }} value={editingItem.unit}
                                onChange={(v) => setEditingItem({ ...editingItem, unit: v })}
                                options={['EA', 'SF', 'LF', 'HR', 'LS'].map(u => ({ label: u, value: u }))} />
                            </Col>
                            <Col span={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Rate</Text>
                              <InputNumber style={{ width: '100%' }} min={0} step={1} prefix="$"
                                value={editingItem.unit_price}
                                onChange={(v) => setEditingItem({ ...editingItem, unit_price: v })} />
                            </Col>
                          </Row>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Total: <Text strong>${round2((editingItem.quantity || 0) * (editingItem.unit_price || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                            </Text>
                          </div>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Notes</Text>
                            <Input value={editingItem.notes || ''}
                              onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </Modal>

                    {/* Add Line Item Modal */}
                    <Modal
                      title={`Add Item to Phase ${addingPhase}`}
                      open={addingPhase !== null}
                      onCancel={() => setAddingPhase(null)}
                      onOk={() => {
                        if (addingPhase === null) return;
                        const descEl = document.getElementById('add-li-desc') as HTMLInputElement;
                        const qtyEl = document.getElementById('add-li-qty') as HTMLInputElement;
                        const rateEl = document.getElementById('add-li-rate') as HTMLInputElement;
                        const unitEl = document.getElementById('add-li-unit') as HTMLInputElement;
                        const notesEl = document.getElementById('add-li-notes') as HTMLInputElement;
                        const desc = descEl?.value?.trim();
                        if (!desc) { message.warning('Description is required'); return; }
                        const qty = parseFloat(qtyEl?.value) || 1;
                        const rate = parseFloat(rateEl?.value) || 0;
                        lineItemMutation.mutate({
                          action: 'add',
                          data: {
                            phase: addingPhase,
                            description: desc,
                            quantity: qty,
                            unit: unitEl?.value || 'EA',
                            unit_price: rate,
                            notes: notesEl?.value || undefined,
                          },
                        });
                      }}
                      confirmLoading={lineItemMutation.isPending}
                      destroyOnHidden
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>Description *</Text>
                          <Input id="add-li-desc" placeholder="Line item description" />
                        </div>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Qty</Text>
                            <Input id="add-li-qty" defaultValue="1" type="number" />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Unit</Text>
                            <Input id="add-li-unit" defaultValue="EA" />
                          </Col>
                          <Col span={8}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Rate ($)</Text>
                            <Input id="add-li-rate" defaultValue="0" type="number" />
                          </Col>
                        </Row>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>Notes</Text>
                          <Input id="add-li-notes" placeholder="Optional notes" />
                        </div>
                      </div>
                    </Modal>
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

      {estimate && registerBidItemOpen && (
        <React.Suspense fallback={null}>
          <RegisterBidItemModal
            open={registerBidItemOpen}
            onClose={() => setRegisterBidItemOpen(false)}
            estimateType="bathroom"
            estimateId={estimate.id}
            claimId={estimate.claim_id}
            defaultTitle={
              estimate.designation
                ? `${estimate.designation} Bathroom${estimate.property_address ? ` — ${estimate.property_address}` : ''}`
                : estimate.property_address || 'Bathroom Estimate'
            }
            defaultAmount={estimate.total}
          />
        </React.Suspense>
      )}
    </div>
  );
};

export default BathroomEstimateDetail;
