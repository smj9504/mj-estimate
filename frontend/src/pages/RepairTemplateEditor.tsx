import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, Col, Collapse, Descriptions, Form, Grid, Input, InputNumber,
  message, Modal, Popover, Row, Select, Space, Spin, Tag, Typography,
} from 'antd';
import {
  ArrowLeftOutlined, BulbOutlined, CloseOutlined,
  DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/config';
import { repairSpecService } from '../services/repairSpecService';
import {
  ConditionSuggestionCreate,
  RepairCondition,
  RepairTemplateCreate,
  RepairTemplateItemCreate,
} from '../types/repairSpec';
import ConditionManager from '../components/repair-spec/ConditionManager';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const SURFACE_OPTIONS = [
  { value: 'wall', label: 'Wall' },
  { value: 'floor', label: 'Floor' },
  { value: 'ceiling', label: 'Ceiling' },
  { value: 'general', label: 'General' },
];

const SCOPE_COLOR: Record<string, string> = { damaged: 'red', affected: 'blue' };

// ── Xactimate inline editor popover ──

interface XactEditPopoverProps {
  itemCode: string;
  children: React.ReactNode;
}

const XactEditPopover: React.FC<XactEditPopoverProps> = ({ itemCode, children }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [xactItem, setXactItem] = useState<Record<string, any> | null>(null);
  const [editForm] = Form.useForm();

  const loadItem = useCallback(async () => {
    if (!itemCode) return;
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/xactimate/items/by-code/${itemCode}`);
      setXactItem(res.data);
      editForm.setFieldsValue({
        description: res.data.description,
        untaxed_unit_price: res.data.untaxed_unit_price,
        labor_cost: res.data.labor_cost,
        material_cost: res.data.material_cost,
      });
    } catch {
      setXactItem(null);
    } finally {
      setLoading(false);
    }
  }, [itemCode, editForm]);

  const handleSave = async () => {
    if (!xactItem) return;
    const values = await editForm.validateFields();
    try {
      await apiClient.put(`/api/xactimate/items/${xactItem.id}`, values);
      message.success('Xactimate item updated');
      setOpen(false);
    } catch {
      message.error('Failed to update');
    }
  };

  const handleOpenChange = (visible: boolean) => {
    setOpen(visible);
    if (visible && itemCode) loadItem();
  };

  const content = loading ? (
    <Spin size="small" />
  ) : xactItem ? (
    <div style={{ width: 320 }}>
      <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
        Edit Xactimate: {xactItem.item_code}
      </Text>
      <Form form={editForm} size="small" layout="vertical">
        <Form.Item name="description" label="Description" style={{ marginBottom: 8 }}>
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} />
        </Form.Item>
        <Row gutter={8}>
          <Col span={12}>
            <Form.Item name="untaxed_unit_price" label="Unit Price" style={{ marginBottom: 8 }}>
              <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="labor_cost" label="Labor" style={{ marginBottom: 8 }}>
              <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="material_cost" label="Material" style={{ marginBottom: 8 }}>
          <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} />
        </Form.Item>
        <Button type="primary" size="small" block onClick={handleSave}>
          Save to Xactimate DB
        </Button>
      </Form>
    </div>
  ) : (
    <Text type="secondary">Item not found in Xactimate DB</Text>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottomLeft"
    >
      {children}
    </Popover>
  );
};

// ── Xactimate search/create modal ──

interface XactSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string, description: string, unit?: string) => void;
}

const XactSearchModal: React.FC<XactSearchModalProps> = ({ open, onClose, onSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [createForm] = Form.useForm();

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/xactimate/items/search', {
        params: { search_term: searchTerm, page_size: 20 },
      });
      setResults(res.data.items || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    try {
      const res = await apiClient.post('/api/xactimate/items', {
        ...values,
        price_year: new Date().getFullYear(),
        price_month: new Date().getMonth() + 1,
      });
      message.success('Xactimate item created');
      onSelect(res.data.item_code, res.data.description);
      onClose();
      setCreateMode(false);
      createForm.resetFields();
    } catch {
      message.error('Failed to create item');
    }
  };

  return (
    <Modal
      title="Search Xactimate Items"
      open={open}
      onCancel={() => { onClose(); setCreateMode(false); }}
      footer={null}
      width={640}
    >
      {!createMode ? (
        <>
          <Space style={{ marginBottom: 12, width: '100%' }}>
            <Input.Search
              placeholder="Search by description or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onSearch={handleSearch}
              loading={loading}
              enterButton
              style={{ flex: 1 }}
            />
            <Button icon={<PlusOutlined />} onClick={() => setCreateMode(true)}>
              New Item
            </Button>
          </Space>

          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {results.map((item) => (
              <div
                key={item.id}
                onClick={() => { onSelect(item.item_code, item.description); onClose(); }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f5f5'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              >
                <div>
                  <Tag style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.item_code}</Tag>
                  <Text style={{ fontSize: 13 }}>{item.description}</Text>
                </div>
                {item.untaxed_unit_price != null && (
                  <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                    ${Number(item.untaxed_unit_price).toFixed(2)}
                  </Text>
                )}
              </div>
            ))}
            {results.length === 0 && !loading && searchTerm && (
              <Text type="secondary" style={{ display: 'block', padding: 16, textAlign: 'center' }}>
                No results. Try a different search or create a new item.
              </Text>
            )}
          </div>
        </>
      ) : (
        <div>
          <Button type="link" onClick={() => setCreateMode(false)} style={{ padding: 0, marginBottom: 12 }}>
            ← Back to search
          </Button>
          <Form form={createForm} layout="vertical" size="small">
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="item_code" label="Item Code" rules={[{ required: true }]}>
                  <Input placeholder="e.g., CUS001" style={{ fontFamily: 'monospace' }} />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="category_code" label="Category" rules={[{ required: true }]}>
                  <Input placeholder="e.g., DRY" maxLength={3} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="Description" rules={[{ required: true }]}>
              <Input.TextArea rows={2} placeholder="Line item description" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="untaxed_unit_price" label="Unit Price">
                  <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="labor_cost" label="Labor">
                  <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} min={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="material_cost" label="Material">
                  <InputNumber prefix="$" style={{ width: '100%' }} step={0.01} min={0} />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" block onClick={handleCreate}>
              Create & Select
            </Button>
          </Form>
        </div>
      )}
    </Modal>
  );
};

// ── Main Editor ──

const RepairTemplateEditor: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const [selectedConditions, setSelectedConditions] = useState<RepairCondition[]>([]);
  const [items, setItems] = useState<RepairTemplateItemCreate[]>([]);
  const [suggestions, setSuggestions] = useState<ConditionSuggestionCreate[]>([]);
  const [conditionPickerOpen, setConditionPickerOpen] = useState(false);
  const [suggestionModalOpen, setSuggestionModalOpen] = useState(false);
  const [xactSearchOpen, setXactSearchOpen] = useState(false);
  const [xactSearchConditionId, setXactSearchConditionId] = useState<string>('');

  const { data: template, isLoading } = useQuery({
    queryKey: ['repair-template', id],
    queryFn: () => repairSpecService.getTemplate(id!),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (template) {
      form.setFieldsValue({
        name: template.name,
        surface: template.surface,
        description: template.description,
        tags: template.tags || [],
      });
      setSelectedConditions(template.conditions || []);
      setItems(
        (template.items || []).map((it) => ({
          condition_id: it.condition_id,
          xactimate_item_code: it.xactimate_item_code,
          description_override: it.description_override || undefined,
          default_unit: it.default_unit || undefined,
          is_required: it.is_required,
          sort_order: it.sort_order,
        }))
      );
      setSuggestions(
        (template.suggestions || []).map((s) => ({
          from_condition_id: s.from_condition_id,
          to_condition_id: s.to_condition_id,
        }))
      );
    }
  }, [template, form]);

  const createMutation = useMutation({
    mutationFn: (data: RepairTemplateCreate) => repairSpecService.createTemplate(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
      message.success('Template created');
      navigate(`/repair-templates/${result.id}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: RepairTemplateCreate) => repairSpecService.updateTemplate(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-templates'] });
      queryClient.invalidateQueries({ queryKey: ['repair-template', id] });
      message.success('Template saved');
    },
  });

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: RepairTemplateCreate = {
      ...values,
      conditions: selectedConditions.map((c, i) => ({ condition_id: c.id, sort_order: i })),
      items,
      suggestions,
    };
    if (isNew) createMutation.mutate(payload);
    else updateMutation.mutate(payload);
  };

  const addCondition = (condition: RepairCondition) => {
    if (!selectedConditions.find((c) => c.id === condition.id)) {
      setSelectedConditions([...selectedConditions, condition]);
    }
    setConditionPickerOpen(false);
  };

  const removeCondition = (conditionId: string) => {
    setSelectedConditions(selectedConditions.filter((c) => c.id !== conditionId));
    setItems(items.filter((it) => it.condition_id !== conditionId));
    setSuggestions(
      suggestions.filter(
        (s) => s.from_condition_id !== conditionId && s.to_condition_id !== conditionId
      )
    );
  };

  // Item helpers
  const getItemsForCondition = (conditionId: string) =>
    items.filter((it) => it.condition_id === conditionId);

  const addItem = (conditionId: string, code = '', desc = '') => {
    setItems([
      ...items,
      {
        condition_id: conditionId,
        xactimate_item_code: code,
        description_override: desc,
        default_unit: '',
        sort_order: items.length,
      },
    ]);
  };

  const updateItem = (globalIdx: number, field: string, value: unknown) => {
    const updated = [...items];
    updated[globalIdx] = { ...updated[globalIdx], [field]: value };
    setItems(updated);
  };

  const removeItem = (globalIdx: number) => {
    setItems(items.filter((_, i) => i !== globalIdx));
  };

  const getGlobalIndex = (conditionId: string, localIndex: number): number => {
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].condition_id === conditionId) {
        if (count === localIndex) return i;
        count++;
      }
    }
    return -1;
  };

  const getSuggestsFor = (conditionId: string) =>
    suggestions
      .filter((s) => s.from_condition_id === conditionId)
      .map((s) => selectedConditions.find((c) => c.id === s.to_condition_id)?.name)
      .filter(Boolean);

  const openXactSearch = (conditionId: string) => {
    setXactSearchConditionId(conditionId);
    setXactSearchOpen(true);
  };

  const handleXactSelect = (code: string, desc: string) => {
    addItem(xactSearchConditionId, code, desc);
  };

  if (!isNew && isLoading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      {/* Header */}
      <Space style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/repair-templates')} size={isMobile ? 'small' : 'middle'}>
          {isMobile ? '' : 'Back'}
        </Button>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
          {isNew ? 'New Template' : template?.name || 'Edit Template'}
        </Title>
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={handleSave}>
          {isNew ? 'Create' : 'Save'}
        </Button>
      </Space>

      {/* Template Info */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Form.Item name="name" rules={[{ required: true }]} style={{ flex: '1 1 200px', marginBottom: 8 }}>
            <Input placeholder="Template Name" />
          </Form.Item>
          <Form.Item name="surface" style={{ marginBottom: 8 }}>
            <Select placeholder="Surface" allowClear style={{ width: 120 }} options={SURFACE_OPTIONS} />
          </Form.Item>
          <Form.Item name="tags" style={{ flex: '1 1 180px', marginBottom: 8 }}>
            <Select mode="tags" placeholder="Tags" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" style={{ flex: '1 1 100%', marginBottom: 0 }}>
            <Input.TextArea rows={1} placeholder="Description (optional)" autoSize={{ minRows: 1, maxRows: 2 }} />
          </Form.Item>
        </Form>
      </Card>

      {/* Conditions & Line Items */}
      <Card
        size={isMobile ? 'small' : 'default'}
        title={
          <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 15 }}>Conditions & Line Items</Text>
            <Space>
              {selectedConditions.length >= 2 && (
                <Button size="small" icon={<BulbOutlined />} onClick={() => setSuggestionModalOpen(true)}>
                  Suggestions
                </Button>
              )}
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setConditionPickerOpen(true)}>
                Add Condition
              </Button>
            </Space>
          </Space>
        }
      >
        {selectedConditions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: '#999' }}>
            <Text type="secondary">
              No conditions added yet. Click "Add Condition" to start building your template.
            </Text>
          </div>
        ) : (
          <Collapse
            defaultActiveKey={selectedConditions.map((c) => c.id)}
            style={{ background: 'transparent', border: 'none' }}
            items={selectedConditions.map((cond) => {
              const condItems = getItemsForCondition(cond.id);
              const condSuggests = getSuggestsFor(cond.id);

              return {
                key: cond.id,
                style: { marginBottom: 8, borderRadius: 8, overflow: 'hidden' },
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text strong>{cond.name}</Text>
                    <Tag color={SCOPE_COLOR[cond.scope] || 'default'} style={{ marginRight: 0 }}>
                      {cond.scope}
                    </Tag>
                    {cond.category && <Tag color="default" style={{ fontSize: 11 }}>{cond.category}</Tag>}
                    <Tag style={{ fontSize: 11, fontWeight: 600 }}>
                      {condItems.length} item{condItems.length !== 1 ? 's' : ''}
                    </Tag>
                    {condSuggests.length > 0 && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        <BulbOutlined /> → {condSuggests.join(', ')}
                      </Text>
                    )}
                  </div>
                ),
                extra: (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={(e) => { e.stopPropagation(); removeCondition(cond.id); }}
                  />
                ),
                children: (
                  <div>
                    {condItems.map((item, localIdx) => {
                      const globalIdx = getGlobalIndex(cond.id, localIdx);
                      return (
                        <Row
                          key={`${cond.id}-${localIdx}`}
                          gutter={[8, 8]}
                          align="middle"
                          style={{
                            padding: '6px 0',
                            borderBottom: localIdx < condItems.length - 1 ? '1px solid #f5f5f5' : undefined,
                          }}
                        >
                          <Col xs={24} sm={4} md={3}>
                            <Space size={2}>
                              <Input
                                size="small"
                                value={item.xactimate_item_code}
                                onChange={(e) => updateItem(globalIdx, 'xactimate_item_code', e.target.value)}
                                placeholder="Code"
                                style={{ fontFamily: 'monospace', fontWeight: 600 }}
                              />
                              {item.xactimate_item_code && (
                                <XactEditPopover itemCode={item.xactimate_item_code}>
                                  <Button type="text" size="small" icon={<EditOutlined />} style={{ flexShrink: 0 }} />
                                </XactEditPopover>
                              )}
                            </Space>
                          </Col>
                          <Col xs={24} sm={14} md={16}>
                            <Input
                              size="small"
                              value={item.description_override || ''}
                              onChange={(e) => updateItem(globalIdx, 'description_override', e.target.value)}
                              placeholder="Line item description"
                            />
                          </Col>
                          <Col xs={12} sm={4} md={3}>
                            <Input
                              size="small"
                              value={item.default_unit || ''}
                              onChange={(e) => updateItem(globalIdx, 'default_unit', e.target.value)}
                              placeholder="Unit"
                              style={{ textAlign: 'center' }}
                            />
                          </Col>
                          <Col xs={12} sm={2} md={2} style={{ textAlign: 'right' }}>
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => removeItem(globalIdx)}
                            />
                          </Col>
                        </Row>
                      );
                    })}
                    <Space style={{ marginTop: 8, width: '100%' }}>
                      <Button
                        type="dashed"
                        size="small"
                        icon={<SearchOutlined />}
                        onClick={() => openXactSearch(cond.id)}
                      >
                        Search Xactimate
                      </Button>
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => addItem(cond.id)}
                      >
                        Manual Entry
                      </Button>
                    </Space>
                  </div>
                ),
              };
            })}
          />
        )}
      </Card>

      {/* Condition Picker Modal */}
      <Modal
        title="Select Condition"
        open={conditionPickerOpen}
        onCancel={() => setConditionPickerOpen(false)}
        footer={null}
        width={isMobile ? '95%' : 600}
      >
        <ConditionManager selectable onSelect={addCondition} />
      </Modal>

      {/* Xactimate Search Modal */}
      <XactSearchModal
        open={xactSearchOpen}
        onClose={() => setXactSearchOpen(false)}
        onSelect={handleXactSelect}
      />

      {/* Suggestion Editor Modal */}
      <Modal
        title="Manage Suggestions"
        open={suggestionModalOpen}
        onOk={() => setSuggestionModalOpen(false)}
        onCancel={() => setSuggestionModalOpen(false)}
        width={isMobile ? '95%' : 500}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          When a "From" condition is checked, the "To" condition will be recommended.
        </Text>
        {suggestions.map((s, i) => (
          <Space key={i} style={{ marginBottom: 8, display: 'flex' }}>
            <Select
              value={s.from_condition_id}
              onChange={(v) => {
                const updated = [...suggestions];
                updated[i] = { ...updated[i], from_condition_id: v };
                setSuggestions(updated);
              }}
              style={{ width: 180 }}
              size="small"
              options={selectedConditions.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Text style={{ flexShrink: 0 }}>→</Text>
            <Select
              value={s.to_condition_id}
              onChange={(v) => {
                const updated = [...suggestions];
                updated[i] = { ...updated[i], to_condition_id: v };
                setSuggestions(updated);
              }}
              style={{ width: 180 }}
              size="small"
              options={selectedConditions.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Button type="text" danger size="small" onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))}>
              ×
            </Button>
          </Space>
        ))}
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() =>
            setSuggestions([
              ...suggestions,
              { from_condition_id: selectedConditions[0]?.id || '', to_condition_id: selectedConditions[1]?.id || '' },
            ])
          }
          disabled={selectedConditions.length < 2}
        >
          Add Suggestion
        </Button>
      </Modal>
    </div>
  );
};

export default RepairTemplateEditor;
