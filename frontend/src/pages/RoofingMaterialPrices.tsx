/**
 * Roofing Material Prices — INTERNAL ONLY
 *
 * The default supplier cost for every roofing material, in one place.
 * These are the starting costs new estimates are built from; an estimate
 * freezes the costs in force when it is created, so editing here never
 * rewrites the profit already recorded on a past job.
 *
 * Quantities do not appear on this screen — they depend on a particular
 * roof. This is only "what does the material cost", per unit.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
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
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roofingEstimateService } from '../services/roofingEstimateService';
import type {
  FormulaValidation,
  MaterialBasis,
  MaterialPriceCreate,
  MaterialPriceEntry,
  MaterialPricePatch,
} from '../types/roofingEstimate';

const { Title, Text } = Typography;

const unitMoney = (v: number) =>
  `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  })}`;

/** Two decimals, trailing zeros trimmed: 3 -> "3", 66.6667 -> "66.67". */
const num2 = (v: number) =>
  (Math.round(v * 100) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

/**
 * How a package relates to the measurement it is ordered against.
 *
 * Stored as "measurement covered by one package", which reads naturally
 * for a roll (10 SQ/RL) but not for a bundle covering a third of a
 * square — that is flipped so it reads 3 BD/SQ, the way a roofer says it.
 */
const coverageLabel = (
  perUnit: number, basisUnit: string, packUnit: string,
) => (
  perUnit > 0 && perUnit < 1
    ? `${num2(1 / perUnit)} ${packUnit}/${basisUnit}`
    : `${num2(perUnit)} ${basisUnit}/${packUnit}`
);

/** Ordering mirrors the 8-phase estimate structure, not the alphabet. */
const CATEGORY_ORDER = [
  'shingle', 'ridge_cap', 'underlayment', 'ice_water', 'drip_edge',
  'decking', 'flashing', 'ventilation', 'penetration', 'gutter',
  'accessories',
];

/** Purchase units — how a supplier actually sells the material. */
const UNIT_OPTIONS = [
  { value: 'BD', label: 'BD — 번들 (Bundle)' },
  { value: 'RL', label: 'RL — 롤 (Roll)' },
  { value: 'PC', label: 'PC — 낱개/스틱 (Piece)' },
  { value: 'BX', label: 'BX — 박스 (Box)' },
  { value: 'CTN', label: 'CTN — 카톤 (Carton)' },
  { value: 'TB', label: 'TB — 튜브 (Tube)' },
  { value: 'EA', label: 'EA — 개 (Each)' },
  { value: 'SQ', label: 'SQ — 스퀘어 (100 SF)' },
  { value: 'SF', label: 'SF — 평방피트' },
  { value: 'LF', label: 'LF — 피트' },
  { value: 'GAL', label: 'GAL — 갤런' },
  { value: 'LB', label: 'LB — 파운드' },
];

/**
 * Variables split by what they measure. Length is most of the list, so
 * it gets the wider column; area and counts are short.
 */
const VARIABLE_GROUPS = [
  { title: '면적', units: ['SQ', 'SF'], span: 8 },
  { title: '길이 (LF)', units: ['LF'], span: 10 },
  { title: '개수 (EA)', units: ['EA'], span: 6 },
];

/** The formula from the estimator's spreadsheet, as a starting point. */
const SHINGLE_EXAMPLE =
  'IF(valley > 15, ROUNDUP(roof_area_waste * 3.15), ROUNDUP(roof_area_waste * 3))';

const CATEGORY_LABELS: Record<string, string> = {
  shingle: 'Shingle',
  ridge_cap: 'Hip & Ridge Cap',
  underlayment: 'Underlayment',
  ice_water: 'Ice & Water Shield',
  drip_edge: 'Drip Edge',
  decking: 'Decking',
  flashing: 'Flashing',
  ventilation: 'Ventilation',
  penetration: 'Pipe Boots & Penetrations',
  gutter: 'Gutter',
  accessories: 'Nails & Accessories',
};

const RoofingMaterialPrices: React.FC = () => {
  const queryClient = useQueryClient();

  // Edits are staged locally so a half-finished table is never saved.
  const [drafts, setDrafts] = useState<Record<string, MaterialPricePatch>>({});
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  // null = closed; a row = editing it; {} = adding a new material.
  const [editing, setEditing] = useState<Partial<MaterialPriceEntry> | null>(
    null,
  );
  const [form] = Form.useForm();
  const [formulaText, setFormulaText] = useState('');
  const [formulaCheck, setFormulaCheck] = useState<FormulaValidation | null>(
    null,
  );
  const [showVars, setShowVars] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery<
    MaterialPriceEntry[]
  >({
    queryKey: ['roofing-material-prices', showRetired],
    queryFn: () => roofingEstimateService.listMaterialPrices(showRetired),
  });

  // The measurements a quantity formula can be written against, and the
  // unit each one is expressed in.
  const { data: bases } = useQuery<MaterialBasis[]>({
    queryKey: ['roofing-material-bases'],
    queryFn: () => roofingEstimateService.listMaterialBases(),
    staleTime: Infinity,
  });

  const basisUnitOf = (basis?: string | null) =>
    (bases || []).find((b) => b.value === basis)?.unit || '';

  const { data: formulaHelp } = useQuery({
    queryKey: ['roofing-formula-variables'],
    queryFn: () => roofingEstimateService.getFormulaVariables(),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (editing) {
      form.setFieldsValue(editing);
      setFormulaText(editing.qty_formula || '');
      setFormulaCheck(null);
    }
  }, [editing, form]);

  /** Append a token to the formula being edited. */
  const insertVariable = (token: string) => {
    // A space between two bare words would be a syntax error, so only
    // pad when the formula already ends in something separable.
    const needsSpace = /[\w)]$/.test(formulaText) && /^[A-Za-z_]/.test(token);
    const next = `${formulaText}${needsSpace ? ' ' : ''}${token}`;
    setFormulaText(next);
    form.setFieldsValue({ qty_formula: next });
  };

  // Check the formula a beat after typing stops, so every keystroke does
  // not become a request.
  useEffect(() => {
    const text = formulaText.trim();
    if (!text) {
      setFormulaCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      roofingEstimateService.validateMaterialFormula(text)
        .then(setFormulaCheck)
        .catch(() => setFormulaCheck(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [formulaText]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Send only rows that actually changed.
      const prices: Record<string, MaterialPricePatch> = {};
      (data || []).forEach((entry) => {
        const draft = drafts[entry.material_key];
        if (!draft) return;
        const patch: MaterialPricePatch = {};
        if (draft.unit_cost != null && draft.unit_cost !== entry.unit_cost) {
          patch.unit_cost = draft.unit_cost;
        }
        if (draft.is_taxable != null && draft.is_taxable !== entry.is_taxable) {
          patch.is_taxable = draft.is_taxable;
        }
        if (draft.notes != null && draft.notes !== entry.notes) {
          patch.notes = draft.notes;
        }
        if (Object.keys(patch).length) prices[entry.material_key] = patch;
      });
      return roofingEstimateService.updateMaterialPrices(prices);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roofing-material-prices'] });
      // Per-estimate screens compare against these defaults.
      queryClient.invalidateQueries({ queryKey: ['roofing-material-costs'] });
      setDrafts({});
      message.success('기본 단가가 저장되었습니다 — 새 견적서부터 적용됩니다');
    },
    onError: () => message.error('저장에 실패했습니다'),
  });

  /** Add a material, or rewrite an existing row's details. */
  const upsertMutation = useMutation({
    mutationFn: async (
      values: MaterialPriceCreate & { material_key?: string },
    ) => {
      if (values.material_key) {
        const { material_key: key, ...patch } = values;
        await roofingEstimateService.updateMaterialPrices({
          [key]: patch as MaterialPricePatch,
        });
        return;
      }
      await roofingEstimateService.createMaterialPrice(values);
    },
    onSuccess: (_r, values) => {
      queryClient.invalidateQueries({ queryKey: ['roofing-material-prices'] });
      queryClient.invalidateQueries({ queryKey: ['roofing-material-costs'] });
      setEditing(null);
      form.resetFields();
      message.success(
        values.material_key ? '자재가 수정되었습니다' : '자재가 추가되었습니다',
      );
    },
    onError: () => message.error('저장에 실패했습니다'),
  });

  /**
   * Retire or restore. Never a hard delete — estimates priced with this
   * material must keep resolving.
   */
  const retireMutation = useMutation({
    mutationFn: ({ key, active }: { key: string; active: boolean }) =>
      roofingEstimateService.updateMaterialPrices({
        [key]: { is_active: active },
      }),
    onSuccess: (_r, { active }) => {
      queryClient.invalidateQueries({ queryKey: ['roofing-material-prices'] });
      message.success(active ? '자재를 복원했습니다' : '자재를 비활성화했습니다');
    },
    onError: () => message.error('처리에 실패했습니다'),
  });

  /** Current value for a row, preferring an unsaved edit. */
  const valueOf = (entry: MaterialPriceEntry) => {
    const draft = drafts[entry.material_key];
    return {
      unitCost: draft?.unit_cost ?? entry.unit_cost,
      isTaxable: draft?.is_taxable ?? entry.is_taxable,
      notes: draft?.notes ?? entry.notes,
    };
  };

  const setDraft = (key: string, patch: MaterialPricePatch) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const isChanged = (entry: MaterialPriceEntry) => {
    const draft = drafts[entry.material_key];
    if (!draft) return false;
    return (
      (draft.unit_cost != null && draft.unit_cost !== entry.unit_cost) ||
      (draft.is_taxable != null && draft.is_taxable !== entry.is_taxable) ||
      (draft.notes != null && draft.notes !== entry.notes)
    );
  };

  const changedCount = useMemo(
    () => (data || []).filter(isChanged).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, drafts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data || [];
    return (data || []).filter((e) =>
      [
        e.label, e.material_key, e.manufacturer, e.product_name,
        e.color, e.size_spec, e.supplier, e.sku,
        CATEGORY_LABELS[e.category] || e.category,
      ].some((f) => (f || '').toLowerCase().includes(q)),
    );
  }, [data, search]);

  /** Grouped by category, in phase order rather than alphabetically. */
  const groups = useMemo(() => {
    const byCat: Record<string, MaterialPriceEntry[]> = {};
    filtered.forEach((e) => {
      (byCat[e.category] ||= []).push(e);
    });
    const known = CATEGORY_ORDER.filter((c) => byCat[c]);
    const extra = Object.keys(byCat)
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort();
    return [...known, ...extra].map((c) => ({
      category: c,
      label: CATEGORY_LABELS[c] || c,
      items: byCat[c],
    }));
  }, [filtered]);

  const columns = [
    {
      title: 'Material',
      dataIndex: 'label',
      key: 'label',
      render: (text: string, entry: MaterialPriceEntry) => {
        // Manufacturer + product is what actually identifies the item;
        // fall back to the key for rows that only name a grade.
        const spec = [entry.manufacturer, entry.product_name, entry.color,
          entry.size_spec].filter(Boolean).join(' · ');
        const source = [
          entry.supplier,
          entry.sku ? `SKU ${entry.sku}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <Space direction="vertical" size={0}>
            <Space size={6} wrap>
              <Text delete={!entry.is_active}>{text}</Text>
              {isChanged(entry) && <Tag color="orange">수정됨</Tag>}
              {entry.is_custom && <Tag color="green">직접 추가</Tag>}
              {entry.company_id && <Tag color="blue">회사 전용</Tag>}
              {!entry.is_active && <Tag>비활성</Tag>}
            </Space>
            {spec && (
              <Text style={{ fontSize: 12 }} type="secondary">{spec}</Text>
            )}
            {source && (
              <Text style={{ fontSize: 11 }} type="secondary">{source}</Text>
            )}
            {entry.qty_formula ? (
              <Text
                style={{ fontSize: 11, fontFamily: 'monospace' }}
                type="secondary"
              >
                ƒ {entry.qty_formula}
              </Text>
            ) : entry.coverage_per_unit ? (
              <Text style={{ fontSize: 11 }} type="secondary">
                {coverageLabel(
                  entry.coverage_per_unit,
                  entry.coverage_unit || basisUnitOf(entry.qty_basis),
                  entry.unit,
                )}
                {entry.qty_minimum ? ` · 최소 ${num2(entry.qty_minimum)}` : ''}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      align: 'center' as const,
      render: (u: string) => <Text type="secondary">{u}</Text>,
    },
    {
      title: 'Unit Cost',
      key: 'unit_cost',
      align: 'right' as const,
      width: 190,
      render: (_: unknown, entry: MaterialPriceEntry) => {
        const { unitCost } = valueOf(entry);
        const changed = isChanged(entry);
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={0.01}
              value={unitCost}
              prefix="$"
              onChange={(v) =>
                setDraft(entry.material_key, { unit_cost: (v as number) ?? 0 })
              }
            />
            {changed && unitCost !== entry.unit_cost && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                이전: {unitMoney(entry.unit_cost)}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: (
        <Tooltip title="이 자재에 판매세가 붙는지 여부입니다">
          <span>Taxable <InfoCircleOutlined style={{ fontSize: 10 }} /></span>
        </Tooltip>
      ),
      key: 'is_taxable',
      align: 'center' as const,
      width: 90,
      render: (_: unknown, entry: MaterialPriceEntry) => (
        <Switch
          size="small"
          checked={valueOf(entry).isTaxable}
          onChange={(c) => setDraft(entry.material_key, { is_taxable: c })}
        />
      ),
    },
    {
      title: 'Notes',
      key: 'notes',
      width: 220,
      render: (_: unknown, entry: MaterialPriceEntry) => (
        <Input
          size="small"
          placeholder="공급업체, 변경 사유 등"
          value={valueOf(entry).notes}
          onChange={(e) =>
            setDraft(entry.material_key, { notes: e.target.value })
          }
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, entry: MaterialPriceEntry) => (
        <Space size={0}>
          {isChanged(entry) && (
            <Tooltip title="이 항목의 수정을 취소합니다">
              <Button
                type="text"
                size="small"
                icon={<UndoOutlined />}
                onClick={() =>
                  setDrafts((prev) => {
                    const next = { ...prev };
                    delete next[entry.material_key];
                    return next;
                  })
                }
              />
            </Tooltip>
          )}
          <Tooltip title="제조사·제품명 등 상세 정보 편집">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(entry)}
            />
          </Tooltip>
          {entry.is_active ? (
            <Popconfirm
              title="이 자재를 비활성화할까요?"
              description="목록에서만 숨겨집니다. 이 자재로 만든 기존 견적서는 그대로 유지됩니다."
              okText="비활성화"
              cancelText="취소"
              onConfirm={() =>
                retireMutation.mutate({
                  key: entry.material_key, active: false,
                })
              }
            >
              <Tooltip title="비활성화">
                <Button type="text" size="small" icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Tooltip title="복원">
              <Button
                type="text"
                size="small"
                icon={<UndoOutlined />}
                onClick={() =>
                  retireMutation.mutate({
                    key: entry.material_key, active: true,
                  })
                }
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="기본 단가를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        action={
          <Button size="small" onClick={() => refetch()}>다시 시도</Button>
        }
      />
    );
  }

  const totalCount = (data || []).length;

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            자재 기본 단가
          </Title>
          <Text type="secondary">
            Roofing 견적서가 사용하는 공급업체 기본 원가입니다. 내부 전용이며
            고객에게 노출되지 않습니다.
          </Text>
        </Col>
        <Col>
          <Space>
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditing({ unit: 'EA', is_taxable: true, unit_cost: 0 });
              }}
            >
              자재 추가
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isFetching}
            >
              새로고침
            </Button>
            {changedCount > 0 && (
              <Popconfirm
                title="수정을 모두 취소할까요?"
                onConfirm={() => setDrafts({})}
                okText="취소"
                cancelText="닫기"
              >
                <Button icon={<UndoOutlined />}>전체 되돌리기</Button>
              </Popconfirm>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={changedCount === 0}
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              저장{changedCount > 0 ? ` (${changedCount})` : ''}
            </Button>
          </Space>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="여기서 바꾼 단가는 새로 만드는 견적서부터 적용됩니다"
        description={
          '기존 견적서는 생성 당시의 단가를 그대로 보관하므로, 이미 기록된 '
          + '마진이 소급해서 바뀌지 않습니다. 특정 견적서에만 다른 값을 쓰려면 '
          + '해당 견적서의 원가 화면에서 개별 수정하세요.'
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={5}>
          <Card size="small">
            <Statistic title="등록 자재" value={totalCount} suffix="개" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={5}>
          <Card size="small">
            <Statistic
              title="수정 대기"
              value={changedCount}
              suffix="개"
              valueStyle={changedCount ? { color: '#fa8c16' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8} md={10}>
          <Input
            allowClear
            size="large"
            prefix={<SearchOutlined />}
            placeholder="자재명, 제조사, 제품명, 카테고리로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Col>
        <Col xs={24} md={4}>
          <Card size="small">
            <Space>
              <Switch
                size="small"
                checked={showRetired}
                onChange={setShowRetired}
              />
              <Text style={{ fontSize: 12 }}>비활성 포함</Text>
            </Space>
          </Card>
        </Col>
      </Row>

      {groups.length === 0 ? (
        <Card>
          <Empty
            description={
              search
                ? `"${search}"에 해당하는 자재가 없습니다`
                : '등록된 자재가 없습니다'
            }
          />
        </Card>
      ) : (
        groups.map((g) => (
          <Card
            key={g.category}
            size="small"
            title={
              <Space>
                <Text strong>{g.label}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {g.items.length}개
                </Text>
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            <Table
              rowKey="material_key"
              size="small"
              pagination={false}
              columns={columns}
              dataSource={g.items}
              onRow={(e) => (
                e.is_active ? {} : { style: { opacity: 0.55 } }
              )}
            />
          </Card>
        ))
      )}

      <Modal
        open={editing != null}
        title={editing?.material_key ? '자재 수정' : '자재 추가'}
        okText="저장"
        cancelText="취소"
        confirmLoading={upsertMutation.isPending}
        onCancel={() => {
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        width={680}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            upsertMutation.mutate({
              ...values,
              material_key: editing?.material_key,
            })
          }
        >
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item
                label="표시 이름"
                name="label"
                rules={[{ required: true, message: '이름을 입력하세요' }]}
                tooltip="목록과 원가 화면에 표시되는 이름입니다"
              >
                <Input placeholder="예: Shingle — GAF Timberline HDZ" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                label="카테고리"
                name="category"
                rules={[{ required: true, message: '카테고리를 선택하세요' }]}
              >
                <Select
                  showSearch
                  options={Object.entries(CATEGORY_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                label="발주 단위"
                name="unit"
                rules={[{ required: true, message: '단위를 선택하세요' }]}
                tooltip="공급업체가 판매하는 단위입니다"
              >
                <Select options={UNIT_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="단위당 원가" name="unit_cost">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  prefix="$"
                />
              </Form.Item>
            </Col>
          </Row>

          <Text type="secondary" style={{ fontSize: 12 }}>
            제품 정보 — 같은 등급이라도 제조사·제품에 따라 단가가 다릅니다
          </Text>
          <Row gutter={12} style={{ marginTop: 8 }}>
            <Col xs={12} md={8}>
              <Form.Item label="제조사" name="manufacturer">
                <Input placeholder="GAF, CertainTeed..." />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="제품명" name="product_name">
                <Input placeholder="Timberline HDZ" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="색상" name="color">
                <Input placeholder="Charcoal" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item
                label="규격"
                name="size_spec"
                tooltip="예: D-style 2&quot;x2&quot;"
              >
                <Input placeholder='D-style 2"x2"' />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="공급업체" name="supplier">
                <Input placeholder="ABC Supply" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="SKU" name="sku">
                <Input placeholder="0489210" />
              </Form.Item>
            </Col>
          </Row>

          <Text type="secondary" style={{ fontSize: 12 }}>
            수량 계산식 — 측정치를 발주 수량으로 환산하는 규칙입니다
          </Text>
          <Row gutter={12} style={{ marginTop: 8 }}>
            <Col xs={24} md={9}>
              <Form.Item
                label="기준 측정치"
                name="qty_basis"
                tooltip="비워두면 브랜드 포장 기본값을 사용합니다."
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="자동 (브랜드 기본값)"
                  options={(bases || []).map((b) => ({
                    value: b.value,
                    label: `${b.label} (${b.unit})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item
                label="1개당 커버리지"
                name="coverage_per_unit"
                tooltip="1 RL이 10 SQ를 덮으면 10. 1 BD가 1/3 SQ면 0.33."
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.5}
                  precision={4}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item
                label="최소 수량"
                name="qty_minimum"
                tooltip="측정치가 적어도 최소 이만큼은 발주합니다."
              >
                <InputNumber style={{ width: '100%' }} min={0} step={1} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item
                label="과세 대상"
                name="is_taxable"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          {/* Spell the simple rule back out, so a typo shows up here. */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) =>
              prev.qty_basis !== cur.qty_basis
              || prev.coverage_per_unit !== cur.coverage_per_unit
              || prev.qty_minimum !== cur.qty_minimum
              || prev.unit !== cur.unit
              || prev.qty_formula !== cur.qty_formula
            }
          >
            {({ getFieldValue }) => {
              if ((getFieldValue('qty_formula') || '').trim()) return null;
              const basis = getFieldValue('qty_basis');
              const per = getFieldValue('coverage_per_unit');
              const min = getFieldValue('qty_minimum');
              const unit = getFieldValue('unit') || 'EA';
              if (!basis || !per) return null;
              const bUnit = basisUnitOf(basis);
              const bLabel = (bases || []).find(
                (b) => b.value === basis,
              )?.label || basis;
              return (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={
                    `${bLabel} ÷ ${num2(per)} ${bUnit} → 올림 → ${unit}`
                    + (min ? `, 최소 ${num2(min)} ${unit}` : '')
                  }
                  description={coverageLabel(per, bUnit, unit)}
                />
              );
            }}
          </Form.Item>

          {/* Anything the simple rule cannot say — conditionals, several
              measurements at once — is written as a formula instead. */}
          <Form.Item
            label="수식 (선택)"
            name="qty_formula"
            tooltip="입력하면 위의 기준/커버리지 대신 이 수식이 사용됩니다."
            extra={
              <Space split="·" wrap style={{ fontSize: 11 }}>
                <Text type="secondary" copyable={{ text: SHINGLE_EXAMPLE }}>
                  예: {SHINGLE_EXAMPLE}
                </Text>
                <a onClick={() => setShowVars((v) => !v)}>
                  {showVars ? '변수 숨기기' : '사용 가능한 변수 보기'}
                </a>
              </Space>
            }
          >
            <Input.TextArea
              rows={2}
              placeholder="ROUNDUP(roof_area_waste * 3)"
              style={{ fontFamily: 'monospace' }}
              onChange={(e) => setFormulaText(e.target.value)}
            />
          </Form.Item>

          {showVars && (
            <Card
              size="small"
              style={{ marginBottom: 16, background: '#fafafa' }}
              title={
                <Text style={{ fontSize: 12 }}>
                  변수를 클릭하면 수식에 삽입됩니다
                </Text>
              }
            >
              {/* One row per variable: the name you type on the left,
                  what it means on the right. Grouping by unit keeps the
                  length measurements — most of the list — together. */}
              <Row gutter={[16, 0]}>
                {VARIABLE_GROUPS.map((group) => {
                  const rows = (formulaHelp?.variables || []).filter(
                    (v) => group.units.includes(v.unit),
                  );
                  if (!rows.length) return null;
                  return (
                    <Col xs={24} md={group.span} key={group.title}>
                      <Text
                        type="secondary"
                        style={{ fontSize: 11, fontWeight: 600 }}
                      >
                        {group.title}
                      </Text>
                      <div style={{ marginTop: 4, marginBottom: 12 }}>
                        {rows.map((v) => (
                          <div
                            key={v.name}
                            onClick={() => insertVariable(v.name)}
                            style={{
                              display: 'flex',
                              alignItems: 'baseline',
                              gap: 8,
                              padding: '3px 6px',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#e6f4ff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '';
                            }}
                            title={
                              v.aliases.length
                                ? `같은 뜻: ${v.aliases.join(', ')}`
                                : undefined
                            }
                          >
                            <code
                              style={{
                                fontSize: 12,
                                color: '#0958d9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {v.name}
                            </code>
                            <Text
                              type="secondary"
                              style={{ fontSize: 11, flex: 1 }}
                              ellipsis
                            >
                              {v.label}
                            </Text>
                          </div>
                        ))}
                      </div>
                    </Col>
                  );
                })}
              </Row>

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  함수
                </Text>
                <div style={{ marginTop: 4 }}>
                  {(formulaHelp?.functions || []).map((fn) => (
                    <Tag
                      key={fn}
                      style={{
                        marginBottom: 4,
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: 11,
                      }}
                      onClick={() => insertVariable(`${fn}(`)}
                    >
                      {fn}
                    </Tag>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Validate as it is typed: a typo should not wait for costing. */}
          {formulaCheck && formulaText.trim() && (
            <Alert
              type={formulaCheck.ok ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                formulaCheck.ok
                  ? `샘플 지붕 기준 결과: ${formulaCheck.value}`
                  : formulaCheck.error
              }
              description={
                formulaCheck.ok ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    사용 변수: {formulaCheck.used.join(', ') || '없음'}
                    {' · '}샘플: 면적 28.25 SQ, valley 20 LF, eave 120 LF
                  </Text>
                ) : null
              }
            />
          )}

          <Form.Item label="메모" name="notes">
            <Input.TextArea rows={2} placeholder="공급업체, 변경 사유 등" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default RoofingMaterialPrices;
