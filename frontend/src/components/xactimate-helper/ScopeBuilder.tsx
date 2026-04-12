/**
 * ScopeBuilder — Hierarchical multi-select for scope of work
 *
 * Major category → sub-category cascading selects → auto-include items
 * Replaces manual keyword entry with structured scope selection.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  BorderOuterOutlined,
  BuildOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  FormatPainterOutlined,
  GatewayOutlined,
  InboxOutlined,
  PlusOutlined,
  ScissorOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';

import {
  type AutoIncludeItem,
  SCOPE_CATEGORIES,
  type ScopeCategory,
  resolveItemCodes,
} from '../../config/scopeConfig';
import type { RoomDimensions } from '../../types/xactimateHelper';

const { Text, Title } = Typography;

// Icon mapping
const ICON_MAP: Record<string, React.ReactNode> = {
  AppstoreOutlined: <AppstoreOutlined />,
  AppstoreAddOutlined: <AppstoreAddOutlined />,
  BorderOuterOutlined: <BorderOuterOutlined />,
  BuildOutlined: <BuildOutlined />,
  ClearOutlined: <ClearOutlined />,
  ColumnHeightOutlined: <ColumnHeightOutlined />,
  ExperimentOutlined: <ExperimentOutlined />,
  FormatPainterOutlined: <FormatPainterOutlined />,
  GatewayOutlined: <GatewayOutlined />,
  InboxOutlined: <InboxOutlined />,
  ScissorOutlined: <ScissorOutlined />,
  ThunderboltOutlined: <ThunderboltOutlined />,
  ToolOutlined: <ToolOutlined />,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScopeSelection {
  categoryKey: string;
  categoryLabel: string;
  selections: Record<string, string | string[]>;
}

export interface ResolvedScopeItem {
  itemCode: string;
  qty: number;
  unit: string;
  source: string;
  categoryLabel: string;
}

interface ScopeBuilderProps {
  dimensions: RoomDimensions;
  roomType?: string;
  onScopeChange: (items: ResolvedScopeItem[]) => void;
}

// ─── Category Selector (single category panel) ──────────────────────────────

interface CategoryPanelProps {
  category: ScopeCategory;
  selections: Record<string, string | string[]>;
  onChange: (subKey: string, value: string | string[]) => void;
}

const CategoryPanel: React.FC<CategoryPanelProps> = ({ category, selections, onChange }) => {
  return (
    <div style={{ padding: '8px 0' }}>
      {category.subCategories.map((sub) => {
        // Check dependency
        if (sub.dependsOn) {
          const parentVal = selections[sub.dependsOn];
          if (!parentVal) return null;
          if (sub.dependsOnValues) {
            const parentVals = Array.isArray(parentVal) ? parentVal : [parentVal];
            if (!parentVals.some((v) => sub.dependsOnValues!.includes(v))) return null;
          }
        }

        // Find the currently selected option (for finish rendering)
        const selectedVal = selections[sub.key] as string | undefined;
        const selectedOption = !sub.multiple && selectedVal
          ? sub.options.find((o) => o.value === selectedVal)
          : null;

        return (
          <div key={sub.key} style={{ marginBottom: 12 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              {sub.label}
            </Text>
            {sub.multiple ? (
              <Checkbox.Group
                value={(selections[sub.key] as string[]) || []}
                onChange={(vals) => onChange(sub.key, vals as string[])}
                style={{ width: '100%' }}
              >
                <Row gutter={[8, 4]}>
                  {sub.options.map((opt) => (
                    <Col span={12} key={opt.value}>
                      <Checkbox value={opt.value}>{opt.label}</Checkbox>
                    </Col>
                  ))}
                </Row>
              </Checkbox.Group>
            ) : (
              <Select
                value={selections[sub.key] as string | undefined}
                onChange={(val) => onChange(sub.key, val)}
                placeholder={`Select ${sub.label}`}
                allowClear
                style={{ width: '100%' }}
                options={sub.options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
              />
            )}

            {/* Inline Finish selector — appears when selected option has finishOptions */}
            {selectedOption?.finishOptions && selectedOption.finishOptions.length > 0 && (
              <div style={{ marginTop: 6, paddingLeft: 16, borderLeft: '3px solid #1890ff' }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  Finish for {selectedOption.label}:
                </Text>
                <Select
                  value={selections[`${sub.key}__finish__${selectedVal}`] as string | undefined}
                  onChange={(val) => onChange(`${sub.key}__finish__${selectedVal}`, val)}
                  placeholder="Select finish"
                  allowClear
                  style={{ width: '100%' }}
                  options={selectedOption.finishOptions.map((f) => ({
                    value: f.value,
                    label: f.label,
                  }))}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Auto-include indicator */}
      {category.autoIncludes && category.autoIncludes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Auto-included:</Text>
          <div style={{ marginTop: 4 }}>
            {category.autoIncludes.map((ai, idx) => (
              <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                {ai.label}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main ScopeBuilder ──────────────────────────────────────────────────────

const ScopeBuilder: React.FC<ScopeBuilderProps> = ({ dimensions, roomType, onScopeChange }) => {
  // Track which categories are added + their selections
  const [addedCategories, setAddedCategories] = useState<string[]>([]);
  const [allSelections, setAllSelections] = useState<Record<string, Record<string, string | string[]>>>({});

  // Filter categories by room type: show if no applicableRooms (general) or room matches
  const filteredCategories = useMemo(
    () => SCOPE_CATEGORIES.filter((c) =>
      !c.applicableRooms || !roomType || c.applicableRooms.includes(roomType)
    ),
    [roomType]
  );

  // Categories not yet added (from filtered set)
  const availableCategories = useMemo(
    () => filteredCategories.filter((c) => !addedCategories.includes(c.key)),
    [filteredCategories, addedCategories]
  );

  // Add a category
  const handleAddCategory = (categoryKey: string) => {
    setAddedCategories((prev) => [...prev, categoryKey]);
    setAllSelections((prev) => ({ ...prev, [categoryKey]: {} }));
  };

  // Remove a category
  const handleRemoveCategory = (categoryKey: string) => {
    setAddedCategories((prev) => prev.filter((k) => k !== categoryKey));
    setAllSelections((prev) => {
      const next = { ...prev };
      delete next[categoryKey];
      return next;
    });
  };

  // Update selections for a category
  const handleSelectionChange = useCallback((categoryKey: string, subKey: string, value: string | string[]) => {
    setAllSelections((prev) => ({
      ...prev,
      [categoryKey]: {
        ...(prev[categoryKey] || {}),
        [subKey]: value,
      },
    }));
  }, []);

  // Resolve all selections to item codes whenever anything changes
  useEffect(() => {
    const allItems: ResolvedScopeItem[] = [];

    for (const catKey of addedCategories) {
      const category = SCOPE_CATEGORIES.find((c) => c.key === catKey);
      if (!category) continue;

      const selections = allSelections[catKey] || {};
      const resolved = resolveItemCodes(catKey, selections, dimensions);

      for (const r of resolved) {
        allItems.push({
          itemCode: r.itemCode,
          qty: r.qty,
          unit: r.unit,
          source: r.source,
          categoryLabel: category.label,
        });
      }
    }

    onScopeChange(allItems);
  }, [addedCategories, allSelections, dimensions, onScopeChange]);

  // Build collapse panels
  const collapseItems = addedCategories.map((catKey) => {
    const category = SCOPE_CATEGORIES.find((c) => c.key === catKey)!;
    const selections = allSelections[catKey] || {};
    const selectedCount = Object.values(selections).filter((v) =>
      Array.isArray(v) ? v.length > 0 : !!v
    ).length;

    return {
      key: catKey,
      label: (
        <Space>
          {ICON_MAP[category.icon] || <AppstoreOutlined />}
          <span>{category.label}</span>
          {selectedCount > 0 && <Badge count={selectedCount} style={{ backgroundColor: '#52c41a' }} />}
        </Space>
      ),
      extra: (
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveCategory(catKey);
          }}
        />
      ),
      children: (
        <CategoryPanel
          category={category}
          selections={selections}
          onChange={(subKey, value) => handleSelectionChange(catKey, subKey, value)}
        />
      ),
    };
  });

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          <span>Scope of Work Builder</span>
        </Space>
      }
      size="small"
    >
      {/* Add Category Button */}
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          {availableCategories.map((cat) => (
            <Button
              key={cat.key}
              icon={ICON_MAP[cat.icon] || <PlusOutlined />}
              onClick={() => handleAddCategory(cat.key)}
            >
              {cat.label}
            </Button>
          ))}
        </Space>
        {availableCategories.length === 0 && addedCategories.length > 0 && (
          <Text type="secondary" style={{ marginLeft: 8 }}>All categories added</Text>
        )}
        {addedCategories.length === 0 && (
          <Alert
            message="Select work categories to build your scope"
            type="info"
            showIcon
            style={{ marginTop: 8 }}
          />
        )}
      </div>

      {/* Category Panels */}
      {collapseItems.length > 0 && (
        <Collapse
          items={collapseItems}
          defaultActiveKey={addedCategories}
          style={{ marginBottom: 16 }}
        />
      )}
    </Card>
  );
};

export default ScopeBuilder;
