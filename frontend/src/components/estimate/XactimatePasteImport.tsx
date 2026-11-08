/**
 * Bring line items over from Xactimate.
 *
 *  - Screenshot: capture Xactimate's Item Activity Information window
 *    (Win+Shift+S) and paste the picture. The server reads the item's prices
 *    off it (Claude); the item can be kept in the Xactimate price list too.
 *  - Text: select rows in a Xactimate line item grid, or drag over the lines
 *    of an estimate report / PDF, copy (Ctrl+C) and paste. Read in the
 *    browser by `parseXactimatePaste`.
 *
 * Everything lands in a preview first; untick what you don't want.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Input, InputNumber, Modal, Radio, Row, Space, Spin,
  Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  ClearOutlined, CloseOutlined, PictureOutlined, SnippetsOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { EstimateLineItem } from '../../services/estimateService';
import xactimateService from '../../services/xactimateService';
import { XactimateScreenDraft } from '../../types/xactimate';
import { formatNumber } from '../../utils/formatUtils';
import { htmlTableToTsv, parseXactimatePaste, ParsedXactimateLine } from '../../utils/xactimatePaste';

const { Text } = Typography;
const { TextArea } = Input;

type GroupMode = 'rooms' | 'current';

interface XactimatePasteImportProps {
  open: boolean;
  /** Group the manager is showing, "Primary" or "Primary/Secondary" */
  selectedGroup?: string;
  /** Builds an item code when the pasted text has no Cat/Sel */
  makeItemCode: (description: string) => string;
  onImport: (items: EstimateLineItem[]) => void;
  onCancel: () => void;
}

/** A pasted screenshot and what was read off it */
interface ScreenEntry {
  key: string;
  previewUrl: string;
  status: 'reading' | 'ready' | 'error';
  error?: string;
  draft?: XactimateScreenDraft;
  include: boolean;
  quantity: number;
  unit: string;
  description: string;
  unitPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ACTIVITY_PREFIX: Record<string, string> = {
  '-': 'Remove',
  '&': 'R&R',
  R: 'Detach & reset',
  I: 'Install',
  M: 'Material only -',
};

const priceListDescription = (s: ScreenEntry): string => {
  const prefix = s.draft?.activity ? ACTIVITY_PREFIX[s.draft.activity] : undefined;
  const text = s.description.trim();
  const stripped = prefix && text.startsWith(`${prefix} `) ? text.slice(prefix.length + 1).trim() : text;
  return stripped || s.draft?.description || s.draft?.item_code || 'Xactimate item';
};

const money = (v?: number | null) => (v == null ? '-' : `$${formatNumber(v)}`);

let screenSeq = 0;

const XactimatePasteImport: React.FC<XactimatePasteImportProps> = ({
  open,
  selectedGroup,
  makeItemCode,
  onImport,
  onCancel,
}) => {
  const [text, setText] = useState('');
  // Rows the person unticked; every other row is added.
  const [uncheckedKeys, setUncheckedKeys] = useState<Set<React.Key>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode | null>(null);
  const [screens, setScreens] = useState<ScreenEntry[]>([]);
  const [saveToPriceList, setSaveToPriceList] = useState(true);
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseXactimatePaste(text), [text]);
  const hasRooms = parsed.rooms.length > 0;
  const effectiveGroupMode: GroupMode = groupMode ?? (hasRooms ? 'rooms' : 'current');

  useEffect(() => {
    if (!open) {
      setText('');
      setGroupMode(null);
      setUncheckedKeys(new Set());
      setScreens((prev) => {
        prev.forEach((s) => URL.revokeObjectURL(s.previewUrl));
        return [];
      });
    }
  }, [open]);

