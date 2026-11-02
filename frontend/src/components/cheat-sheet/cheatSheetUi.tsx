/**
 * Cheat sheet pieces: cell values, rule callouts, a table's rows (a table on
 * desktop, a row list on phones) and a category with its occasional toggle.
 */

import React, { useId, useState } from 'react';
import { Button, Popconfirm, Table, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BulbOutlined, CheckCircleOutlined, CommentOutlined, CopyOutlined, DeleteOutlined, EditOutlined,
  FileTextOutlined, FlagOutlined, InfoCircleOutlined, PlusOutlined, RightOutlined, StarFilled,
  StarOutlined, StopOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { CSRow, CSRule, CSTable } from '../../services/cheatsheetService';
import { isCommon, type DisplayRow, type SectionView, type TableView } from './cheatSheetView';
import './cheatSheet.css';

// ─── Cell values ──────────────────────────────────────────────────────

/** Text with `codes`; **bold** too when it comes from a rule */
export const RichText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="cs-code">{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    })}
  </>
);

const hasPrice = (value?: string) => Boolean(value) && value !== '—';

const Price: React.FC<{ value?: string }> = ({ value }) =>
  hasPrice(value)
    ? <span className="cs-price">{value}</span>
    : <span className="cs-muted">{'—'}</span>;

const NOTE_MARKERS = [
  { marker: '[miss]', className: 'cs-flag cs-flag--miss', icon: <FlagOutlined />, fallback: '자주 빠짐' },
  { marker: '[excl]', className: 'cs-flag cs-flag--excl', icon: <StopOutlined />, fallback: '' },
  { marker: '[warn]', className: 'cs-flag cs-flag--warn', icon: null, fallback: '' },
];

/** `[miss]` flags what estimates tend to leave out, `[excl]` what a price leaves out */
const NoteText: React.FC<{ value?: string }> = ({ value }) => {
  if (!value) return null;
  const found = NOTE_MARKERS.find(m => value.includes(m.marker));
  if (!found) return <span className="cs-note"><RichText text={value} /></span>;
  return (
    <span className={found.className}>
      {found.icon && <span className="cs-flag-icon" aria-hidden="true">{found.icon}</span>}
      {value.replace(found.marker, '').trim() || found.fallback}
    </span>
  );
};

const CellValue: React.FC<{ render?: string; value?: string }> = ({ render, value }) => {
  if (render === 'price') return <Price value={value} />;
  if (render === 'unit') return <span className="cs-unit">{value}</span>;
  if (render === 'miss') return <NoteText value={value} />;
  return value ? <RichText text={value} /> : null;
};

// ─── Row actions ──────────────────────────────────────────────────────

export interface SheetActions {
  editMode: boolean;
  onOpenNote: (row: CSRow) => void;
  onAddRow: (table: CSTable, isCommonRow: boolean) => void;
  onEditRow: (row: CSRow, table: CSTable) => void;
  onDeleteRow: (rowId: string) => void;
  onToggleRow: (row: CSRow) => void;
  onAddRule: (sectionId: string) => void;
  onEditRule: (rule: CSRule, sectionId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (rule: CSRule) => void;
}

const stop = (e?: React.SyntheticEvent) => e?.stopPropagation();

const TierButton: React.FC<{ common: boolean; onClick: () => void }> = ({ common, onClick }) => (
  <Tooltip title={common ? '간혹 쓰는 항목으로 옮기기' : '자주 쓰는 항목으로 옮기기'}>
    <Button
      type="text"
      size="small"
      className={`ui-icon-btn${common ? ' cs-tier-on' : ''}`}
      aria-label={common ? '간혹 쓰는 항목으로 옮기기' : '자주 쓰는 항목으로 옮기기'}
      aria-pressed={common}
      icon={common ? <StarFilled /> : <StarOutlined />}
      onClick={(e) => { stop(e); onClick(); }}
    />
  </Tooltip>
);

const EditActions: React.FC<{
  common: boolean;
  label: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ common, label, onToggle, onEdit, onDelete }) => (
  <span className="cs-edit-actions">
    <TierButton common={common} onClick={onToggle} />
    <Button
      type="text"
      size="small"
      className="ui-icon-btn"
      aria-label={`${label} 수정`}
      icon={<EditOutlined />}
      onClick={(e) => { stop(e); onEdit(); }}
    />
    <Popconfirm title="삭제?" onConfirm={(e) => { stop(e); onDelete(); }} onCancel={stop}>
      <Button
        type="text"
        size="small"
        className="ui-icon-btn ui-icon-btn--danger"
        aria-label={`${label} 삭제`}
        icon={<DeleteOutlined />}
        onClick={stop}
      />
    </Popconfirm>
  </span>
);

