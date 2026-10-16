/**
 * Category colour, shared by the filter-chip dots and the thumbnail labels so a
 * category reads the same colour in both places. Accepts the stored key
 * ("day-1") or a display label ("Day 1").
 *
 * Grey is reserved for "uncategorized": a real category never falls back to
 * it, because grey reads as empty. Keys missing from the map (custom
 * categories) get a stable tone hashed from the key.
 */
import { tagTones } from '../../../styles/tokens';
import { toneFromKey } from '../ui';

const CATEGORY_COLORS: Record<string, string> = {
  'all': '#1f74c9',
  'uncategorized': '#dfdfdc',
  'property-overview': '#2f74a0',
  'wet-area': '#337ea9',
  'personal-properties': '#8459a5',
  'pre-mitigation-moving': '#cb912f',
  'moisture': '#3f7a5a',
  'equipment': '#a65208',
  'demolition': '#d44c47',
  'containment': '#9065b0',
  'protection': '#448361',
  'drying-process': '#8a5a45',
  'day-1': '#c14c8a',
  'day-2': '#d9730d',
  'day-3': '#8f6714',
  'documentation': '#5f5e5b',
};

export const getCategoryColor = (category: string): string => {
  const key = category.trim().toLowerCase().replace(/\s+/g, '-');
  return CATEGORY_COLORS[key] || tagTones[toneFromKey(key)].text;
};
