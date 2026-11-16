/**
 * The repairs added on a rebuild estimate: made from an Xactimate price list
 * match, a set of them, or typed in, and changed. Pure, so it is tested on
 * its own.
 *
 * A line from the price list is written in our words (the wording the server
 * sends with each activity: the company's, else ours), not Xactimate's
 * (owner, 2026-11-13). A line with no words of ours comes in in Xactimate's,
 * marked, until the estimator writes it our way.
 */

import type {
  ActivityPrice, AddedSection, Assembly, Basis, CutPart, RebuildLine, RebuildRoom, XactActivity, XactimateMatch,
} from '../../types/rebuildEstimate';

let seq = 0;
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A room's sections, in the order they print (assemble.SECTIONS on the server) */
export const SECTIONS: { key: string; label: string }[] = [
  { key: 'floor', label: 'Floor' },
  { key: 'cabinets', label: 'Cabinets' },
  { key: 'bath_1', label: 'Demo & Disposal' },
  { key: 'bath_2', label: 'Rough Trades (Plumbing & Electrical)' },
  { key: 'bath_3', label: 'Substrate & Waterproofing' },
  { key: 'bath_4', label: 'Tile & Flooring' },
  { key: 'bath_5', label: 'Fixtures Install' },
  { key: 'bath_6', label: 'Finish (Paint & Trim)' },
  { key: 'bath_7', label: 'Punch / Cleanup / Accessories' },
  { key: 'wall', label: 'Wall' },
  { key: 'ceiling', label: 'Ceiling' },
  { key: 'other', label: 'Other' },
];
export const ADDED_SECTIONS: { value: AddedSection; label: string }[] = [
  { value: 'wall', label: 'Wall' },
  { value: 'ceiling', label: 'Ceiling' },
  { value: 'floor', label: 'Floor' },
  { value: 'other', label: 'Other' },
];
export const BASES: { value: Basis; label: string; unit: string }[] = [
  { value: 'wall_sf', label: 'Wall SF', unit: 'SF' },
  { value: 'exterior_wall_sf', label: 'Outside wall SF', unit: 'SF' },
  { value: 'ceiling_sf', label: 'Ceiling SF', unit: 'SF' },
  { value: 'floor_sf', label: 'Floor SF', unit: 'SF' },
  { value: 'perimeter_lf', label: 'Perimeter LF', unit: 'LF' },
];
/** The measures a cut height applies to */
export const WALL_BASES: Basis[] = ['wall_sf', 'exterior_wall_sf'];
/** Flood cut heights offered */
export const CUT_HEIGHTS = [2, 4];

/** The surface our words name ({S}) under each section */
export const SURFACE: Record<AddedSection, string> = {
  wall: 'Walls', ceiling: 'Ceiling', floor: 'Floor', other: 'Surfaces',
};
/** How Xactimate's {V} reads under each section */
const XACT_SURFACE: Record<AddedSection, string> = {
  wall: 'the walls', ceiling: 'the ceiling', floor: 'the floor', other: 'the surface area',
};
const PREFIX: Partial<Record<XactActivity, string>> = {
  '&': 'R&R ', '-': 'Remove ', R: 'Detach & Reset ', M: 'Material Only ', I: 'Install ',
};
const PREFIXES = Object.values(PREFIX) as string[];

/** Xactimate's own words for an activity: "R&R ...", "Remove ...", plain for replace */
export function describe(description: string, activity: XactActivity | null | undefined, section: AddedSection): string {
  const bare = PREFIXES.reduce((d, p) => (d.startsWith(p) ? d.slice(p.length) : d), description)
    .replace(/\{V\}/g, XACT_SURFACE[section]);
  return `${(activity && PREFIX[activity]) || ''}${bare}`;
}

/** Our words, with the surface named */
export const worded = (wording: string, section: AddedSection) => wording.replace(/\{S\}/g, SURFACE[section]);

/** Words to keep for next time: the surface they name made {S} again */
export function asWording(description: string, section: AddedSection): string {
  const surface = SURFACE[section];
  return description.trim().startsWith(surface) ? `{S}${description.trim().slice(surface.length)}` : description.trim();
}

/** A line's words for an activity: ours when there are some, else Xactimate's (marked) */
function wordsFor(
  activities: ActivityPrice[], activity: XactActivity | null | undefined, section: AddedSection, xactimate: string,
): { description: string; xact_words: boolean } {
  const ours = activities.find((a) => a.activity === activity)?.wording;
  return ours
    ? { description: worded(ours, section), xact_words: false }
    : { description: describe(xactimate, activity, section), xact_words: true };
}

/** What a line's quantity follows by default: the surface it is under, in its unit */
export function defaultBasis(unit: string, section: AddedSection): Basis | null {
  if (unit === 'LF') return 'perimeter_lf';
  if (unit !== 'SF') return null;
  if (section === 'wall') return 'wall_sf';
  if (section === 'ceiling') return 'ceiling_sf';
  if (section === 'floor') return 'floor_sf';
  return null;
}

