/**
 * What in a job a supplement would be for, so the estimator can see why one
 * might apply before adding it. None is added on its own: the server prices only
 * the ones chosen and prints each with its reason (supplement_basis in
 * backend pack_calculation/packing_service.py says the same about a saved job).
 */
import type { DetectedContentItem } from '../../types/packing-estimate';
import { isUnconfirmed } from './itemEdits';

export interface SupplementRoom {
  /** A Photo AI room's name; a Quick Estimate room has only its preset */
  name?: string;
  floor: string;
  density: string;
  contamination: string;
  items?: DetectedContentItem[];
}

const CONTAMINATION: Record<string, string> = { gray_water: 'gray water', black_water: 'black water' };
const UPPER_FLOORS: Record<string, string> = { '3rd': '3rd floor', '4th+': '4th floor or higher' };
const HEAVY: Record<string, string> = { heavy: 'heavy contents', extreme: 'extreme contents' };

/** "Kitchen (gray water)", or "2 rooms (gray water)" when rooms have no names */
const roomsWith = (rooms: SupplementRoom[], value: (r: SupplementRoom) => string, labels: Record<string, string>) => {
  const hits = rooms.filter(r => labels[value(r)]);
  if (hits.length === 0) return null;
  if (hits.every(r => r.name)) return hits.map(r => `${r.name} (${labels[value(r)]})`).join(', ');
  const kinds = Array.from(new Set(hits.map(r => labels[value(r)])));
  return `${hits.length} room${hits.length === 1 ? '' : 's'} (${kinds.join(', ')})`;
};

/** Per supplement key: what in this job it would be for, or null when nothing shows it */
export function supplementSignals(rooms: SupplementRoom[]): Record<string, string | null> {
  const highValue = rooms
    .flatMap(r => r.items ?? [])
    .filter(i => i.is_high_value && !isUnconfirmed(i))
    .reduce((sum, i) => sum + (i.quantity || 1), 0);
  return {
    hidden_damage: roomsWith(rooms, r => r.contamination, CONTAMINATION),
    high_value_documentation: highValue >= 3 ? `${highValue} high-value items` : null,
    difficult_access: roomsWith(rooms, r => r.floor, UPPER_FLOORS),
    heavy_contents: roomsWith(rooms, r => r.density, HEAVY),
  };
}
