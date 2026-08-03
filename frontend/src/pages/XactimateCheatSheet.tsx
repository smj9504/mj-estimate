import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Input, Tag, Typography, Anchor, Card, Table, Alert, Row, Col, Badge, Space,
  Drawer, FloatButton, Modal, Button, Spin, message, Tooltip, Popconfirm, Form, Select,
} from 'antd';
import {
  SearchOutlined, PrinterOutlined, MenuOutlined, CopyOutlined, FileTextOutlined,
  EditOutlined, PlusOutlined, DeleteOutlined, SaveOutlined, CloseOutlined,
  CommentOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { CSSection, CSRule, CSTable, CSRow } from '../services/cheatsheetService';
import * as csApi from '../services/cheatsheetService';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ─── Render helpers (same logic, now working with DB data) ───

const codeRender = (v: string) => {
  if (!v) return null;
  const parts = v.split(/(`[^`]+`)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <Tag key={i} color="default" style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
            {p.slice(1, -1)}
          </Tag>
        ) : p.includes('\u2691') ? (
          <Tag key={i} color="gold" style={{ fontSize: 11 }}>{p}</Tag>
        ) : p.includes('\u2715') ? (
          <Tag key={i} color="red" style={{ fontSize: 11 }}>{p}</Tag>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </span>
  );
};

const priceRender = (v: string) => {
  if (!v || v === '\u2014') return <Text type="secondary">{'\u2014'}</Text>;
  return <Text style={{ fontFamily: 'monospace', color: '#389e0d', fontWeight: 500 }}>{v}</Text>;
};

const unitRender = (v: string) => (
  <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>
);

const missRender = (v: string) => {
  if (!v) return null;
  if (v.includes('[miss]')) {
    const clean = v.replace('[miss]', '').trim();
    return <Tag color="gold" style={{ fontSize: 10 }}>{'\u2691'} {clean || '자주 빠짐'}</Tag>;
  }
  if (v.includes('[excl]')) {
    const clean = v.replace('[excl]', '').trim();
    return <Tag color="red" style={{ fontSize: 10 }}>{'\u2715'} {clean}</Tag>;
  }
  if (v.includes('[warn]')) {
    const clean = v.replace('[warn]', '').trim();
    return <Text type="warning">{clean}</Text>;
  }
  return codeRender(v);
};

const RENDER_MAP: Record<string, (v: string) => React.ReactNode> = {
  code: codeRender,
  price: priceRender,
  unit: unitRender,
  miss: missRender,
};

// ─── Helper renders ───

const ruleTypeToAlertType = (t: string): 'info' | 'warning' | 'success' | 'error' => {
  if (t === 'warning') return 'warning';
  if (t === 'success') return 'success';
  return 'info';
};

const ruleTypeToColor = (t: string): string => {
  if (t === 'warning') return '#fff7e6';
  if (t === 'success') return '#f6ffed';
  if (t === 'purple') return '#f9f0ff';
  return '#e6f4ff';
};

const ruleTypeToBorderColor = (t: string): string => {
  if (t === 'warning') return '#faad14';
  if (t === 'success') return '#52c41a';
  if (t === 'purple') return '#722ed1';
  return '#1677ff';
};

const formatText = (text: string): React.ReactNode => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={i} strong>{part.slice(2, -2)}</Text>;
    }
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((cp, j) => {
      if (cp.startsWith('`') && cp.endsWith('`')) {
        return <Tag key={`${i}-${j}`} color="default" style={{ fontFamily: 'monospace', fontSize: 11 }}>{cp.slice(1, -1)}</Tag>;
      }
      return <span key={`${i}-${j}`}>{cp}</span>;
    });
  });
};

// ─── Mobile hook ───

const useIsMobile = (breakpoint = 768) => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
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
      title={
        <Space>
          <CommentOutlined />
          <span>메모</span>
          {itemLabel && <Tag color="blue" style={{ fontSize: 11 }}>{typeof itemLabel === 'string' ? itemLabel.replace(/`/g, '').substring(0, 40) : ''}</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={[
        row?.note && (
          <Button key="clear" danger onClick={() => { setNoteText(''); }} style={{ float: 'left' }}>
            메모 삭제
          </Button>
        ),
        <Button key="cancel" onClick={onClose}>취소</Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>
          <SaveOutlined /> 저장
        </Button>,
      ]}
      width={520}
    >
      <TextArea
        rows={4}
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        placeholder="이 항목에 대한 메모를 입력하세요..."
        style={{ marginTop: 8 }}
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
  const isNew = !rule;

  useEffect(() => {
    if (open) {
      form.setFieldsValue(
        rule
          ? { rule_type: rule.rule_type, title: rule.title, items: rule.items.join('\n') }
          : { rule_type: 'info', title: '', items: '' }
      );
    }
  }, [open, rule, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const items = (values.items as string).split('\n').filter((s: string) => s.trim());
    setSaving(true);
    try {
      if (isNew && sectionId) {
        await csApi.createRule({ section_id: sectionId, rule_type: values.rule_type, title: values.title, items });
      } else if (rule) {
        await csApi.updateRule(rule.id, { rule_type: values.rule_type, title: values.title, items });
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
    <Modal title={isNew ? '규칙 추가' : '규칙 수정'} open={open} onCancel={onClose}
      onOk={handleSave} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical">
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
  onClose: () => void;
  onSaved: () => void;
}

const EditRowModal: React.FC<EditRowModalProps> = ({ open, row, columns, tableId, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isNew = !row;

  useEffect(() => {
    if (open) {
      if (row) {
        form.setFieldsValue({ row_key: row.row_key, ...row.data });
      } else {
        form.resetFields();
      }
    }
  }, [open, row, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const { row_key, ...data } = values;
    setSaving(true);
    try {
      if (isNew && tableId) {
        await csApi.createRow({ table_id: tableId, row_key: row_key || `r${Date.now()}`, data });
      } else if (row) {
        await csApi.updateRow(row.id, { data });
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
    <Modal title={isNew ? '행 추가' : '행 수정'} open={open} onCancel={onClose}
      onOk={handleSave} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical">
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
      </Form>
    </Modal>
  );
};

// ─── Main Component ───

const XactimateCheatSheet: React.FC = () => {
  const [sections, setSections] = useState<CSSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const isMobile = useIsMobile();

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

  // ─── Data loading ─────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await csApi.getSections(!editMode);
      setSections(data);
    } catch (err) {
      message.error('데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [editMode]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Note handlers ────────────────────────────────────────────────

  const handleRowClick = (row: CSRow) => {
    setNoteRow(row);
    setNoteModalOpen(true);
  };

  const handleNoteSave = async (rowId: string, note: string | null) => {
    await csApi.updateRowNote(rowId, note);
    // Update local state
    setSections(prev => prev.map(sec => ({
      ...sec,
      tables: sec.tables.map(tbl => ({
        ...tbl,
        rows: tbl.rows.map(r => r.id === rowId ? { ...r, note } : r),
      })),
    })));
    message.success(note ? '메모 저장됨' : '메모 삭제됨');
  };

  // ─── Delete handlers ──────────────────────────────────────────────

  const handleDeleteRule = async (ruleId: string) => {
    await csApi.deleteRule(ruleId);
    message.success('규칙 삭제됨');
    loadData();
  };

  const handleDeleteRow = async (rowId: string) => {
    await csApi.deleteRow(rowId);
    message.success('행 삭제됨');
    loadData();
  };

  // ─── Filtering ────────────────────────────────────────────────────

  const filteredSections = useMemo(() => {
    if (!searchText.trim()) return sections;
    const q = searchText.toLowerCase();
    return sections.filter(section => {
      if (section.title.toLowerCase().includes(q)) return true;
      if (section.tag.toLowerCase().includes(q)) return true;
      if (section.rules?.some(r =>
        r.title.toLowerCase().includes(q) ||
        r.items.some(item => item.toLowerCase().includes(q))
      )) return true;
      if (section.tables?.some(t =>
        t.rows.some(row =>
          Object.values(row.data).some(v => v && v.toLowerCase().includes(q))
        )
      )) return true;
      return false;
    });
  }, [searchText, sections]);

  const matchCount = useMemo(() => {
    if (!searchText.trim()) return 0;
    const q = searchText.toLowerCase();
    let count = 0;
    sections.forEach(s => {
      s.tables?.forEach(t => {
        t.rows.forEach(row => {
          if (Object.values(row.data).some(v => v && v.toLowerCase().includes(q))) count++;
        });
      });
      s.rules?.forEach(r => {
        if (r.title.toLowerCase().includes(q) || r.items.some(i => i.toLowerCase().includes(q))) count++;
      });
    });
    return count;
  }, [searchText, sections]);

  const getFilteredRows = (rows: CSRow[]) => {
    if (!searchText.trim()) return rows;
    const q = searchText.toLowerCase();
    return rows.filter(row =>
      Object.values(row.data).some(v => v && v.toLowerCase().includes(q))
    );
  };

  const shouldShowRule = (rule: CSRule) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return rule.title.toLowerCase().includes(q) ||
      rule.items.some(item => item.toLowerCase().includes(q));
  };

  const handleAnchorClick = useCallback(() => {
    if (isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // ─── Nav groups ───────────────────────────────────────────────────

  const navGroups = useMemo(() => {
    return sections.reduce<Record<string, { id: string; title: string; dotColor: string }[]>>((acc, s) => {
      if (!acc[s.nav_group]) acc[s.nav_group] = [];
      acc[s.nav_group].push({ id: s.section_key, title: s.title, dotColor: s.nav_dot_color });
      return acc;
    }, {});
  }, [sections]);

  // ─── Build table columns from DB data ─────────────────────────────

  const buildColumns = (tbl: CSTable) => {
    const cols = tbl.columns.map(col => ({
      ...col,
      render: col.render ? RENDER_MAP[col.render] : undefined,
    }));

    // Add note indicator column
    cols.push({
      title: '',
      dataIndex: '__note',
      key: '__note',
      render: (_: any, record: any) => {
        const row = tbl.rows.find(r => r.row_key === record.key);
        if (!row) return null;
        return row.note ? (
          <Tooltip title={row.note}>
            <CommentOutlined style={{ color: '#1677ff', fontSize: 14 }} />
          </Tooltip>
        ) : (
          <CommentOutlined style={{ color: '#d9d9d9', fontSize: 14 }} />
        );
      },
    } as any);

    // Edit mode: add actions column
    if (editMode) {
      cols.push({
        title: '',
        dataIndex: '__actions',
        key: '__actions',
        render: (_: any, record: any) => {
          const row = tbl.rows.find(r => r.row_key === record.key);
          if (!row) return null;
          return (
            <Space size={4}>
              <Button type="link" size="small" icon={<EditOutlined />}
                onClick={(e) => { e.stopPropagation(); setEditingRow(row); setEditRowColumns(tbl.columns); setEditRowTableId(tbl.id); setEditRowOpen(true); }} />
              <Popconfirm title="삭제?" onConfirm={(e) => { e?.stopPropagation(); handleDeleteRow(row.id); }}
                onCancel={e => e?.stopPropagation()}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />}
                  onClick={e => e.stopPropagation()} />
              </Popconfirm>
            </Space>
          );
        },
      } as any);
    }

    return cols;
  };

  // ─── Shared navigation ────────────────────────────────────────────

  const navContent = (
    <>
      <div style={{ padding: '8px 0 16px', borderBottom: '1px solid #f0f0f0', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0, fontFamily: 'monospace', letterSpacing: 1 }}>XACTIMATE</Title>
        <Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Estimator Cheat Sheet</Text>
      </div>
      <Anchor
        affix={false}
        offsetTop={80}
        onClick={handleAnchorClick}
        items={Object.entries(navGroups).map(([group, items]) => ({
          key: group,
          href: `#${items[0].id}`,
          title: <Text type="secondary" style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{group}</Text>,
          children: items.map(item => ({
            key: item.id,
            href: `#${item.id}`,
            title: (
              <Space size={6}>
                <Badge color={item.dotColor} />
                <span style={{ fontSize: 12 }}>{item.title}</span>
              </Space>
            ),
          })),
        }))}
      />
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
        <a onClick={() => window.print()} style={{ fontSize: 12, cursor: 'pointer', color: '#666' }}>
          <PrinterOutlined /> Print / PDF
        </a>
      </div>
    </>
  );

  // ─── Render ───────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /><div style={{ marginTop: 16 }}>Loading cheat sheet...</div></div>;
  }

  return (
    <div style={{ display: 'flex', gap: isMobile ? 0 : 24 }}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <div style={{
          width: 220, flexShrink: 0, position: 'sticky', top: 0,
          maxHeight: 'calc(100vh - 140px)', overflowY: 'auto',
          borderRight: '1px solid #f0f0f0', paddingRight: 12,
        }}>
          {navContent}
        </div>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <>
          <Drawer title={null} placement="left" onClose={() => setDrawerOpen(false)}
            open={drawerOpen} width={260}
            styles={{ body: { padding: '12px 16px' } }}>
            {navContent}
          </Drawer>
          <FloatButton icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)}
            style={{ left: 16, bottom: 24, right: 'auto' }} />
        </>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '0 8px' : 0 }}>
        {/* Search + Edit toggle */}
        <div style={{
          marginBottom: isMobile ? 16 : 24, position: 'sticky', top: 0, zIndex: 10,
          background: '#fff', paddingBottom: 8, paddingTop: isMobile ? 8 : 0,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <Input
            size={isMobile ? 'middle' : 'large'}
            placeholder={isMobile ? 'Search codes...' : 'Search items, codes, descriptions...'}
            prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
            suffix={searchText && <Text type="secondary" style={{ fontSize: 12 }}>{matchCount} items</Text>}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            allowClear
            style={{ fontFamily: 'monospace', fontSize: isMobile ? 12 : 13, flex: 1 }}
          />
          <Tooltip title="새로고침">
            <Button icon={<ReloadOutlined />} onClick={loadData} />
          </Tooltip>
          <Tooltip title={editMode ? '편집 모드 종료' : '편집 모드'}>
            <Button
              type={editMode ? 'primary' : 'default'}
              icon={editMode ? <CloseOutlined /> : <EditOutlined />}
              onClick={() => setEditMode(prev => !prev)}
              danger={editMode}
            />
          </Tooltip>
        </div>

        {editMode && (
          <Alert
            message="편집 모드 — 행 클릭으로 메모 등록, 규칙/행 추가·수정·삭제가 가능합니다"
            type="info" showIcon closable style={{ marginBottom: 16 }}
          />
        )}

        {filteredSections.length === 0 && !loading && (
          <Alert message="No matching items found" type="info" showIcon style={{ marginBottom: 24 }} />
        )}

        {/* Sections */}
        {filteredSections.map(section => (
          <div key={section.section_key} id={section.section_key} style={{ marginBottom: isMobile ? 28 : 40, scrollMarginTop: 60 }}>
            {/* Section Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10,
              marginBottom: isMobile ? 10 : 16, paddingBottom: isMobile ? 6 : 10,
              borderBottom: '2px solid #1a1a1a', flexWrap: 'wrap',
            }}>
              <Title level={isMobile ? 5 : 4} style={{ margin: 0, fontFamily: 'monospace' }}>{section.title}</Title>
              <Tag color={section.tag_color} style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: isMobile ? 10 : 11 }}>
                {section.tag}
              </Tag>
            </div>

            {/* Rules */}
            {section.rules && section.rules.length > 0 && (
              <Row gutter={[isMobile ? 8 : 12, isMobile ? 8 : 12]} style={{ marginBottom: section.tables?.length ? (isMobile ? 10 : 16) : 0 }}>
                {section.rules.filter(shouldShowRule).map((rule) => (
                  <Col key={rule.id} xs={24} md={section.rules.length > 2 ? 12 : section.rules.length === 1 ? 24 : 12} lg={section.rules.length > 2 ? (section.rules.length > 4 ? 8 : 12) : section.rules.length === 1 ? 24 : 12}>
                    <Card
                      size="small"
                      style={{
                        height: '100%',
                        background: ruleTypeToColor(rule.rule_type),
                        borderLeft: `3px solid ${ruleTypeToBorderColor(rule.rule_type)}`,
                        borderColor: '#f0f0f0',
                      }}
                      styles={isMobile ? { body: { padding: '8px 10px' } } : undefined}
                      extra={editMode && (
                        <Space size={4}>
                          <Button type="link" size="small" icon={<EditOutlined />}
                            onClick={() => { setEditingRule(rule); setEditRuleSectionId(section.id); setEditRuleOpen(true); }} />
                          <Popconfirm title="삭제?" onConfirm={() => handleDeleteRule(rule.id)}>
                            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      )}
                    >
                      <Text strong style={{
                        fontSize: isMobile ? 10 : 11, textTransform: 'uppercase',
                        letterSpacing: 0.5, color: ruleTypeToBorderColor(rule.rule_type),
                        display: 'block', marginBottom: isMobile ? 4 : 8,
                      }}>
                        {rule.title}
                      </Text>
                      <ul style={{ paddingLeft: isMobile ? 12 : 16, margin: 0 }}>
                        {rule.items.map((item, j) => (
                          <li key={j} style={{ fontSize: isMobile ? 11 : 12, color: '#555', lineHeight: isMobile ? 1.6 : 1.8 }}>
                            {formatText(item)}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Col>
                ))}
                {editMode && (
                  <Col xs={24} md={12}>
                    <Button type="dashed" block icon={<PlusOutlined />}
                      style={{ height: 60 }}
                      onClick={() => { setEditingRule(null); setEditRuleSectionId(section.id); setEditRuleOpen(true); }}>
                      규칙 추가
                    </Button>
                  </Col>
                )}
              </Row>
            )}

            {/* Tables */}
            {section.tables?.map((tbl) => {
              const filteredRows = getFilteredRows(tbl.rows);
              if (searchText && filteredRows.length === 0) return null;
              const hasAnyDesc = filteredRows.some(r => r.data.desc);
              const tableData = filteredRows.map(r => ({ key: r.row_key, ...r.data } as Record<string, any>));

              return (
                <div key={tbl.id} style={{ marginTop: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <Table
                    columns={buildColumns(tbl)}
                    dataSource={tableData}
                    pagination={false}
                    size="small"
                    bordered
                    scroll={{ x: isMobile ? 600 : 'max-content' }}
                    style={{ fontSize: isMobile ? 11 : 12 }}
                    onRow={(record) => ({
                      onClick: () => {
                        const row = tbl.rows.find(r => r.row_key === record.key);
                        if (row) handleRowClick(row);
                      },
                      style: { cursor: 'pointer' },
                    })}
                    rowClassName={(record, index) => {
                      const row = tbl.rows.find(r => r.row_key === record.key);
                      const stripe = index % 2 === 0 ? '' : 'ant-table-row-stripe';
                      const hasNote = row?.note ? ' cs-row-has-note' : '';
                      const hasDesc = record.desc ? ' has-desc-row' : '';
                      return stripe + hasNote + hasDesc;
                    }}
                    expandable={hasAnyDesc ? {
                      rowExpandable: (record) => !!record.desc,
                      expandedRowRender: (record) => (
                        <div style={{
                          padding: isMobile ? '8px 4px' : '10px 16px',
                          background: '#f6ffed', borderLeft: '3px solid #52c41a',
                          borderRadius: 4, display: 'flex', gap: 8, alignItems: 'flex-start',
                        }}>
                          <div style={{ flex: 1 }}>
                            <Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                              <FileTextOutlined /> Description / Justification
                            </Text>
                            <Text style={{ fontSize: isMobile ? 11 : 12, lineHeight: 1.6, color: '#333' }}>
                              {record.desc}
                            </Text>
                          </div>
                          <a onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(record.desc || ''); message.success('복사됨'); }}
                            style={{ flexShrink: 0, fontSize: 16, color: '#8c8c8c', padding: 4 }} title="Copy to clipboard">
                            <CopyOutlined />
                          </a>
                        </div>
                      ),
                      expandIcon: ({ expanded, onExpand, record }) =>
                        record.desc ? (
                          <a onClick={(e) => { e.stopPropagation(); onExpand(record, e); }}
                            style={{ color: expanded ? '#52c41a' : '#bbb', fontSize: 14 }} title="View description">
                            <FileTextOutlined />
                          </a>
                        ) : <span style={{ display: 'inline-block', width: 14 }} />,
                    } : undefined}
                  />
                  {editMode && (
                    <Button type="dashed" block icon={<PlusOutlined />}
                      style={{ marginTop: 4 }}
                      onClick={() => { setEditingRow(null); setEditRowColumns(tbl.columns); setEditRowTableId(tbl.id); setEditRowOpen(true); }}>
                      행 추가
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Note Modal */}
      <NoteModal open={noteModalOpen} row={noteRow} onClose={() => setNoteModalOpen(false)} onSave={handleNoteSave} />

      {/* Edit Rule Modal */}
      <EditRuleModal open={editRuleOpen} rule={editingRule} sectionId={editRuleSectionId}
        onClose={() => setEditRuleOpen(false)} onSaved={loadData} />

      {/* Edit Row Modal */}
      <EditRowModal open={editRowOpen} row={editingRow} columns={editRowColumns}
        tableId={editRowTableId} onClose={() => setEditRowOpen(false)} onSaved={loadData} />

      {/* Style for note rows */}
      <style>{`
        .cs-row-has-note { background: #f0f5ff !important; }
        .cs-row-has-note:hover td { background: #e6f0ff !important; }
      `}</style>
    </div>
  );
};

export default XactimateCheatSheet;