const NoteButton: React.FC<{ row: CSRow; onOpen: (row: CSRow) => void }> = ({ row, onOpen }) => (
  <Button
    type="text"
    size="small"
    className={`ui-icon-btn cs-note-btn${row.note ? ' has-note' : ''}`}
    aria-label={row.note ? '메모 보기' : '메모 추가'}
    icon={<CommentOutlined />}
    onClick={(e) => { stop(e); onOpen(row); }}
  />
);

const RowMemo: React.FC<{ note: string | null }> = ({ note }) =>
  note ? <div className="cs-memo"><CommentOutlined aria-hidden="true" /> {note}</div> : null;

const Justification: React.FC<{ text: string }> = ({ text }) => (
  <div className="cs-desc">
    <div className="cs-desc-text">
      <div className="cs-desc-label">Description / Justification</div>
      {text}
    </div>
    <Button
      type="text"
      size="small"
      className="ui-icon-btn"
      aria-label="Copy to clipboard"
      icon={<CopyOutlined />}
      onClick={(e) => {
        stop(e);
        navigator.clipboard.writeText(text);
        message.success('복사됨');
      }}
    />
  </div>
);

const DescToggle: React.FC<{ open: boolean; onClick: () => void }> = ({ open, onClick }) => (
  <button
    type="button"
    className={`cs-desc-toggle${open ? ' is-open' : ''}`}
    aria-expanded={open}
    aria-label="View description"
    onClick={(e) => { stop(e); onClick(); }}
  >
    <FileTextOutlined aria-hidden="true" />
  </button>
);

// ─── A table's rows ───────────────────────────────────────────────────

interface RowsProps {
  view: TableView;
  rows: DisplayRow[];
  actions: SheetActions;
}

const useOpenDescriptions = () => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return { open, toggle };
};

/**
 * Fixed widths by what a column holds, so unit, price and note line up from one
 * category to the next and the page reads as one sheet.
 */
const columnWidth = (col: CSTable['columns'][number], view: TableView): number | string | undefined => {
  const hasName = view.table.columns.some(c => !c.render && c.dataIndex !== view.groupKey);
  // A table with a group, a name and a code (Trim) has one more column to fit
  const crowded = hasName && view.groupKey !== null;
  if (col.dataIndex === view.groupKey) return crowded ? 76 : 100;
  if (col.render === 'unit') return 76;
  if (col.render === 'price') return 112;
  if (col.render === 'miss') return crowded ? '22%' : '24%';
  if (col.render === 'code' && hasName) return crowded ? '20%' : '24%';
  return undefined;
};