  const updateScreen = (key: string, patch: Partial<ScreenEntry>) =>
    setScreens((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const removeScreen = (key: string) =>
    setScreens((prev) => {
      const gone = prev.find((s) => s.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((s) => s.key !== key);
    });

  const readScreenshot = async (image: Blob) => {
    const key = `screen_${Date.now()}_${screenSeq++}`;
    const previewUrl = URL.createObjectURL(image);
    setScreens((prev) => [...prev, {
      key, previewUrl, status: 'reading', include: true, quantity: 1, unit: 'EA', description: '', unitPrice: 0,
    }]);
    try {
      const ext = image.type === 'image/jpeg' ? 'jpg' : 'png';
      const draft = await xactimateService.readItemScreenshot(image, `xactimate.${ext}`);
      const prefix = draft.activity ? ACTIVITY_PREFIX[draft.activity] : undefined;
      updateScreen(key, {
        status: 'ready',
        draft,
        unit: draft.unit || 'EA',
        description: prefix && draft.description ? `${prefix} ${draft.description}` : draft.description,
        unitPrice: draft.unit_price ?? 0,
      });
    } catch (e: any) {
      updateScreen(key, {
        status: 'error',
        include: false,
        error: e?.response?.data?.detail || e?.message || 'Could not read the screenshot',
      });
    }
  };

  const insertAtCursor = (el: HTMLTextAreaElement, insert: string) => {
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + insert + text.slice(end));
  };

  const imagesFrom = (data: DataTransfer | null): File[] =>
    data ? Array.from(data.files).filter((f) => f.type.startsWith('image/')) : [];

  // A screenshot pastes as a picture; a table copied from a browser keeps its
  // cells best in the HTML flavour.
  const handlePaste = (e: React.ClipboardEvent<HTMLElement>) => {
    const images = imagesFrom(e.clipboardData);
    if (images.length > 0) {
      e.preventDefault();
      images.forEach(readScreenshot);
      return;
    }
    const tsv = htmlTableToTsv(e.clipboardData.getData('text/html'));
    if (tsv && e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      insertAtCursor(e.target, tsv);
    }
  };

  const handleReadClipboard = async () => {
    try {
      let pastedText: string | null = null;
      if (navigator.clipboard && 'read' in navigator.clipboard) {
        try {
          const clipItems = await navigator.clipboard.read();
          for (const item of clipItems) {
            const imageType = item.types.find((t) => t.startsWith('image/'));
            if (imageType) {
              await readScreenshot(await item.getType(imageType));
              return;
            }
            if (item.types.includes('text/html')) {
              pastedText = htmlTableToTsv(await (await item.getType('text/html')).text());
              if (pastedText) break;
            }
          }
        } catch {
          // Some browsers only allow readText; fall through.
        }
      }
      if (!pastedText) pastedText = await navigator.clipboard.readText();
      if (!pastedText?.trim()) {
        message.info('The clipboard is empty. Copy line items or a screenshot of Xactimate first.');
        return;
      }
      setText(pastedText);
    } catch {
      message.warning('The browser blocked clipboard access. Click the box below and press Ctrl+V instead.');
    }
  };

  const currentGroup = (): Pick<EstimateLineItem, 'primary_group' | 'secondary_group'> => {
    if (selectedGroup) {
      const [primary, secondary] = selectedGroup.split('/');
      return { primary_group: primary, secondary_group: secondary || undefined };
    }
    return { primary_group: 'Xactimate Items', secondary_group: undefined };
  };

  const groupFor = (line: ParsedXactimateLine): Pick<EstimateLineItem, 'primary_group' | 'secondary_group'> => {
    if (effectiveGroupMode === 'rooms' && line.room) {
      return { primary_group: line.room, secondary_group: undefined };
    }
    return selectedGroup || !line.room ? currentGroup() : { primary_group: line.room, secondary_group: undefined };
  };

  const textToLineItem = (line: ParsedXactimateLine): EstimateLineItem => {
    const unitPrice = round2(line.unitPrice);
    const code = line.category && line.selector
      ? `${line.category} ${line.selector}`
      : line.category || makeItemCode(line.description);
    return {
      id: undefined,
      name: code,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit || 'EA',
      unit_price: unitPrice,
      total: round2(line.quantity * unitPrice),
      category: line.category,
      item: line.selector,
      note: line.note
        ? line.note.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('')
        : undefined,
      ...groupFor(line),
    } as EstimateLineItem;
  };

  const screenToLineItem = (s: ScreenEntry): EstimateLineItem => {
    const d = s.draft!;
    const unitPrice = round2(s.unitPrice || 0);
    const noteParts = [
      d.includes_description && `<p><strong>Includes:</strong> ${escapeHtml(d.includes_description)}</p>`,
      d.excludes_description && `<p><strong>Excludes:</strong> ${escapeHtml(d.excludes_description)}</p>`,
      d.quality_description && `<p><strong>Quality:</strong> ${escapeHtml(d.quality_description)}</p>`,
    ].filter(Boolean);
    return {
      id: undefined,
      name: [d.category_code, d.selector].filter(Boolean).join(' ') || makeItemCode(s.description),
      description: s.description,
      quantity: s.quantity,
      unit: s.unit || 'EA',
      unit_price: unitPrice,
      total: round2(s.quantity * unitPrice),
      category: d.category_code || undefined,
      item: d.selector || undefined,
      note: noteParts.length ? noteParts.join('') : undefined,
      ...currentGroup(),
    } as EstimateLineItem;
  };

  /** Keep the screenshot items in the Xactimate price list; failures don't block the estimate */
  const saveScreensToPriceList = async (entries: ScreenEntry[]) => {
    const results = await Promise.allSettled(entries.map((s) => {
      const d = s.draft!;
      return xactimateService.saveItemFromScreen({
        item_code: d.item_code,
        category_code: d.category_code,
        category_name: d.phase?.replace(/^\d+\s*/, '') || null,
        // The price list keeps the description as checked here, without the activity.
        description: priceListDescription(s),
        price_year: d.price_year,
        price_month: d.price_month,
        labor_cost: d.labor_cost,
        material_cost: d.material_cost,
        equipment_cost: d.equipment_cost,
        labor_burden: d.labor_burden,
        market_conditions: d.market_conditions,
        untaxed_unit_price: d.untaxed_unit_price ?? s.unitPrice ?? 0,
        includes_description: d.includes_description,
        excludes_description: d.excludes_description,
        note_description: d.note_description,
        quality_description: d.quality_description,
        reference_description: d.reference_description,
        components: d.components,
      });
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    const saved = results.length - failed;
    if (saved > 0) message.success(`${saved} item${saved === 1 ? '' : 's'} kept in the Xactimate price list`);
    if (failed > 0) message.warning(`${failed} item${failed === 1 ? '' : 's'} couldn't be saved to the price list`);
  };

  const chosenText = parsed.items.filter((i) => !uncheckedKeys.has(i.key));
  const chosenScreens = screens.filter((s) => s.status === 'ready' && s.include);
  const totalChosen = chosenText.length + chosenScreens.length;
  const reading = screens.some((s) => s.status === 'reading');

  const handleImport = async () => {
    if (totalChosen === 0) return;
    const savable = chosenScreens.filter((s) => s.draft?.category_code && s.draft.item_code);
    setAdding(true);
    try {
      if (saveToPriceList && savable.length > 0) await saveScreensToPriceList(savable);
      onImport([...chosenScreens.map(screenToLineItem), ...chosenText.map(textToLineItem)]);
    } finally {
      setAdding(false);
    }
  };

  const columns: ColumnsType<ParsedXactimateLine> = [
    {
      title: '#',
      dataIndex: 'lineNumber',
      width: 48,
      render: (v?: number) => v ?? '',
    },
    ...(hasRooms
      ? [{ title: 'Room', dataIndex: 'room', width: 130, ellipsis: true } as ColumnsType<ParsedXactimateLine>[number]]
      : []),
    {
      title: 'Code',
      key: 'code',
      width: 90,
      render: (_: unknown, r: ParsedXactimateLine) =>
        [r.category, r.selector].filter(Boolean).join(' ') || <Text type="secondary">-</Text>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (v: string, r: ParsedXactimateLine) => (
        <span>
          {r.warnings.length > 0 && (
            <Tooltip title={r.warnings.join('. ')}>
              <WarningOutlined style={{ color: '#faad14', marginRight: 6 }} />
            </Tooltip>
          )}
          {v}
          {r.note && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{r.note}</Text>
          )}
        </span>
      ),
    },
    { title: 'Qty', dataIndex: 'quantity', width: 90, align: 'right', render: (v: number) => formatNumber(v) },
    { title: 'Unit', dataIndex: 'unit', width: 60 },
    { title: 'Unit Price', dataIndex: 'unitPrice', width: 100, align: 'right', render: (v: number) => formatNumber(v) },
    {
      title: 'Total',
      key: 'total',
      width: 110,
      align: 'right',
      render: (_: unknown, r: ParsedXactimateLine) => formatNumber(round2(r.quantity * round2(r.unitPrice))),
    },
  ];

  const warningCount = parsed.items.filter((i) => i.warnings.length > 0).length;
  const currentGroupLabel = selectedGroup ? selectedGroup.replace('/', ' / ') : 'Xactimate Items';

  const renderScreen = (s: ScreenEntry) => {
    const d = s.draft;
    return (
      <Card
        key={s.key}
        size="small"
        styles={{ body: { padding: 12 } }}
        title={
          <Space size={8} wrap>
            {s.status === 'ready' && (
              <Checkbox checked={s.include} onChange={(e) => updateScreen(s.key, { include: e.target.checked })} />
            )}
            <PictureOutlined />
            {d ? (
              <>
                <Text strong>{[d.category_code, d.selector].filter(Boolean).join(' ') || 'Item'}</Text>
                {d.activity && <Tag>{d.activity} {d.activity_label}</Tag>}
              </>
            ) : (
              <Text type="secondary">Screenshot</Text>
            )}
          </Space>
        }
        extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => removeScreen(s.key)} aria-label="Remove" />}
      >
        <Row gutter={[12, 12]} wrap>
          <Col xs={24} sm={6}>
            <img
              src={s.previewUrl}
              alt="Xactimate screenshot"
              style={{ width: '100%', maxHeight: 140, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4 }}
            />
          </Col>
          <Col xs={24} sm={18}>
            {s.status === 'reading' && (
              <Space><Spin size="small" /><Text type="secondary">Reading the screenshot...</Text></Space>
            )}
            {s.status === 'error' && <Alert type="error" showIcon message={s.error} />}
            {s.status === 'ready' && d && (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {d.warnings.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message={d.warnings.map((w) => <div key={w}>{w}</div>)}
                    style={{ padding: '4px 8px' }}
                  />
                )}
                <Input
                  value={s.description}
                  onChange={(e) => updateScreen(s.key, { description: e.target.value })}
                  placeholder="Description"
                  status={s.description ? undefined : 'warning'}
                />
                <Space wrap size={8}>
                  <InputNumber
                    prefix={<Text type="secondary">Qty</Text>}
                    min={0}
                    value={s.quantity}
                    onChange={(v) => updateScreen(s.key, { quantity: Number(v) || 0 })}
                    style={{ width: 140 }}
                  />
                  <Input
                    prefix={<Text type="secondary">Unit</Text>}
                    value={s.unit}
                    onChange={(e) => updateScreen(s.key, { unit: e.target.value.toUpperCase() })}
                    style={{ width: 120 }}
                  />
                  <InputNumber
                    prefix={<Text type="secondary">Unit price $</Text>}
                    min={0}
                    step={0.01}
                    precision={2}
                    value={s.unitPrice}
                    onChange={(v) => updateScreen(s.key, { unitPrice: Number(v) || 0 })}
                    style={{ width: 200 }}
                  />
                  <Text strong>= ${formatNumber(round2(s.quantity * round2(s.unitPrice)))}</Text>
                </Space>
                <Descriptions size="small" column={{ xs: 2, sm: 3, md: 5 }} colon={false}>
                  <Descriptions.Item label="Material">{money(d.material_cost)}</Descriptions.Item>
                  <Descriptions.Item label="Equipment">{money(d.equipment_cost)}</Descriptions.Item>
                  <Descriptions.Item label="Labor">{money(d.retail_labor ?? d.labor_cost)}</Descriptions.Item>
                  <Descriptions.Item label="Market">{money(d.market_conditions)}</Descriptions.Item>
                  <Descriptions.Item label={d.activity === '-' ? 'Remove' : 'Replace'}>
                    {money(d.activity === '-' ? d.remove_price : d.replace_price)}
                  </Descriptions.Item>
                </Descriptions>
                {(d.includes_description || d.quality_description) && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {d.includes_description && <>Includes: {d.includes_description} </>}
                    {d.quality_description && <>Quality: {d.quality_description}</>}
                  </Text>
                )}
              </Space>
            )}
          </Col>
        </Row>
      </Card>
    );
  };

