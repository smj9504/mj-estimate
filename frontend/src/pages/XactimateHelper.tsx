/**
 * Xactimate Helper Tool - Main Page
 *
 * Combines: Room creation, AI photo analysis, recommendation editing,
 * description management, and feedback correction workflow.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  AppstoreOutlined,
  CameraOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  SearchOutlined,
  SendOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';

import {
  DAMAGE_TYPES,
  DESCRIPTION_TYPES,
  ROOM_TYPES,
  type AnalyzeResponse,
  type RecommendedItem,
  type XactItemDescription,
  type XactRoom,
} from '../types/xactimateHelper';
import * as helperService from '../services/xactimateHelperService';
import ScopeBuilder, { type ResolvedScopeItem } from '../components/xactimate-helper/ScopeBuilder';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ─── Room Creation Form ──────────────────────────────────────────────────────

interface RoomFormProps {
  onCreated: (room: XactRoom) => void;
}

const RoomForm: React.FC<RoomFormProps> = ({ onCreated }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const room = await helperService.createRoom({
        name: values.name,
        room_type: values.room_type,
        damage_type: values.damage_type,
        dimensions: {
          LF: values.lf || undefined,
          SF: values.sf || undefined,
          height: values.height || undefined,
        },
        condition_flags: {
          occupied: values.occupied ?? false,
        },
      });
      message.success('Room created');
      form.resetFields();
      onCreated(room);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Create Room" size="small">
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="name" label="Room Name" rules={[{ required: true }]}>
              <Input placeholder="e.g. Living Room" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="room_type" label="Room Type">
              <Select placeholder="Select type" allowClear>
                {ROOM_TYPES.map((t) => (
                  <Select.Option key={t.value} value={t.value}>{t.label}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="damage_type" label="Damage Type">
              <Select placeholder="Select damage type" allowClear>
                {DAMAGE_TYPES.map((t) => (
                  <Select.Option key={t.value} value={t.value}>{t.label}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={6}>
            <Form.Item name="lf" label="LF (Linear Feet)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="sf" label="SF (Square Feet)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="height" label="Ceiling Height">
              <InputNumber min={0} style={{ width: '100%' }} addonAfter="ft" />
            </Form.Item>
          </Col>
          <Col span={6} style={{ paddingTop: 30 }}>
            <Form.Item name="occupied" valuePropName="checked" noStyle>
              <Switch checkedChildren="Occupied" unCheckedChildren="Vacant" />
            </Form.Item>
          </Col>
        </Row>

        <Button type="primary" htmlType="submit" loading={loading} icon={<PlusOutlined />}>
          Create Room
        </Button>
      </Form>
    </Card>
  );
};

// ─── AI Analysis Panel ───────────────────────────────────────────────────────

interface AnalysisPanelProps {
  room: XactRoom;
  onResult: (result: AnalyzeResponse) => void;
}

const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ room, onResult }) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [manualKeywords, setManualKeywords] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);

  const handleAnalyze = async () => {
    const photos: string[] = [];

    // Convert files to base64
    for (const file of fileList) {
      if (file.originFileObj) {
        const b64 = await fileToBase64(file.originFileObj);
        photos.push(b64);
      }
    }

    const keywords = manualKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (photos.length === 0 && keywords.length === 0) {
      message.warning('Please upload photos or enter keywords');
      return;
    }

    setAnalyzing(true);
    setCurrentStep(0);

    let stepTimer: ReturnType<typeof setInterval> | undefined;
    try {
      // Simulate step progression
      stepTimer = setInterval(() => {
        setCurrentStep((prev) => Math.min(prev + 1, 2));
      }, 2000);

      const result = await helperService.analyzeRoom(room.id, {
        photos: photos.length > 0 ? photos : undefined,
        manual_keywords: keywords.length > 0 ? keywords : undefined,
      });

      clearInterval(stepTimer);
      setCurrentStep(3);
      onResult(result);
      message.success('Analysis complete!');
    } catch (err: any) {
      if (stepTimer) clearInterval(stepTimer);
      message.error(err?.response?.data?.detail || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <RobotOutlined />
          <span>AI Analysis — {room.name}</span>
        </Space>
      }
      size="small"
    >
      {analyzing && (
        <Steps
          current={currentStep}
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            { title: 'Vision AI', description: 'Extracting keywords' },
            { title: 'Vector Search', description: 'Finding candidates' },
            { title: 'LLM Matching', description: 'Building assembly' },
          ]}
        />
      )}

      <Row gutter={16}>
        <Col span={12}>
          <Upload
            listType="picture-card"
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl)}
            beforeUpload={() => false}
            accept="image/*"
            multiple
          >
            {fileList.length < 5 && (
              <div>
                <CameraOutlined />
                <div style={{ marginTop: 8 }}>Upload Photo</div>
              </div>
            )}
          </Upload>
        </Col>
        <Col span={12}>
          <TextArea
            rows={4}
            placeholder="Or enter keywords manually (comma-separated)&#10;e.g.: baseboard remove and replace LF, wall paint SF"
            value={manualKeywords}
            onChange={(e) => setManualKeywords(e.target.value)}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 12 }}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={analyzing}
          onClick={handleAnalyze}
          size="large"
        >
          {analyzing ? 'Analyzing...' : 'Run AI Analysis'}
        </Button>
      </div>
    </Card>
  );
};

// ─── Recommendation Editor ───────────────────────────────────────────────────

// ─── Waste Factor Guide ──────────────────────────────────────────────────────
// Xactimate에서 waste가 가격에 미포함 → 수동으로 수량에 추가 필요한 항목
// Source: Xactware docs, cheat sheet, industry standards
interface WasteGuide {
  pct: string;        // e.g. "10~15%"
  tip: string;        // Short guidance
}

/**
 * item_code prefix → waste guidance.
 * 매칭 순서: 긴 prefix부터 먼저 검사하므로 구체적 코드가 우선.
 * `null` = waste가 이미 가격에 포함됨 (별도 안내 불필요)
 */
