/**
 * Roofing Pricing Settings — INTERNAL ONLY
 *
 * Both halves of what an estimate is priced from, in one place:
 *
 *   1. Calculation rates (editable) — installed rates, pitch and story
 *      multipliers, waste factors, sales tax, permit fees, and the
 *      fallback material portions.
 *   2. Material costs (read-only) — what the supplier charges.
 *
 * The material tab is deliberately read-only. Editing a supplier cost
 * stays on the Material Prices screen, which carries the supplier, SKU,
 * packaging and quantity formula that give a cost its meaning; a bare
 * number edited out of that context is how the two price books drift
 * apart. Showing it here is about answering "what is the $750/SQ
 * installed rate actually covering" while setting that rate.
 *
 * A setting with no stored override tracks the code default, so a later
 * change to a default still reaches anyone who never overrode it.
 * Editing here affects estimates calculated from now on; existing
 * estimates keep their totals until someone recalculates them.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  InfoCircleOutlined,
  LockOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roofingEstimateService } from '../services/roofingEstimateService';
import type {
  PricingSettingEntry,
  PricingSettingPatch,
} from '../types/roofingEstimate';

const { Title, Text, Paragraph } = Typography;

const keyOf = (s: { setting_group: string; setting_key: string }) =>
  `${s.setting_group}:${s.setting_key}`;

/** Trailing zeros trimmed: 750 -> "750", 0.1325 -> "0.13". */
const trim = (v: number, digits = 2) =>
  (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });

/**
 * A setting is shown in the unit people actually talk in: a percentage
 * is stored as 0.06 but read and typed as 6, a multiplier stays as it
 * is, and money keeps two decimals.
 */
const display = (value: number, kind: string) =>
  kind === 'pct' ? value * 100 : value;

const store = (shown: number, kind: string) =>
  kind === 'pct' ? shown / 100 : shown;

const format = (value: number, kind: string) => {
  if (kind === 'pct') return `${trim(value * 100)}%`;
  if (kind === 'rate') return `${trim(value, 3)}×`;
  return `$${trim(value)}`;
};

