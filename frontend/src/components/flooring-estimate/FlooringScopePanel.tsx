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
import { DeleteOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import type {
  CatalogItem, CustomItem, FloorMaterial, FlooringPricingInfo, ItemChoice, JobScope, LayPattern, RoomScope,
  TakeoffItem, TakeoffRoom,
} from '../../types/flooringEstimate';
import {
  addCustom, removeCustom, resetRoomItem, round2, setGeneralItem, setJobDefaults, setJobRoomItem, setRoomField,
  setRoomItem, shownItem, updateCustom,
} from './scope/scopeEdit';

const { Text } = Typography;

const GROUP_ORDER = ['Flooring', 'Trim', 'Detach & Reset', 'Prep', 'Transitions', 'Contents', 'Stairs'];
/** Always listed; the rest of a room's items show when on, or when asked for */
const ALWAYS_SHOWN = new Set(['Flooring', 'Trim']);
/** Bases worth saying under an item: counts read off the sketch */
const SAY_BASIS = new Set([
  'toilet_count', 'vanity_count', 'appliance_count', 'door_count', 'exterior_door_count', 'transition_count', 'toe_kick_lf',
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

const CustomLines: React.FC<{ items: CustomItem[] | undefined; onChange: (next: CustomItem[]) => void }> = ({ items, onChange }) => (
  <div>
    {(items || []).map((c) => (
      <div key={c.id ?? ''} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
        <Input size="small" value={c.description} style={{ flex: '1 1 220px' }} aria-label="Custom line description"
          onChange={(e) => onChange(updateCustom(items, c.id!, { description: e.target.value }))} />
        <InputNumber size="small" min={0} value={c.quantity} style={{ width: 80 }} aria-label="Custom line quantity"
          onChange={(v) => onChange(updateCustom(items, c.id!, { quantity: v ?? 0 }))} />
        <Select size="small" value={c.unit} style={{ width: 72 }} options={UNITS.map((u) => ({ value: u, label: u }))}
          onChange={(unit) => onChange(updateCustom(items, c.id!, { unit }))} />
        <InputNumber size="small" min={0} prefix="$" value={c.unit_price ?? null} style={{ width: 100 }}
          aria-label="Custom line unit price" placeholder="price"
          onChange={(v) => onChange(updateCustom(items, c.id!, { unit_price: v ?? null }))} />
        <Text strong style={{ width: 90, textAlign: 'right', alignSelf: 'center' }}>
          {money(round2((c.quantity || 0) * (c.unit_price || 0)))}
        </Text>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove custom line"
          onClick={() => onChange(removeCustom(items, c.id!))} />
      </div>
    ))}
    <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => onChange(addCustom(items))}>
      Add a line
    </Button>
  </div>
);

const customTotal = (items: CustomItem[] | undefined) =>
  (items || []).reduce((sum, c) => sum + round2((c.quantity || 0) * (c.unit_price || 0)), 0);

// ── The panel ──

const FlooringScopePanel: React.FC<ScopePanelProps> = ({
  rooms, generalItems, pricing, roomScopes, jobScope, onRoomScopes, onJobScope, onGoToSketch,
}) => {
  const catalog = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const c of [...(pricing?.room_items || []), ...(pricing?.general_items || [])]) map.set(c.key, c);
    return map;
  }, [pricing]);
  const materials = pricing?.materials || [];
  const materialLabel = (key?: FloorMaterial | null) => materials.find((m) => m.key === key)?.label ?? key ?? '';
  const materialOptions = materials.map((m) => ({ value: m.key, label: m.label }));
  const patternOptions = (pricing?.patterns || []).map((p) => ({ value: p.key, label: p.label }));
  const defaults = jobScope.defaults || {};
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
    ).total, 0) + customTotal(scope.custom_items));
    const included = scope.included !== false;
    const newMaterial = scope.new_material ?? defaults.new_material ?? null;
    const material = materials.find((m) => m.key === newMaterial);
    const pattern = (scope.pattern ?? defaults.pattern ?? 'straight') as LayPattern;
    const set = (patch: Partial<RoomScope>) => onRoomScopes(setRoomField(roomScopes, room.room_id, patch));

    const header = (
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, width: '100%' }}>
        <Space size={8} wrap>
          <Text strong>{room.subroom_of ? `↳ ${room.name}` : room.name}</Text>
          <Text type="secondary">{room.floor_sf.toFixed(2)} SF</Text>
          {included
            ? (newMaterial ? <Tag>{material?.short ?? newMaterial}</Tag> : <Tag color="warning">No floor picked</Tag>)
            : <Tag>Not in this estimate</Tag>}
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
                    placeholder={String(material.waste_pct[pattern] ?? material.waste_pct.straight ?? '')}
                    onChange={(v) => set({ waste_pct: v ?? null })} aria-label="Waste percent" />
                </Space>
              )}
            </>
          )}
          <Space size={4}>
            <Text type="secondary">Existing floor</Text>
            <Select size="small" allowClear style={{ width: 210 }} value={scope.existing_material ?? undefined}
              placeholder={defaults.existing_material ? `Job default: ${materialLabel(defaults.existing_material)}` : 'Nothing to tear out'}
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
                {everything ? 'Show only what is on' : `${hidden} more: detach & reset, prep, transitions, contents, stairs`}
              </Button>
            )}
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Other work in this room
              </Text>
              <CustomLines items={scope.custom_items} onChange={(next) => set({ custom_items: next })} />
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
  ).total, 0) + customTotal(jobScope.custom_items));
  const warnings = rooms.filter((r) => (roomScopes[r.room_id]?.included ?? true) && !(roomScopes[r.room_id]?.new_material ?? defaults.new_material)
    && roomScopes[r.room_id]?.items?.install?.on !== false);

  return (
    <div data-testid="flooring-scope-panel">
      <Card size="small" title="Every room" style={{ marginBottom: 12 }}>
        <Space wrap size={[16, 8]}>
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
          <CustomLines items={jobScope.custom_items} onChange={(next) => onJobScope({ ...jobScope, custom_items: next })} />
        </div>
      </Card>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
        Amounts here are before material tax and O&amp;P. A price typed in is used as entered. Calculate for the priced estimate.
      </Text>
    </div>
  );
};

export default FlooringScopePanel;
