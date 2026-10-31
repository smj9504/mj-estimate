/**
 * Which sections an estimate lists, and in what order. Every section with a
 * charge is listed, so what's on the page adds up to the subtotal, even on an
 * older estimate saved with a section that has no lines.
 */

/** The order the PDF prints them in (section_order in backend export.py) */
const SECTION_ORDER = [
  'Pack-Out Labor', 'Materials', 'On-Site Relocation',
  'Transport Out', 'Storage', 'Debris Hauling',
  'Pack-Back Labor', 'Furniture Assembly',
  'Transport Back', 'On-Site Pack-Back Move', 'Special Items',
];

interface SectionSource {
  sections?: Record<string, number> | null;
  section_details?: Record<string, { lines?: unknown[] } | null> | null;
}

export function estimateSectionNames(estimate: SectionSource): string[] {
  const details = estimate.section_details || {};
  const totals = estimate.sections || {};
  const rank = (name: string) => {
    const index = SECTION_ORDER.indexOf(name);
    return index === -1 ? SECTION_ORDER.length : index;
  };
  return Array.from(new Set([...Object.keys(details), ...Object.keys(totals)]))
    .filter(name => (details[name]?.lines?.length ?? 0) > 0 || (totals[name] ?? 0) !== 0)
    .sort((a, b) => rank(a) - rank(b));
}
