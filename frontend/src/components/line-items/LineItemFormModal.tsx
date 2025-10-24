/**
 * Line Item Form Modal
 * Comprehensive form for creating and editing line items with note management
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Typography,
  Divider,
  Radio,
  message,
  Popconfirm,
  Card,
  List,
  Collapse,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  HolderOutlined,
  SaveOutlined,
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
import lineItemService from '../../services/lineItemService';
import { LineItem, LineItemCreate, LineItemUpdate, LineItemType, LineItemNote } from '../../types/lineItem';

const { TextArea } = Input;
const { Title, Text } = Typography;
const { Panel } = Collapse;

interface LineItemFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lineItemId?: string;
}

interface NoteFormData {
  id?: string;
  title?: string;
  content: string;
  category?: string;
  order_index?: number;
  _isNew?: boolean;
}

// Sortable Note Item Component
interface SortableNoteItemProps {
  id: string;
  note: NoteFormData;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<NoteFormData>) => void;
}

const SortableNoteItem: React.FC<SortableNoteItemProps> = ({ id, note, onDelete, onUpdate }) => {
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

  const [isEditing, setIsEditing] = useState(note._isNew || false);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'white',
        border: '1px solid #f0f0f0',
        borderRadius: '4px',
        marginBottom: '8px',
        padding: '12px',
      }}
    >
      {isEditing ? (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Input
            placeholder="Note Title (optional)"
            value={note.title}
            onChange={(e) => onUpdate(id, { title: e.target.value })}
          />
          <TextArea
            placeholder="Note Content (required)"
            value={note.content}
            onChange={(e) => onUpdate(id, { content: e.target.value })}
            rows={3}
          />
          <Input
            placeholder="Category (optional)"
            value={note.category}
            onChange={(e) => onUpdate(id, { category: e.target.value })}
          />
          <Space>
            <Button size="small" type="primary" onClick={() => setIsEditing(false)}>
              Done
            </Button>
            <Popconfirm
              title="Delete this note?"
              onConfirm={() => onDelete(id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Popconfirm>
          </Space>
        </Space>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Space>
            <HolderOutlined
              {...attributes}
              {...listeners}
              style={{ cursor: 'grab', color: '#999', fontSize: 16 }}
            />
            <div>
              {note.title && <Text strong>{note.title}</Text>}
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {note.content.length > 100 ? `${note.content.substring(0, 100)}...` : note.content}
                </Text>
              </div>
              {note.category && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Category: {note.category}
                </Text>
              )}
            </div>
          </Space>
          <Space>
            <Button
              type="text"
              size="small"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>
            <Popconfirm
              title="Delete this note?"
              onConfirm={() => onDelete(id)}
            >
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Space>
        </div>
      )}
    </div>
  );
};

const LineItemFormModal: React.FC<LineItemFormModalProps> = ({
  open,
  onClose,
  onSuccess,
  lineItemId,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [itemType, setItemType] = useState<LineItemType>(LineItemType.CUSTOM);
  const [categories, setCategories] = useState<any[]>([]);
  const [notes, setNotes] = useState<NoteFormData[]>([]);
  const [notesToDelete, setNotesToDelete] = useState<string[]>([]);

  const isEditMode = !!lineItemId;

  // DnD Sensors for note reordering
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Unit options
  const unitOptions = [
    'EA', 'SF', 'LF', 'SQ', 'CY', 'HR', 'DAY', 'WK', 'MO',
    'GAL', 'LBS', 'TON', 'FT', 'IN', 'YD', 'MI', 'AC', 'LOT'
  ];

  // Load categories
  useEffect(() => {
    loadCategories();
  }, []);

  // Load line item data in edit mode
  useEffect(() => {
    if (open && lineItemId) {
      loadLineItemData();
    } else if (open && !lineItemId) {
      // Reset form for create mode
      form.resetFields();
      setItemType(LineItemType.CUSTOM);
      setNotes([]);
      setNotesToDelete([]);
    }
  }, [open, lineItemId]);

  const loadCategories = async () => {
    try {
      const data = await lineItemService.getCategories();
      setCategories(data);
    } catch (error: any) {
      console.error('Failed to load categories:', error);
      message.error('Failed to load categories');
    }
  };

  const loadLineItemData = async () => {
    if (!lineItemId) return;

    setLoadingData(true);
    try {
      const lineItem = await lineItemService.getLineItem(lineItemId);

      // Determine type based on presence of Xactimate fields
      const type = lineItem.lab !== undefined || lineItem.mat !== undefined
        ? LineItemType.XACTIMATE
        : LineItemType.CUSTOM;

      setItemType(type);

      // Set form values
      form.setFieldsValue({
        type,
        item: lineItem.item,
        description: lineItem.description,
        unit: lineItem.unit,
        cat: lineItem.cat,
        includes: lineItem.includes,
        is_active: lineItem.is_active,
        // Custom fields
        untaxed_unit_price: lineItem.untaxed_unit_price,
        // Xactimate fields
        lab: lineItem.lab,
        mat: lineItem.mat,
        equ: lineItem.equ,
        labor_burden: lineItem.labor_burden,
        market_condition: lineItem.market_condition,
      });

      // Load notes
      const notesData = await lineItemService.getLineItemNotes(lineItemId);
      setNotes(notesData.map((note, index) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        category: note.category,
        order_index: index,
      })));
    } catch (error: any) {
      console.error('Failed to load line item:', error);
      message.error('Failed to load line item data');
    } finally {
      setLoadingData(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const lineItemData: any = {
        item: values.item,
        description: values.description,
        includes: values.includes,
        unit: values.unit,
        cat: values.cat,
        is_active: values.is_active ?? true,
      };

      // Add type-specific fields
      if (itemType === LineItemType.CUSTOM) {
        lineItemData.untaxed_unit_price = values.untaxed_unit_price;
      } else {
        lineItemData.lab = values.lab || 0;
        lineItemData.mat = values.mat || 0;
        lineItemData.equ = values.equ || 0;
        lineItemData.labor_burden = values.labor_burden || 0;
        lineItemData.market_condition = values.market_condition || 0;
      }

      let savedLineItemId = lineItemId;

      if (isEditMode) {
        // Update existing line item
        await lineItemService.updateLineItem(lineItemId!, lineItemData);
        message.success('Line item updated successfully');
      } else {
        // Create new line item
        const createdItem = await lineItemService.createLineItem(lineItemData);
        savedLineItemId = createdItem.id;
        message.success('Line item created successfully');
      }

      // Handle notes
      if (savedLineItemId) {
        // Delete removed notes
        for (const noteId of notesToDelete) {
          try {
            await lineItemService.deleteLineItemNote(savedLineItemId, noteId);
          } catch (error) {
            console.error('Failed to delete note:', error);
          }
        }

        // Create/Update notes
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          if (!note.content.trim()) continue; // Skip empty notes

          const noteData = {
            title: note.title,
            content: note.content,
            category: note.category,
            is_template: false,
          };

          try {
            if (note._isNew || !note.id) {
              // Create new note
              await lineItemService.createLineItemNote(savedLineItemId, noteData);
            } else {
              // Update existing note
              await lineItemService.updateLineItemNote(savedLineItemId, note.id, noteData);
            }
          } catch (error) {
            console.error('Failed to save note:', error);
          }
        }

        // Reorder notes if needed
        if (notes.length > 1) {
          const noteOrders = notes
            .filter(n => n.id && !n._isNew)
            .map((note, index) => ({
              id: note.id!,
              order_index: index,
            }));

          if (noteOrders.length > 0) {
            try {
              await lineItemService.reorderLineItemNotes(savedLineItemId, noteOrders);
            } catch (error) {
              console.error('Failed to reorder notes:', error);
            }
          }
        }
      }

      onSuccess();
      handleClose();
    } catch (error: any) {
      console.error('Failed to save line item:', error);
      message.error(error.message || 'Failed to save line item');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    form.resetFields();
    setNotes([]);
    setNotesToDelete([]);
    setItemType(LineItemType.CUSTOM);
    onClose();
  };

  const handleAddNote = () => {
    const newNote: NoteFormData = {
      id: `temp-${Date.now()}`,
      title: '',
      content: '',
      category: '',
      order_index: notes.length,
      _isNew: true,
    };
    setNotes([...notes, newNote]);
  };

  const handleDeleteNote = (id: string) => {
    const note = notes.find(n => n.id === id);
    if (note && !note._isNew && note.id) {
      setNotesToDelete([...notesToDelete, note.id]);
    }
    setNotes(notes.filter(n => n.id !== id));
  };

  const handleUpdateNote = (id: string, updates: Partial<NoteFormData>) => {
    setNotes(notes.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setNotes((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Calculate total for Xactimate items
  const calculateXactimateTotal = () => {
    const values = form.getFieldsValue();
    const lab = parseFloat(values.lab) || 0;
    const mat = parseFloat(values.mat) || 0;
    const equ = parseFloat(values.equ) || 0;
    const laborBurden = parseFloat(values.labor_burden) || 0;
    const marketCondition = parseFloat(values.market_condition) || 0;

    // If all pricing fields are 0, return 0 to avoid showing 0.00
    if (lab === 0 && mat === 0 && equ === 0) {
      return 0;
    }

    return (lab + mat + equ) * (1 + laborBurden / 100) * (1 + marketCondition / 100);
  };

  return (
    <Modal
      title={isEditMode ? 'Edit Line Item' : 'Create Line Item'}
      open={open}
      onCancel={handleClose}
      width={800}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={loading}
          onClick={handleSubmit}
          icon={<SaveOutlined />}
        >
          {isEditMode ? 'Update Line Item' : 'Create Line Item'}
        </Button>,
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          type: LineItemType.CUSTOM,
          is_active: true,
          lab: 0,
          mat: 0,
          equ: 0,
          labor_burden: 0,
          market_condition: 0,
        }}
      >
        {/* Type Selection */}
        <Form.Item
          label="Type"
          name="type"
          rules={[{ required: true, message: 'Please select a type' }]}
        >
          <Radio.Group
            onChange={(e) => setItemType(e.target.value)}
            disabled={isEditMode}
          >
            <Radio.Button value={LineItemType.XACTIMATE}>Xactimate</Radio.Button>
            <Radio.Button value={LineItemType.CUSTOM}>Custom</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Divider orientation="left">Basic Information</Divider>

        {/* Code */}
        <Form.Item
          label="Code"
          name="item"
          rules={[{ required: true, message: 'Please enter a code' }]}
        >
          <Input placeholder="e.g., CUS001" />
        </Form.Item>

        {/* Description */}
        <Form.Item
          label="Description"
          name="description"
          rules={[{ required: true, message: 'Please enter a description' }]}
        >
          <TextArea rows={2} placeholder="Line item description" />
        </Form.Item>

        {/* Unit and Category */}
        <Space style={{ width: '100%' }} size="middle">
          <Form.Item
            label="Unit"
            name="unit"
            style={{ width: 200 }}
          >
            <Select
              showSearch
              placeholder="Select unit"
              options={unitOptions.map(u => ({ label: u, value: u }))}
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ padding: '4px 8px', cursor: 'pointer' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Or type custom unit
                    </Text>
                  </div>
                </>
              )}
            />
          </Form.Item>

          <Form.Item
            label="Category"
            name="cat"
            style={{ flex: 1 }}
          >
            <Select
              showSearch
              placeholder="Select category"
              options={categories.map(c => ({
                label: `${c.code} - ${c.name}`,
                value: c.code,
              }))}
            />
          </Form.Item>
        </Space>

        <Divider orientation="left">Pricing</Divider>

        {itemType === LineItemType.CUSTOM ? (
          <Form.Item
            label="Unit Price"
            name="untaxed_unit_price"
            rules={[{ required: true, message: 'Please enter unit price' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              step={0.01}
              precision={2}
              prefix="$"
              placeholder="0.00"
            />
          </Form.Item>
        ) : (
          <>
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item label="Labor" name="lab" style={{ flex: 1 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  precision={2}
                  prefix="$"
                />
              </Form.Item>

              <Form.Item label="Material" name="mat" style={{ flex: 1 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  precision={2}
                  prefix="$"
                />
              </Form.Item>

              <Form.Item label="Equipment" name="equ" style={{ flex: 1 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  precision={2}
                  prefix="$"
                />
              </Form.Item>
            </Space>

            <Space style={{ width: '100%' }} size="middle">
              <Form.Item label="Labor Burden (%)" name="labor_burden" style={{ flex: 1 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={100}
                  step={0.1}
                  precision={1}
                  suffix="%"
                />
              </Form.Item>

              <Form.Item label="Market Condition (%)" name="market_condition" style={{ flex: 1 }}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={-100}
                  max={100}
                  step={0.1}
                  precision={1}
                  suffix="%"
                />
              </Form.Item>
            </Space>

            <Card size="small" style={{ background: '#f5f5f5' }}>
              <Text strong>Calculated Total: </Text>
              <Text type="success" style={{ fontSize: 16 }}>
                ${calculateXactimateTotal().toFixed(2)}
              </Text>
            </Card>
          </>
        )}

        <Divider orientation="left">Additional Details</Divider>

        {/* Includes */}
        <Form.Item
          label="Includes (Work Description)"
          name="includes"
        >
          <TextArea rows={3} placeholder="What work is included in this line item?" />
        </Form.Item>

        {/* Active Status */}
        <Form.Item
          label="Active Status"
          name="is_active"
          valuePropName="checked"
        >
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>

        <Divider orientation="left">Notes for this Line Item</Divider>

        {notes.length === 0 ? (
          <Card size="small" style={{ textAlign: 'center', marginBottom: 16 }}>
            <Text type="secondary">No notes added yet</Text>
          </Card>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={notes.map(n => n.id!)}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ marginBottom: 16 }}>
                {notes.map((note) => (
                  <SortableNoteItem
                    key={note.id}
                    id={note.id!}
                    note={note}
                    onDelete={handleDeleteNote}
                    onUpdate={handleUpdateNote}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={handleAddNote}
          block
        >
          Add Note
        </Button>
      </Form>
    </Modal>
  );
};

export default LineItemFormModal;