interface LineOptions {
  activity?: XactActivity;
  basis?: Basis | null;
  cut_height_ft?: number | null;
  cut_part?: CutPart | null;
}

/** An Xactimate item as a line: its own activity (an R&R item as R&R), quantity from the room */
export function lineFromXactimate(
  match: XactimateMatch, roomId: string | null, section: AddedSection, options: LineOptions = {},
): RebuildLine {
  const chosen = match.activities.find((a) => a.activity === options.activity) ?? match.activities[0];
  const basis = roomId ? (options.basis !== undefined ? options.basis : defaultBasis(match.unit, section)) : null;
  const cut = basis && WALL_BASES.includes(basis) ? options.cut_height_ft ?? null : null;
  const activities = match.activities.map(({ activity: a, label, price, material_share, wording, note }: ActivityPrice) => ({
    activity: a, label, price, material_share, wording: wording ?? null, note: note ?? null,
  }));
  return {
    id: newId(),
    room_id: roomId,
    section,
    ...wordsFor(activities, chosen?.activity, section, match.description),
    unit: match.unit || 'EA',
    quantity: basis ? null : 1,
    basis,
    cut_height_ft: cut,
    cut_part: (cut && options.cut_part) || 'below',
    unit_price: null,
    code: match.code,
    activity: chosen?.activity ?? null,
    price_list: match.price_list,
    activities,
    // What its price pays for, where the item comes with a note
    notes: chosen?.note ?? null,
  };
}

/**
 * A line's note once it is another activity or item: one written for it
 * stays; one it came with (or none) is the new one's.
 */
function noteAfter(line: RebuildLine, activities: ActivityPrice[], activity: XactActivity | null | undefined): string | null {
  const cameWith = line.activities.find((a) => a.activity === line.activity)?.note ?? null;
  const note = line.notes?.trim() || null;
  if (note && note !== cameWith?.trim()) return line.notes ?? null;
  return activities.find((a) => a.activity === activity)?.note ?? null;
}

/**
 * Another price list item in a line's place: its code, activities, unit and
 * price (a price typed on the line gives way to the item's), worded as a new
 * line of it would be. The line keeps its room and section, a note written
 * for it (one it came with is the new item's), and its quantity (typed or
 * followed) while the unit is the same; the activity stays when the item has it.
 */
export function withItem(line: RebuildLine, match: XactimateMatch): RebuildLine {
  const keep = (match.unit || 'EA') === line.unit;
  const fresh = lineFromXactimate(match, line.room_id ?? null, line.section, {
    activity: line.activity ?? undefined,
    ...(keep ? { basis: line.basis, cut_height_ft: line.cut_height_ft ?? null, cut_part: line.cut_part ?? null } : {}),
  });
  return {
    ...fresh,
    id: line.id,
    notes: noteAfter(line, fresh.activities, fresh.activity),
    quantity: keep ? line.quantity : fresh.quantity,
    qty_formula: keep ? line.qty_formula ?? null : null,
  };
}

/** A set's lines for a room: the part of the wall it is for (cut), the rest painted to match */
export function assemblyLines(assembly: Assembly, roomId: string, cut: number | null): RebuildLine[] {
  return assembly.items
    .filter((item) => !item.only_with_cut || (assembly.asks_cut && cut))
    .map((item) => lineFromXactimate(item.match, roomId, item.section, {
      activity: item.activity,
      basis: item.basis,
      cut_height_ft: assembly.asks_cut ? cut : null,
      cut_part: item.cut_part,
    }));
}

/** The set a room takes with its first repair: its final clean-up, as the flooring estimate has one (owner, 2026-11-16) */
export const FINAL_CLEAN_SET = 'final_clean';

/**
 * Repairs added to a room. With the room's first, its final clean-up comes
 * too, on its floor area, unless one is among them; taken off, it stays off.
 */
export function addToRoom(
  lines: RebuildLine[], roomId: string | null, added: RebuildLine[], assemblies?: Assembly[] | null,
): RebuildLine[] {
  const clean = assemblies?.find((a) => a.key === FINAL_CLEAN_SET);
  const first = !!roomId && !lines.some((l) => l.room_id === roomId);
  const codes = new Set((clean?.items || []).map((i) => i.code));
  if (!clean || !roomId || !first || added.some((l) => l.code && codes.has(l.code))) return [...lines, ...added];
  return [...lines, ...added, ...assemblyLines(clean, roomId, null)];
}

/**
 * A quantity typed as a sum, as on a calculator: numbers with + - * / and
 * brackets (x or × for times), e.g. 16.25*2 + 4.25*2 or (12+8)*2. Read
 * without eval; null when it can't be read, is negative or isn't finite.
 */