  return (
    <Modal
      title={<span><SnippetsOutlined style={{ marginRight: 8 }} />Bring Line Items from Xactimate</span>}
      open={open}
      onCancel={onCancel}
      width={1100}
      style={{ top: 20, maxWidth: 'calc(100vw - 32px)' }}
      destroyOnHidden
      footer={[
        screens.some((s) => s.status === 'ready') && (
          <Checkbox
            key="save"
            checked={saveToPriceList}
            onChange={(e) => setSaveToPriceList(e.target.checked)}
            style={{ float: 'left', marginTop: 5 }}
          >
            Also keep screenshot items in the Xactimate price list
          </Checkbox>
        ),
        <Button key="cancel" onClick={onCancel}>Cancel</Button>,
        <Button key="add" type="primary" loading={adding} disabled={totalChosen === 0 || reading} onClick={handleImport}>
          {totalChosen > 0 ? `Add ${totalChosen} item${totalChosen === 1 ? '' : 's'}` : 'Add items'}
        </Button>,
      ]}
    >
      <div onPaste={handlePaste}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Text type="secondary">
            Capture Xactimate&apos;s Item Activity Information window (Win+Shift+S) and paste the picture, or select
            line items in Xactimate (drag over the rows, or the lines of the estimate report or PDF), copy with Ctrl+C
            and paste them. Unit prices come in without tax and O&amp;P.
          </Text>

          <Space wrap>
            <Button type="primary" ghost icon={<SnippetsOutlined />} onClick={handleReadClipboard}>
              Paste from clipboard
            </Button>
            <Button icon={<PictureOutlined />} onClick={() => fileInputRef.current?.click()}>Choose screenshot</Button>
            <Button icon={<ClearOutlined />} onClick={() => setText('')} disabled={!text}>Clear text</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                Array.from(e.target.files || []).forEach(readScreenshot);
                e.target.value = '';
              }}
            />
          </Space>

          {screens.length > 0 && (
            <Space direction="vertical" size={8} style={{ width: '100%' }} data-testid="xactimate-screen-drafts">
              {screens.map(renderScreen)}
            </Space>
          )}

          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste here (Ctrl+V): a screenshot, or copied line items\n\ne.g. 1. R&R Baseboard - 3 1/4"   45.33 LF   3.07   2.65   28.36   170.17'}
            autoSize={{ minRows: 4, maxRows: 10 }}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 }}
            data-testid="xactimate-paste-input"
          />

          {text.trim() && parsed.items.length === 0 && (
            <Alert
              type="warning"
              showIcon
              message="No line items found in the pasted text"
              description="Each line item needs a quantity with its unit (e.g. 45.33 LF) followed by its prices."
            />
          )}

          {parsed.items.length > 0 && (
            <>
              <Space wrap size={[16, 8]} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text>
                  <Text strong>{parsed.items.length}</Text> item{parsed.items.length === 1 ? '' : 's'} in the text
                  {hasRooms && <> in <Text strong>{parsed.rooms.length}</Text> room{parsed.rooms.length === 1 ? '' : 's'}</>}
                  {warningCount > 0 && <Text type="warning"> · {warningCount} to check</Text>}
                </Text>
                <Radio.Group size="small" value={effectiveGroupMode} onChange={(e) => setGroupMode(e.target.value)}>
                  <Radio value="rooms" disabled={!hasRooms}>Group by Xactimate room</Radio>
                  <Radio value="current">Add all to {currentGroupLabel}</Radio>
                </Radio.Group>
              </Space>

              <Table<ParsedXactimateLine>
                rowKey="key"
                size="small"
                columns={columns}
                dataSource={parsed.items}
                pagination={false}
                scroll={{ x: 760, y: 340 }}
                rowSelection={{
                  selectedRowKeys: chosenText.map((i) => i.key),
                  onChange: (keys) => setUncheckedKeys(
                    new Set(parsed.items.filter((i) => !keys.includes(i.key)).map((i) => i.key)),
                  ),
                }}
                data-testid="xactimate-paste-preview"
              />
            </>
          )}

          {parsed.skippedLines.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer' }}>
                <Text type="secondary">
                  {parsed.skippedLines.length} line{parsed.skippedLines.length === 1 ? '' : 's'} not read as items
                </Text>
              </summary>
              <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0 0', maxHeight: 160, overflow: 'auto' }}>
                {parsed.skippedLines.join('\n')}
              </pre>
            </details>
          )}
        </Space>
      </div>
    </Modal>
  );
};

export default XactimatePasteImport;
