/**
 * What a category shows for the current search: its items split into the
 * common ones, always on the page, and the occasional ones behind its toggle.
 */

import type { CSRow, CSRule, CSSection, CSTable } from '../../services/cheatsheetService';

/** A row with the group label it should show, which may come from a row above it */
export interface DisplayRow {
  row: CSRow;
  groupLabel: string;
}

export interface TableView {
  table: CSTable;
  groupKey: string | null;
  common: DisplayRow[];
  occasional: DisplayRow[];
}

export interface SectionView {
  section: CSSection;
  commonRules: CSRule[];
  occasionalRules: CSRule[];
  tables: TableView[];
  occasionalCount: number;
  matchCount: number;
}

/** Anything not explicitly occasional is common, so a row from before the split still shows */
export const isCommon = (item: { is_common?: boolean }) => item.is_common !== false;

const rowMatches = (row: CSRow, q: string) =>
  Object.values(row.data).some(v => typeof v === 'string' && v.toLowerCase().includes(q));

const ruleMatches = (rule: CSRule, q: string) =>
  rule.title.toLowerCase().includes(q) || rule.items.some(item => item.toLowerCase().includes(q));

/**
 * Rows leave the first column blank when it repeats the row above, which reads
 * as a group. The first column is only a group when some row does that: in a
 * table where every row fills it, it is the item's name.
 */
export const groupColumn = (table: CSTable): string | null => {
  const first = table.columns[0];
  if (!first || first.render) return null;
  return table.rows.some(r => !r.data[first.dataIndex]) ? first.dataIndex : null;
};

/**
 * Lays out `visible` in table order, each group's label on its first visible
 * row, so a row whose label row is hidden or filtered out still says its group.
 */
export const withGroupLabels = (
  table: CSTable,
  groupKey: string | null,
  visible: CSRow[],
): DisplayRow[] => {
  const shown = new Set(visible.map(r => r.id));
  const out: DisplayRow[] = [];
  let current = '';
  let lastShown: string | null = null;
  table.rows.forEach(row => {
    if (groupKey) current = row.data[groupKey] || current;
    if (!shown.has(row.id)) return;
    out.push({ row, groupLabel: current !== lastShown ? current : '' });
    lastShown = current;
  });
  return out;
};

const buildTable = (table: CSTable, keep: (row: CSRow) => boolean): TableView | null => {
  const rows = table.rows.filter(keep);
  if (rows.length === 0) return null;
  const groupKey = groupColumn(table);
  return {
    table,
    groupKey,
    common: withGroupLabels(table, groupKey, rows.filter(isCommon)),
    occasional: withGroupLabels(table, groupKey, rows.filter(r => !isCommon(r))),
  };
};

export const buildSectionView = (section: CSSection, query: string): SectionView | null => {
  const q = query.trim().toLowerCase();
  // A search for the category itself shows all of it, not just the rows repeating its name
  const wholeSection = !q || section.title.toLowerCase().includes(q) || section.tag.toLowerCase().includes(q);

  const rules = wholeSection ? section.rules : section.rules.filter(r => ruleMatches(r, q));
  const tables = section.tables
    .map(t => buildTable(t, wholeSection ? () => true : row => rowMatches(row, q)))
    .filter((t): t is TableView => t !== null);

  if (!wholeSection && rules.length === 0 && tables.length === 0) return null;

  const occasionalRules = rules.filter(r => !isCommon(r));
  const occasionalRows = tables.reduce((n, t) => n + t.occasional.length, 0);
  const allRows = tables.reduce((n, t) => n + t.common.length + t.occasional.length, 0);

  return {
    section,
    commonRules: rules.filter(isCommon),
    occasionalRules,
    tables,
    occasionalCount: occasionalRules.length + occasionalRows,
    matchCount: rules.length + allRows,
  };
};
