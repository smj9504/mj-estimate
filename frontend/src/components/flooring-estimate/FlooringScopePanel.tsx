/**
 * Rooms & materials: what goes in each room, and the work that comes with it.
 *
 * Every item is offered on every room with a quantity measured from the
 * sketch; only what the sketch makes plain starts switched on. The
 * estimator switches items per room or for every room, types a quantity or
 * a price where the measured one isn't right, and adds lines the catalog
 * doesn't have. Totals here are before material tax and O&P; Calculate
 * gives the priced estimate.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Collapse, Empty, Input, InputNumber, Segmented, Select, Space, Switch, Tag,
  Tooltip, Typography,
} from 'antd';
import { ClockCircleOutlined, DeleteOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import type {
  CatalogItem, CustomItem, FloorMaterial, FloorWork, FlooringPricingInfo, ItemChoice, JobScope, LayPattern,
  PriceListItem, RefinishFinish, RoomScope, TakeoffItem, TakeoffRoom,
} from '../../types/flooringEstimate';
import {
  LABOR_HOURS, addCustom, addLabor, addPricedCustom, customPrice, isLaborKey, removeCustom, resetRoomItem, round2,
  setGeneralItem, setJobDefaults, setJobRoomItem, setRoomField, setRoomItem, shownItem, updateCustom,
} from './scope/scopeEdit';

const { Text } = Typography;

const GROUP_ORDER = [
  'Flooring', 'Refinish', 'Tear out', 'Trim', 'Detach & Reset', 'Cabinets', 'Prep', 'Transitions', 'Contents', 'Stairs',
];
const WORK_OPTIONS: { value: FloorWork; label: string }[] = [
  { value: 'replace', label: 'New floor' },
  { value: 'refinish', label: 'Sand & refinish' },
];
/** Always listed; the rest of a room's items show when on, or when asked for */
const ALWAYS_SHOWN = new Set(['Flooring', 'Trim']);
/** Bases worth saying under an item: counts read off the sketch */
const SAY_BASIS = new Set([
  'toilet_count', 'vanity_count', 'pedestal_sink_count', 'utility_sink_count', 'register_count', 'appliance_count',
  'refrigerator_count', 'range_count', 'range_gas_count', 'dishwasher_count', 'washer_count', 'dryer_count',
  'dryer_gas_count', 'island_lf', 'island_panel_sf', 'cabinet_run_lf',
  'door_count', 'exterior_door_count', 'transition_count', 'toe_kick_lf',
]);
const UNITS = ['EA', 'SF', 'LF', 'SY', 'HR', 'LS'];

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export interface ScopePanelProps {
  rooms: TakeoffRoom[];
  generalItems: TakeoffItem[];
  pricing?: FlooringPricingInfo;
  roomScopes: Record<string, RoomScope>;
  jobScope: JobScope;
  onRoomScopes: (next: Record<string, RoomScope>) => void;
  onJobScope: (next: JobScope) => void;
  onGoToSketch: () => void;
}

// ── One item: switched on or off, its quantity and price ──

interface ItemRowProps {
  item: TakeoffItem;
  roomChoice?: ItemChoice;
  jobChoice?: ItemChoice;
  catalogPrice?: number;
  onChange: (patch: Partial<ItemChoice>) => void;
  onReset?: () => void;
  hint?: string;
}

const SOURCE_TAG: Record<string, { text: string; color: string } | undefined> = {
  job: { text: 'every room', color: 'geekblue' },
  room: { text: 'set here', color: 'gold' },
};

