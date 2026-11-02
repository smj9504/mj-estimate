import { describe, expect, it } from 'vitest';
import type { CSRow, CSRule, CSSection, CSTable } from '../../services/cheatsheetService';
import { buildSectionView, groupColumn, isCommon, withGroupLabels } from './cheatSheetView';

const row = (key: string, data: Record<string, string>, is_common = true): CSRow => ({
  id: key, table_id: 't', row_key: key, data, note: null, is_common, sort_order: 0,
});

const table = (rows: CSRow[]): CSTable => ({
  id: 't',
  section_id: 's',
  sort_order: 0,
  columns: [
    { title: '상황', dataIndex: 'situation', key: 'situation' },
    { title: 'Line Item', dataIndex: 'item', key: 'item', render: 'code' },
  ],
  rows,
});

const rule = (title: string, items: string[], is_common = true): CSRule => ({
  id: title, section_id: 's', rule_type: 'info', title, items, is_common, sort_order: 0,
});

const section = (tables: CSTable[], rules: CSRule[] = []): CSSection => ({
  id: 's', section_key: 'carpet', title: 'Carpet', tag: 'FCC', tag_color: '', nav_group: 'Flooring',
  nav_dot_color: '', sort_order: 0, is_active: true, rules, tables,
});

const carpet = table([
  row('c1', { situation: '제거', item: 'Remove carpet' }),
  row('c2', { situation: '', item: 'Remove pad' }),
  row('c3', { situation: '설치', item: 'Carpet tile' }, false),
  row('c4', { situation: '', item: 'Carpet' }),
  row('c5', { situation: '', item: 'Pad' }, false),
]);

describe('isCommon', () => {
  it('treats a row saved before the split as common', () => {
    expect(isCommon({})).toBe(true);
    expect(isCommon({ is_common: true })).toBe(true);
    expect(isCommon({ is_common: false })).toBe(false);
  });
});

describe('groupColumn', () => {
  it('is the first column when some row leaves it blank', () => {
    expect(groupColumn(carpet)).toBe('situation');
  });

  it('is nothing when every row fills it, because then it names the item', () => {
    expect(groupColumn(table([row('a', { situation: 'x', item: 'y' })]))).toBeNull();
  });
});

describe('withGroupLabels', () => {
  it('moves a hidden row\'s group label down to the next row that shows', () => {
    const shown = withGroupLabels(carpet, 'situation', carpet.rows.filter(r => r.row_key === 'c4'));
    expect(shown.map(s => [s.row.row_key, s.groupLabel])).toEqual([['c4', '설치']]);
  });

  it('shows a label once per group', () => {
    const shown = withGroupLabels(carpet, 'situation', carpet.rows.filter(isCommon));
    expect(shown.map(s => s.groupLabel)).toEqual(['제거', '', '설치']);
  });
});

describe('buildSectionView', () => {
  it('splits rows and rules into common and occasional, counting what the toggle holds', () => {
    const view = buildSectionView(section([carpet], [rule('Waste', ['a']), rule('Example', ['b'], false)]), '')!;
    expect(view.tables[0].common.map(s => s.row.row_key)).toEqual(['c1', 'c2', 'c4']);
    expect(view.tables[0].occasional.map(s => [s.row.row_key, s.groupLabel])).toEqual([['c3', '설치'], ['c5', '']]);
    expect(view.commonRules.map(r => r.title)).toEqual(['Waste']);
    expect(view.occasionalRules.map(r => r.title)).toEqual(['Example']);
    expect(view.occasionalCount).toBe(3);
  });

  it('finds an occasional row by search and keeps its group label', () => {
    const view = buildSectionView(section([carpet]), 'tile')!;
    expect(view.tables[0].common).toEqual([]);
    expect(view.tables[0].occasional.map(s => [s.row.row_key, s.groupLabel])).toEqual([['c3', '설치']]);
    expect(view.matchCount).toBe(1);
  });

  it('shows the whole category when the search names it', () => {
    const view = buildSectionView(section([carpet]), 'fcc')!;
    expect(view.matchCount).toBe(5);
  });

  it('drops a category with nothing matching', () => {
    expect(buildSectionView(section([carpet]), 'granite')).toBeNull();
  });

  it('keeps a table out when the search leaves it empty', () => {
    const other = table([row('x', { situation: 'a', item: 'Granite' })]);
    const view = buildSectionView(section([carpet, { ...other, id: 'o' }]), 'granite')!;
    expect(view.tables).toHaveLength(1);
    expect(view.tables[0].table.id).toBe('o');
  });
});
