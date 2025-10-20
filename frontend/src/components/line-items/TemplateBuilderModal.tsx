/**
 * Template Builder Modal
 * Main interface for creating and editing line item templates
 * Supports drag & drop reordering, item editing, and metadata management
 */

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Space,
  Typography,
  List,
  InputNumber,
  Popconfirm,
  message,
  Divider,
  Tag,
  Empty
} from 'antd';
import {
  SaveOutlined,
  DeleteOutlined,
  HolderOutlined,
  PlusOutlined,
  EditOutlined
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTemplateBuilder } from '../../contexts/TemplateBuilderContext';

const { TextArea } = Input;
const { Title, Text } = Typography;

interface SortableItemProps {
  id: string;
  index: number;
  item: any;
  onRemove: (index: number) => void;
  onUpdate: (index: number, updates: any) => void;
}

const SortableItem: React.FC<SortableItemProps> = ({ id, index, item, onRemove, onUpdate }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <List.Item
        style={{
          background: 'white',
          border: '1px solid #f0f0f0',
          borderRadius: '4px',
          marginBottom: '8px',
          padding: '12px',
        }}
      >
        <Space style={{ width: '100%' }} direction="vertical" size="small">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Space>
              <HolderOutlined
                {...attributes}
                {...listeners}
                style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
              />
              <div>
                <Text strong>{item.description || item.name}</Text>
                {item.source_section && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    {item.source_section}
                  </Tag>
                )}
              </div>
            </Space>
            <Popconfirm
              title="Remove this item?"
              onConfirm={() => onRemove(index)}
            >
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </div>

          <Space style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Quantity:
            </Text>
            <InputNumber
              min={0.01}
              step={0.1}
              precision={2}
              value={item.quantity_multiplier}
              onChange={(value) => onUpdate(index, { quantity_multiplier: value || 1 })}
              size="small"
              style={{ width: 100 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.unit}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              @ ${item.rate.toFixed(2)}
            </Text>
            <Text strong style={{ marginLeft: 'auto' }}>
              ${((item.quantity_multiplier || 1) * item.rate).toFixed(2)}
            </Text>
          </Space>
        </Space>
      </List.Item>
    </div>
  );
};

const TemplateBuilderModal: React.FC = () => {
  const {
    isBuilderOpen,
    builderItems,
    editingTemplate,
    templateName,
    templateDescription,
    templateCategory,
    closeBuilder,
    removeItemFromBuilder,
    reorderBuilderItems,
    updateBuilderItem,
    saveTemplate,
    updateTemplate,
    setTemplateName,
    setTemplateDescription,
    setTemplateCategory,
  } = useTemplateBuilder();

  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = builderItems.findIndex((_, idx) => `item-${idx}` === active.id);
      const newIndex = builderItems.findIndex((_, idx) => `item-${idx}` === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderBuilderItems(oldIndex, newIndex);
      }
    }
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      message.error('Please enter a template name');
      return;
    }

    if (builderItems.length === 0) {
      message.error('Please add at least one item to the template');
      return;
    }

    const itemsWithLibRef = builderItems.filter(item => item.line_item_id);
    if (itemsWithLibRef.length === 0) {
      message.error('No items with library references. Please ensure items are saved to the library.');
      return;
    }

    try {
      setSaving(true);

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id);
      } else {
        await saveTemplate();
      }
    } catch (error: any) {
      message.error(error.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const totalValue = builderItems.reduce(
    (sum, item) => sum + (item.quantity_multiplier || 1) * item.rate,
    0
  );

  return (
    <Modal
      title={
        <Space>
          <EditOutlined />
          <span>{editingTemplate ? 'Edit Template' : 'Create Template'}</span>
        </Space>
      }
      open={isBuilderOpen}
      onCancel={closeBuilder}
      width={800}
      footer={[
        <Button key="cancel" onClick={closeBuilder}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
        >
          {editingTemplate ? 'Update Template' : 'Save Template'}
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Form.Item
          label="Template Name"
          required
          tooltip="Give this template a descriptive name"
        >
          <Input
            placeholder="e.g., Kitchen Renovation Package"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            maxLength={200}
          />
        </Form.Item>

        <Form.Item label="Description">
          <TextArea
            placeholder="Describe what this template includes..."
            value={templateDescription}
            onChange={(e) => setTemplateDescription(e.target.value)}
            rows={3}
            maxLength={1000}
            showCount
          />
        </Form.Item>

        <Form.Item label="Category" tooltip="Organize templates by category">
          <Input
            placeholder="e.g., Plumbing, Electrical, Kitchen"
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            maxLength={100}
          />
        </Form.Item>
      </Form>

      <Divider orientation="left">
        Template Items ({builderItems.length})
        {builderItems.length > 0 && (
          <Tag color="green" style={{ marginLeft: 8 }}>
            Total: ${totalValue.toFixed(2)}
          </Tag>
        )}
      </Divider>

      {builderItems.length === 0 ? (
        <Empty
          description="No items in template yet"
          style={{ margin: '40px 0' }}
        >
          <Text type="secondary">
            Add items from your invoice sections or select individual items
          </Text>
        </Empty>
      ) : (
        <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '8px' }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={builderItems.map((_, idx) => `item-${idx}`)}
              strategy={verticalListSortingStrategy}
            >
              {builderItems.map((item, index) => (
                <SortableItem
                  key={`item-${index}`}
                  id={`item-${index}`}
                  index={index}
                  item={item}
                  onRemove={removeItemFromBuilder}
                  onUpdate={updateBuilderItem}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </Modal>
  );
};

export default TemplateBuilderModal;
