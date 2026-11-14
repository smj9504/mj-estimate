/**
 * One room of a rebuild estimate (or its General section): its measures,
 * then its lines under their sections. Lines brought in from an estimate
 * show as they were priced there; the repairs added here can be changed.
 *
 * A repair is added from the price list, as part of a set (new drywall
 * primed and painted, insulation...), or typed. Its quantity follows the
 * room's measure; a wall's can be only the lower part (a flood cut) or the
 * rest above it. It reads in our words; one still in Xactimate's is marked,
 * and words written on a line can be kept for that item from then on.
 */

import React, { useMemo, useState } from 'react';
import { Button, Input, InputNumber, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type {
  AddedSection, AssembledLine, AssembledRoom, Assembly, Basis, CutPart, RebuildLine, RebuildRoom, XactActivity,
} from '../../types/rebuildEstimate';
import XactimatePicker from './XactimatePicker';
import {
  ADDED_SECTIONS, BASES, CUT_HEIGHTS, SECTIONS, WALL_BASES, assemblyLines, lineFromXactimate, money, removeLine,
  typedLine, updateLine, withActivity, worded,
} from './lineEdit';
import './rebuildEstimate.css';

const { Text } = Typography;

const ORDER = new Map(SECTIONS.map((s, i) => [s.key, i]));
const LABEL = new Map(SECTIONS.map((s) => [s.key, s.label]));
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

interface Props {
  estimateId?: string;
  roomId: string | null;
  room?: RebuildRoom;
  assembled?: AssembledRoom;
  assemblies?: Assembly[];
  lines: RebuildLine[];
  onLines: (next: RebuildLine[]) => void;
  onRoom?: (patch: Partial<RebuildRoom>) => void;
  onDelete?: () => void;
  /** Keep a line's words for its item from now on */
  onSaveWording?: (line: RebuildLine) => void;
  /** A room drawn on the sketch is renamed, measured and removed there */
  onOpenSketch?: () => void;
}

const MEASURE_FIELDS: { key: keyof RebuildRoom['measures']; label: string; unit: string; hint?: string }[] = [
  { key: 'floor_sf', label: 'Floor', unit: 'SF' },
  { key: 'ceiling_sf', label: 'Ceiling', unit: 'SF' },
  { key: 'wall_sf', label: 'Walls', unit: 'SF', hint: 'Every wall, less the doors and openings' },
  { key: 'exterior_wall_sf', label: 'Outside walls', unit: 'SF', hint: 'The outside walls alone, less their doors (insulation)' },
  { key: 'perimeter_lf', label: 'Perimeter', unit: 'LF' },
  { key: 'height_ft', label: 'Height', unit: 'ft', hint: 'Ceiling height: a flood cut is its share of the walls' },
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

/** Written by hand, not as the item is worded now: worth keeping */
const rewritten = (line: RebuildLine) => {
  const ours = line.activities.find((a) => a.activity === line.activity)?.wording;
  return !ours || worded(ours, line.section) !== line.description.trim();
};

const CUT_OPTIONS = [
  { value: 0, label: 'Full height' },
  ...CUT_HEIGHTS.map((h) => ({ value: h, label: `Lower ${h}'` })),
];

const RoomBody: React.FC<Props> = ({
  estimateId, roomId, room, assembled, assemblies, lines, onLines, onRoom, onDelete, onSaveWording, onOpenSketch,
}) => {
  const drawn = !!room?.sketch_room_id;
  const [section, setSection] = useState<AddedSection>(roomId ? 'wall' : 'other');
  const [setCut, setSetCut] = useState<number>(0);
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
    const onWall = !!line.basis && WALL_BASES.includes(line.basis);
    return (
      <div className="rbe-line rbe-added" key={line.id} data-testid="added-line">
        <Text type="secondary" className="rbe-n">{done ? `${done.n}.` : ''}</Text>
        <div className="rbe-desc">
          <Input size="small" value={line.description} aria-label="Repair description"
            status={line.xact_words ? 'warning' : undefined}
            // Written by hand: no longer Xactimate's words
            onChange={(e) => set(line.id, { description: e.target.value, xact_words: false })} />
          <Space size={4} style={{ marginTop: 4 }} wrap>
            {line.code && <Tag style={{ marginInlineEnd: 0 }}>{line.code}</Tag>}
            {line.xact_words && (
              <Tooltip title="These are Xactimate's words. Write them our way; Keep wording uses them for this item from now on.">
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>Xactimate&apos;s words</Tag>
              </Tooltip>
            )}
            {line.code && line.activity && !line.xact_words && onSaveWording && rewritten(line) && (
              <Tooltip title="Word this item this way on every estimate of the company from now on">
                <Button size="small" type="text" icon={<SaveOutlined />} onClick={() => onSaveWording(line)}
                  aria-label="Keep wording">Keep wording</Button>
              </Tooltip>
            )}
            {line.activities.length > 1 && (
              <Select size="small" value={line.activity ?? undefined} style={{ width: 150 }} aria-label="Activity"
                options={line.activities.map((a) => ({ value: a.activity, label: a.label || a.activity }))}
                onChange={(a: XactActivity) => onLines(lines.map((l) => (l.id === line.id ? withActivity(l, a) : l)))} />
            )}
            {roomId && bases.length > 0 && (
              <Select size="small" allowClear value={line.basis ?? undefined} style={{ width: 170 }}
                placeholder="Quantity typed" aria-label="Quantity follows"
                options={bases.map((b) => ({ value: b.value, label: `Follows ${b.label}` }))}
                onChange={(basis?: Basis) => set(line.id, { basis: basis ?? null })} />
            )}
            {roomId && onWall && (
              <Space.Compact size="small">
                <InputNumber size="small" min={0} max={30} value={line.cut_height_ft ?? null} style={{ width: 92 }}
                  placeholder="Full" suffix="ft" aria-label="Cut height"
                  onChange={(v) => set(line.id, { cut_height_ft: v || null })} />
                {!!line.cut_height_ft && (
                  <Select size="small" value={line.cut_part ?? 'below'} style={{ width: 96 }} aria-label="Part of the wall"
                    options={[{ value: 'below', label: 'Below it' }, { value: 'above', label: 'Above it' }]}
                    onChange={(cut_part: CutPart) => set(line.id, { cut_part })} />
                )}
              </Space.Compact>
            )}
          </Space>
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
          <Tooltip title={drawn ? 'Drawn on the sketch: rename it there' : undefined}>
            <Input size="small" value={room.name} style={{ width: 200 }} aria-label="Room name" disabled={drawn}
              onChange={(e) => onRoom({ name: e.target.value })} />
          </Tooltip>
          {MEASURE_FIELDS.map((f) => (
            <Tooltip key={f.key} title={drawn ? `${f.hint ? `${f.hint}. ` : ''}Measured from the sketch` : f.hint}>
              <InputNumber size="small" min={0} style={{ width: f.key === 'height_ft' ? 132 : 188 }}
                value={room.measures[f.key] ?? null} addonBefore={f.label} suffix={f.unit}
                aria-label={`${f.label} ${f.unit}`} disabled={drawn}
                // Ceiling: the floor's when not measured on its own; height: 8'
                placeholder={f.key === 'ceiling_sf' && room.measures.floor_sf ? String(room.measures.floor_sf)
                  : f.key === 'height_ft' ? '8' : undefined}
                onChange={(v) => onRoom({ measures: { ...room.measures, [f.key]: v ?? null } })} />
            </Tooltip>
          ))}
          {drawn && (
            <Tooltip title="Its name and measures come from the sketch; take it off the sketch to remove it">
              <Button size="small" type="link" icon={<EditOutlined />} onClick={onOpenSketch} data-testid="room-on-sketch">
                On the sketch
              </Button>
            </Tooltip>
          )}
          {onDelete && !drawn && (
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
        {roomId && assemblies && assemblies.length > 0 && (
          <Space.Compact size="small">
            <Select size="small" value={null} style={{ width: 300 }} placeholder="Add a set: new drywall, insulation, paint…"
              aria-label="Add a set" popupMatchSelectWidth={false}
              options={assemblies.map((a) => ({ value: a.key, label: a.label, title: a.hint }))}
              onChange={(key: string) => {
                const assembly = assemblies.find((a) => a.key === key);
                if (assembly) onLines([...lines, ...assemblyLines(assembly, roomId, setCut || null)]);
              }} />
            <Tooltip title="How far up the walls a set's new drywall and insulation go; the rest of the wall is painted to match">
              <Select size="small" value={setCut} style={{ width: 120 }} options={CUT_OPTIONS} aria-label="Set height"
                onChange={setSetCut} />
            </Tooltip>
          </Space.Compact>
        )}
        {roomId && (
          <Select size="small" value={section} style={{ width: 100 }} options={ADDED_SECTIONS}
            onChange={setSection} aria-label="Add under" />
        )}
        <XactimatePicker estimateId={estimateId}
          onPick={(match) => onLines([...lines, lineFromXactimate(match, roomId, section)])} />
        <Button size="small" icon={<PlusOutlined />} onClick={() => onLines([...lines, typedLine(roomId, section)])}>
          Type a line
        </Button>
      </Space>
    </div>
  );
};

export default RoomBody;
