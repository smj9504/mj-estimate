import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button, InputNumber, Popconfirm, Space, Switch, Tag, Tooltip } from 'antd';
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderAddOutlined,
  HolderOutlined,
  PlusOutlined,
  UpOutlined,
} from '@ant-design/icons';

// The collapsible section box shared by the invoice and estimate edit pages:
// a grey header strip (drag handle, title, item count, lump sum, subtotal,
// section actions) over the section's items.

interface SortableSectionItemProps {
  id: string;
  children: React.ReactElement<{ dragListeners?: any }>;
}

// Makes a whole section sortable; the drag listeners go to the child's
// handle only, so the header's buttons and the item rows stay clickable.
export const SortableSectionItem: React.FC<SortableSectionItemProps> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {React.cloneElement(children, { dragListeners: listeners })}
    </div>
  );
};

export interface DocumentSectionPanelProps {
  section: {
    id: string;
    title: string;
    items: unknown[];
    showSubtotal?: boolean;
    subtotal: number;
    isLumpSum?: boolean;
    lumpSumAmount?: number;
  };
  sectionIndex: number;
  isOpen: boolean;
  onToggle: () => void;
  // Injected by SortableSectionItem
  dragListeners?: any;
  // Formats the section subtotal, currency sign included
  formatAmount: (value: number) => string;
  onAddItem: () => void;
  onEditSection: () => void;
  onDeleteSection: () => void;
  // Template buttons show only when their handler is given
  onApplyTemplate?: () => void;
  onSaveAsTemplate?: () => void;
  onToggleLumpSum?: (sectionIndex: number, checked: boolean) => void;
  onLumpSumAmountChange?: (sectionIndex: number, value: number | null) => void;
  // Document-level lump sum: hides the section lump sum and subtotal
  hidePricing?: boolean;
  children?: React.ReactNode;
}

const DocumentSectionPanel: React.FC<DocumentSectionPanelProps> = ({
  section,
  sectionIndex,
  isOpen,
  onToggle,
  dragListeners,
  formatAmount,
  onAddItem,
  onEditSection,
  onDeleteSection,
  onApplyTemplate,
  onSaveAsTemplate,
  onToggleLumpSum,
  onLumpSumAmountChange,
  hidePricing = false,
  children,
}) => {
  return (
    <div
      style={{
        border: '1px solid #d9d9d9',
        borderRadius: '8px',
        marginBottom: '8px',
        overflow: 'hidden',
        backgroundColor: '#fff',
      }}
    >
      {/* Section Header */}
      <div
        className="section-panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '12px 16px',
          backgroundColor: '#fafafa',
          borderBottom: isOpen ? '1px solid #d9d9d9' : 'none',
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        <Space size={6} style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
          <span
            {...dragListeners}
            className="section-drag-handle"
            style={{ cursor: 'grab', color: '#8c8c8c', padding: '4px', touchAction: 'none', flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <HolderOutlined />
          </span>
          <span style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.title}</span>
          <Badge count={section.items.length} showZero color="#108ee9" style={{ flexShrink: 0 }} />
          {!hidePricing && onToggleLumpSum && (
            <Tooltip title="Lump sum: enter one total for this section instead of computing it from items">
              <Space size={4} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>Lump Sum</span>
                <Switch
                  size="small"
                  checked={section.isLumpSum || false}
                  onChange={(checked) => onToggleLumpSum(sectionIndex, checked)}
                />
              </Space>
            </Tooltip>
          )}
          {!hidePricing && (section.isLumpSum ? (
            <InputNumber
              size="small"
              value={section.lumpSumAmount ?? 0}
              onChange={(value) => onLumpSumAmountChange?.(sectionIndex, value)}
              onClick={(e) => e.stopPropagation()}
              prefix="$"
              style={{ width: 110, flexShrink: 0 }}
            />
          ) : (
            section.showSubtotal && (
              <Tag color="blue" style={{ margin: 0 }}>{formatAmount(section.subtotal)}</Tag>
            )
          ))}
          <span style={{ color: '#8c8c8c' }}>
            {isOpen ? <UpOutlined /> : <DownOutlined />}
          </span>
        </Space>
        <Space size={4} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onAddItem();
            }}
          >
            <span className="section-btn-text">Add Item</span>
          </Button>
          {onApplyTemplate && (
            <Button
              size="small"
              icon={<AppstoreAddOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onApplyTemplate();
              }}
            >
              <span className="section-btn-text">Template</span>
            </Button>
          )}
          {onSaveAsTemplate && (
            <Tooltip title="Save section as template">
              <Button
                size="small"
                icon={<FolderAddOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveAsTemplate();
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="Edit section name">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onEditSection();
              }}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this section?"
            description="This will delete all items in this section."
            onConfirm={onDeleteSection}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>

      {/* Section Content */}
      {isOpen && (
        <div style={{ padding: '16px' }}>
          {children}
        </div>
      )}
    </div>
  );
};

export default DocumentSectionPanel;
