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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Popconfirm, Popover, Select, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import type {
  AddedSection, AssembledLine, AssembledRoom, Assembly, Basis, CutPart, RebuildLine, RebuildRoom, XactActivity,
  XactimateMatch,
} from '../../types/rebuildEstimate';
import XactimatePicker from './XactimatePicker';
import {
  ACTIVITY_LABEL, ADDED_SECTIONS, BASES, CUT_HEIGHTS, SECTIONS, WALL_BASES, addToRoom, assemblyLines, lineFromXactimate, money, removeLine,
  typedLine, typedQty, updateLine, withActivity, withItem, worded,
} from './lineEdit';
import './rebuildEstimate.css';

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
  { key: 'wall_sf', label: 'Walls', unit: 'SF', hint: 'Every wall, less the doors, openings and windows' },
  { key: 'exterior_wall_sf', label: 'Outside walls', unit: 'SF', hint: 'The outside walls alone, less their doors (insulation)' },
  { key: 'perimeter_lf', label: 'Perimeter', unit: 'LF' },
  { key: 'height_ft', label: 'Height', unit: 'ft', hint: 'Ceiling height: a flood cut is its share of the walls' },
];

const ImportedRow: React.FC<{ line: AssembledLine }> = ({ line }) => (
  <div className="rbe-line" data-testid="imported-line">
    <span className="rbe-n">{line.n}</span>
    <div className="rbe-desc">
      <div className="rbe-desc-text">{line.description}</div>
      {line.notes && <div className="rbe-meta">{line.notes}</div>}
    </div>
    <span className="rbe-qty rbe-fig">{qty(line.quantity)}<span className="rbe-unit">{line.unit}</span></span>
    <span className="rbe-price rbe-fig">{line.unit_price.toFixed(2)}</span>
    <span className="rbe-total rbe-fig">{money(line.total)}</span>
    <span className="rbe-actions" />
  </div>
);

/**
 * A line's quantity: a number, or a sum as on a calculator (16.25*2 + 4.25*2)
 * worked out when the field is left and kept to type again from. Empty: the
 * room's measure it follows.
 */
const QtyInput: React.FC<{
  line: RebuildLine; placeholder: string; onChange: (patch: Partial<RebuildLine>) => void;
}> = ({ line, placeholder, onChange }) => {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = line.quantity != null ? qty(line.quantity) : '';
  const commit = () => {
    if (text === null) return;
    const next = typedQty(text);
    if (next === undefined) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(null);
    const patch: Partial<RebuildLine> = { quantity: next.quantity };
    if (next.qty_formula || line.qty_formula) patch.qty_formula = next.qty_formula;
    if (patch.quantity !== line.quantity || (patch.qty_formula ?? null) !== (line.qty_formula ?? null)) onChange(patch);
  };
  const field = (
    <Input variant="borderless" className={`rbe-field rbe-num rbe-qty-input${line.qty_formula ? ' rbe-has-formula' : ''}`}
      aria-label="Repair quantity" value={text ?? shown} placeholder={placeholder} status={bad ? 'error' : undefined}
      onFocus={() => setText((t) => t ?? (line.qty_formula || (line.quantity != null ? String(line.quantity) : '')))}
      onChange={(e) => {
        setText(e.target.value);
        setBad(false);
      }}
      onBlur={commit}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()} />
  );
  const tip = bad ? "Can't work that out: use numbers with + - * / and brackets"
    : line.qty_formula && text === null ? `= ${line.qty_formula}` : 'A number, or a sum: 16.25*2 + 4.25*2';
  return <Tooltip title={tip} open={bad ? true : undefined} mouseEnterDelay={0.4}>{field}</Tooltip>;
};

/**
 * The line's price list item, as its code: picked, it searches the price
 * list for another item to put in the line's place (a line typed by hand
 * gets one this way)
 */