const WASTE_GUIDE: Record<string, WasteGuide | null> = {
  // ── Waste 미포함 → 수동 추가 필수 ──
  'FCCAV':   { pct: '10~15%', tip: 'Carpet: Qty에 waste 추가 필요 (기본 15%, 패턴매칭시 20%). Remove qty에는 waste 추가 안 함!' },
  'FCCNFCP': { pct: '10~15%', tip: 'Carpet per specs: Qty에 waste 추가 필요 (기본 15%). Remove qty에는 waste 추가 안 함!' },
  'FCCPAD':  { pct: '10~15%', tip: 'Carpet Pad: Carpet과 동일한 waste % 적용. Remove qty에는 waste 추가 안 함!' },
  'FCVAV':   { pct: '10~15%', tip: 'Sheet Vinyl: Qty에 waste 추가 필요 (기본 10%, 패턴매칭시 15%). Remove qty에는 waste 추가 안 함!' },
  'RFGSHNG': { pct: '10~20%', tip: 'Shingles: 단순 지붕 10%, hip/valley 15%, 복잡한 지붕 20%+' },
  // ── Waste 자동 포함 (안내만) ──
  'FCTAV':   null,  // Tile floor — waste 포함
  'TILAV':   null,  // Wall tile — waste 포함
  'TILTUB':  null,  // Tub surround — waste 포함
  'TILSWR':  null,  // Shower tile — waste 포함
  'FCVPLK':  null,  // LVP — waste 포함
  'FCWAV':   null,  // Hardwood — waste 포함
  'FCWLAM':  null,  // Laminate — waste 포함
  'DRY':     null,  // Drywall — waste 포함
  'PNT':     null,  // Paint — waste 포함
};

/** item_code에 해당하는 waste 안내를 찾는다. 긴 prefix 우선 매칭. */
function getWasteGuide(itemCode: string): WasteGuide | null | undefined {
  // Sort keys by length desc so longer (more specific) prefixes match first
  const keys = Object.keys(WASTE_GUIDE).sort((a, b) => b.length - a.length);
  for (const prefix of keys) {
    if (itemCode.startsWith(prefix)) {
      return WASTE_GUIDE[prefix];
    }
  }
  return undefined; // no match = no waste info
}

interface RecommendationEditorProps {
  room: XactRoom;
  result: AnalyzeResponse;
  onSaved: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  CLN: 'Cleaning',
  CON: 'Contents',
  DML: 'Demolition',
  DRY: 'Drywall',
  ELC: 'Electrical',
  FNC: 'Fencing',
  FLR: 'Flooring',
  FRM: 'Framing',
  GNL: 'General',
  HVC: 'HVAC',
  INS: 'Insulation',
  MBL: 'Mold/Bio',
  PNT: 'Painting',
  PLB: 'Plumbing',
  RFG: 'Roofing',
  SSF: 'Siding/Soffit/Fascia',
  WDR: 'Windows/Doors',
  WTR: 'Water Mitigation',
  ACM: 'Asbestos/Lead',
  APP: 'Appliances',
  CAB: 'Cabinetry',
  CPT: 'Carpet',
  TLE: 'Tile',
  MAS: 'Masonry',
};