export function evalQty(input: string): number | null {
  const text = input.replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/\s+/g, '');
  if (!text || !/^[\d.+\-*/()]+$/.test(text)) return null;
  let i = 0;
  const peek = () => text[i];
  const number = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = text[i++];
      const r = factor();
      if (r === null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = text[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const value = sum();
  if (value === null || i !== text.length || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * What a quantity typed in sets on a line: nothing (back to the room's
 * measure), a number, or a sum kept with what it comes to. undefined when it
 * can't be read.
 */
export function typedQty(input: string): { quantity: number | null; qty_formula: string | null } | undefined {
  const text = input.trim();
  if (!text) return { quantity: null, qty_formula: null };
  const value = evalQty(text);
  if (value === null) return undefined;
  const plain = /^\d*\.?\d+$|^\d+\.$/.test(text.replace(/,/g, ''));
  return { quantity: value, qty_formula: plain ? null : text.replace(/\s+/g, ' ') };
}

export function typedLine(roomId: string | null, section: AddedSection): RebuildLine {
  return {
    id: newId(), room_id: roomId, section, description: 'Repair', unit: 'EA', quantity: 1, basis: null,
    unit_price: 0, activities: [], notes: null,
  };
}

/**
 * What an activity does, as the line's activity picker names it and as our
 * words end with it ("Quarter round 3/4\" - detach & reset"): the server's
 * words (wording._ACTION), so a line reads as what was picked.
 */
export const ACTION_WORDS: Record<XactActivity, string> = {
  '&': 'remove & replace', '+': 'install', '-': 'remove', R: 'detach & reset', M: 'material only', I: 'labor only',
};
export const ACTIVITY_LABEL: Record<XactActivity, string> = {
  '&': 'Remove & replace', '+': 'Install', '-': 'Remove', R: 'Detach & reset', M: 'Material only', I: 'Labor only',
};
const ACTION_ENDINGS = (Object.values(ACTION_WORDS) as string[]).sort((a, b) => b.length - a.length);
/** Activities only an item that can come out has: its words name what is done ("... - install") */
const OUT = new Set<XactActivity>(['&', '-', 'R']);

/**
 * Another activity of the same item: its words follow. Words kept for that
 * activity come first. Xactimate's words take its prefix ("Remove ...",
 * "R&R ..."). Words of ours end in what is done: an item that can come out
 * always ("Baseboard 2 1/4\" - install", "... - remove"), one that can't
 * only when it isn't the plain install ("Contents - move out & reset",
 * "... - labor only"). A prefix or ending left from another activity goes.
 */
export function withActivity(line: RebuildLine, activity: XactActivity): RebuildLine {
  const notes = noteAfter(line, line.activities, activity);
  const ours = line.activities.find((a) => a.activity === activity)?.wording;
  if (ours) return { ...line, activity, notes, description: worded(ours, line.section), xact_words: false };
  if (line.xact_words) return { ...line, activity, notes, description: describe(line.description, activity, line.section) };
  const bare = PREFIXES.reduce((d, p) => (d.startsWith(p) ? d.slice(p.length) : d), line.description.trim());
  const ending = ACTION_ENDINGS.find((w) => bare.toLowerCase().endsWith(` - ${w}`));
  const stem = ending ? bare.slice(0, bare.length - ending.length - 3).trimEnd() : bare;
  const named = line.activities.some((a) => OUT.has(a.activity));
  const description = activity === '+' && !named ? stem : `${stem} - ${ACTION_WORDS[activity]}`;
  return { ...line, activity, notes, description };
}

/**
 * Words of ours kept for a code and activity, and the note kept with them:
 * every line of it on the estimate takes them (a note written for a line
 * stays). No note kept: the one the item comes with stays.
 */
export function withWording(
  lines: RebuildLine[], code: string, activity: XactActivity, wording: string, note: string | null = null,
): RebuildLine[] {
  return lines.map((l) => {
    if (l.code !== code) return l;
    const activities = l.activities.map((a) => (a.activity === activity ? { ...a, wording, note: note ?? a.note ?? null } : a));
    if (l.activity !== activity) return { ...l, activities };
    const cameWith = l.activities.find((a) => a.activity === activity)?.note ?? null;
    const notes = !l.notes?.trim() || l.notes.trim() === cameWith?.trim() ? note ?? l.notes ?? null : l.notes;
    return { ...l, activities, notes, description: worded(wording, l.section), xact_words: false };
  });
}

export function updateLine(lines: RebuildLine[], id: string, patch: Partial<RebuildLine>): RebuildLine[] {
  return lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

export function removeLine(lines: RebuildLine[], id: string): RebuildLine[] {
  return lines.filter((l) => l.id !== id);
}

export function newRoom(rooms: RebuildRoom[], name: string): RebuildRoom[] {
  return [...rooms, { id: newId(), name, level_name: null, measures: {} }];
}

export const money = (n: number | null | undefined) =>
  `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const measureText = (m: { floor_sf?: number | null; wall_sf?: number | null; perimeter_lf?: number | null }) =>
  [
    m.floor_sf ? `${m.floor_sf.toLocaleString('en-US')} SF floor` : null,
    m.wall_sf ? `${m.wall_sf.toLocaleString('en-US')} SF walls` : null,
    m.perimeter_lf ? `${m.perimeter_lf.toLocaleString('en-US')} LF perimeter` : null,
  ].filter(Boolean).join(' · ');