const ItemSwap: React.FC<{
  line: RebuildLine; estimateId?: string; onPick: (match: XactimateMatch) => void;
}> = ({ line, estimateId, onPick }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Opened: straight into the search, so the item can be typed
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => box.current?.querySelector('input')?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      destroyOnHidden
      title={line.code ? 'Change to another item' : 'Price it from the price list'}
      content={(
        <div ref={box} style={{ width: 380, maxWidth: '80vw' }}>
          <XactimatePicker estimateId={estimateId} autoFocus style={{ width: '100%' }}
            placeholder="Search the price list: vinyl plank, drywall…"
            onPick={(match) => {
              onPick(match);
              setOpen(false);
            }} />
          <div className="rbe-swap-hint">The quantity, room and note stay; the price and words follow the item.</div>
        </div>
      )}
    >
      {line.code ? (
        <Tooltip title="Change to another price list item" mouseEnterDelay={0.4}>
          <button type="button" className="rbe-code rbe-code-btn" aria-label={`Item ${line.code}: change it`}>
            {line.code}
            <SwapOutlined className="rbe-code-swap" />
          </button>
        </Tooltip>
      ) : (
        <Button size="small" type="text" className="rbe-keep rbe-on-hover" icon={<SwapOutlined />} aria-label="Price list item">
          Price list
        </Button>
      )}
    </Popover>
  );
};

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
    const keep = !!(line.code && line.activity && !line.xact_words && onSaveWording && rewritten(line));
    return (
      <div className="rbe-line rbe-added" key={line.id} data-testid="added-line">
        <span className="rbe-n">{done ? done.n : ''}</span>
        <div className="rbe-desc">
          <Input.TextArea variant="borderless" className="rbe-field rbe-desc-input" value={line.description}
            autoSize={{ minRows: 1, maxRows: 4 }}
            aria-label="Repair description" status={line.xact_words ? 'warning' : undefined}
            // Written by hand: no longer Xactimate's words
            onChange={(e) => set(line.id, { description: e.target.value, xact_words: false })} />
          <div className="rbe-meta">
            <ItemSwap line={line} estimateId={estimateId}
              onPick={(match) => onLines(lines.map((l) => (l.id === line.id ? withItem(l, match) : l)))} />
            {line.xact_words && (
              <Tooltip title="These are Xactimate's words. Write them our way; Keep wording uses them for this item from now on.">
                <span className="rbe-pill rbe-pill--orange">Xactimate&apos;s words</span>
              </Tooltip>
            )}
            {line.activities.length > 1 && (
              <Select size="small" variant="borderless" className="rbe-meta-select" popupMatchSelectWidth={false}
                value={line.activity ?? undefined} aria-label="Activity"
                options={line.activities.map((a) => ({ value: a.activity, label: ACTIVITY_LABEL[a.activity] ?? a.label ?? a.activity }))}
                onChange={(a: XactActivity) => onLines(lines.map((l) => (l.id === line.id ? withActivity(l, a) : l)))} />
            )}
            {line.notes && <span className="rbe-note">{line.notes}</span>}
            {roomId && bases.length > 0 && (
              <Select size="small" variant="borderless" popupMatchSelectWidth={false}
                className={`rbe-meta-select${line.basis ? '' : ' rbe-on-hover'}`}
                allowClear value={line.basis ?? undefined} placeholder="Typed qty" aria-label="Quantity follows"
                options={bases.map((b) => ({ value: b.value, label: `Follows ${b.label}` }))}
                onChange={(basis?: Basis) => set(line.id, { basis: basis ?? null })} />
            )}
            {roomId && onWall && (
              <>
                <InputNumber size="small" variant="borderless" className="rbe-meta-number" min={0} max={30}
                  value={line.cut_height_ft ?? null} placeholder="Full height" suffix="ft" aria-label="Cut height"
                  onChange={(v) => set(line.id, { cut_height_ft: v || null })} />
                {!!line.cut_height_ft && (
                  <Select size="small" variant="borderless" className="rbe-meta-select" popupMatchSelectWidth={false}
                    value={line.cut_part ?? 'below'} aria-label="Part of the wall"
                    options={[{ value: 'below', label: 'Below it' }, { value: 'above', label: 'Above it' }]}
                    onChange={(cut_part: CutPart) => set(line.id, { cut_part })} />
                )}
              </>
            )}
          </div>
        </div>
        <span className="rbe-qty">
          <QtyInput line={line} placeholder={done?.auto_qty != null ? qty(done.auto_qty) : ''}
            onChange={(patch) => set(line.id, patch)} />
          <span className="rbe-unit">{line.unit}</span>
        </span>
        <span className="rbe-price">
          <InputNumber variant="borderless" className="rbe-field rbe-num" min={0} value={line.unit_price}
            aria-label="Repair unit price" placeholder={done && !done.price_typed ? done.unit_price.toFixed(2) : ''}
            onChange={(v) => set(line.id, { unit_price: v ?? null })} />
        </span>
        <span className="rbe-total rbe-fig">{done ? money(done.total) : '…'}</span>
        <span className="rbe-actions">
          {keep && (
            <Tooltip title="Keep wording: word this item this way on every estimate of the company from now on">
              <Button size="small" type="text" className="ui-icon-btn rbe-on-hover" icon={<SaveOutlined />}
                onClick={() => onSaveWording!(line)} aria-label="Keep wording" />
            </Tooltip>
          )}
          <Button size="small" type="text" className="ui-icon-btn ui-icon-btn--danger rbe-on-hover" icon={<DeleteOutlined />}
            aria-label="Remove repair" onClick={() => onLines(removeLine(lines, line.id))} />
        </span>
      </div>
    );
  };

  const hasLines = keys.length > 0;

  return (
    <div className="rbe-room" data-testid={`rebuild-room-${roomId ?? 'general'}`}>
      {room && onRoom && drawn && (
        <div className="rbe-facts" data-testid="room-facts">
          {MEASURE_FIELDS.map((f) => {
            const value = room.measures[f.key];
            return (
              <Tooltip key={f.key} title={f.hint}>
                <span className="rbe-fact">
                  <span className="rbe-fact-label">{f.label}</span>
                  <span className="rbe-fact-value">{value != null ? `${qty(value)} ${f.unit}` : 'Empty'}</span>
                </span>
              </Tooltip>
            );
          })}
          <Tooltip title="Its name and measures come from the sketch; take it off the sketch to remove it">
            <Button size="small" type="link" icon={<EditOutlined />} onClick={onOpenSketch} data-testid="room-on-sketch"
              className="rbe-facts-link">
              Edit on the sketch
            </Button>
          </Tooltip>
        </div>
      )}
      {room && onRoom && !drawn && (
        <div className="rbe-facts rbe-facts--edit">
          <label className="rbe-fact rbe-fact--name">
            <span className="rbe-fact-label">Name</span>
            <Input size="small" variant="filled" value={room.name} aria-label="Room name"
              onChange={(e) => onRoom({ name: e.target.value })} />
          </label>
          {MEASURE_FIELDS.map((f) => (
            <Tooltip key={f.key} title={f.hint}>
              <label className="rbe-fact">
                <span className="rbe-fact-label">{f.label}</span>
                <InputNumber size="small" variant="filled" min={0} className="rbe-num" value={room.measures[f.key] ?? null}
                  suffix={f.unit} aria-label={`${f.label} ${f.unit}`}
                  // Ceiling: the floor's when not measured on its own; height: 8'
                  placeholder={f.key === 'ceiling_sf' && room.measures.floor_sf ? String(room.measures.floor_sf)
                    : f.key === 'height_ft' ? '8' : undefined}
                  onChange={(v) => onRoom({ measures: { ...room.measures, [f.key]: v ?? null } })} />
              </label>
            </Tooltip>
          ))}
          {onDelete && (
            imported.length ? (
              <Tooltip title="It holds lines brought in from an estimate: remove or move that estimate first">
                <Button size="small" type="text" className="ui-icon-btn rbe-facts-link" disabled icon={<DeleteOutlined />}>
                  Remove room
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm title={mine.length ? 'Remove this room and its repairs?' : 'Remove this room?'}
                okText="Remove" okButtonProps={{ danger: true }} onConfirm={onDelete}>
                <Button size="small" type="text" className="ui-icon-btn ui-icon-btn--danger rbe-facts-link"
                  icon={<DeleteOutlined />}>Remove room</Button>
              </Popconfirm>
            )
          )}
        </div>
      )}

      {hasLines && (
        <div className="rbe-line rbe-head" aria-hidden>
          <span className="rbe-n">#</span>
          <span className="rbe-desc">Description</span>
          <span className="rbe-qty">Qty</span>
          <span className="rbe-price">Unit price</span>
          <span className="rbe-total">Total</span>
          <span className="rbe-actions" />
        </div>
      )}

      {keys.map((key) => {
        const own = (assembled?.sections || []).find((s) => s.key === key);
        const brought = (own?.lines || []).filter((li) => li.source === 'imported');
        const added = mine.filter((l) => l.section === key);
        const from = Array.from(new Set(brought.map((li) => li.source_label).filter(Boolean)));
        return (
          <div key={key} className="rbe-section">
            <div className="rbe-section-head">
              <span className="rbe-section-title">
                {LABEL.get(key) ?? key}
                {from.length > 0 && <span className="rbe-section-from"> · from {from.join(', ')}</span>}
              </span>
              {own && <span className="rbe-fig">{money(own.total)}</span>}
            </div>
            {brought.map((li) => <ImportedRow key={li.id} line={li} />)}
            {added.map(addedRow)}
          </div>
        );
      })}

      <div className="rbe-add">
        <XactimatePicker estimateId={estimateId} variant="filled" placeholder="Add from Xactimate: drywall, paint…"
          style={{ width: 300 }}
          onPick={(match) => onLines(addToRoom(lines, roomId, [lineFromXactimate(match, roomId, section)], assemblies))} />
        {roomId && (
          <label className="rbe-add-under">
            <span>under</span>
            <Select size="small" variant="borderless" value={section} options={ADDED_SECTIONS} popupMatchSelectWidth={false}
              onChange={setSection} aria-label="Add under" />
          </label>
        )}
        <Button size="small" type="text" icon={<PlusOutlined />}
          onClick={() => onLines(addToRoom(lines, roomId, [typedLine(roomId, section)], assemblies))}>
          Type a line
        </Button>
        {roomId && assemblies && assemblies.length > 0 && (
          <span className="rbe-add-set">
            <Select size="small" variant="filled" value={null} style={{ width: 240 }} placeholder="Add a set…"
              aria-label="Add a set" popupMatchSelectWidth={false}
              options={assemblies.map((a) => ({ value: a.key, label: a.label, title: a.hint }))}
              onChange={(key: string) => {
                const assembly = assemblies.find((a) => a.key === key);
                if (assembly) onLines(addToRoom(lines, roomId, assemblyLines(assembly, roomId, setCut || null), assemblies));
              }} />
            <Tooltip title="How far up the walls a set's new drywall and insulation go; the rest of the wall is painted to match">
              <Select size="small" variant="borderless" value={setCut} options={CUT_OPTIONS} aria-label="Set height"
                popupMatchSelectWidth={false} onChange={setSetCut} />
            </Tooltip>
          </span>
        )}
      </div>
    </div>
  );
};

export default RoomBody;