const RowsTable: React.FC<RowsProps> = ({ view, rows, actions }) => {
  const { open, toggle } = useOpenDescriptions();
  const { table, groupKey } = view;
  const primary = table.columns.find(c => c.render === 'code') ?? table.columns.find(c => c.dataIndex !== groupKey);

  const columns: ColumnsType<DisplayRow> = table.columns.map(col => ({
    title: col.title,
    key: col.key,
    width: columnWidth(col, view),
    align: col.render === 'price' ? 'right' : undefined,
    render: (_: unknown, { row, groupLabel }: DisplayRow) => {
      if (col.dataIndex === groupKey) return <span className="cs-group">{groupLabel}</span>;
      const cell = <CellValue render={col.render} value={row.data[col.dataIndex]} />;
      if (col !== primary) return cell;
      return (
        <>
          {cell}
          {row.data.desc && <DescToggle open={open.has(row.id)} onClick={() => toggle(row.id)} />}
          <RowMemo note={row.note} />
        </>
      );
    },
  }));

  columns.push({
    title: '',
    key: '__note',
    width: 40,
    render: (_: unknown, { row }: DisplayRow) => <NoteButton row={row} onOpen={actions.onOpenNote} />,
  });

  if (actions.editMode) {
    columns.push({
      title: '',
      key: '__actions',
      width: 104,
      render: (_: unknown, { row }: DisplayRow) => (
        <EditActions
          common={isCommon(row)}
          label="행"
          onToggle={() => actions.onToggleRow(row)}
          onEdit={() => actions.onEditRow(row, table)}
          onDelete={() => actions.onDeleteRow(row.id)}
        />
      ),
    });
  }

  return (
    <Table<DisplayRow>
      className="cs-table"
      columns={columns}
      dataSource={rows}
      rowKey={d => d.row.id}
      pagination={false}
      size="small"
      tableLayout="fixed"
      onRow={d => ({ onClick: () => actions.onOpenNote(d.row) })}
      expandable={{
        showExpandColumn: false,
        expandedRowKeys: Array.from(open),
        expandedRowRender: d => <Justification text={d.row.data.desc || ''} />,
      }}
    />
  );
};