export const ItemRow: React.FC<ItemRowProps> = ({ item, roomChoice, jobChoice, catalogPrice, onChange, onReset, hint }) => {
  const shown = shownItem(item, roomChoice, jobChoice, catalogPrice);
  const chosen = roomChoice && Object.keys(roomChoice).length > 0;
  const tag = shown.onSource !== 'default' || chosen ? SOURCE_TAG[chosen ? 'room' : shown.onSource] : undefined;
  return (
    <div
      data-testid={`item-${item.key}`}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 0',
        borderBottom: '1px solid #f5f5f5', opacity: shown.on ? 1 : 0.7,
      }}
    >
      <Checkbox checked={shown.on} onChange={(e) => onChange({ on: e.target.checked })} style={{ flex: '1 1 240px', minWidth: 0 }}>
        <span>{item.label}</span>
        {tag && <Tag color={tag.color} style={{ marginLeft: 6 }}>{tag.text}</Tag>}
        {(hint || item.notes) && (
          <div style={{ fontSize: 11, color: '#8c8c8c', lineHeight: 1.3 }}>{item.notes || hint}</div>
        )}
      </Checkbox>
      <Space size={4} wrap>
        <InputNumber
          size="small"
          min={0}
          value={roomChoice?.qty ?? null}
          placeholder={qtyText(item.auto_qty)}
          onChange={(v) => onChange({ qty: v ?? null })}
          style={{ width: 92 }}
          aria-label={`${item.label} quantity`}
        />
        <Text type="secondary" style={{ width: 22, display: 'inline-block', fontSize: 12 }}>{item.unit}</Text>
        <InputNumber
          size="small"
          min={0}
          prefix="$"
          value={roomChoice?.unit_price ?? null}
          placeholder={(jobChoice?.unit_price ?? catalogPrice ?? item.unit_price).toFixed(2)}
          onChange={(v) => onChange({ unit_price: v ?? null })}
          style={{ width: 100 }}
          aria-label={`${item.label} unit price`}
        />
        <Text strong={shown.on} style={{ width: 90, textAlign: 'right', display: 'inline-block' }}>
          {shown.on ? money(shown.total) : '—'}
        </Text>
        {onReset && chosen ? (
          <Tooltip title="Back to the measured quantity, the catalog price and the default">
            <Button size="small" type="text" icon={<UndoOutlined />} onClick={onReset} aria-label={`Reset ${item.label}`} />
          </Tooltip>
        ) : <span style={{ width: 24, display: 'inline-block' }} />}
      </Space>
    </div>
  );
};

// ── Lines the catalog doesn't have ──

interface CustomLinesProps {
  items: CustomItem[] | undefined;
  priceList: PriceListItem[];
  prices: Map<string, number>;
  onChange: (next: CustomItem[]) => void;
  /** The trade an "Add labor hours" line starts on (a price-list key) */
  laborKey?: string;
}

const HOUR_OPTIONS = LABOR_HOURS.map((h) => ({ value: h, label: `${h} hr` }));

