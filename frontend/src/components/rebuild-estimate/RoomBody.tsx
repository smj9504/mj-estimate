/**
 * One room of a rebuild estimate (or its General section): its measures,
 * then its lines under their sections. Lines brought in from an estimate
 * show as they were priced there; the repairs added here can be changed.
 */

import React, { useMemo, useState } from 'react';
import { Button, Input, InputNumber, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type {
  AddedSection, AssembledLine, AssembledRoom, Basis, RebuildLine, RebuildRoom, XactActivity,
} from '../../types/rebuildEstimate';
import XactimatePicker from './XactimatePicker';
import {
  ADDED_SECTIONS, BASES, SECTIONS, lineFromXactimate, money, removeLine, typedLine, updateLine, withActivity,
} from './lineEdit';
import './rebuildEstimate.css';

const { Text } = Typography;

const ORDER = new Map(SECTIONS.map((s, i) => [s.key, i]));
const LABEL = new Map(SECTIONS.map((s) => [s.key, s.label]));
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

interface Props {
  roomId: string | null;
  room?: RebuildRoom;
  assembled?: AssembledRoom;
  lines: RebuildLine[];
  onLines: (next: RebuildLine[]) => void;
  onRoom?: (patch: Partial<RebuildRoom>) => void;
  onDelete?: () => void;
}

const MEASURE_FIELDS: { key: keyof RebuildRoom['measures']; label: string; unit: string }[] = [
  { key: 'floor_sf', label: 'Floor', unit: 'SF' },
  { key: 'ceiling_sf', label: 'Ceiling', unit: 'SF' },
  { key: 'wall_sf', label: 'Walls', unit: 'SF' },
  { key: 'perimeter_lf', label: 'Perimeter', unit: 'LF' },
];

const ImportedRow: React.FC<{ line: AssembledLine }> = ({ line }) => (
  <div className="rbe-line" data-testid="imported-line">
    <Text type="secondary" className="rbe-n">{line.n}.</Text>
    <div className="rbe-desc">
      {line.description}
      {line.notes && <div className="rbe-note">{line.notes}</div>}
    </div>
    <Text type="secondary" className="rbe-qty">{qty(line.quantity)} {line.unit}</Text>
    <Text type="secondary" className="rbe-price">{line.unit_price.toFixed(2)}</Text>
    <Text className="rbe-total">{money(line.total)}</Text>
    <span className="rbe-tail" />
  </div>
);

const RoomBody: React.FC<Props> = ({ roomId, room, assembled, lines, onLines, onRoom, onDelete }) => {
  const [section, setSection] = useState<AddedSection>(roomId ? 'wall' : 'other');
  const mine = lines.filter((l) => (l.room_id ?? null) === roomId);
  const computed = useMemo(() => {
    const map = new Map<string, AssembledLine>();
    for (const s of assembled?.sections || []) for (const li of s.lines) map.set(li.id, li);
    return map;
  }, [assembled]);
  const imported = (assembled?.sections || []).flatMap((s) => s.lines.filter((li) => li.source === 'imported'));
  const keys = Array.from(new Set([
    ...(assembled?.sections || []).map((s) => s.key),
    ...mine.map((l) => l.section),
  ])).sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99));
  const set = (id: string, patch: Partial<RebuildLine>) => onLines(updateLine(lines, id, patch));

  const addedRow = (line: RebuildLine) => {
    const done = computed.get(line.id);
    const bases = BASES.filter((b) => b.unit === line.unit);
    return (
      <div className="rbe-line rbe-added" key={line.id} data-testid="added-line">
        <Text type="secondary" className="rbe-n">{done ? `${done.n}.` : ''}</Text>
        <div className="rbe-desc">
          <Input size="small" value={line.description} aria-label="Repair description"
            onChange={(e) => set(line.id, { description: e.target.value })} />
          {(line.code || line.activities.length > 1) && (
            <Space size={4} style={{ marginTop: 4 }} wrap>
              {line.code && <Tag style={{ marginInlineEnd: 0 }}>{line.code}</Tag>}
              {line.activities.length > 1 && (
                <Select size="small" value={line.activity ?? undefined} style={{ width: 150 }} aria-label="Activity"
                  options={line.activities.map((a) => ({ value: a.activity, label: a.label || a.activity }))}
                  onChange={(a: XactActivity) => onLines(lines.map((l) => (l.id === line.id ? withActivity(l, a) : l)))} />
              )}
              {roomId && bases.length > 0 && (
                <Select size="small" allowClear value={line.basis ?? undefined} style={{ width: 150 }}
                  placeholder="Quantity typed" aria-label="Quantity follows"
                  options={bases.map((b) => ({ value: b.value, label: `Follows ${b.label}` }))}
                  onChange={(basis?: Basis) => set(line.id, { basis: basis ?? null })} />
              )}
            </Space>
          )}
        </div>
        <span className="rbe-qty">
          <InputNumber size="small" min={0} value={line.quantity} style={{ width: 84 }} aria-label="Repair quantity"
            placeholder={done?.auto_qty != null ? qty(done.auto_qty) : ''}
            onChange={(v) => set(line.id, { quantity: v ?? null })} />
          <Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }}>{line.unit}</Text>
        </span>
        <span className="rbe-price">
          <InputNumber size="small" min={0} prefix="$" value={line.unit_price} style={{ width: 96 }}
            aria-label="Repair unit price" placeholder={done && !done.price_typed ? done.unit_price.toFixed(2) : ''}
            onChange={(v) => set(line.id, { unit_price: v ?? null })} />
        </span>
        <Text strong className="rbe-total">{done ? money(done.total) : '…'}</Text>
        <span className="rbe-tail">
          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove repair"
            onClick={() => onLines(removeLine(lines, line.id))} />
        </span>
      </div>
    );
  };

  return (
    <div data-testid={`rebuild-room-${roomId ?? 'general'}`}>
      {room && onRoom && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Input size="small" value={room.name} style={{ width: 200 }} aria-label="Room name"
            onChange={(e) => onRoom({ name: e.target.value })} />
          {MEASURE_FIELDS.map((f) => (
            <InputNumber key={f.key} size="small" min={0} style={{ width: 176 }} value={room.measures[f.key] ?? null}
              addonBefore={f.label} suffix={f.unit} aria-label={`${f.label} ${f.unit}`}
              // Ceiling: the floor's when not measured on its own
              placeholder={f.key === 'ceiling_sf' && room.measures.floor_sf ? String(room.measures.floor_sf) : undefined}
              onChange={(v) => onRoom({ measures: { ...room.measures, [f.key]: v ?? null } })} />
          ))}
          {onDelete && (
            imported.length ? (
              <Tooltip title="It holds lines brought in from an estimate: remove or move that estimate first">
                <Button size="small" type="text" disabled icon={<DeleteOutlined />}>Remove room</Button>
              </Tooltip>
            ) : (
              <Popconfirm title={mine.length ? 'Remove this room and its repairs?' : 'Remove this room?'}
                okText="Remove" okButtonProps={{ danger: true }} onConfirm={onDelete}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />}>Remove room</Button>
              </Popconfirm>
            )
          )}
        </div>
      )}

      {keys.map((key) => {
        const own = (assembled?.sections || []).find((s) => s.key === key);
        const brought = (own?.lines || []).filter((li) => li.source === 'imported');
        const added = mine.filter((l) => l.section === key);
        const from = Array.from(new Set(brought.map((li) => li.source_label).filter(Boolean)));
        return (
          <div key={key} style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid #e6e9ee' }}>
              <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {LABEL.get(key) ?? key}
                {from.length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0 }}> · from {from.join(', ')}</span>}
              </Text>
              {own && <Text type="secondary" style={{ fontSize: 12 }}>{money(own.total)}</Text>}
            </div>
            {brought.map((li) => <ImportedRow key={li.id} line={li} />)}
            {added.map(addedRow)}
          </div>
        );
      })}

      <Space wrap size={8} style={{ marginTop: 12 }}>
        {roomId && (
          <Select size="small" value={section} style={{ width: 100 }} options={ADDED_SECTIONS}
            onChange={setSection} aria-label="Add under" />
        )}
        <XactimatePicker onPick={(match) => onLines([...lines, lineFromXactimate(match, roomId, section)])} />
        <Button size="small" icon={<PlusOutlined />} onClick={() => onLines([...lines, typedLine(roomId, section)])}>
          Type a line
        </Button>
      </Space>
    </div>
  );
};

export default RoomBody;
