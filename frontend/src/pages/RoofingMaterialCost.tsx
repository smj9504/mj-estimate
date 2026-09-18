/**
 * Roofing Material Cost — INTERNAL ONLY
 *
 * The estimate itself is priced at installed rates, where material and
 * labor are one number. This screen is the other half: what the material
 * actually costs us, so expected profit can be reasoned about.
 *
 * Quantities are derived from the roof measurements on the estimate, so
 * nothing here is typed in by hand — only unit costs are editable, and
 * only when the real supplier price differs from the default.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  LockOutlined,
  PushpinOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { roofingEstimateService } from '../services/roofingEstimateService';
import type {
  MaterialCostBreakdown,
  RoofingJobCostInputs,
  MaterialCostItem,
  MaterialCostOverride,
  MaterialPriceEntry,
} from '../types/roofingEstimate';

const { Title, Text } = Typography;

const TAX_PRESETS = [
  { label: 'MD — 6%', value: 0.06 },
  { label: 'VA — 5.3%', value: 0.053 },
  { label: 'DC — 6%', value: 0.06 },
  { label: 'Tax exempt — 0%', value: 0 },
];

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/** Unit costs are per-unit and often sub-dollar, so they need more precision. */
const unitMoney = (v: number) =>
  `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  })}`;