const CustomLines: React.FC<CustomLinesProps> = ({ items, priceList, prices, onChange, laborKey }) => {
  const trades = priceList.filter((p) => isLaborKey(p.key));
  const tradeOptions = trades.map((p) => ({
    value: p.key, label: `${p.label.replace(/ - per hour$/, '')} · ${money(p.unit_price)}/hr`,
  }));
  const startOn = laborKey && prices.has(laborKey) ? laborKey : trades[0]?.key;
  return (
    <div>
      {(items || []).map((c) => (
        <div key={c.id ?? ''} data-testid={isLaborKey(c.price_key) ? 'labor-line' : undefined}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
          <Input size="small" value={c.description} style={{ flex: '1 1 220px' }} aria-label="Custom line description"
            placeholder={isLaborKey(c.price_key) ? 'What the hours are for' : undefined}
            onChange={(e) => onChange(updateCustom(items, c.id!, { description: e.target.value }))} />
          {isLaborKey(c.price_key) ? (
            // Hours by the quarter, at the trade's hourly rate
            <>
              <Select size="small" value={c.price_key} style={{ width: 230 }} options={tradeOptions}
                aria-label="Labor trade" onChange={(price_key: string) => onChange(updateCustom(items, c.id!, { price_key }))} />
              <Select size="small" value={c.quantity} style={{ width: 88 }} options={HOUR_OPTIONS}
                aria-label="Labor hours" onChange={(quantity: number) => onChange(updateCustom(items, c.id!, { quantity }))} />
            </>
          ) : (
            <>
              <InputNumber size="small" min={0} value={c.quantity} style={{ width: 80 }} aria-label="Custom line quantity"
                onChange={(v) => onChange(updateCustom(items, c.id!, { quantity: v ?? 0 }))} />
              <Select size="small" value={c.unit} style={{ width: 72 }} options={UNITS.map((u) => ({ value: u, label: u }))}
                onChange={(unit) => onChange(updateCustom(items, c.id!, { unit }))} />
            </>
          )}
          <InputNumber size="small" min={0} prefix="$" value={c.unit_price ?? null} style={{ width: 100 }}
            aria-label="Custom line unit price"
            placeholder={c.price_key && prices.has(c.price_key) ? prices.get(c.price_key)!.toFixed(2) : 'price'}
            onChange={(v) => onChange(updateCustom(items, c.id!, { unit_price: v ?? null }))} />
          <Text strong style={{ width: 90, textAlign: 'right', alignSelf: 'center' }}>
            {money(round2((c.quantity || 0) * customPrice(c, prices)))}
          </Text>
          {c.price_key && c.unit_price == null && (
            <Tooltip title="Priced from the price list, at this estimate's prices; material tax and O&P go on it like any item">
              <Tag style={{ alignSelf: 'center', marginInlineEnd: 0 }}>price list</Tag>
            </Tooltip>
          )}
          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove custom line"
            onClick={() => onChange(removeCustom(items, c.id!))} />
        </div>
      ))}
      <Space wrap size={8} style={{ marginTop: 8 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={() => onChange(addCustom(items))}>
          Add a line
        </Button>
        {startOn && (
          <Tooltip title="Work no line covers, like cutting tile around a column base: a trade's hours, by the quarter hour">
            <Button size="small" icon={<ClockCircleOutlined />} onClick={() => onChange(addLabor(items, startOn))}>
              Add labor hours
            </Button>
          </Tooltip>
        )}
        {priceList.length > 0 && (
          <Select
            size="small"
            showSearch
            value={null}
            placeholder="…or add one from the price list"
            style={{ width: 300 }}
            optionFilterProp="label"
            aria-label="Add from the price list"
            options={Object.entries(groupBy(priceList)).map(([group, list]) => ({
              label: group,
              options: list.map((p) => ({ value: p.key, label: `${p.label} (${p.unit})` })),
            }))}
            onChange={(key: string) => {
              const item = priceList.find((p) => p.key === key);
              if (item) onChange(addPricedCustom(items, item));
            }}
          />
        )}
      </Space>
    </div>
  );
};

function groupBy(list: PriceListItem[]): Record<string, PriceListItem[]> {
  return list.reduce<Record<string, PriceListItem[]>>((acc, p) => {
    (acc[p.group] = acc[p.group] || []).push(p);
    return acc;
  }, {});
}

const customTotal = (items: CustomItem[] | undefined, prices: Map<string, number>) =>
  (items || []).reduce((sum, c) => sum + round2((c.quantity || 0) * customPrice(c, prices)), 0);

// ── The panel ──

const FlooringScopePanel: React.FC<ScopePanelProps> = ({
  rooms, generalItems, pricing, roomScopes, jobScope, onRoomScopes, onJobScope, onGoToSketch,
}) => {
  const catalog = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const c of [...(pricing?.room_items || []), ...(pricing?.general_items || [])]) map.set(c.key, c);
    return map;
  }, [pricing]);
  const priceList = useMemo(() => pricing?.price_list || [], [pricing]);
  const prices = useMemo(() => new Map(priceList.map((p) => [p.key, p.unit_price])), [priceList]);
  const materials = pricing?.materials || [];
  const labor = pricing?.labor;
  const materialLabel = (key?: FloorMaterial | null) => materials.find((m) => m.key === key)?.label ?? key ?? '';
  const materialOptions = materials.map((m) => ({ value: m.key, label: m.label }));
  const patternOptions = (pricing?.patterns || []).map((p) => ({ value: p.key, label: p.label }));
  const finishOptions = (pricing?.finishes || []).map((f) => ({ value: f.key, label: f.label, title: f.includes }));
  const finishLabel = (key?: RefinishFinish | null) => pricing?.finishes?.find((f) => f.key === key)?.label ?? key ?? '';
  const defaults = jobScope.defaults || {};
  const workOf = (scope: RoomScope): FloorWork => scope.work ?? defaults.work ?? 'replace';
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const hintOf = (key: string) => {
    const c = catalog.get(key);
    if (!c) return undefined;
    return c.hint || (SAY_BASIS.has(c.basis) ? c.basis_label : undefined);
  };

  if (!rooms.length) {
    return (
      <Empty description="Draw the rooms first: every quantity here is measured from the sketch.">
        <Button type="primary" onClick={onGoToSketch}>Open the sketch</Button>
      </Empty>
    );
  }

  const roomCard = (room: TakeoffRoom) => {
    const scope = roomScopes[room.room_id] || {};
    const items = room.items.filter((i) => i.source !== 'custom');
    const isOn = (i: TakeoffItem) => shownItem(i, scope.items?.[i.key], jobScope.room_items?.[i.key], undefined).on;
    const everything = !!showAll[room.room_id];
    const listed = items.filter((i) => everything || ALWAYS_SHOWN.has(i.group) || isOn(i));
    const hidden = items.length - listed.length;
    const groups = GROUP_ORDER
      .map((g) => ({ group: g, items: listed.filter((i) => i.group === g) }))
      .filter((g) => g.items.length);
    const total = round2(items.reduce((sum, i) => sum + shownItem(
      i, scope.items?.[i.key], jobScope.room_items?.[i.key], catalog.get(i.key)?.unit_price,
    ).total, 0) + customTotal(scope.custom_items, prices));
    const included = scope.included !== false;
    const refinish = workOf(scope) === 'refinish';
    const newMaterial = refinish ? null : scope.new_material ?? defaults.new_material ?? null;
    const material = materials.find((m) => m.key === newMaterial);
    const pattern = (scope.pattern ?? defaults.pattern ?? 'straight') as LayPattern;
    const set = (patch: Partial<RoomScope>) => onRoomScopes(setRoomField(roomScopes, room.room_id, patch));

    const header = (
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, width: '100%' }}>
        <Space size={8} wrap>
          <Text strong>{room.subroom_of ? `↳ ${room.name}` : room.name}</Text>
          <Text type="secondary">{room.floor_sf.toFixed(2)} SF</Text>
          {!included ? <Tag>Not in this estimate</Tag>
            : refinish ? <Tag color="gold">Sand &amp; refinish</Tag>
              : newMaterial ? <Tag>{material?.short ?? newMaterial}</Tag> : <Tag color="warning">No floor picked</Tag>}
        </Space>
        {included && <Text strong>{money(total)}</Text>}
      </div>
    );

    const body = (
      <div data-testid={`room-scope-${room.room_id}`}>
        <Space wrap size={[16, 8]} style={{ marginBottom: 8 }}>
          <span>
            <Switch size="small" checked={included} onChange={(v) => set({ included: v })} aria-label="In this estimate" />
            <Text style={{ marginLeft: 6 }}>In this estimate</Text>
          </span>
          {included && (
            <Segmented size="small" value={workOf(scope)} options={WORK_OPTIONS} aria-label="Work"
              onChange={(v) => set({ work: v as FloorWork })} />
          )}
          {included && refinish && (
            <Space size={4}>
              <Text type="secondary">Finish</Text>
              <Select size="small" allowClear style={{ width: 290 }} value={scope.finish ?? undefined}
                placeholder={finishLabel(defaults.finish ?? 'natural')}
                options={finishOptions} onChange={(v) => set({ finish: v ?? null })} aria-label="Finish" />
            </Space>
          )}
          {included && !refinish && (
            <>
              <Space size={4}>
                <Text type="secondary">New floor</Text>
                <Select size="small" allowClear style={{ width: 210 }} value={scope.new_material ?? undefined}
                  placeholder={defaults.new_material ? `Job default: ${materialLabel(defaults.new_material)}` : 'Pick a floor'}
                  options={materialOptions} onChange={(v) => set({ new_material: v ?? null })} aria-label="New floor" />
              </Space>
              {material?.patterned && (
                <Space size={4}>
                  <Text type="secondary">Lay</Text>
                  <Select size="small" style={{ width: 130 }} value={scope.pattern ?? undefined} allowClear
                    placeholder={pricing?.patterns.find((p) => p.key === pattern)?.label}
                    options={patternOptions} onChange={(v) => set({ pattern: v ?? null })} aria-label="Pattern" />
                </Space>
              )}
              {material && (
                <Space size={4}>
                  <Text type="secondary">Waste</Text>
                  <InputNumber size="small" min={0} max={100} suffix="%" style={{ width: 84 }} value={scope.waste_pct ?? null}
                    // What the server worked out (the floor's shape for tile and wood), until one is typed
                    placeholder={String(room.waste_pct ?? material.waste_pct[pattern] ?? material.waste_pct.straight ?? '')}
                    onChange={(v) => set({ waste_pct: v ?? null })} aria-label="Waste percent" />
                </Space>
              )}
            </>
          )}
          <Space size={4}>
            <Text type="secondary">{refinish ? 'Floor to sand' : 'Existing floor'}</Text>
            <Select size="small" allowClear style={{ width: 210 }} value={scope.existing_material ?? undefined}
              placeholder={defaults.existing_material ? `Job default: ${materialLabel(defaults.existing_material)}`
                : refinish ? 'Hardwood' : 'Nothing to tear out'}
              options={materialOptions} onChange={(v) => set({ existing_material: v ?? null })} aria-label="Existing floor" />
          </Space>
        </Space>

        <div style={{ fontSize: 12, color: '#595959', marginBottom: 8 }}>
          {room.floor_sf.toFixed(2)} SF floor · {room.perimeter_lf.toFixed(2)} LF perimeter · {room.base_lf.toFixed(2)} LF
          baseboard (less openings{room.cabinet_run_lf ? ' and cabinets' : ''}) · {room.wall_sf.toFixed(2)} SF walls
          {room.transitions.length > 0 && <> · transitions to {room.transitions.join(', ')}</>}
        </div>

        {included && (
          <>
            {groups.map(({ group, items: rows }) => (
              <div key={group} style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{group}</Text>
                {rows.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    roomChoice={scope.items?.[item.key]}
                    jobChoice={jobScope.room_items?.[item.key]}
                    catalogPrice={catalog.get(item.key)?.unit_price}
                    hint={hintOf(item.key)}
                    onChange={(patch) => onRoomScopes(setRoomItem(roomScopes, room.room_id, item.key, patch))}
                    onReset={() => onRoomScopes(resetRoomItem(roomScopes, room.room_id, item.key))}
                  />
                ))}
              </div>
            ))}
            {(hidden > 0 || everything) && (
              <Button type="link" size="small" style={{ paddingInline: 0, marginTop: 4 }}
                data-testid={`more-items-${room.room_id}`}
                onClick={() => setShowAll((s) => ({ ...s, [room.room_id]: !everything }))}>
                {everything ? 'Show only what is on'
                  : `${hidden} more: ${refinish ? 'sanding extras, ' : ''}detach & reset, prep, transitions, contents, stairs`}
              </Button>
            )}
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Other work in this room
              </Text>
              <CustomLines items={scope.custom_items} priceList={priceList} prices={prices}
                laborKey={refinish ? labor?.refinish : newMaterial ? labor?.by_floor[newMaterial] : labor?.general}
                onChange={(next) => set({ custom_items: next })} />
            </div>
          </>
        )}
      </div>
    );
    return { key: room.room_id, label: header, children: body };
  };

  const roomItemsCatalog = pricing?.room_items || [];
  const everyRoomGroups = GROUP_ORDER
    .map((g) => ({ group: g, items: roomItemsCatalog.filter((i) => i.group === g) }))
    .filter((g) => g.items.length);

  const general = generalItems.filter((i) => i.source !== 'custom');
  const generalTotal = round2(general.reduce((sum, i) => sum + shownItem(
    i, jobScope.items?.[i.key], undefined, catalog.get(i.key)?.unit_price,
  ).total, 0) + customTotal(jobScope.custom_items, prices));
  const warnings = rooms.filter((r) => (roomScopes[r.room_id]?.included ?? true)
    && workOf(roomScopes[r.room_id] || {}) !== 'refinish'
    && !(roomScopes[r.room_id]?.new_material ?? defaults.new_material)
    && roomScopes[r.room_id]?.items?.install?.on !== false);

  return (
    <div data-testid="flooring-scope-panel">
      <Card size="small" title="Every room" style={{ marginBottom: 12 }}>
        <Space wrap size={[16, 8]}>
          <Segmented size="small" value={defaults.work ?? 'replace'} options={WORK_OPTIONS} aria-label="Default work"
            onChange={(v) => onJobScope(setJobDefaults(jobScope, { work: v === 'replace' ? null : v as FloorWork }))} />
          {defaults.work === 'refinish' && (
            <Space size={4}>
              <Text type="secondary">Finish</Text>
              <Select size="small" allowClear style={{ width: 290 }} value={defaults.finish ?? undefined}
                placeholder={finishLabel('natural')} options={finishOptions}
                onChange={(v) => onJobScope(setJobDefaults(jobScope, { finish: v ?? null }))} aria-label="Default finish" />
            </Space>
          )}
          <Space size={4}>
            <Text type="secondary">New floor</Text>
            <Select size="small" allowClear style={{ width: 210 }} value={defaults.new_material ?? undefined} placeholder="Pick per room"
              options={materialOptions} onChange={(v) => onJobScope(setJobDefaults(jobScope, { new_material: v ?? null }))}
              aria-label="Default new floor" />
          </Space>
          <Space size={4}>
            <Text type="secondary">Lay</Text>
            <Select size="small" allowClear style={{ width: 130 }} value={defaults.pattern ?? undefined} placeholder="Straight lay"
              options={patternOptions} onChange={(v) => onJobScope(setJobDefaults(jobScope, { pattern: v ?? null }))}
              aria-label="Default pattern" />
          </Space>
          <Space size={4}>
            <Text type="secondary">Existing floor</Text>
            <Select size="small" allowClear style={{ width: 210 }} value={defaults.existing_material ?? undefined}
              placeholder="Pick per room" options={materialOptions}
              onChange={(v) => onJobScope(setJobDefaults(jobScope, { existing_material: v ?? null }))}
              aria-label="Default existing floor" />
          </Space>
        </Space>
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 8 }}
          items={[{
            key: 'every-room-items',
            label: <Text>Switch an item on or off in every room <Text type="secondary">(a room&apos;s own choice still wins)</Text></Text>,
            children: everyRoomGroups.map(({ group, items }) => (
              <div key={group} style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{group}</Text>
                {items.map((c) => {
                  const choice = jobScope.room_items?.[c.key]?.on;
                  return (
                    <div key={c.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}
                      data-testid={`every-room-${c.key}`}>
                      <span>
                        {c.label}
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>{c.rule_label}</div>
                      </span>
                      <Segmented
                        size="small"
                        value={choice == null ? 'default' : choice ? 'on' : 'off'}
                        options={[{ value: 'default', label: 'As above' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
                        onChange={(v) => onJobScope(setJobRoomItem(jobScope, c.key, { on: v === 'default' ? null : v === 'on' }))}
                      />
                    </div>
                  );
                })}
              </div>
            )),
          }]}
        />
      </Card>

      {warnings.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message={`No new floor picked for ${warnings.map((r) => r.name).join(', ')}`}
          description="Pick it on the room or set a default above. A room that is only torn out: switch its new floor off." />
      )}

      <Collapse accordion items={rooms.map(roomCard)} defaultActiveKey={rooms[0]?.room_id} style={{ marginBottom: 12 }} />

      <Card size="small" title={<span>General <Text type="secondary" style={{ fontWeight: 400 }}>— once for the whole job</Text></span>}
        extra={<Text strong>{money(generalTotal)}</Text>}>
        {general.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            roomChoice={jobScope.items?.[item.key]}
            catalogPrice={catalog.get(item.key)?.unit_price}
            hint={hintOf(item.key)}
            onChange={(patch) => onJobScope(setGeneralItem(jobScope, item.key, patch))}
            onReset={() => onJobScope(setGeneralItem(jobScope, item.key, { on: null, qty: null, unit_price: null, note: null }))}
          />
        ))}
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Other work on the job</Text>
          <CustomLines items={jobScope.custom_items} priceList={priceList} prices={prices} laborKey={labor?.general}
            onChange={(next) => onJobScope({ ...jobScope, custom_items: next })} />
        </div>
      </Card>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
        Amounts here are before material tax and O&amp;P. A price typed in is used as entered. Calculate for the priced estimate.
      </Text>
    </div>
  );
};

export default FlooringScopePanel;
