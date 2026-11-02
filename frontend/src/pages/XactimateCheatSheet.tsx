import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Input, Anchor, Alert, Drawer, Modal, Button, Skeleton, message, Tooltip, Form, Select, Switch,
} from 'antd';
import {
  SearchOutlined, PrinterOutlined, UnorderedListOutlined, EditOutlined, CheckOutlined,
  ReloadOutlined, SaveOutlined,
} from '@ant-design/icons';
import type { CSSection, CSRule, CSTable, CSRow } from '../services/cheatsheetService';
import * as csApi from '../services/cheatsheetService';
import PageHeader from '../components/common/ui/PageHeader';
import { useSheetModal } from '../components/common/ui/useSheetModal';
import { SheetSection, type SheetActions } from '../components/cheat-sheet/cheatSheetUi';
import { buildSectionView, isCommon, type SectionView } from '../components/cheat-sheet/cheatSheetView';

const { TextArea } = Input;

const TOOLBAR_OFFSET = 116;

// ─── Screen width hook ───

const useIsNarrower = (breakpoint: number) => {
  const [narrower, setNarrower] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrower(e.matches);
    mql.addEventListener('change', handler);
    setNarrower(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return narrower;
};

// ─── Note Modal ───

interface NoteModalProps {
  open: boolean;
  row: CSRow | null;
  onClose: () => void;
  onSave: (rowId: string, note: string | null) => Promise<void>;
}

const NoteModal: React.FC<NoteModalProps> = ({ open, row, onClose, onSave }) => {
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const { sheetProps, isPhone } = useSheetModal();

  useEffect(() => {
    if (row) setNoteText(row.note || '');
  }, [row]);

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    try {
      await onSave(row.id, noteText.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const itemLabel = row?.data?.item || row?.data?.item_name || row?.row_key || '';

  return (
    <Modal
      {...sheetProps}
      title="메모"
      open={open}
      onCancel={onClose}
      footer={[
        row?.note && (
          <Button key="clear" type="text" danger onClick={() => { setNoteText(''); }} style={isPhone ? undefined : { float: 'left' }}>
            메모 삭제
          </Button>
        ),
        <Button key="cancel" onClick={onClose}>취소</Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave} icon={<SaveOutlined />}>
          저장
        </Button>,
      ]}
      width={520}
    >
      {itemLabel && <p className="cs-muted" style={{ margin: 0 }}>{itemLabel.replace(/`/g, '')}</p>}
      <TextArea
        rows={4}
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        placeholder="이 항목에 대한 메모를 입력하세요..."
        style={{ marginTop: 8, fontSize: isPhone ? 16 : undefined }}
        autoFocus
      />
    </Modal>
  );
};

// ─── Edit Rule Modal ───

interface EditRuleModalProps {
  open: boolean;
  rule: CSRule | null;
  sectionId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const EditRuleModal: React.FC<EditRuleModalProps> = ({ open, rule, sectionId, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { sheetProps, isPhone } = useSheetModal();
  const isNew = !rule;

  useEffect(() => {
    if (open) {
      form.setFieldsValue(
        rule
          ? { rule_type: rule.rule_type, title: rule.title, items: rule.items.join('\n'), is_common: isCommon(rule) }
          : { rule_type: 'info', title: '', items: '', is_common: true }
      );
    }
  }, [open, rule, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const items = (values.items as string).split('\n').filter((s: string) => s.trim());
    setSaving(true);
    try {
      if (isNew && sectionId) {
        await csApi.createRule({ section_id: sectionId, rule_type: values.rule_type, title: values.title, items, is_common: values.is_common });
      } else if (rule) {
        await csApi.updateRule(rule.id, { rule_type: values.rule_type, title: values.title, items, is_common: values.is_common });
      }
      message.success(isNew ? '규칙 추가됨' : '규칙 수정됨');
      onSaved();
      onClose();
    } catch {
      message.error('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal {...sheetProps} title={isNew ? '규칙 추가' : '규칙 수정'} open={open} onCancel={onClose}
      onOk={handleSave} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical" size={isPhone ? 'large' : undefined}>
        <Form.Item name="rule_type" label="타입">
          <Select options={[
            { value: 'info', label: 'Info (파랑)' },
            { value: 'warning', label: 'Warning (노랑)' },
            { value: 'success', label: 'Success (초록)' },
            { value: 'purple', label: 'Purple (보라)' },
          ]} />
        </Form.Item>
        <Form.Item name="title" label="제목" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="items" label="항목 (줄바꿈으로 구분)" rules={[{ required: true }]}>
          <TextArea rows={8} placeholder="항목 1&#10;항목 2&#10;**볼드** 사용 가능&#10;`코드` 사용 가능" />
        </Form.Item>
        <Form.Item name="is_common" label="바로 보이기 (끄면 간혹 쓰는 항목으로)" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─── Edit Row Modal ───

interface EditRowModalProps {
  open: boolean;
  row: CSRow | null;
  columns: Array<{ title: string; dataIndex: string; key: string }>;
  tableId: string | null;
  newRowCommon: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EditRowModal: React.FC<EditRowModalProps> = ({ open, row, columns, tableId, newRowCommon, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { sheetProps, isPhone } = useSheetModal();
  const isNew = !row;

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (row) {
        form.setFieldsValue({ row_key: row.row_key, is_common: isCommon(row), ...row.data });
      } else {
        form.setFieldsValue({ is_common: newRowCommon });
      }
    }
  }, [open, row, newRowCommon, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const { row_key, is_common, ...data } = values;
    setSaving(true);
    try {
      if (isNew && tableId) {
        await csApi.createRow({ table_id: tableId, row_key: row_key || `r${Date.now()}`, data, is_common });
      } else if (row) {
        // The form only holds the table's columns; keep what isn't one, like the description
        await csApi.updateRow(row.id, { data: { ...row.data, ...data }, is_common });
      }
      message.success(isNew ? '행 추가됨' : '행 수정됨');
      onSaved();
      onClose();
    } catch {
      message.error('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal {...sheetProps} title={isNew ? '행 추가' : '행 수정'} open={open} onCancel={onClose}
      onOk={handleSave} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical" size={isPhone ? 'large' : undefined}>
        {isNew && (
          <Form.Item name="row_key" label="Row Key" rules={[{ required: true }]}>
            <Input placeholder="e.g. c10, l15" />
          </Form.Item>
        )}
        {columns.filter(c => c.dataIndex !== 'key').map(col => (
          <Form.Item key={col.dataIndex} name={col.dataIndex} label={col.title}>
            <Input />
          </Form.Item>
        ))}
        <Form.Item name="is_common" label="바로 보이기 (끄면 간혹 쓰는 항목으로)" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

// ─── Main Component ───

const XactimateCheatSheet: React.FC = () => {
  const [sections, setSections] = useState<CSSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const isPhone = useIsNarrower(768);
  const navInDrawer = useIsNarrower(1200);

  // Note modal state
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteRow, setNoteRow] = useState<CSRow | null>(null);

  // Edit modals
  const [editRuleOpen, setEditRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CSRule | null>(null);
  const [editRuleSectionId, setEditRuleSectionId] = useState<string | null>(null);

  const [editRowOpen, setEditRowOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<CSRow | null>(null);
  const [editRowColumns, setEditRowColumns] = useState<CSTable['columns']>([]);
  const [editRowTableId, setEditRowTableId] = useState<string | null>(null);
  const [newRowCommon, setNewRowCommon] = useState(true);

  // ─── Data loading ─────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await csApi.getSections(!editMode);
      setSections(data);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      message.error('데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [editMode]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Local updates ────────────────────────────────────────────────

  const patchRow = (rowId: string, patch: Partial<CSRow>) => {
    setSections(prev => prev.map(sec => ({
      ...sec,
      tables: sec.tables.map(tbl => ({
        ...tbl,
        rows: tbl.rows.map(r => r.id === rowId ? { ...r, ...patch } : r),
      })),
    })));
  };

  const patchRule = (ruleId: string, patch: Partial<CSRule>) => {
    setSections(prev => prev.map(sec => ({
      ...sec,
      rules: sec.rules.map(r => r.id === ruleId ? { ...r, ...patch } : r),
    })));
  };

  // ─── Note handlers ────────────────────────────────────────────────

  const handleNoteSave = async (rowId: string, note: string | null) => {
    await csApi.updateRowNote(rowId, note);
    patchRow(rowId, { note });
    message.success(note ? '메모 저장됨' : '메모 삭제됨');
  };

  // ─── Sheet actions ────────────────────────────────────────────────

  const actions: SheetActions = {
    editMode,
    onOpenNote: (row) => {
      setNoteRow(row);
      setNoteModalOpen(true);
    },
    onAddRow: (table, isCommonRow) => {
      setEditingRow(null);
      setEditRowColumns(table.columns);
      setEditRowTableId(table.id);
      setNewRowCommon(isCommonRow);
      setEditRowOpen(true);
    },
    onEditRow: (row, table) => {
      setEditingRow(row);
      setEditRowColumns(table.columns);
      setEditRowTableId(table.id);
      setEditRowOpen(true);
    },
    onDeleteRow: async (rowId) => {
      await csApi.deleteRow(rowId);
      message.success('행 삭제됨');
      loadData();
    },
    onToggleRow: async (row) => {
      const is_common = !isCommon(row);
      patchRow(row.id, { is_common });
      try {
        await csApi.updateRow(row.id, { is_common });
      } catch {
        patchRow(row.id, { is_common: !is_common });
        message.error('저장 실패');
      }
    },
    onAddRule: (sectionId) => {
      setEditingRule(null);
      setEditRuleSectionId(sectionId);
      setEditRuleOpen(true);
    },
    onEditRule: (rule, sectionId) => {
      setEditingRule(rule);
      setEditRuleSectionId(sectionId);
      setEditRuleOpen(true);
    },
    onDeleteRule: async (ruleId) => {
      await csApi.deleteRule(ruleId);
      message.success('규칙 삭제됨');
      loadData();
    },
    onToggleRule: async (rule) => {
      const is_common = !isCommon(rule);
      patchRule(rule.id, { is_common });
      try {
        await csApi.updateRule(rule.id, { is_common });
      } catch {
        patchRule(rule.id, { is_common: !is_common });
        message.error('저장 실패');
      }
    },
  };

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ─── Filtering ────────────────────────────────────────────────────

  const searching = searchText.trim().length > 0;

  const views = useMemo(
    () => sections
      .map(s => buildSectionView(s, searchText))
      .filter((v): v is SectionView => v !== null),
    [searchText, sections],
  );

  const matchCount = useMemo(() => views.reduce((n, v) => n + v.matchCount, 0), [views]);

  const rowCount = useMemo(
    () => sections.reduce((n, s) => n + s.tables.reduce((m, t) => m + t.rows.length, 0), 0),
    [sections],
  );

  // ─── Nav groups ───────────────────────────────────────────────────

  const navGroups = useMemo(() => {
    return sections.reduce<Record<string, { id: string; title: string }[]>>((acc, s) => {
      if (!acc[s.nav_group]) acc[s.nav_group] = [];
      acc[s.nav_group].push({ id: s.section_key, title: s.title });
      return acc;
    }, {});
  }, [sections]);

  const reloadButton = (
    <Tooltip title="새로고침">
      <Button icon={<ReloadOutlined />} aria-label="새로고침" loading={loading} onClick={loadData} />
    </Tooltip>
  );

  const printButton = (
    <Tooltip title="Print / PDF">
      <Button icon={<PrinterOutlined />} aria-label="Print / PDF" onClick={() => window.print()} />
    </Tooltip>
  );

  const navContent = (
    <>
      <Anchor
        affix={false}
        offsetTop={TOOLBAR_OFFSET}
        targetOffset={TOOLBAR_OFFSET}
        onClick={() => setDrawerOpen(false)}
        items={Object.entries(navGroups).map(([group, items]) => ({
          key: group,
          href: `#${items[0].id}`,
          title: group,
          children: items.map(item => ({
            key: item.id,
            href: `#${item.id}`,
            title: item.title,
          })),
        }))}
      />
      {isPhone && (
        <div className="cs-nav-tools">
          {reloadButton}
          {printButton}
        </div>
      )}
    </>
  );

  // ─── Render ───────────────────────────────────────────────────────

  const firstLoad = loading && sections.length === 0;

  return (
    <div className="cs-page">
      <PageHeader
        title="Xactimate cheat sheet"
        meta={sections.length > 0 && <span>카테고리 {sections.length}개 · 항목 {rowCount}개</span>}
      />

      <div className="cs-layout">
        <div className="cs-main">
          {/* Search + tools */}
          <div className="cs-toolbar">
            <Input
              placeholder={isPhone ? 'Search codes...' : 'Search items, codes, descriptions...'}
              aria-label="Search items, codes, descriptions"
              prefix={<SearchOutlined style={{ color: 'var(--color-neutral-600)' }} />}
              suffix={searching && <span className="cs-match-count">{matchCount} items</span>}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
              style={isPhone ? { fontSize: 16 } : undefined}
            />
            {navInDrawer && (
              <Button icon={<UnorderedListOutlined />} onClick={() => setDrawerOpen(true)} aria-label="목차">
                {!isPhone && '목차'}
              </Button>
            )}
            {!isPhone && reloadButton}
            {!isPhone && printButton}
            <Button
              type={editMode ? 'primary' : 'default'}
              icon={editMode ? <CheckOutlined /> : <EditOutlined />}
              aria-label={editMode ? '편집 모드 종료' : '편집 모드'}
              aria-pressed={editMode}
              onClick={() => setEditMode(prev => !prev)}
            >
              {!isPhone && (editMode ? '편집 종료' : '편집')}
            </Button>
          </div>

          {editMode && (
            <Alert
              message="편집 모드 — 별 아이콘으로 자주/간혹 쓰는 항목을 옮기고, 규칙/행을 추가·수정·삭제할 수 있습니다"
              type="info" showIcon closable style={{ marginBottom: 16 }}
            />
          )}

          {firstLoad && <Skeleton active title={false} paragraph={{ rows: 12 }} />}

          {loadFailed && sections.length === 0 && !loading && (
            <Alert
              type="error"
              showIcon
              message="Cheat sheet를 불러오지 못했습니다"
              action={<Button size="small" onClick={loadData}>다시 시도</Button>}
            />
          )}

          {searching && views.length === 0 && (
            <p className="cs-empty-search">No matching items found</p>
          )}

          {views.map(view => (
            <SheetSection
              key={view.section.section_key}
              view={view}
              open={openSections.has(view.section.section_key)}
              searching={searching}
              isPhone={isPhone}
              onToggle={() => toggleSection(view.section.section_key)}
              actions={actions}
            />
          ))}
        </div>

        {/* Contents */}
        {!navInDrawer && sections.length > 0 && <nav className="cs-nav" aria-label="목차">{navContent}</nav>}
      </div>

      {navInDrawer && (
        <Drawer
          title="목차"
          placement={isPhone ? 'bottom' : 'right'}
          height={isPhone ? '75%' : undefined}
          width={isPhone ? undefined : 280}
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
          rootClassName="cs-nav-drawer"
        >
          <div className="cs-nav cs-nav--drawer">{navContent}</div>
        </Drawer>
      )}

      {/* Note Modal */}
      <NoteModal open={noteModalOpen} row={noteRow} onClose={() => setNoteModalOpen(false)} onSave={handleNoteSave} />

      {/* Edit Rule Modal */}
      <EditRuleModal open={editRuleOpen} rule={editingRule} sectionId={editRuleSectionId}
        onClose={() => setEditRuleOpen(false)} onSaved={loadData} />

      {/* Edit Row Modal */}
      <EditRowModal open={editRowOpen} row={editingRow} columns={editRowColumns}
        tableId={editRowTableId} newRowCommon={newRowCommon}
        onClose={() => setEditRowOpen(false)} onSaved={loadData} />
    </div>
  );
};

export default XactimateCheatSheet;
