import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Collapse, Badge, Tag, Button, Space, Tooltip, Popconfirm, Switch, InputNumber } from 'antd';
import { HolderOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

const { Panel } = Collapse;

interface SortableSectionProps {
  section: {
    id: string;
    title: string;
    items: any[];
    showSubtotal: boolean;
    subtotal: number;
    isLumpSum?: boolean;
    lumpSumAmount?: number;
  };
  sectionIndex: number;
  children?: React.ReactNode;
  onAddItem: (sectionIndex: number) => void;
  onEditSection: (sectionId: string, title: string) => void;
  onDeleteSection: (sectionIndex: number) => void;
  renderHeaderOnly?: boolean;
  onToggleLumpSum?: (sectionIndex: number, checked: boolean) => void;
  onLumpSumAmountChange?: (sectionIndex: number, value: number | null) => void;
  // When true (document-level lump sum mode), the per-section lump-sum
  // toggle and subtotal display are hidden - pricing is document-wide only.
  hideAmounts?: boolean;
}

const SortableSection: React.FC<SortableSectionProps> = ({
  section,
  sectionIndex,
  children,
  onAddItem,
  onEditSection,
  onDeleteSection,
  renderHeaderOnly = false,
  hideAmounts = false,
  onToggleLumpSum,
  onLumpSumAmountChange,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: section.id,
  });

  // When dragging: render an empty div placeholder (no children).
  // Rendering Tooltip/Button children during drag causes ResizeObserver → setState loop.
  if (isDragging) {
    if (renderHeaderOnly) {
      return (
        <div
          ref={setNodeRef}
          style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none', width: '100%' }}
        />
      );
    }
    return (
      <div
        ref={setNodeRef}
        style={{ opacity: 0, visibility: 'hidden', pointerEvents: 'none' }}
      />
    );
  }

  // Skip CSS transforms when displaced (transform non-null = another section is being dragged).
  // Per-frame transform changes trigger Ant Design Tooltip ResizeObserver → setState loop.
  const sectionStyle = (transform !== null)
    ? ({} as React.CSSProperties)
    : ({ transform: CSS.Transform.toString(transform), transition } as React.CSSProperties);

  // If only rendering the header, return just the header content
  if (renderHeaderOnly) {
    return (
      <div ref={setNodeRef} style={{ ...sectionStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div
            {...attributes}
            {...listeners}
            className="section-drag-handle"
            style={{
              cursor: 'grab',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              backgroundColor: 'transparent',
              transition: 'background-color 0.2s',
              touchAction: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f0f0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <HolderOutlined style={{ color: '#8c8c8c', fontSize: '14px' }} />
          </div>
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.title}</strong>
          <Badge count={section.items.length} style={{ marginLeft: 4, flexShrink: 0 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {!hideAmounts && onToggleLumpSum && (
            <Tooltip title="Lump sum: enter one total for this section instead of computing it from items">
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>Lump Sum</span>
                <Switch
                  size="small"
                  checked={section.isLumpSum || false}
                  onChange={(checked) => onToggleLumpSum(sectionIndex, checked)}
                />
              </Space>
            </Tooltip>
          )}
          {!hideAmounts && (section.isLumpSum ? (
            <InputNumber
              size="small"
              value={section.lumpSumAmount ?? 0}
              onChange={(value) => onLumpSumAmountChange?.(sectionIndex, value)}
              onClick={(e) => e.stopPropagation()}
              prefix="$"
              style={{ width: 110 }}
            />
          ) : (
            section.showSubtotal && (
              <Tag color="blue" style={{ margin: 0 }}>${section.subtotal.toFixed(2)}</Tag>
            )
          ))}
          <Space size={4}>
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onAddItem(sectionIndex);
              }}
              className="section-btn-add-item"
            >
              <span className="section-btn-text">Add Item</span>
            </Button>
            <Tooltip title="Edit section name">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditSection(section.id, section.title);
                }}
              />
            </Tooltip>
            <Popconfirm
              title="Are you sure you want to delete this section?"
              onConfirm={(e) => {
                e?.stopPropagation();
                onDeleteSection(sectionIndex);
              }}
              okText="Yes"
              cancelText="No"
            >
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Space>
        </div>
      </div>
    );
  }

  // Legacy mode: return full Panel (for backward compatibility)
  return (
    <div ref={setNodeRef} style={sectionStyle}>
      <Panel
        key={section.id}
        header={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                {...attributes}
                {...listeners}
                style={{
                  cursor: 'grab',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'transparent',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0f0f0';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <HolderOutlined style={{ color: '#8c8c8c', fontSize: '14px' }} />
              </div>
              <strong>{section.title}</strong>
              <Badge count={section.items.length} style={{ marginLeft: 8 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: '8px' }}>
              {section.showSubtotal && (
                <Tag color="blue">${section.subtotal.toFixed(2)}</Tag>
              )}
              <Space size={4}>
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddItem(sectionIndex);
                  }}
                >
                  Add Item
                </Button>
                <Tooltip title="Edit section name">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditSection(section.id, section.title);
                    }}
                  />
                </Tooltip>
                <Popconfirm
                  title="Are you sure you want to delete this section?"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    onDeleteSection(sectionIndex);
                  }}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    danger
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </Space>
            </div>
          </div>
        }
      >
        <div style={{ padding: '16px 0' }}>
          {children}
        </div>
      </Panel>
    </div>
  );
};

export default SortableSection;