/** Phones get the same rows as a list: name, then unit and price, then the note */
const RowsList: React.FC<RowsProps> = ({ view, rows, actions }) => {
  const { open, toggle } = useOpenDescriptions();
  const { table, groupKey } = view;
  const nameCol = table.columns.find(c => !c.render && c.dataIndex !== groupKey);
  const codeCol = table.columns.find(c => c.render === 'code');
  const unitCol = table.columns.find(c => c.render === 'unit');
  const priceCol = table.columns.find(c => c.render === 'price');
  const noteCol = table.columns.find(c => c.render === 'miss');
  const extraCols = table.columns.filter(
    c => !c.render && c.dataIndex !== groupKey && c !== nameCol,
  );

  return (
    <div className="cs-rows">
      {rows.map(({ row, groupLabel }) => (
        <React.Fragment key={row.id}>
          {groupLabel && <div className="cs-rows-group">{groupLabel}</div>}
          <div className="cs-row" onClick={() => actions.onOpenNote(row)}>
            <div className="cs-row-body">
              {nameCol && <div className="cs-row-name">{row.data[nameCol.dataIndex]}</div>}
              {!nameCol && codeCol && row.data[codeCol.dataIndex] && (
                <div className="cs-row-name"><RichText text={row.data[codeCol.dataIndex] as string} /></div>
              )}
              <div className="cs-row-meta">
                {nameCol && codeCol && row.data[codeCol.dataIndex] && (
                  <span><RichText text={row.data[codeCol.dataIndex] as string} /></span>
                )}
                {unitCol && <CellValue render="unit" value={row.data[unitCol.dataIndex]} />}
                {priceCol && hasPrice(row.data[priceCol.dataIndex]) && <Price value={row.data[priceCol.dataIndex]} />}
                {row.data.desc && <DescToggle open={open.has(row.id)} onClick={() => toggle(row.id)} />}
              </div>
              {noteCol && row.data[noteCol.dataIndex] && (
                <div className="cs-row-note"><NoteText value={row.data[noteCol.dataIndex]} /></div>
              )}
              {extraCols.map(col => row.data[col.dataIndex] && (
                <div key={col.key} className="cs-row-extra">
                  <span className="cs-muted">{col.title}</span> {row.data[col.dataIndex]}
                </div>
              ))}
              <RowMemo note={row.note} />
              {open.has(row.id) && <Justification text={row.data.desc || ''} />}
            </div>
            <div className="cs-row-actions">
              {actions.editMode && (
                <EditActions
                  common={isCommon(row)}
                  label="행"
                  onToggle={() => actions.onToggleRow(row)}
                  onEdit={() => actions.onEditRow(row, table)}
                  onDelete={() => actions.onDeleteRow(row.id)}
                />
              )}
              <NoteButton row={row} onOpen={actions.onOpenNote} />
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

// ─── Rules ────────────────────────────────────────────────────────────

const RULE_ICONS: Record<string, React.ReactNode> = {
  warning: <WarningOutlined />,
  success: <CheckCircleOutlined />,
  purple: <BulbOutlined />,
  info: <InfoCircleOutlined />,
};

const RuleCallout: React.FC<{ rule: CSRule; sectionId: string; actions: SheetActions }> = ({ rule, sectionId, actions }) => {
  const type = RULE_ICONS[rule.rule_type] ? rule.rule_type : 'info';
  return (
    <div className={`cs-callout cs-callout--${type}`}>
      <span className="cs-callout-icon" aria-hidden="true">{RULE_ICONS[type]}</span>
      <div className="cs-callout-body">
        <div className="cs-callout-head">
          <h3 className="cs-callout-title">{rule.title}</h3>
          {actions.editMode && (
            <EditActions
              common={isCommon(rule)}
              label="규칙"
              onToggle={() => actions.onToggleRule(rule)}
              onEdit={() => actions.onEditRule(rule, sectionId)}
              onDelete={() => actions.onDeleteRule(rule.id)}
            />
          )}
        </div>
        <ul className="cs-callout-list">
          {rule.items.map((item, i) => <li key={i}><RichText text={item} /></li>)}
        </ul>
      </div>
    </div>
  );
};

const RuleGrid: React.FC<{ rules: CSRule[]; sectionId: string; actions: SheetActions }> = ({ rules, sectionId, actions }) =>
  rules.length === 0 ? null : (
    <div className="cs-rules">
      {rules.map(rule => <RuleCallout key={rule.id} rule={rule} sectionId={sectionId} actions={actions} />)}
    </div>
  );

// ─── A category ───────────────────────────────────────────────────────

interface SectionProps {
  view: SectionView;
  /** The occasional items are showing */
  open: boolean;
  /** A search is on: matches always show, so there is nothing to toggle */
  searching: boolean;
  isPhone: boolean;
  onToggle: () => void;
  actions: SheetActions;
}

export const SheetSection: React.FC<SectionProps> = ({ view, open, searching, isPhone, onToggle, actions }) => {
  const { section, commonRules, occasionalRules, tables, occasionalCount } = view;
  const bodyId = useId();
  const Rows = isPhone ? RowsList : RowsTable;
  const label = `간혹 쓰는 항목 ${occasionalCount}개`;

  return (
    <section id={section.section_key} className="cs-section">
      <header className="cs-section-head">
        <h2 className="cs-section-title">{section.title}</h2>
        <span className="cs-section-code">{section.tag}</span>
        {actions.editMode && (
          <Button
            type="text"
            size="small"
            className="ui-icon-btn cs-section-action"
            icon={<PlusOutlined />}
            onClick={() => actions.onAddRule(section.id)}
          >
            규칙 추가
          </Button>
        )}
      </header>

      <RuleGrid rules={commonRules} sectionId={section.id} actions={actions} />

      {tables.map(t => (
        <div key={t.table.id} className="cs-table-block">
          {t.common.length > 0 && <Rows view={t} rows={t.common} actions={actions} />}
          {actions.editMode && !searching && (
            <Button
              type="text"
              size="small"
              className="ui-icon-btn cs-add-row"
              icon={<PlusOutlined />}
              onClick={() => actions.onAddRow(t.table, true)}
            >
              행 추가
            </Button>
          )}
        </div>
      ))}

      {occasionalCount > 0 && (
        <div className="cs-more-block">
          {searching ? (
            <div className="cs-more cs-more--label">{label}</div>
          ) : (
            <button
              type="button"
              className="cs-more"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={onToggle}
            >
              <RightOutlined className="cs-more-chevron" aria-hidden="true" />
              {label}
            </button>
          )}
          {/* Stays in the page while closed: print shows it, see cheatSheet.css */}
          <div id={bodyId} className="cs-more-body" hidden={!open && !searching}>
            <RuleGrid rules={occasionalRules} sectionId={section.id} actions={actions} />
            {tables.filter(t => t.occasional.length > 0).map(t => (
              <div key={t.table.id} className="cs-table-block">
                <Rows view={t} rows={t.occasional} actions={actions} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