const RoofingMaterialCost: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Edits are staged locally so a half-finished table isn't saved.
  const [drafts, setDrafts] = useState<Record<string, MaterialCostOverride>>({});
  const [taxRate, setTaxRate] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<MaterialCostBreakdown>({
    queryKey: ['roofing-material-costs', id],
    queryFn: () => roofingEstimateService.getMaterialCosts(id!),
    enabled: !!id,
  });

  const { data: estimate } = useQuery({
    queryKey: ['roofing-estimate', id],
    queryFn: () => roofingEstimateService.getById(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (data && taxRate === null) setTaxRate(data.tax_rate);
  }, [data, taxRate]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only genuine overrides; anything matching the default is
      // dropped so it keeps tracking the default table.
      const overrides: Record<string, MaterialCostOverride> = {};
      (data?.items || []).forEach((item) => {
        const draft = drafts[item.key];
        const unitCost = draft?.unit_cost ?? (
          item.is_overridden ? item.unit_cost : undefined
        );
        const taxable = draft?.taxable ?? item.taxable;
        const changed =
          (unitCost != null && unitCost !== item.default_unit_cost) ||
          taxable === false;
        if (changed) {
          overrides[item.key] = {
            ...(unitCost != null ? { unit_cost: unitCost } : {}),
            taxable,
          };
        }
      });
      return roofingEstimateService.updateMaterialCosts(id!, {
        overrides,
        ...(taxRate != null ? { tax_rate: taxRate } : {}),
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['roofing-material-costs', id], result);
      setDrafts({});
      message.success('자재 원가가 저장되었습니다');
    },
    onError: () => message.error('저장에 실패했습니다'),
  });

  /**
   * Promote costs on this screen to the default price book. Only affects
   * estimates created from here on — this one and every existing estimate
   * keep the snapshot they were built on.
   */
  const saveDefaultsMutation = useMutation({
    mutationFn: (items: MaterialCostItem[]) => {
      const prices: Record<string, { unit_cost: number }> = {};
      items.forEach((item) => {
        if (!item.price_key) return;
        prices[item.price_key] = { unit_cost: valueOf(item).unitCost };
      });
      return roofingEstimateService.updateMaterialPrices(prices);
    },
    onSuccess: (_result, items) => {
      queryClient.invalidateQueries({ queryKey: ['roofing-material-costs'] });
      message.success(
        `${items.length}개 항목을 기본 원가로 저장했습니다 — 새 견적서부터 적용됩니다`,
      );
    },
    onError: () => message.error('기본 원가 저장에 실패했습니다'),
  });

  /** Current default cost per price-book key, for "differs from default". */
  const priceBook = useMemo(() => {
    const map: Record<string, MaterialPriceEntry> = {};
    (data?.price_book || []).forEach((e) => { map[e.material_key] = e; });
    return map;
  }, [data]);

  /** Current value for a row, preferring an unsaved edit. */
  const valueOf = (item: MaterialCostItem) => {
    const draft = drafts[item.key];
    return {
      unitCost: draft?.unit_cost ?? item.unit_cost,
      taxable: draft?.taxable ?? item.taxable,
    };
  };

  const setDraft = (key: string, patch: MaterialCostOverride) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  /**
   * Totals recomputed from the staged edits, so the figures move as soon
   * as a cost is typed rather than only after saving.
   */
  // Crew rates live on the estimate, not in a shared table: every crew
  // charges differently, and last month's rate should not silently
  // reprice this month's job.
  const [jobCost, setJobCost] = useState<RoofingJobCostInputs>({});
  const [jobCostDirty, setJobCostDirty] = useState(false);

  // Seed from the estimate already loaded above; do not clobber edits
  // the user has started making.
  useEffect(() => {
    if (!estimate || jobCostDirty) return;
    setJobCost((estimate.job_cost_inputs ?? {}) as RoofingJobCostInputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate]);

  const setJobCostField = (
    key: keyof RoofingJobCostInputs, value: unknown,
  ) => {
    setJobCost((prev) => ({ ...prev, [key]: value as never }));
    setJobCostDirty(true);
  };

  const jobCostMutation = useMutation({
    mutationFn: (inputs: RoofingJobCostInputs) =>
      roofingEstimateService.update(id!, {
        job_cost_inputs: inputs,
      } as never),
    onSuccess: () => {
      setJobCostDirty(false);
      queryClient.invalidateQueries({
        queryKey: ['roofing-material-costs', id],
      });
      queryClient.invalidateQueries({ queryKey: ['roofing-estimate', id] });
      message.success('인건비 단가가 저장되었습니다');
    },
    onError: () => message.error('저장에 실패했습니다'),
  });

  const preview = useMemo(() => {
    if (!data) return null;
    const rate = taxRate ?? data.tax_rate;
    let subtotal = 0;
    let taxable = 0;
    data.items.forEach((item) => {
      const { unitCost, taxable: isTaxable } = valueOf(item);
      const line = item.quantity * unitCost;
      subtotal += line;
      if (isTaxable) taxable += line;
    });
    const tax = taxable * rate;
    const total = subtotal + tax;
    const estTotal = data.estimate_total;

    // Profit is the sale minus EVERY known cost. Material alone counts
    // the crew and the dumpster as profit, which is what made this panel
    // read ~69% on jobs that actually clear far less. When the crew rate
    // has not been entered the margin is withheld rather than inflated.
    const jc = data.job_cost;
    const labor = jc?.labor?.total ?? 0;
    const disposal = jc?.disposal?.total ?? 0;
    const totalCost = total + labor + disposal;
    const canShowProfit = Boolean(estTotal) && Boolean(jc?.complete);

    return {
      subtotal,
      tax,
      total,
      rate,
      labor,
      disposal,
      totalCost,
      canShowProfit,
      missing: jc?.missing ?? [],
      grossProfit: canShowProfit ? (estTotal as number) - totalCost : null,
      marginPct: canShowProfit
        ? (((estTotal as number) - totalCost) / (estTotal as number)) * 100
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, drafts, taxRate]);

  const isDirty =
    Object.keys(drafts).length > 0 ||
    (data != null && taxRate != null && taxRate !== data.tax_rate);

  const columns = [
    {
      title: 'Material',
      dataIndex: 'description',
      key: 'description',
      render: (text: string, item: MaterialCostItem) => (
        <Space direction="vertical" size={0}>
          <Text>{text}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {item.category_label}
          </Text>
        </Space>
      ),
    },
    {
      title: (
        <Tooltip title="측정치에서 실제 발주 단위(BD/RL/PC)로 자동 환산됩니다 — 직접 입력할 필요 없습니다">
          <span>Qty <LockOutlined style={{ fontSize: 10 }} /></span>
        </Tooltip>
      ),
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right' as const,
      width: 170,
      render: (qty: number, item: MaterialCostItem) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Text strong>
            {qty.toLocaleString()}{' '}
            <Text type="secondary" style={{ fontSize: 11 }}>{item.unit}</Text>
          </Text>
          {/* Say where the package count came from: 2.4 rolls still buys 3. */}
          {item.measured_quantity != null && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {item.measured_quantity.toLocaleString()} {item.measured_unit}
              {item.packaging_note ? ` · ${item.packaging_note}` : ''}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Unit Cost',
      key: 'unit_cost',
      align: 'right' as const,
      width: 190,
      render: (_: unknown, item: MaterialCostItem) => {
        const { unitCost } = valueOf(item);
        const bookCost = priceBook[item.price_key || '']?.unit_cost;
        const differsFromBook =
          bookCost != null && Math.abs(unitCost - bookCost) > 0.0001;
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={0.01}
              value={unitCost}
              prefix="$"
              onChange={(v) =>
                setDraft(item.key, { unit_cost: (v as number) ?? 0 })
              }
            />
            {differsFromBook && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                기본값 {unitMoney(bookCost!)}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Tax',
      key: 'taxable',
      align: 'center' as const,
      width: 80,
      render: (_: unknown, item: MaterialCostItem) => {
        const { taxable } = valueOf(item);
        return (
          <Switch
            size="small"
            checked={taxable}
            onChange={(checked) => setDraft(item.key, { taxable: checked })}
          />
        );
      },
    },
    {
      title: 'Subtotal',
      key: 'subtotal',
      align: 'right' as const,
      width: 130,
      render: (_: unknown, item: MaterialCostItem) => {
        const { unitCost } = valueOf(item);
        return <Text strong>{money(item.quantity * unitCost)}</Text>;
      },
    },
  ];

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert
        type="error"
        message="자재 원가를 불러오지 못했습니다"
        description="견적서가 존재하는지 확인해 주세요."
        showIcon
      />
    );
  }

  const hasItems = data.items.length > 0;

  return (
    <div>
      <Space
        style={{
          width: '100%', justifyContent: 'space-between', marginBottom: 16,
        }}
        align="start"
      >
        <Space direction="vertical" size={0}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            style={{ paddingLeft: 0 }}
            onClick={() => navigate(`/roofing-estimates/${id}`)}
          >
            견적서로 돌아가기
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            Material Cost
            <Tag color="red" style={{ marginLeft: 12 }}>
              <LockOutlined /> 내부 전용
            </Tag>
          </Title>
          {estimate?.property_address && (
            <Text type="secondary">{estimate.property_address}</Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            수량은 측정치에서 발주 단위(BD/RL/PC)로 환산됩니다. 단위당 기본
            원가는{' '}
            <a onClick={() => navigate('/roofing/material-prices')}>
              자재 기본 단가
            </a>
            에서 관리합니다.
          </Text>
        </Space>
        <Space>
          {isDirty && (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                setDrafts({});
                setTaxRate(data.tax_rate);
              }}
            >
              되돌리기
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!isDirty}
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            저장
          </Button>
        </Space>
      </Space>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="이 화면은 손님에게 보여주는 용도가 아닙니다"
        description="자재·인건비·폐기물 처리 원가와 예상 이익을 내부적으로 파악하기 위한 자료입니다. 인건비는 crew마다 단가가 다르므로 견적별로 입력합니다. 고객용 견적서 PDF에는 포함되지 않습니다."
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="단가는 이 견적서에 고정되어 있습니다"
        description="이 견적서는 생성 당시의 기본 원가를 그대로 보관합니다. 나중에 기본 원가를 올려도 이 견적서의 이익률은 변하지 않습니다. 단가를 고치면 이 견적서에만 적용되고, 시세가 실제로 바뀌었다면 '기본값으로' 버튼으로 새 견적서부터 반영할 수 있습니다."
      />

      {!hasItems ? (
        <Card>
          <Empty description="측정치가 없어 자재 수량을 계산할 수 없습니다">
            <Button
              type="primary"
              onClick={() => navigate(`/roofing-estimates/${id}`)}
            >
              견적서에서 측정치 입력하기
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="자재비 (before tax)"
                  value={preview?.subtotal ?? 0}
                  precision={2}
                  prefix="$"
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title={`Tax (${((preview?.rate ?? 0) * 100).toFixed(1)}%)`}
                  value={preview?.tax ?? 0}
                  precision={2}
                  prefix="$"
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="자재비 총합 (tax 포함)"
                  value={preview?.total ?? 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="예상 이익 (견적 − 총원가)"
                  value={preview?.canShowProfit
                    ? (preview?.grossProfit ?? 0) : 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{
                    color: (preview?.grossProfit ?? 0) >= 0
                      ? '#3f8600' : '#cf1322',
                  }}
                  suffix={
                    preview?.marginPct != null ? (
                      <span style={{ fontSize: 13 }}>
                        {' '}({preview.marginPct.toFixed(1)}%)
                      </span>
                    ) : undefined
                  }
                />
                {!data.estimate_total && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    견적서를 Calculate 해야 이익이 계산됩니다
                  </Text>
                )}
                {data.estimate_total != null
                  && !preview?.canShowProfit && (
                  <Text type="warning" style={{ fontSize: 11 }}>
                    인건비 미입력 — 아래에서 crew 단가를 입력하세요
                  </Text>
                )}
              </Card>
            </Col>
          </Row>

          {/* Crew rates differ per crew, so they are entered per
              estimate rather than assumed from a table. Without them
              the margin above is withheld instead of being computed as
              though labor were free. */}
          <Card
            size="small"
            style={{ marginBottom: 16 }}
            title={
              <Space>
                <Text strong>인건비 · 폐기물 처리</Text>
                <Text type="secondary" style={{ fontWeight: 400 }}>
                  crew별 단가 (내부 원가 계산용)
                </Text>
              </Space>
            }
            extra={
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                loading={jobCostMutation.isPending}
                disabled={!jobCostDirty}
                onClick={() => jobCostMutation.mutate(jobCost)}
              >
                저장
              </Button>
            }
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12} md={5}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Crew
                </Text>
                <Input
                  placeholder="예: Crew A"
                  value={jobCost.crew_name ?? ''}
                  onChange={(e) => setJobCostField(
                    'crew_name', e.target.value)}
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  설치 ($/SQ)
                </Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={5}
                  value={jobCost.labor_per_sq ?? null}
                  onChange={(v) => setJobCostField('labor_per_sq', v)}
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  철거 ($/SQ)
                </Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={5}
                  value={jobCost.tearoff_per_sq ?? null}
                  onChange={(v) => setJobCostField('tearoff_per_sq', v)}
                />
              </Col>
              <Col xs={12} sm={6} md={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  고정비 ($)
                </Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={50}
                  value={jobCost.labor_fixed ?? null}
                  onChange={(v) => setJobCostField('labor_fixed', v)}
                />
              </Col>
              <Col xs={12} sm={6} md={7}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  폐기물 처리
                </Text>
                <Select
                  style={{ width: '100%' }}
                  value={jobCost.disposal_method ?? 'dumpster'}
                  onChange={(v) => setJobCostField('disposal_method', v)}
                  options={[
                    { value: 'dumpster', label: '컨테이너 대여' },
                    { value: 'truck', label: '자체 트럭 운반' },
                  ]}
                />
              </Col>
            </Row>

            {jobCost.disposal_method === 'truck' && (
              <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                <Col xs={12} sm={8} md={5}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Tipping fee ($/ton)
                  </Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={5}
                    value={jobCost.tipping_fee_per_ton ?? null}
                    onChange={(v) => setJobCostField(
                      'tipping_fee_per_ton', v)}
                  />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    회차당 ($)
                  </Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={10}
                    value={jobCost.haul_cost_per_trip ?? null}
                    onChange={(v) => setJobCostField(
                      'haul_cost_per_trip', v)}
                  />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    회차 수
                  </Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={1}
                    placeholder={String(
                      data.job_cost?.disposal?.trips ?? '')}
                    value={jobCost.haul_trips ?? null}
                    onChange={(v) => setJobCostField('haul_trips', v)}
                  />
                </Col>
                <Col xs={24} md={11}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    비우면 철거 추정 무게로 회차를 산정합니다
                    {data.job_cost?.disposal?.debris_lb
                      ? ` (추정 ${Math.round(
                          data.job_cost.disposal.debris_lb,
                        ).toLocaleString()} lb)`
                      : ''}
                  </Text>
                </Col>
              </Row>
            )}

            {data.job_cost?.complete && (
              <Row style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  원가 구성 — 자재{' '}
                  {data.job_cost.cost_breakdown_pct.material}% · 인건비{' '}
                  {data.job_cost.cost_breakdown_pct.labor}% · 폐기물{' '}
                  {data.job_cost.cost_breakdown_pct.disposal}%
                </Text>
              </Row>
            )}
          </Card>

          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Text strong>Sales Tax</Text>
              <Select
                style={{ width: 170 }}
                value={taxRate ?? data.tax_rate}
                onChange={(v) => setTaxRate(v)}
                options={TAX_PRESETS}
              />
              <InputNumber
                style={{ width: 120 }}
                min={0}
                max={20}
                step={0.1}
                addonAfter="%"
                value={Number((((taxRate ?? data.tax_rate) * 100)).toFixed(3))}
                onChange={(v) => setTaxRate(((v as number) ?? 0) / 100)}
              />
              <Text type="secondary">
                기본 6% — 물건지 주에 따라 자동 적용됩니다
              </Text>
            </Space>
          </Card>

          {data.categories.map((cat) => {
            const catItems = cat.items.map((item) => {
              const { unitCost, taxable } = valueOf(item);
              return { ...item, _line: item.quantity * unitCost, taxable };
            });
            const catSubtotal = catItems.reduce(
              (sum, i) => sum + i._line, 0,
            );
            const pct = preview?.subtotal
              ? (catSubtotal / preview.subtotal) * 100 : 0;

            return (
              <Card
                key={cat.category}
                size="small"
                style={{ marginBottom: 12 }}
                title={
                  <Space>
                    <Text strong>{cat.label}</Text>
                    <Tag>{pct.toFixed(1)}%</Tag>
                  </Space>
                }
                extra={
                  <Space>
                    {catItems.some((i) => {
                      const bc = priceBook[i.price_key || '']?.unit_cost;
                      return bc != null
                        && Math.abs(valueOf(i).unitCost - bc) > 0.0001;
                    }) && (
                      <Tooltip title="이 카테고리의 현재 단가를 기본 원가로 저장합니다. 새 견적서부터 적용되고, 기존 견적서는 그대로 유지됩니다.">
                        <Button
                          size="small"
                          icon={<PushpinOutlined />}
                          loading={saveDefaultsMutation.isPending}
                          onClick={() =>
                            saveDefaultsMutation.mutate(
                              cat.items.filter((i) => i.price_key),
                            )
                          }
                        >
                          기본값으로
                        </Button>
                      </Tooltip>
                    )}
                    <Text strong>{money(catSubtotal)}</Text>
                  </Space>
                }
              >
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={cat.items}
                  columns={columns}
                />
              </Card>
            );
          })}

          <Card>
            <Row justify="end">
              <Col xs={24} sm={16} md={10}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Text>자재비 (before tax)</Text>
                  <Text strong>{money(preview?.subtotal)}</Text>
                </Row>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Text>
                    Sales tax ({((preview?.rate ?? 0) * 100).toFixed(1)}%)
                  </Text>
                  <Text strong>{money(preview?.tax)}</Text>
                </Row>
                <Row
                  justify="space-between"
                  style={{
                    borderTop: '1px solid #f0f0f0', paddingTop: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text strong>자재비 총합 (tax 포함)</Text>
                  <Title level={4} style={{ margin: 0 }}>
                    {money(preview?.total)}
                  </Title>
                </Row>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Text>
                    인건비
                    {data.job_cost?.labor?.crew_name
                      ? ` (${data.job_cost.labor.crew_name})` : ''}
                  </Text>
                  <Text strong={(preview?.labor ?? 0) > 0}>
                    {(preview?.labor ?? 0) > 0
                      ? money(preview?.labor)
                      : <Text type="warning">미입력</Text>}
                  </Text>
                </Row>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Text>
                    폐기물 처리
                    {data.job_cost?.disposal?.method === 'truck'
                      ? ' (자체 운반)' : ' (컨테이너)'}
                  </Text>
                  <Text strong>{money(preview?.disposal)}</Text>
                </Row>
                <Row
                  justify="space-between"
                  style={{
                    borderTop: '1px solid #f0f0f0', paddingTop: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text strong>총 원가</Text>
                  <Title level={4} style={{ margin: 0 }}>
                    {money(preview?.totalCost)}
                  </Title>
                </Row>
                {data.estimate_total != null && (
                  <>
                    <Row justify="space-between" style={{ marginBottom: 8 }}>
                      <Text type="secondary">견적 총액</Text>
                      <Text type="secondary">
                        {money(data.estimate_total)}
                      </Text>
                    </Row>
                    <Row
                      justify="space-between"
                      style={{
                        borderTop: '1px solid #f0f0f0', paddingTop: 8,
                      }}
                    >
                      <Text strong>예상 이익</Text>
                      {preview?.canShowProfit ? (
                        <Title
                          level={4}
                          style={{
                            margin: 0,
                            color: (preview?.grossProfit ?? 0) >= 0
                              ? '#3f8600' : '#cf1322',
                          }}
                        >
                          {money(preview?.grossProfit)}
                          {preview?.marginPct != null && (
                            <Text
                              style={{ fontSize: 14, marginLeft: 8 }}
                              type="secondary"
                            >
                              {preview.marginPct.toFixed(1)}%
                            </Text>
                          )}
                        </Title>
                      ) : (
                        <Text type="warning">
                          인건비 입력 필요
                        </Text>
                      )}
                    </Row>
                  </>
                )}
              </Col>
            </Row>
          </Card>
        </>
      )}
    </div>
  );
};

export default RoofingMaterialCost;
