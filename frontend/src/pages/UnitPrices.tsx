/**
 * Company prices — bathroom and kitchen cabinet estimates.
 *
 * Every price the two calculators use, with its default (from the code,
 * updated monthly or quarterly) and the company's own material and labor.
 * An empty company cell follows the default. A company price applies to
 * estimates priced after it is saved: an estimate keeps the prices it was
 * first priced with until "현재 단가로 다시 계산" on the estimate.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  InputNumber,
  message,
  Popover,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  HistoryOutlined,
  InfoCircleOutlined,
  PercentageOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unitPriceService } from '../services/unitPriceService';
import type {
  PriceDomain,
  PriceKind,
  UnitPriceChange,
  UnitPriceHistoryEntry,
  UnitPriceItem,
} from '../types/unitPrices';

const { Title, Text, Paragraph } = Typography;

type Side = 'material' | 'labor';

const DOMAINS: { value: PriceDomain; label: string }[] = [
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'cabinet', label: 'Kitchen Cabinet' },
];

const KIND_TAGS: Record<PriceKind, { color: string; label: string }> = {
  material: { color: 'blue', label: 'Material' },
  labor: { color: 'green', label: 'Labor' },
  mixed: { color: 'purple', label: 'Material + Labor' },
};

const money = (v: number | null | undefined) =>
  v == null ? '' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Whether a side can be priced on this item. */
const takes = (kind: PriceKind, side: Side) => kind === 'mixed' || kind === side;

const fmtWhen = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
};

