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
  const activities = match.activities.map(({ activity: a, label, price, material_share, wording }: ActivityPrice) => ({
    activity: a, label, price, material_share, wording: wording ?? null,
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
    notes: null,
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

export function typedLine(roomId: string | null, section: AddedSection): RebuildLine {
  return {
    id: newId(), room_id: roomId, section, description: 'Repair', unit: 'EA', quantity: 1, basis: null,
    unit_price: 0, activities: [], notes: null,
  };
}

/** Another activity of the same item: its words follow */
export function withActivity(line: RebuildLine, activity: XactActivity): RebuildLine {
  const ours = line.activities.find((a) => a.activity === activity)?.wording;
  if (ours) return { ...line, activity, description: worded(ours, line.section), xact_words: false };
  return { ...line, activity, description: describe(line.description, activity, line.section) };
}

/** Words of ours kept for a code and activity: every line of it on the estimate takes them */
export function withWording(lines: RebuildLine[], code: string, activity: XactActivity, wording: string): RebuildLine[] {
  return lines.map((l) => {
    if (l.code !== code) return l;
    const activities = l.activities.map((a) => (a.activity === activity ? { ...a, wording } : a));
    return l.activity === activity
      ? { ...l, activities, description: worded(wording, l.section), xact_words: false }
      : { ...l, activities };
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
