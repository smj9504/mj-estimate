/**
 * The repairs added on a rebuild estimate: made from an Xactimate price list
 * match or typed in, and changed. Pure, so it is tested on its own.
 */

import type {
  ActivityPrice, AddedSection, Basis, RebuildLine, RebuildRoom, XactActivity, XactimateMatch,
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
  { value: 'ceiling_sf', label: 'Ceiling SF', unit: 'SF' },
  { value: 'floor_sf', label: 'Floor SF', unit: 'SF' },
  { value: 'perimeter_lf', label: 'Perimeter LF', unit: 'LF' },
];

/** How Xactimate's {V} reads under each section */
const SURFACE: Record<AddedSection, string> = {
  wall: 'the walls', ceiling: 'the ceiling', floor: 'the floor', other: 'the surface area',
};
const PREFIX: Partial<Record<XactActivity, string>> = {
  '&': 'R&R ', '-': 'Remove ', R: 'Detach & Reset ', M: 'Material Only ', I: 'Install ',
};
const PREFIXES = Object.values(PREFIX) as string[];

/** The line's words for an activity: "R&R ...", "Remove ...", plain for replace */
export function describe(description: string, activity: XactActivity | null | undefined, section: AddedSection): string {
  const bare = PREFIXES.reduce((d, p) => (d.startsWith(p) ? d.slice(p.length) : d), description)
    .replace(/\{V\}/g, SURFACE[section]);
  return `${(activity && PREFIX[activity]) || ''}${bare}`;
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

/** An Xactimate item as a line: its own activity (an R&R item as R&R), quantity from the room */
export function lineFromXactimate(
  match: XactimateMatch, roomId: string | null, section: AddedSection, activity?: XactActivity,
): RebuildLine {
  const chosen = match.activities.find((a) => a.activity === activity) ?? match.activities[0];
  const basis = roomId ? defaultBasis(match.unit, section) : null;
  return {
    id: newId(),
    room_id: roomId,
    section,
    description: describe(match.description, chosen?.activity, section),
    unit: match.unit || 'EA',
    quantity: basis ? null : 1,
    basis,
    unit_price: null,
    code: match.code,
    activity: chosen?.activity ?? null,
    price_list: match.price_list,
    activities: match.activities.map(({ activity: a, label, price, material_share }: ActivityPrice) => ({
      activity: a, label, price, material_share,
    })),
    notes: null,
  };
}

export function typedLine(roomId: string | null, section: AddedSection): RebuildLine {
  return {
    id: newId(), room_id: roomId, section, description: 'Repair', unit: 'EA', quantity: 1, basis: null,
    unit_price: 0, activities: [], notes: null,
  };
}

/** Another activity of the same item: its words follow */
export function withActivity(line: RebuildLine, activity: XactActivity): RebuildLine {
  return { ...line, activity, description: describe(line.description, activity, line.section) };
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