interface GroupedSection {
  category: string;
  label: string;
  items: { item: RecommendedItem; flatIndex: number }[];
}

const RecommendationEditor: React.FC<RecommendationEditorProps> = ({ room, result, onSaved }) => {
  const [items, setItems] = useState<RecommendedItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [descDrawer, setDescDrawer] = useState<{ open: boolean; itemCode: string }>({
    open: false,
    itemCode: '',
  });

  useEffect(() => {
    if (result.recommendations.length > 0) {
      setItems(result.recommendations[0].items);
    }
  }, [result]);

  // Group items by category, preserving flat array indices
  const groupedSections = useMemo<GroupedSection[]>(() => {
    const sectionMap = new Map<string, { item: RecommendedItem; flatIndex: number }[]>();
    items.forEach((item, idx) => {
      const cat = item.category || 'OTHER';
      if (!sectionMap.has(cat)) {
        sectionMap.set(cat, []);
      }
      sectionMap.get(cat)!.push({ item, flatIndex: idx });
    });

    return Array.from(sectionMap.entries()).map(([cat, entries]) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] || cat,
      items: entries,
    }));
  }, [items]);

  const handleQtyChange = (index: number, qty: number) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, qty } : item)));
  };

  const handleRemove = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { item_code: '', description: 'New item', qty: 1, unit: 'EA', unit_price: 0 },
    ]);
  };

  const handleSaveCorrection = async () => {
    setSaving(true);
    try {
      const original = result.recommendations[0]?.items || [];
      await helperService.saveCorrection(room.id, {
        ai_suggested: original,
        user_corrected: items,
      });

      // Also update room with final line items
      await helperService.updateRoom(room.id, {
        final_line_items: items,
        status: 'draft',
      });

      message.success('Corrections saved');
      onSaved();
    } catch (err: any) {
      message.error('Failed to save corrections');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    try {
      await helperService.updateRoom(room.id, {
        final_line_items: items,
        status: 'confirmed',
      });
      message.success('Estimate confirmed!');
      onSaved();
    } catch {
      message.error('Failed to confirm');
    }
  };

  // Columns WITHOUT Cat column — category is now the section header
  const makeSectionColumns = () => [
    {
      title: 'Item',
      width: 110,
      render: (_: any, row: { item: RecommendedItem; flatIndex: number }) => {
        const cat = row.item.category || '';
        const itemPart = cat && row.item.item_code.startsWith(cat)
          ? row.item.item_code.substring(cat.length)
          : row.item.item_code;
        return (
          <Input
            size="small"
            value={itemPart}
            style={{ fontFamily: 'monospace', fontWeight: 600 }}
            onChange={(e) => {
              const newCode = cat + e.target.value;
              const fi = row.flatIndex;
              setItems((prev) =>
                prev.map((item, i) => (i === fi ? { ...item, item_code: newCode } : item))
              );
            }}
          />
        );
      },
    },
    {
      title: 'Description',
      ellipsis: false,
      render: (_: any, row: { item: RecommendedItem }) => {
        const waste = getWasteGuide(row.item.item_code);
        return (
          <div>
            <span>{row.item.description}</span>
            {waste && (
              <Tooltip title={waste.tip}>
                <Tag
                  color="warning"
                  icon={<WarningOutlined />}
                  style={{ marginLeft: 6, cursor: 'help' }}
                >
                  Waste {waste.pct}
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Qty',
      width: 80,
      render: (_: any, row: { item: RecommendedItem; flatIndex: number }) => (
        <InputNumber
          size="small"
          min={0}
          value={row.item.qty}
          onChange={(v) => handleQtyChange(row.flatIndex, v || 0)}
        />
      ),
    },
    {
      title: 'Unit',
      width: 60,
      render: (_: any, row: { item: RecommendedItem }) => row.item.unit,
    },
    {
      title: 'Source',
      width: 200,
      ellipsis: true,
      render: (_: any, row: { item: RecommendedItem }) => (
        <Text type="secondary">{row.item.reason}</Text>
      ),
    },
    {
      title: '',
      width: 80,
      render: (_: any, row: { item: RecommendedItem; flatIndex: number }) => (
        <Space size="small">
          <Tooltip title="Descriptions">
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => setDescDrawer({ open: true, itemCode: row.item.item_code })}
            />
          </Tooltip>
          <Popconfirm title="Remove?" onConfirm={() => handleRemove(row.flatIndex)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const SECTION_COLORS: Record<string, string> = {
    DML: '#ff4d4f', PNT: '#1677ff', DRY: '#faad14', FLR: '#52c41a',
    PLB: '#13c2c2', ELC: '#722ed1', CLN: '#eb2f96', WTR: '#2f54eb',
    FRM: '#fa8c16', INS: '#a0d911', HVC: '#597ef7', MBL: '#f5222d',
  };

  return (
    <>
      <Card
        title={
          <Space>
            <span>Recommended Line Items</span>
            {result.feedback_applied && (
              <Tag color="blue" icon={<InfoCircleOutlined />}>
                Prior corrections applied
              </Tag>
            )}
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Text type="secondary">
              {groupedSections.length} sections
            </Text>
            <Divider type="vertical" />
            <Text type="secondary">
              {items.length} items
            </Text>
          </Space>
        }
      >
        {result.feedback_message && (
          <Alert
            message={result.feedback_message}
            type="info"
            showIcon
            closable
            style={{ marginBottom: 12 }}
          />
        )}

        {result.keywords.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">Keywords: </Text>
            {result.keywords.map((kw, i) => (
              <Tag key={i}>{kw}</Tag>
            ))}
          </div>
        )}

        {groupedSections.map((section) => (
          <div key={section.category} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: '#fafafa',
                borderLeft: `3px solid ${SECTION_COLORS[section.category] || '#d9d9d9'}`,
                borderRadius: '0 4px 4px 0',
                marginBottom: 4,
              }}
            >
              <Tag
                color={SECTION_COLORS[section.category] ? undefined : 'default'}
                style={
                  SECTION_COLORS[section.category]
                    ? { backgroundColor: SECTION_COLORS[section.category], color: '#fff', border: 'none' }
                    : undefined
                }
              >
                {section.category}
              </Tag>
              <Text strong>{section.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                ({section.items.length})
              </Text>
            </div>
            <Table
              dataSource={section.items}
              columns={makeSectionColumns()}
              size="small"
              pagination={false}
              showHeader={section === groupedSections[0]}
              rowKey={(row) => String(row.flatIndex)}
            />
          </div>
        ))}

        {items.length === 0 && (
          <Empty description="No line items yet" style={{ padding: '24px 0' }} />
        )}

        <div style={{ marginTop: 12 }}>
          <Space>
            <Button icon={<PlusOutlined />} onClick={handleAddItem}>
              Add Item
            </Button>
            <Button
              type="default"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSaveCorrection}
            >
              Save Corrections
            </Button>
            <Popconfirm title="Confirm this estimate?" onConfirm={handleConfirm}>
              <Button type="primary" icon={<CheckCircleOutlined />}>
                Confirm Estimate
              </Button>
            </Popconfirm>
          </Space>
        </div>
      </Card>

      <DescriptionDrawer
        open={descDrawer.open}
        itemCode={descDrawer.itemCode}
        damageType={room.damage_type || 'general'}
        roomType={room.room_type || 'any'}
        onClose={() => setDescDrawer({ open: false, itemCode: '' })}
      />
    </>
  );
};

// ─── Description Drawer ──────────────────────────────────────────────────────

interface DescriptionDrawerProps {
  open: boolean;
  itemCode: string;
  damageType: string;
  roomType: string;
  onClose: () => void;
}

const DescriptionDrawer: React.FC<DescriptionDrawerProps> = ({
  open,
  itemCode,
  damageType,
  roomType,
  onClose,
}) => {
  const [descriptions, setDescriptions] = useState<XactItemDescription[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadDescriptions = useCallback(async () => {
    if (!itemCode) return;
    setLoading(true);
    try {
      const data = await helperService.getItemDescriptions(itemCode);
      setDescriptions(data);
    } catch {
      // No descriptions found is OK
      setDescriptions([]);
    } finally {
      setLoading(false);
    }
  }, [itemCode]);

  useEffect(() => {
    if (open && itemCode) {
      loadDescriptions();
    }
  }, [open, itemCode, loadDescriptions]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await helperService.generateDescriptions(itemCode, damageType, roomType);
      message.success('Descriptions generated');
      loadDescriptions();
    } catch {
      message.error('Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (desc: XactItemDescription) => {
    try {
      await navigator.clipboard.writeText(desc.body);
      await helperService.recordDescriptionCopy(desc.id);
      message.success('Copied to clipboard');
    } catch {
      message.error('Copy failed');
    }
  };

  const handleApprove = async (desc: XactItemDescription) => {
    try {
      await helperService.approveDescription(desc.id);
      message.success('Approved');
      loadDescriptions();
    } catch {
      message.error('Approval failed');
    }
  };

  return (
    <Drawer
      title={`Descriptions — ${itemCode}`}
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={generating}
          onClick={handleGenerate}
        >
          Generate AI
        </Button>
      }
    >
      {loading ? (
        <Spin />
      ) : descriptions.length === 0 ? (
        <Empty description="No descriptions yet. Click 'Generate AI' to create some." />
      ) : (
        <List
          dataSource={descriptions}
          renderItem={(desc) => (
            <List.Item
              actions={[
                <Tooltip title="Copy" key="copy">
                  <Button icon={<CopyOutlined />} onClick={() => handleCopy(desc)} />
                </Tooltip>,
                !desc.approved && (
                  <Tooltip title="Approve" key="approve">
                    <Button
                      type="link"
                      icon={<CheckCircleOutlined />}
                      onClick={() => handleApprove(desc)}
                    />
                  </Tooltip>
                ),
              ].filter(Boolean)}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={descTypeColor(desc.description_type)}>{desc.description_type}</Tag>
                    <Text strong>{desc.title}</Text>
                    {desc.is_ai_generated && <Tag color="purple">AI</Tag>}
                    {desc.approved && <Tag color="green">Approved</Tag>}
                  </Space>
                }
                description={desc.body}
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function descTypeColor(type: string): string {
  const colors: Record<string, string> = {
    waste: 'orange',
    building_code: 'blue',
    secondary_damage: 'red',
    scope_of_work: 'green',
    industry_standard: 'purple',
  };
  return colors[type] || 'default';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (data:image/jpeg;base64,)
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Main Page Component ─────────────────────────────────────────────────────

const XactimateHelper: React.FC = () => {
  const [activeRoom, setActiveRoom] = useState<XactRoom | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(null);
  const [scopeItems, setScopeItems] = useState<ResolvedScopeItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>('scope');
  const [generatingItems, setGeneratingItems] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0 });

  // Convert ScopeBuilder items to AnalyzeResponse format for RecommendationEditor
  const handleApplyScopeItems = useCallback(async () => {
    if (scopeItems.length === 0) {
      message.warning('Select at least one scope item');
      return;
    }
    if (generatingItems) return; // prevent double-click

    setGeneratingItems(true);

    const items: RecommendedItem[] = scopeItems.map((si) => ({
      item_code: si.itemCode,
      description: '',
      qty: si.qty,
      unit: si.unit,
      unit_price: 0,
      reason: si.source,
    }));

    try {
      const enriched = await enrichScopeItems(items);

      const result: AnalyzeResponse = {
        room_id: activeRoom?.id || '',
        keywords: [],
        recommendations: [{
          assembly_name: 'Scope Selection',
          items: enriched,
          source: 'assembly_rule',
        }],
        feedback_applied: false,
      };

      setAnalysisResult(result);
      message.success(`${enriched.length} line items generated from scope`);
    } catch {
      message.error('Failed to generate line items');
    } finally {
      setGeneratingItems(false);
      setGenerateProgress({ current: 0, total: 0 });
    }
  }, [scopeItems, activeRoom, generatingItems]);

  /**
   * Strip Xactimate variant suffixes (+, ++, >) to get the base item code.
   * e.g. "TILTUB+" → "TILTUB", "PLMFAUBA++" → "PLMFAUBA"
   */
  const getBaseItemCode = (code: string): string | null => {
    const match = code.match(/^(.+?)(\+{1,2}|>)$/);
    return match ? match[1] : null;
  };

  /** Variant suffix label for description */
  const getVariantLabel = (code: string): string => {
    if (code.endsWith('++')) return ' — Premium';
    if (code.endsWith('+')) return ' — High Grade';
    if (code.endsWith('>')) return ' — Large/Upgrade';
    return '';
  };

  // Fetch item details from DB with progress tracking
  const enrichScopeItems = async (items: RecommendedItem[]): Promise<RecommendedItem[]> => {
    const enriched: RecommendedItem[] = [];
    const seen = new Set<string>();

    // Deduplicate first
    const unique: RecommendedItem[] = [];
    for (const item of items) {
      if (seen.has(item.item_code)) {
        const existing = unique.find((e) => e.item_code === item.item_code);
        if (existing) existing.qty += item.qty;
        continue;
      }
      seen.add(item.item_code);
      unique.push({ ...item });
    }

    setGenerateProgress({ current: 0, total: unique.length });

    for (let i = 0; i < unique.length; i++) {
      const item = unique[i];
      setGenerateProgress({ current: i + 1, total: unique.length });

      // 1) _CUSTOM codes — no DB entry, use scope source as description
      if (item.item_code.endsWith('_CUSTOM')) {
        const catPrefix = item.item_code.replace(/_CUSTOM$/, '');
        enriched.push({
          ...item,
          category: catPrefix.substring(0, 3),
          description: item.reason || item.item_code,
        });
        continue;
      }

      // 2) Try exact match first
      try {
        const dbItem = await helperService.getHelperLineItem(item.item_code);
        enriched.push({
          ...item,
          category: dbItem.category || '',
          description: dbItem.description || '',
          unit_price: dbItem.unit_price || 0,
          unit: dbItem.unit || item.unit,
        });
        continue;
      } catch {
        // exact match failed — try base code fallback
      }

      // 3) Variant suffix fallback: strip +/++/> and look up base code
      const baseCode = getBaseItemCode(item.item_code);
      if (baseCode) {
        try {
          const dbItem = await helperService.getHelperLineItem(baseCode);
          const variantLabel = getVariantLabel(item.item_code);
          enriched.push({
            ...item,
            category: dbItem.category || '',
            description: (dbItem.description || '') + variantLabel,
            unit_price: dbItem.unit_price || 0,
            unit: dbItem.unit || item.unit,
          });
          continue;
        } catch {
          // base code also not found
        }
      }

      // 4) Nothing found — use scope source label as fallback
      enriched.push({ ...item, description: item.reason || '' });
    }

    return enriched;
  };

  const roomDimensions = activeRoom?.dimensions || {};

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={3}>
        <ThunderboltOutlined /> Xactimate Helper Tool
      </Title>
      <Paragraph type="secondary">
        AI-powered line item recommendation for insurance claim estimates
      </Paragraph>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Step 1: Room Creation */}
        <RoomForm
          onCreated={(room) => {
            setActiveRoom(room);
            setAnalysisResult(null);
            setScopeItems([]);
          }}
        />

        {/* Step 2: Input Method — Tabs */}
        {activeRoom && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="card"
            items={[
              {
                key: 'scope',
                label: (
                  <Space>
                    <AppstoreOutlined />
                    <span>Scope Builder</span>
                    {scopeItems.length > 0 && (
                      <Badge count={scopeItems.length} style={{ backgroundColor: '#52c41a' }} />
                    )}
                  </Space>
                ),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <ScopeBuilder
                      dimensions={roomDimensions}
                      roomType={activeRoom?.room_type}
                      onScopeChange={setScopeItems}
                    />
                    {scopeItems.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Button
                          type="primary"
                          size="large"
                          icon={<SendOutlined />}
                          loading={generatingItems}
                          disabled={generatingItems}
                          onClick={handleApplyScopeItems}
                        >
                          {generatingItems
                            ? `Loading... (${generateProgress.current}/${generateProgress.total})`
                            : `Generate Line Items (${scopeItems.length})`
                          }
                        </Button>
                      </div>
                    )}
                  </Space>
                ),
              },
              {
                key: 'photo',
                label: (
                  <Space>
                    <CameraOutlined />
                    <span>Photo AI Analysis</span>
                  </Space>
                ),
                children: (
                  <AnalysisPanel room={activeRoom} onResult={setAnalysisResult} />
                ),
              },
            ]}
          />
        )}

        {/* Step 3: Recommendation Editor */}
        {activeRoom && analysisResult && (
          <RecommendationEditor
            room={activeRoom}
            result={analysisResult}
            onSaved={() => {
              message.info('Room updated');
            }}
          />
        )}
      </Space>
    </div>
  );
};

export default XactimateHelper;