const RoofingPricingSettings: React.FC = () => {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['roofing-pricing-settings'],
    queryFn: () => roofingEstimateService.listPricingSettings(),
  });


  const saveMutation = useMutation({
    mutationFn: (patches: PricingSettingPatch[]) =>
      roofingEstimateService.updatePricingSettings(patches),
    onSuccess: (result) => {
      queryClient.setQueryData(['roofing-pricing-settings'], result);
      // A changed rate changes what the next calculation produces, so
      // any estimate already on screen is now showing stale totals.
      queryClient.invalidateQueries({ queryKey: ['roofing-estimate'] });
      setDrafts({});
      message.success(
        '저장되었습니다 — 다시 계산하는 견적부터 적용됩니다',
      );
    },
    onError: (err: any) => {
      message.error(
        err?.response?.data?.detail || '저장에 실패했습니다',
      );
    },
  });

  const settings = data?.settings ?? [];
  // How many rates the price book could be matched to, so a broken
  // link shows up as a falling count rather than silent dashes.
  const linkedCount = useMemo(
    () => settings.filter((x) => x.material_cost != null).length,
    [settings],
  );

  const setDraft = useCallback(
    (entry: PricingSettingEntry, shown: number | null) => {
      const k = keyOf(entry);
      setDrafts((prev) => {
        const next = { ...prev };
        if (shown === null || Number.isNaN(shown)) {
          delete next[k];
          return next;
        }
        const value = store(shown, entry.kind);
        // Typing the current value back is not an edit.
        if (Math.abs(value - entry.value) < 1e-9) {
          delete next[k];
          return next;
        }
        next[k] = value;
        return next;
      });
    },
    [],
  );

  /** Queue a reset — applied on save like any other edit. */
  const queueReset = useCallback((entry: PricingSettingEntry) => {
    setDrafts((prev) => ({ ...prev, [keyOf(entry)]: null }));
  }, []);

  const dirtyCount = Object.keys(drafts).length;

  const handleSave = () => {
    const patches: PricingSettingPatch[] = Object.entries(drafts).map(
      ([k, value]) => {
        const [setting_group, ...rest] = k.split(':');
        return { setting_group, setting_key: rest.join(':'), value };
      },
    );
    if (!patches.length) return;
    saveMutation.mutate(patches);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return settings;
    return settings.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.group_label.toLowerCase().includes(q) ||
        s.setting_key.toLowerCase().includes(q),
    );
  }, [settings, search]);

  /** Grouped in the order the backend declares, not alphabetically. */
  const grouped = useMemo(() => {
    const order = (data?.groups ?? []).map((g) => g.group);
    const byGroup = new Map<string, PricingSettingEntry[]>();
    filtered.forEach((s) => {
      const list = byGroup.get(s.setting_group) ?? [];
      list.push(s);
      byGroup.set(s.setting_group, list);
    });
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({
        group: g,
        label: byGroup.get(g)![0].group_label,
        help: data?.groups.find((x) => x.group === g)?.help,
        rows: byGroup.get(g)!,
      }));
  }, [filtered, data?.groups]);

  const columns = [
    {
      title: '항목',
      dataIndex: 'label',
      width: '30%',
      render: (label: string, row: PricingSettingEntry) => (
        <Space size={4}>
          <Text>{label}</Text>
          {row.unit && <Text type="secondary">({row.unit})</Text>}
        </Space>
      ),
    },
    {
      title: '현재 값',
      width: 150,
      render: (_: unknown, row: PricingSettingEntry) => {
        const k = keyOf(row);
        const draft = k in drafts ? drafts[k] : undefined;
        const effective =
          draft === undefined
            ? row.value
            : draft === null
              ? (row.default_value ?? row.value)
              : draft;
        return (
          <Space direction="vertical" size={0}>
            <Text strong>{format(effective, row.kind)}</Text>
            {draft !== undefined && (
              <Text type="warning" style={{ fontSize: 12 }}>
                {draft === null ? '기본값으로 되돌림' : '변경됨'}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: '수정',
      width: 180,
      render: (_: unknown, row: PricingSettingEntry) => {
        const k = keyOf(row);
        const draft = k in drafts ? drafts[k] : undefined;
        const shown =
          draft === undefined
            ? row.value
            : draft === null
              ? (row.default_value ?? row.value)
              : draft;
        return (
          <InputNumber
            style={{ width: '100%' }}
            value={display(shown, row.kind)}
            min={0}
            step={row.kind === 'money' ? 5 : row.kind === 'pct' ? 0.5 : 0.05}
            precision={row.kind === 'money' ? 2 : row.kind === 'pct' ? 2 : 3}
            addonAfter={
              row.kind === 'pct' ? '%' : row.kind === 'rate' ? '×' : '$'
            }
            onChange={(v) => setDraft(row, v as number | null)}
          />
        );
      },
    },
    {
      title: (
        <Space size={4}>
          자재 원가
          <Tooltip
            title={
              '이 단가에 들어가는 주요 자재의 공급업체 원가입니다. ' +
              '비교할 수 있도록 단가와 같은 단위로 환산했습니다. ' +
              '못·실란트 등 부자재는 포함되지 않으므로 전체 원가가 ' +
              '아니며, 수정은 자재 기본 단가 화면에서 합니다.'
            }
          >
            <LockOutlined style={{ color: '#999', fontSize: 12 }} />
          </Tooltip>
        </Space>
      ),
      width: 190,
      render: (_: unknown, row: PricingSettingEntry) => {
        if (row.material_cost === null || row.material_cost === undefined) {
          return (
            <Tooltip title="이 단가에 대응하는 단일 주요 자재가 없습니다">
              <Text type="secondary">—</Text>
            </Tooltip>
          );
        }
        const draft = drafts[keyOf(row)];
        const effective =
          draft === undefined
            ? row.value
            : draft === null
              ? (row.default_value ?? row.value)
              : draft;
        // Share of the rate that is this material — the number people
        // actually reason about when deciding whether a rate is right.
        const pct = effective > 0
          ? (row.material_cost / effective) * 100 : 0;
        const tight = pct >= 60;
        return (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <Text>${trim(row.material_cost, 4)}</Text>
              {row.unit && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  /{row.unit.split(' ')[0]}
                </Text>
              )}
              <Text
                type={tight ? 'danger' : 'secondary'}
                style={{ fontSize: 12 }}
              >
                ({pct.toFixed(0)}%)
              </Text>
            </Space>
            <Tooltip
              title={`${row.material_label ?? ''} — 구매 단가 ` +
                `$${trim(row.material_unit_cost ?? 0, 4)}/` +
                `${row.material_purchase_unit ?? ''}` +
                (row.material_per_rate_unit && row.material_rate_unit
                  ? ` × ${trim(row.material_per_rate_unit, 4)} ` +
                    `${row.material_purchase_unit}/${row.material_rate_unit}`
                  : '') +
                ' (환산 비율은 자재 기본 단가의 포장 규칙에서 옵니다)'}
            >
              <Text type="secondary" style={{ fontSize: 11 }}>
                ${trim(row.material_unit_cost ?? 0, 2)}/
                {row.material_purchase_unit}
                {row.material_per_rate_unit != null
                  && row.material_rate_unit
                  && row.material_per_rate_unit !== 1 && (
                  <> × {trim(row.material_per_rate_unit, 3)}</>
                )}
              </Text>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '기본값',
      width: 130,
      render: (_: unknown, row: PricingSettingEntry) =>
        row.default_value === null || row.default_value === undefined ? (
          <Text type="secondary">—</Text>
        ) : (
          <Space size={4}>
            <Text type="secondary">
              {format(row.default_value, row.kind)}
            </Text>
            {row.is_overridden && <Tag color="blue">수정됨</Tag>}
          </Space>
        ),
    },
    {
      title: '',
      width: 90,
      render: (_: unknown, row: PricingSettingEntry) => {
        const k = keyOf(row);
        const canReset = row.is_overridden || k in drafts;
        if (!canReset) return null;
        return (
          <Tooltip title="기본값으로 되돌리기">
            <Button
              size="small"
              type="text"
              icon={<UndoOutlined />}
              onClick={() => queueReset(row)}
            />
          </Tooltip>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ marginBottom: 4 }}>
            견적 계산 단가 설정
          </Title>
          <Text type="secondary">
            설치 단가 · 배수 · 폐기율 · 세금 · 허가비 — 자재 원가를
            나란히 보며 조정
          </Text>
        </Col>
        <Col>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isFetching}
            >
              새로고침
            </Button>
            {(
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!dirtyCount}
                loading={saveMutation.isPending}
                onClick={handleSave}
              >
                저장{dirtyCount ? ` (${dirtyCount})` : ''}
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginBottom: 16 }}
        message="자재 원가는 참고용으로 나란히 표시됩니다"
        description={
          <Paragraph style={{ marginBottom: 0 }}>
            <b>현재 값</b>은 자재와 인건비가 합쳐진 설치 단가로, 견적
            금액을 직접 결정합니다. 옆의 <b>자재 원가</b>는 그 단가에
            들어가는 주요 자재의 공급업체 원가를 같은 단위로 환산한
            것으로, <u>조회 전용</u>입니다. 못·실란트 등 부자재는
            빠져 있어 전체 원가가 아닙니다. 자재 원가 수정은{' '}
            <Link to="/roofing/material-prices">자재 기본 단가</Link>{' '}
            화면에서 — 공급업체·SKU·포장 규칙과 함께 관리해야 합니다.
          </Paragraph>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="계산 단가 항목" value={settings.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="자재 원가 연결됨"
              value={linkedCount}
              prefix={<LockOutlined style={{ fontSize: 14 }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="기본값에서 수정됨"
              value={data?.overridden_count ?? 0}
              valueStyle={{
                color: (data?.overridden_count ?? 0) > 0
                  ? '#1677ff' : undefined,
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="저장 대기"
              value={dirtyCount}
              valueStyle={{ color: dirtyCount ? '#fa8c16' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="검색 (예: shingle, pitch, tax, GAF)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 400 }}
      />

      {dirtyCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`저장하지 않은 변경 ${dirtyCount}건`}
          action={
            <Popconfirm
              title="변경사항을 모두 취소할까요?"
              onConfirm={() => setDrafts({})}
              okText="취소"
              cancelText="유지"
            >
              <Button size="small">되돌리기</Button>
            </Popconfirm>
          }
        />
      )}

      {grouped.length === 0 ? (
        <Empty description="검색 결과가 없습니다" />
      ) : (
        grouped.map((g) => (
          <Card
            key={g.group}
            size="small"
            style={{ marginBottom: 16 }}
            title={
              <Space>
                <Text strong>{g.label}</Text>
                <Text type="secondary" style={{ fontWeight: 400 }}>
                  {g.rows.length}개
                </Text>
              </Space>
            }
          >
            {g.help && (
              <Text
                type="secondary"
                style={{ display: 'block', marginBottom: 8 }}
              >
                {g.help}
              </Text>
            )}
            <Table
              rowKey={keyOf}
              size="small"
              pagination={false}
              columns={columns as any}
              dataSource={g.rows}
            />
          </Card>
        ))
      )}
    </div>
  );
};

export default RoofingPricingSettings;
