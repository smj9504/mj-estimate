import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Collapse, Badge, Tag, Button, Space, Tooltip, Popconfirm } from 'antd';
import { HolderOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

const { Panel } = Collapse;

interface SortableSectionProps {
  section: {
    id: string;
    title: string;
    items: any[];
    showSubtotal: boolean;
    subtotal: number;
  };
  sectionIndex: number;
  children?: React.ReactNode;
  onAddItem: (sectionIndex: number) => void;
  onEditSection: (sectionId: string, title: string) => void;
  onDeleteSection: (sectionIndex: number) => void;
  renderHeaderOnly?: boolean;
}

const SortableSection: React.FC<SortableSectionProps> = ({
  section,
  sectionIndex,
  children,
  onAddItem,
  onEditSection,
  onDeleteSection,
  renderHeaderOnly = false,
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0 : 1,
    visibility: isDragging ? 'hidden' : 'visible',
  } as React.CSSProperties;

  // If only rendering the header, return just the header content
  if (renderHeaderOnly) {
    return (
      <div ref={setNodeRef} style={{ ...style, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <HolderOutlined style={{ color: '#999', fontSize: '14px' }} />
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
    );
  }

  // Legacy mode: return full Panel (for backward compatibility)
  return (
    <div ref={setNodeRef} style={style}>
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
                <HolderOutlined style={{ color: '#999', fontSize: '14px' }} />
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