const UnitPrices: React.FC = () => {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string>();
  const [domain, setDomain] = useState<PriceDomain>('bathroom');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>();
  const [onlyCompany, setOnlyCompany] = useState(false);
  // Unsaved edits. A side present here replaces the saved value; null is
  // "follow the default".
  const [drafts, setDrafts] = useState<Record<string, UnitPriceChange>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bulkSide, setBulkSide] = useState<Side>('labor');
  const [bulkPct, setBulkPct] = useState<number | null>(5);

  const companies = useQuery({
    queryKey: ['unit-price-companies'],
    queryFn: () => unitPriceService.listCompanies(),
  });

  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);

  const prices = useQuery({
    queryKey: ['unit-prices', domain, companyId],
    queryFn: () => unitPriceService.list(domain, companyId!),
    enabled: !!companyId,
  });

  const history = useQuery({
    queryKey: ['unit-price-history', domain, companyId],
    queryFn: () => unitPriceService.history(domain, companyId!),
    enabled: !!companyId && historyOpen,
  });

  const items = useMemo(() => prices.data?.items || [], [prices.data]);
  const groups = useMemo(() => Array.from(new Set(items.map((i) => i.group))), [items]);

  // Another company or price list: nothing unsaved carries over
  useEffect(() => {
    setDrafts({});
    setGroup(undefined);
  }, [domain, companyId]);

  const valueOf = (item: UnitPriceItem, side: Side): number | null => {
    const draft = drafts[item.key];
    if (draft && side in draft) return draft[side] ?? null;
    return item[side];
  };

  const effective = (item: UnitPriceItem) =>
    (valueOf(item, 'material') ?? item.default_material) + (valueOf(item, 'labor') ?? item.default_labor);

  const isChanged = (item: UnitPriceItem) => {
    const draft = drafts[item.key];
    if (!draft) return false;
    return (['material', 'labor'] as Side[]).some((side) => side in draft && (draft[side] ?? null) !== item[side]);
  };

  const hasOwn = (item: UnitPriceItem) => valueOf(item, 'material') != null || valueOf(item, 'labor') != null;

  const setDraft = (key: string, change: UnitPriceChange) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...change } }));

  const changedItems = useMemo(
    () => items.filter(isChanged),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, drafts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (group && item.group !== group) return false;
      if (onlyCompany && !hasOwn(item)) return false;
      if (!q) return true;
      return [item.label, item.group, item.key].some((f) => f.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, group, onlyCompany, drafts]);

  // One card per group, in the order groups first appear (a group's prices
  // can sit in more than one table)
  const byGroup = useMemo(() => {
    const out = new Map<string, UnitPriceItem[]>();
    filtered.forEach((item) => {
      const rows = out.get(item.group);
      if (rows) rows.push(item);
      else out.set(item.group, [item]);
    });
    return Array.from(out, ([name, rows]) => ({ group: name, rows }));
  }, [filtered]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, UnitPriceChange> = {};
      changedItems.forEach((item) => {
        const draft = drafts[item.key];
        const change: UnitPriceChange = {};
        (['material', 'labor'] as Side[]).forEach((side) => {
          if (side in draft && (draft[side] ?? null) !== item[side]) change[side] = draft[side] ?? null;
        });
        body[item.key] = change;
      });
      return unitPriceService.save(domain, companyId!, body);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['unit-prices', domain, companyId], data);
      queryClient.invalidateQueries({ queryKey: ['unit-price-history', domain, companyId] });
      setDrafts({});
      message.success('회사 단가를 저장했습니다. 새로 계산하는 견적부터 적용됩니다.');
    },
    onError: (err: any) => message.error(err?.response?.data?.detail || '저장하지 못했습니다'),
  });

  /** Raise or lower one side of every row on screen by a percentage. */
  const applyBulk = () => {
    if (!bulkPct) return;
    const factor = 1 + bulkPct / 100;
    setDrafts((prev) => {
      const next = { ...prev };
      filtered.forEach((item) => {
        if (!takes(item.kind, bulkSide)) return;
        const current = valueOf(item, bulkSide) ?? (bulkSide === 'material' ? item.default_material : item.default_labor);
        if (!current) return;
        next[item.key] = { ...next[item.key], [bulkSide]: round2(current * factor) };
      });
      return next;
    });
  };

  const sideInput = (item: UnitPriceItem, side: Side) => {
    if (!takes(item.kind, side)) return <Text type="secondary">—</Text>;
    const value = valueOf(item, side);
    return (
      <InputNumber
        size="small"
        min={0}
        step={1}
        precision={2}
        prefix="$"
        style={{ width: '100%' }}
        placeholder="기본값"
        value={value ?? undefined}
        onChange={(v) => setDraft(item.key, { [side]: v == null ? null : Number(v) })}
        aria-label={`${item.label} company ${side}`}
      />
    );
  };

  const columns = [
    {
      title: '항목',
      key: 'label',
      render: (_: unknown, item: UnitPriceItem) => (
        <Space size={6} wrap>
          <span>{item.label}</span>
          <Tag color={KIND_TAGS[item.kind].color} style={{ marginInlineEnd: 0 }}>{KIND_TAGS[item.kind].label}</Tag>
          {item.note && (
            <Tooltip title={item.note}>
              <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: '단위', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: '기본 Material',
      key: 'dm',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) =>
        takes(item.kind, 'material') ? <Text type="secondary">{money(item.default_material)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '기본 Labor',
      key: 'dl',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) =>
        takes(item.kind, 'labor') ? <Text type="secondary">{money(item.default_labor)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '회사 Material',
      key: 'm',
      width: 130,
      render: (_: unknown, item: UnitPriceItem) => sideInput(item, 'material'),
    },
    {
      title: '회사 Labor',
      key: 'l',
      width: 130,
      render: (_: unknown, item: UnitPriceItem) => sideInput(item, 'labor'),
    },
    {
      title: '적용 단가',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, item: UnitPriceItem) => {
        const value = effective(item);
        const isDefault = Math.abs(value - (item.default_material + item.default_labor)) < 0.005;
        return isDefault ? <Text>{money(value)}</Text> : <Text strong style={{ color: '#d46b08' }}>{money(value)}</Text>;
      },
    },
    {
      key: 'reset',
      width: 48,
      render: (_: unknown, item: UnitPriceItem) =>
        hasOwn(item) ? (
          <Tooltip title={item.updated_by ? `기본값으로 (마지막 수정: ${item.updated_by}, ${fmtWhen(item.updated_at)})` : '기본값으로'}>
            <Button
              size="small"
              type="text"
              icon={<UndoOutlined />}
              aria-label={`${item.label} back to default`}
              onClick={() => setDraft(item.key, { material: null, labor: null })}
            />
          </Tooltip>
        ) : null,
    },
  ];

  const historyColumns = [
    { title: '시간', dataIndex: 'changed_at', key: 'at', width: 170, render: (v: string) => fmtWhen(v) },
    { title: '누가', dataIndex: 'changed_by', key: 'by', width: 120, render: (v: string | null) => v || '—' },
    {
      title: '항목',
      key: 'item',
      render: (_: unknown, h: UnitPriceHistoryEntry) => (
        <span>{h.group ? <Text type="secondary">{h.group} · </Text> : null}{h.label}</span>
      ),
    },
    {
      title: 'Material',
      key: 'm',
      width: 170,
      render: (_: unknown, h: UnitPriceHistoryEntry) =>
        h.old_material === h.new_material ? '' : `${h.old_material == null ? '기본' : money(h.old_material)} → ${h.new_material == null ? '기본' : money(h.new_material)}`,
    },
    {
      title: 'Labor',
      key: 'l',
      width: 170,
      render: (_: unknown, h: UnitPriceHistoryEntry) =>
        h.old_labor === h.new_labor ? '' : `${h.old_labor == null ? '기본' : money(h.old_labor)} → ${h.new_labor == null ? '기본' : money(h.new_labor)}`,
    },
  ];

  const ownCount = items.filter((i) => i.material != null || i.labor != null).length;

  return (
    <div style={{ padding: 16, maxWidth: 1280, margin: '0 auto' }}>
      <Title level={3} style={{ marginBottom: 4 }}>회사별 단가</Title>
      <Paragraph type="secondary" style={{ maxWidth: 820 }}>
        Bathroom과 Kitchen Cabinet 견적의 단가입니다. 기본 단가는 월·분기마다 업데이트되고, 회사 칸을 비워두면
        기본 단가를 따릅니다. 회사 단가는 저장한 뒤 새로 계산하는 견적부터 적용돼요. 이미 계산한 견적은 처음 계산할 때의
        단가로 고정되어 있어서, 견적 화면에서 &lsquo;현재 단가로 다시 계산&rsquo;을 눌러야 바뀝니다.
      </Paragraph>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap size={12}>
            <Select
              style={{ minWidth: 220 }}
              placeholder="회사"
              loading={companies.isLoading}
              value={companyId}
              onChange={(v) => {
                if (changedItems.length && !window.confirm('저장하지 않은 변경이 있습니다. 버리고 회사를 바꿀까요?')) return;
                setCompanyId(v);
              }}
              options={(companies.data || []).map((c) => ({ value: c.id, label: c.name }))}
              aria-label="Company"
            />
            <Segmented
              value={domain}
              onChange={(v) => {
                if (changedItems.length && !window.confirm('저장하지 않은 변경이 있습니다. 버리고 바꿀까요?')) return;
                setDomain(v as PriceDomain);
              }}
              options={DOMAINS}
            />
          </Space>
          <Space wrap size={8}>
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} disabled={!companyId}>
              변경 이력
            </Button>
            <Button onClick={() => setDrafts({})} disabled={!changedItems.length}>
              취소
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={!changedItems.length}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              저장{changedItems.length ? ` (${changedItems.length})` : ''}
            </Button>
          </Space>
        </Space>
        <Space wrap size={12} style={{ marginTop: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="항목 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <Select
            allowClear
            showSearch
            placeholder="모든 그룹"
            value={group}
            onChange={setGroup}
            options={groups.map((g) => ({ value: g, label: g }))}
            style={{ minWidth: 200 }}
          />
          <Space size={6}>
            <Switch size="small" checked={onlyCompany} onChange={setOnlyCompany} />
            <Text>회사 단가만{ownCount ? ` (${ownCount})` : ''}</Text>
          </Space>
          <Popover
            trigger="click"
            title="화면에 보이는 항목 일괄 조정"
            content={(
              <Space direction="vertical" size={8}>
                <Segmented
                  value={bulkSide}
                  onChange={(v) => setBulkSide(v as Side)}
                  options={[{ value: 'labor', label: 'Labor' }, { value: 'material', label: 'Material' }]}
                />
                <InputNumber
                  value={bulkPct}
                  onChange={(v) => setBulkPct(v == null ? null : Number(v))}
                  addonAfter="%"
                  step={1}
                  style={{ width: 160 }}
                />
                <Text type="secondary" style={{ fontSize: 12, maxWidth: 240, display: 'block' }}>
                  지금 화면에 보이는 {filtered.length}개 항목의 {bulkSide === 'labor' ? 'Labor' : 'Material'}을 현재 값에서
                  조정합니다. 저장 전까지는 바뀌지 않아요.
                </Text>
                <Button size="small" type="primary" onClick={applyBulk} disabled={!bulkPct || !filtered.length}>
                  적용
                </Button>
              </Space>
            )}
          >
            <Button icon={<PercentageOutlined />} disabled={!items.length}>일괄 조정</Button>
          </Popover>
        </Space>
      </Card>

      {companies.data && !companies.data.length && (
        <Alert type="warning" showIcon message="단가를 정할 수 있는 회사가 없습니다." />
      )}
      {prices.error && <Alert type="error" showIcon message="단가를 불러오지 못했습니다" style={{ marginBottom: 12 }} />}
      {prices.isLoading && companyId ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      ) : !byGroup.length && items.length ? (
        <Empty description="맞는 항목이 없습니다" />
      ) : (
        byGroup.map(({ group: name, rows }) => (
          <Card
            key={name}
            size="small"
            title={<span>{name} <Text type="secondary" style={{ fontWeight: 400 }}>{rows.length}</Text></span>}
            style={{ marginBottom: 12 }}
            styles={{ body: { padding: 0 } }}
          >
            <Table
              size="small"
              rowKey="key"
              columns={columns}
              dataSource={rows}
              pagination={false}
              scroll={{ x: 900 }}
              rowClassName={(item) => (isChanged(item) ? 'up-row-changed' : '')}
            />
          </Card>
        ))
      )}

      <Drawer
        title="변경 이력"
        width={Math.min(900, typeof window !== 'undefined' ? window.innerWidth : 900)}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <Table
          size="small"
          rowKey={(h) => `${h.key}-${h.changed_at}`}
          loading={history.isLoading}
          columns={historyColumns}
          dataSource={history.data || []}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 760 }}
          locale={{ emptyText: '아직 바꾼 단가가 없습니다' }}
        />
      </Drawer>

      <style>{'.up-row-changed > td { background: #fff7e6 !important; }'}</style>
    </div>
  );
};

export default UnitPrices;
