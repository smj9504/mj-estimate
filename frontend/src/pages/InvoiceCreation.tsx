import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Form,
  Input,
  Button,
  DatePicker,
  InputNumber,
  Select,
  Card,
  Row,
  Col,
  Space,
  Table,
  Modal,
  message,
  Divider,
  Switch,
  Typography,
  Tooltip,
  Popconfirm,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  DownloadOutlined,
  AppstoreAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  CommentOutlined,
  UpOutlined,
  DownOutlined,
  PictureOutlined,
  SnippetsOutlined,
  UploadOutlined,
  CopyOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
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
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import DraggableTable from '../components/common/DraggableTable';
import dayjs from 'dayjs';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { invoiceService, InvoiceSection, LineItemImage } from '../services/invoiceService';
import { companyService } from '../services/companyService';
import { Company } from '../types';
import RichTextEditor from '../components/editor/RichTextEditor';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';
import ItemCodeSelector from '../components/estimate/ItemCodeSelector';
import { EstimateLineItem } from '../services/estimateService';
import SortableSection from '../components/common/SortableSection';
import MultiSelectActionBar from '../components/common/MultiSelectActionBar';
import LineItemTemplateSelector from '../components/line-items/LineItemTemplateSelector';
import LineItemTemplateManager from '../components/line-items/LineItemTemplateManager';
import TemplateBuilderBar from '../components/line-items/TemplateBuilderBar';
import TemplateBuilderModal from '../components/line-items/TemplateBuilderModal';
import lineItemService from '../services/lineItemService';
import { LineItemType } from '../types/lineItem';
import { useTemplateBuilder } from '../contexts/TemplateBuilderContext';
import { generateId } from '../components/sketch/utils/idUtils';
import {
  Collapse,
  Tag,
  Badge,
  Checkbox,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { receiptService } from '../services/receiptService';
import type { ReceiptTemplate } from '../types/receipt';
import { useCompanies } from '../hooks/useCompanyQueries';
import { clientService } from '../services/clientService';
import type { Client, ClientListItem } from '../types/client';
import { useInvoice, useCreateInvoice, useUpdateInvoice } from '../hooks/useInvoiceQueries';
import { useReceiptTemplates, useReceiptByNumber } from '../hooks/useReceiptQueries';

const { Title } = Typography;
const { TextArea } = Input;

// Format number with thousand separators
const formatCurrency = (value: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

interface InvoiceItem {
  id?: string;
  line_item_id?: string;  // Reference to line_items library
  name: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
  amount?: number;
  taxable?: boolean;
  primary_group?: string;
  secondary_group?: string;
  sort_order?: number;
  note?: string;  // Rich text note for item-specific notes
  images?: LineItemImage[];  // Images attached to this line item
}

interface PaymentRecord {
  amount: number;
  date?: dayjs.Dayjs | null;
  method?: string;
  reference?: string;
  top_note?: string;
  bottom_note?: string;
  receipt_number?: string;  // Track if receipt was generated for this payment
}

interface Adjustment {
  id: string;
  name: string;
  percentage: number;
  fixedAmount?: number; // Direct dollar amount (used when percentage is 0)
  type: 'add' | 'subtract';
  order: number;
  amount?: number; // Calculated
  note?: string; // Optional note displayed on PDF
}

// Sortable wrapper for each section in the Collapse
interface SortableSectionItemProps {
  id: string;
  children: React.ReactNode;
}

const SortableSectionItem: React.FC<SortableSectionItemProps> = ({ id, children }) => {
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
      {React.cloneElement(children as React.ReactElement, {
        dragListeners: listeners,
      })}
    </div>
  );
};

// Sortable adjustment item for drag-and-drop reordering
const SortableAdjustmentItem: React.FC<{
  adj: Adjustment;
  calculatedAdj: any;
  handleAdjustmentChange: (id: string, field: keyof Adjustment, value: any) => void;
  handleRemoveAdjustment: (id: string) => void;
  setAdjustments: React.Dispatch<React.SetStateAction<Adjustment[]>>;
}> = ({ adj, calculatedAdj, handleAdjustmentChange, handleRemoveAdjustment, setAdjustments }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: adj.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    marginBottom: 12, padding: 12,
    border: isDragging ? '1px dashed #1890ff' : '1px solid #f0f0f0',
    borderRadius: 4, background: '#fafafa',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Row gutter={8} align="middle">
        <Col span={1}>
          <span {...listeners} style={{ cursor: 'grab', color: '#8c8c8c' }}><HolderOutlined /></span>
        </Col>
        <Col span={6}>
          <Input placeholder="Name (e.g., Deductible)" value={adj.name} onChange={(e) => handleAdjustmentChange(adj.id, 'name', e.target.value)} size="small" />
        </Col>
        <Col span={3}>
          <Select value={adj.type} onChange={(value) => handleAdjustmentChange(adj.id, 'type', value)} size="small" style={{ width: '100%' }}>
            <Select.Option value="add">+ Add</Select.Option>
            <Select.Option value="subtract">− Sub</Select.Option>
          </Select>
        </Col>
        <Col span={7}>
          <InputNumber
            placeholder={adj.fixedAmount != null ? "Dollar amount" : "Percentage"}
            value={adj.fixedAmount != null ? adj.fixedAmount : adj.percentage}
            onChange={(value) => {
              if (adj.fixedAmount != null) {
                handleAdjustmentChange(adj.id, 'fixedAmount', value || 0);
              } else {
                handleAdjustmentChange(adj.id, 'percentage', value || 0);
              }
            }}
            min={adj.fixedAmount != null ? 0 : -100}
            max={adj.fixedAmount != null ? undefined : 100}
            step={adj.fixedAmount != null ? 1 : 0.1}
            size="small"
            style={{ width: '100%' }}
            addonAfter={
              <Select
                value={adj.fixedAmount != null ? '$' : '%'}
                onChange={(mode) => {
                  setAdjustments(prev => prev.map(a =>
                    a.id === adj.id
                      ? mode === '$'
                        ? { ...a, fixedAmount: 0, percentage: 0 }
                        : { ...a, fixedAmount: undefined, percentage: 0 }
                      : a
                  ));
                }}
                size="small" style={{ width: 52 }} popupMatchSelectWidth={false}
              >
                <Select.Option value="$">$</Select.Option>
                <Select.Option value="%">%</Select.Option>
              </Select>
            }
          />
        </Col>
        <Col span={5}>
          <span style={{ fontSize: '13px', color: adj.type === 'subtract' ? '#cf1322' : '#389e0d', fontWeight: '600' }}>
            {adj.type === 'subtract' ? '−' : '+'} ${calculatedAdj?.amount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
          </span>
        </Col>
        <Col span={2}>
          <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleRemoveAdjustment(adj.id)} />
        </Col>
      </Row>
      <div style={{ marginTop: 6, paddingLeft: 32 }}>
        <Input placeholder="Note (optional, shown on PDF)" value={adj.note || ''} onChange={(e) => handleAdjustmentChange(adj.id, 'note', e.target.value)} size="small" />
      </div>
    </div>
  );
};

// Section header component that receives drag listeners
interface SectionHeaderProps {
  section: InvoiceSection;
  sectionIndex: number;
  dragListeners?: any;
  formatCurrency: (value: number) => string;
  onAddItem: () => void;
  onApplyTemplate: () => void;
  onSaveAsTemplate: () => void;
  onEditSection: () => void;
  onDeleteSection: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  section,
  dragListeners,
  formatCurrency,
  onAddItem,
  onApplyTemplate,
  onSaveAsTemplate,
  onEditSection,
  onDeleteSection,
}) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <Space>
        <span
          {...dragListeners}
          className="section-drag-handle"
          style={{ cursor: 'grab', color: '#8c8c8c', padding: '4px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <HolderOutlined />
        </span>
        <span style={{ fontWeight: 'bold' }}>{section.title}</span>
        <Badge count={section.items.length} showZero color="#108ee9" />
        {section.showSubtotal && (
          <Tag color="blue">${formatCurrency(section.subtotal)}</Tag>
        )}
      </Space>
      <Space onClick={(e) => e.stopPropagation()}>
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onAddItem();
          }}
        >
          Add Item
        </Button>
        <Button
          size="small"
          icon={<AppstoreAddOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            onApplyTemplate();
          }}
        >
          Apply Template
        </Button>
        <Tooltip title="Save section as template">
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onSaveAsTemplate();
            }}
          >
            Save as Template
          </Button>
        </Tooltip>
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
  );
};

// SectionPanel component for displaying a collapsible section with items
interface SectionPanelProps {
  section: InvoiceSection;
  sectionIndex: number;
  isOpen: boolean;
  onToggle: () => void;
  onAddItem: () => void;
  onApplyTemplate: () => void;
  onSaveAsTemplate: () => void;
  onEditSection: () => void;
  onDeleteSection: () => void;
  formatCurrency: (value: number) => string;
  taxMethod: string;
  sections: InvoiceSection[];
  setSections: React.Dispatch<React.SetStateAction<InvoiceSection[]>>;
  calculateSectionSubtotal: (items: any[], section?: { isLumpSum?: boolean; lumpSumAmount?: number }) => number;
  activeId: string | null;
  dragListeners?: any;
  setEditingSectionIndex: (index: number) => void;
  setEditingItem: (item: any) => void;
  setEditingIndex: (index: number | null) => void;
  itemForm: any;
  setItemModalVisible: (visible: boolean) => void;
  selectedRowKeys?: string[];
  onRowSelection?: (keys: string[]) => void;
  onToggleLumpSum?: (sectionIndex: number, checked: boolean) => void;
  onLumpSumAmountChange?: (sectionIndex: number, value: number | null) => void;
}

const SectionPanel: React.FC<SectionPanelProps> = ({
  section,
  sectionIndex,
  isOpen,
  onToggle,
  onAddItem,
  onApplyTemplate,
  onSaveAsTemplate,
  onEditSection,
  onDeleteSection,
  formatCurrency,
  taxMethod,
  sections,
  setSections,
  calculateSectionSubtotal,
  activeId,
  dragListeners,
  setEditingSectionIndex,
  setEditingItem,
  setEditingIndex,
  itemForm,
  setItemModalVisible,
  selectedRowKeys = [],
  onRowSelection,
  onToggleLumpSum,
  onLumpSumAmountChange,
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
          {onToggleLumpSum && (
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
          {section.isLumpSum ? (
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
              <Tag color="blue" style={{ margin: 0 }}>${formatCurrency(section.subtotal)}</Tag>
            )
          )}
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
          {section.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#8c8c8c' }}>
              No items in this section. Click "Add Item" to add items.
            </div>
          ) : (
            <DraggableTable
              className="draggable-table invoice-items-table"
              dataSource={section.items.map((item, idx) => ({
                ...item,
                key: item.id || `${sectionIndex}-${idx}`
              }))}
              onReorder={() => {}}
              pagination={false}
              size="small"
              showDragHandle={true}
              dragHandlePosition="start"
              dragColumnWidth={30}
              getRowId={(record: any, idx: number) => `item-${sectionIndex}-${record.id || record.key || idx}`}
              disableDrag={false}
              sectionIndex={sectionIndex}
              dragType="item"
              activeId={activeId}
              scroll={{ x: 600 }}
              resizableColumns={true}
              rowSelection={onRowSelection ? {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => onRowSelection(keys as string[]),
                type: 'checkbox' as const,
              } : undefined}
              columns={[
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  ellipsis: true,
                  width: 200,
                  minWidth: 100,
                  maxWidth: 500,
                  fixed: 'left' as const,
                  render: (value: string, record: InvoiceItem) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {value ? (
                        <div dangerouslySetInnerHTML={{ __html: value }} style={{ flex: 1 }} />
                      ) : null}
                      {record.note && record.note.replace(/<[^>]*>/g, '').trim() ? (
                        <Tooltip
                          title={`Item Note: ${record.note.replace(/<[^>]*>/g, '').substring(0, 100)}${record.note.replace(/<[^>]*>/g, '').length > 100 ? '...' : ''}`}
                        >
                          <CommentOutlined
                            style={{
                              color: '#1890ff',
                              fontSize: '16px',
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          />
                        </Tooltip>
                      ) : null}
                      {record.images && record.images.length > 0 ? (
                        <Tooltip
                          title={`${record.images.length} photo(s): ${record.images.map((img: LineItemImage) => img.title).filter(Boolean).join(', ') || 'Attached'}`}
                        >
                          <PictureOutlined
                            style={{
                              color: '#52c41a',
                              fontSize: '16px',
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: 'Qty',
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 60,
                  align: 'center' as const,
                },
                {
                  title: 'Unit',
                  dataIndex: 'unit',
                  key: 'unit',
                  width: 60,
                  align: 'center' as const,
                },
                {
                  title: 'Rate',
                  dataIndex: 'rate',
                  key: 'rate',
                  width: 80,
                  align: 'right' as const,
                  render: (value: number) => formatCurrency(value || 0),
                },
                {
                  title: 'Amount',
                  key: 'amount',
                  width: 90,
                  align: 'right' as const,
                  render: (_: any, record: InvoiceItem) => formatCurrency((record.quantity || 0) * (record.rate || 0)),
                },
                ...(taxMethod === 'percentage' ? [{
                  title: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>Tax</span>
                      <Tooltip title="Toggle all items in this section">
                        <Switch
                          size="small"
                          checked={section.items.every(item => item.taxable !== false)}
                          onChange={(checked) => {
                            const newSections = [...sections];
                            newSections[sectionIndex].items = newSections[sectionIndex].items.map(item => ({
                              ...item,
                              taxable: checked
                            }));
                            newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items, newSections[sectionIndex]);
                            setSections(newSections);
                          }}
                        />
                      </Tooltip>
                    </div>
                  ),
                  dataIndex: 'taxable',
                  key: 'taxable',
                  width: 80,
                  align: 'center' as const,
                  responsive: ['md'] as any,
                  render: (value: boolean | undefined, record: InvoiceItem, recordIndex: number) => (
                    <Switch
                      size="small"
                      checked={value !== false}
                      onChange={(checked) => {
                        const newSections = [...sections];
                        newSections[sectionIndex].items[recordIndex] = {
                          ...newSections[sectionIndex].items[recordIndex],
                          taxable: checked
                        };
                        newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items, newSections[sectionIndex]);
                        setSections(newSections);
                      }}
                    />
                  ),
                }] : []),
                {
                  title: '',
                  key: 'actions',
                  width: 70,
                  align: 'center' as const,
                  fixed: 'right' as const,
                  render: (_: any, record: InvoiceItem, index: number) => (
                    <Space size="small">
                      <Tooltip title="Edit item">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSectionIndex(sectionIndex);
                            setEditingItem(record);
                            setEditingIndex(index);
                            itemForm.setFieldsValue({
                              name: record.name,
                              description: record.description,
                              note: record.note || '',
                              quantity: record.quantity,
                              unit: record.unit,
                              rate: record.rate,
                              taxable: record.taxable !== false,
                            });
                            setItemModalVisible(true);
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="Delete item">
                        <Popconfirm
                          title="Are you sure you want to delete this item?"
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            const newSections = [...sections];
                            newSections[sectionIndex].items.splice(index, 1);
                            newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items, newSections[sectionIndex]);
                            setSections(newSections);
                            message.success('Item deleted successfully');
                          }}
                          okText="Yes"
                          cancelText="No"
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            danger
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>
                      </Tooltip>
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
};

const InvoiceCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isEditMode = !!id;
  const presetClient = (location.state as { presetClient?: Client } | null)?.presetClient;

  // Loading states - separate for different operations
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPreviewingReceipt, setIsPreviewingReceipt] = useState(false);

  const [formMounted, setFormMounted] = useState(false);
  
  // Local state for company selection to ensure Select updates immediately
  const [companySelectionValue, setCompanySelectionValue] = useState<string | undefined>(undefined);

  // Template Builder Context
  const {
    toggleItemSelection,
    selectedItemIds,
    addSectionToBuilder,
    saveSectionAsNewTemplate,
    addSelectedItemsToBuilder,
    setCompanyId,
  } = useTemplateBuilder();
  const [formFieldsChanged, setFormFieldsChanged] = useState(0);
  // Section-based state
  const [sections, setSections] = useState<InvoiceSection[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  // Legacy items array for backward compatibility
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [showInsurance, setShowInsurance] = useState(false);

  // React Query: Load companies
  const { data: companies = [], isLoading: companiesLoading } = useCompanies();
  
  // React Query: Mutations for create/update
  const createInvoiceMutation = useCreateInvoice();
  const updateInvoiceMutation = useUpdateInvoice(id || '');

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [itemImages, setItemImages] = useState<LineItemImage[]>([]);
  const [taxMethod, setTaxMethod] = useState<'percentage' | 'specific'>('percentage');
  const [taxRate, setTaxRate] = useState(0);
  const [specificTaxAmount, setSpecificTaxAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [showPaymentDates, setShowPaymentDates] = useState(true);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentForm] = Form.useForm();
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  const [editingPaymentIndex, setEditingPaymentIndex] = useState<number | null>(null);
  const [clientInputMode, setClientInputMode] = useState<'manual' | 'company' | 'client'>('manual');
  const [selectedClient, setSelectedClient] = useState<Company | null>(null);
  const [selectedClientRecord, setSelectedClientRecord] = useState<ClientListItem | null>(null);
  const [clientSearchResults, setClientSearchResults] = useState<ClientListItem[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [opPercent, setOpPercent] = useState(0); // DEPRECATED: Use adjustments instead
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

  // Receipt generation state
  // React Query: Load receipt templates when company is selected
  const { data: receiptTemplates = [] } = useReceiptTemplates(selectedCompany?.id);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [receiptDate, setReceiptDate] = useState<dayjs.Dayjs | null>(null);
  const [receiptTopNote, setReceiptTopNote] = useState<string>('');
  const [receiptBottomNote, setReceiptBottomNote] = useState<string>('');
  const [generatingReceipt, setGeneratingReceipt] = useState(false);

  // Receipt preview modal state
  const [receiptPreviewVisible, setReceiptPreviewVisible] = useState(false);
  const [receiptPdfBlobUrl, setReceiptPdfBlobUrl] = useState<string | null>(null);

  // Section editing state
  const [sectionEditModalVisible, setSectionEditModalVisible] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');

  // Template selector state
  const [templateSelectorVisible, setTemplateSelectorVisible] = useState(false);
  const [templateManagerVisible, setTemplateManagerVisible] = useState(false);
  const [templateTargetSectionIndex, setTemplateTargetSectionIndex] = useState<number | null>(null);

  // Drag and drop states
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'section' | 'item' | null>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);

  // Collapse active keys state for controlling which sections are expanded
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  // Multi-select state for line items
  const [selectedItemKeys, setSelectedItemKeys] = useState<{[sectionIndex: number]: string[]}>({});

  // JSON paste modal state
  const [jsonPasteVisible, setJsonPasteVisible] = useState(false);
  const [jsonPasteValue, setJsonPasteValue] = useState('');
  const [jsonPasteError, setJsonPasteError] = useState<string | null>(null);

  // Setup sensors for drag interactions
  // PointerSensor for mouse/stylus; TouchSensor with delay for mobile (prevents scroll/drag conflict)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeIdStr = active.id as string;

    if (activeIdStr.startsWith('section-')) {
      // Section drag - useSortable listeners are attached to the drag handle,
      // so we don't need to check for the handle class here
      setActiveDragType('section');
      setActiveId(activeIdStr);
    } else if (activeIdStr.startsWith('item-')) {
      // Item drag - parse section index
      const parts = activeIdStr.split('-');
      if (parts.length >= 3) {
        const sectionIdx = parseInt(parts[1]);
        setActiveDragType('item');
        setActiveId(activeIdStr);
        setActiveSectionIndex(sectionIdx);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      resetDragState();
      return;
    }

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (activeDragType === 'section') {
      // Handle section reordering
      const oldIndex = sections.findIndex(section => section.id === activeIdStr);
      const newIndex = sections.findIndex(section => section.id === overIdStr);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newSections = arrayMove(sections, oldIndex, newIndex);
        setSections(newSections);
      }
    } else if (activeDragType === 'item' && activeSectionIndex !== null) {
      // Handle item reordering within the same section
      // ID format: item-{sectionIndex}-{itemId} where itemId may contain dashes (UUID)
      if (activeIdStr.startsWith('item-') && overIdStr.startsWith('item-')) {
        // Parse the ID: split by '-' and extract sectionIndex and itemId
        const parseItemId = (idStr: string) => {
          const firstDash = idStr.indexOf('-');
          const secondDash = idStr.indexOf('-', firstDash + 1);
          if (firstDash === -1 || secondDash === -1) return null;

          const sectionIdx = parseInt(idStr.substring(firstDash + 1, secondDash));
          const itemId = idStr.substring(secondDash + 1);
          return { sectionIdx, itemId };
        };

        const activeInfo = parseItemId(activeIdStr);
        const overInfo = parseItemId(overIdStr);

        if (activeInfo && overInfo && activeInfo.sectionIdx === overInfo.sectionIdx) {
          const sectionIdx = activeInfo.sectionIdx;
          const sectionItems = sections[sectionIdx]?.items || [];

          // Find indices by item ID
          const activeItemIdx = sectionItems.findIndex(item => item.id === activeInfo.itemId);
          const overItemIdx = sectionItems.findIndex(item => item.id === overInfo.itemId);

          if (activeItemIdx !== -1 && overItemIdx !== -1 && activeItemIdx !== overItemIdx) {
            const newSections = [...sections];
            const newItems = arrayMove([...sectionItems], activeItemIdx, overItemIdx);
            newSections[sectionIdx].items = newItems;
            newSections[sectionIdx].subtotal = calculateSectionSubtotal(newItems, newSections[sectionIdx]);
            setSections(newSections);
          }
        }
      }
    }

    resetDragState();
  };

  const resetDragState = () => {
    setActiveId(null);
    setActiveDragType(null);
    setActiveSectionIndex(null);
  };

  // Removed loadCompanies - now using React Query useCompanies hook
  // Removed loadReceiptTemplates - now using React Query useReceiptTemplates hook

  // React Query: Load invoice when in edit mode
  const { data: fetchedInvoice, isLoading: invoiceLoading } = useInvoice(id, isEditMode);

  const [invoiceData, setInvoiceData] = useState<any>(null);

  // Removed loadInvoice - now using React Query useInvoice hook
  // Invoice data processing happens in useEffect when fetchedInvoice changes

  const convertItemsToSections = (items: InvoiceItem[]): InvoiceSection[] => {
    // Sort items by sort_order first to preserve section ordering
    const sortedItems = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Use a Map to maintain insertion order (order of first appearance)
    const groupedItems = new Map<string, InvoiceItem[]>();

    sortedItems.forEach(item => {
      const groupKey = item.primary_group || 'Default Section';
      if (!groupedItems.has(groupKey)) {
        groupedItems.set(groupKey, []);
      }
      // Ensure each item has a stable unique ID for drag and drop
      const itemWithId = item.id ? item : { ...item, id: generateId() };
      groupedItems.get(groupKey)!.push(itemWithId);
    });

    return Array.from(groupedItems.entries()).map(([title, groupItems], index) => {
      const subtotal = groupItems.reduce((sum, item) => {
        const quantity = parseFloat(String(item.quantity)) || 0;
        const rate = parseFloat(String(item.rate)) || 0;
        const amount = parseFloat(String(item.amount)) || (quantity * rate);
        return sum + amount;
      }, 0);

      return {
        id: `section-${index}`,
        title,
        items: groupItems,
        showSubtotal: true,
        subtotal,
      };
    });
  };

  const convertSectionsToItems = (): InvoiceItem[] => {
    const allItems: InvoiceItem[] = [];
    sections.forEach((section, sectionIndex) => {
      section.items.forEach((item, itemIndex) => {
        allItems.push({
          ...item,
          primary_group: section.title,
          // Use sort_order to preserve section order: sectionIndex * 1000 + itemIndex
          // This allows up to 1000 items per section while maintaining section order
          sort_order: sectionIndex * 1000 + itemIndex,
        });
      });
    });
    return allItems;
  };

  // Section management functions
  const addSection = () => {
    if (!newSectionTitle.trim()) {
      message.warning('Please enter a section title');
      return;
    }

    const newSection: InvoiceSection = {
      id: `section-${Date.now()}`,
      title: newSectionTitle.trim(),
      items: [],
      showSubtotal: true,
      subtotal: 0,
    };

    setSections([...sections, newSection]);
    // Auto-expand the new section
    setActiveKeys([...activeKeys, newSection.id]);
    setNewSectionTitle('');
    message.success('Section added successfully');
  };

  const deleteSection = (sectionIndex: number) => {
    const newSections = sections.filter((_, index) => index !== sectionIndex);
    setSections(newSections);
    message.success('Section deleted successfully');
  };

  // Toggle a section into/out of lump-sum mode. Items are kept as-is;
  // only the section's contribution to the total switches between
  // computed-from-items and the manually-entered lumpSumAmount.
  const toggleSectionLumpSum = (sectionIndex: number, checked: boolean) => {
    setSections(prev => prev.map((section, i) => {
      if (i !== sectionIndex) return section;
      const updated = { ...section, isLumpSum: checked };
      return { ...updated, subtotal: calculateSectionSubtotal(updated.items, updated) };
    }));
  };

  const updateSectionLumpSumAmount = (sectionIndex: number, value: number | null) => {
    setSections(prev => prev.map((section, i) => {
      if (i !== sectionIndex) return section;
      const updated = { ...section, lumpSumAmount: value ?? 0 };
      return { ...updated, subtotal: calculateSectionSubtotal(updated.items, updated) };
    }));
  };

  // Section editing functions
  const handleEditSection = (sectionId: string, currentTitle: string) => {
    setEditingSectionId(sectionId);
    setEditingSectionTitle(currentTitle);
    setSectionEditModalVisible(true);
  };

  const handleSectionTitleSave = () => {
    if (!editingSectionTitle.trim()) {
      message.error('Section title cannot be empty');
      return;
    }

    if (!editingSectionId) {
      message.error('No section selected for editing');
      return;
    }

    const newSections = sections.map(section =>
      section.id === editingSectionId
        ? {
            ...section,
            title: editingSectionTitle.trim(),
            items: section.items.map(item => ({
              ...item,
              primary_group: editingSectionTitle.trim()
            }))
          }
        : section
    );

    setSections(newSections);
    setSectionEditModalVisible(false);
    setEditingSectionId(null);
    setEditingSectionTitle('');
    message.success('Section title updated successfully');
  };

  const handleSectionEditCancel = () => {
    setSectionEditModalVisible(false);
    setEditingSectionId(null);
    setEditingSectionTitle('');
  };

  const calculateSectionSubtotal = (
    items: InvoiceItem[],
    section?: { isLumpSum?: boolean; lumpSumAmount?: number }
  ): number => {
    if (section?.isLumpSum) {
      return section.lumpSumAmount ?? 0;
    }
    return items.reduce((sum, item) => {
      const quantity = parseFloat(String(item.quantity)) || 0;
      const rate = parseFloat(String(item.rate)) || 0;
      const amount = parseFloat(String(item.amount)) || (quantity * rate);
      return sum + amount;
    }, 0);
  };

  // Multi-select row selection handler
  const handleItemRowSelection = (sectionIndex: number, keys: string[]) => {
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: keys
    }));
  };

  // Extract item ID from DraggableTable row key (format: "item-{sectionIndex}-{itemId}")
  const extractItemId = (rowKey: string): string => {
    const firstDash = rowKey.indexOf('-');
    if (firstDash === -1) return rowKey;
    const secondDash = rowKey.indexOf('-', firstDash + 1);
    if (secondDash === -1) return rowKey;
    return rowKey.substring(secondDash + 1);
  };

  // Collect all selected items across sections
  const getSelectedItems = useCallback(() => {
    const result: { item: InvoiceItem; sectionIndex: number; itemIndex: number }[] = [];
    Object.entries(selectedItemKeys).forEach(([sectionIdx, keys]) => {
      const si = parseInt(sectionIdx);
      const section = sections[si];
      if (!section) return;
      keys.forEach(key => {
        // key format from DraggableTable: "item-{sectionIndex}-{itemId}"
        const itemId = extractItemId(key);
        const itemIndex = section.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
          result.push({ item: section.items[itemIndex], sectionIndex: si, itemIndex });
        }
      });
    });
    return result;
  }, [selectedItemKeys, sections]);

  // Move selected items to a target section
  const handleMoveToSection = useCallback((targetSectionIndex: number) => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;

    const newSections = sections.map((section) => ({ ...section, items: [...section.items] }));
    const targetTitle = newSections[targetSectionIndex].title;
    const itemsToMove = selected.map(s => ({
      ...s.item,
      primary_group: targetTitle,
    }));

    // Remove from source sections
    const removeMap = new Map<number, Set<number>>();
    selected.forEach(s => {
      if (!removeMap.has(s.sectionIndex)) removeMap.set(s.sectionIndex, new Set());
      removeMap.get(s.sectionIndex)!.add(s.itemIndex);
    });

    removeMap.forEach((indices, si) => {
      newSections[si] = {
        ...newSections[si],
        items: newSections[si].items.filter((_, idx) => !indices.has(idx)),
      };
      newSections[si].subtotal = calculateSectionSubtotal(newSections[si].items, newSections[si]);
    });

    // Add to target
    newSections[targetSectionIndex] = {
      ...newSections[targetSectionIndex],
      items: [...newSections[targetSectionIndex].items, ...itemsToMove],
    };
    newSections[targetSectionIndex].subtotal = calculateSectionSubtotal(newSections[targetSectionIndex].items, newSections[targetSectionIndex]);

    setSections(newSections);
    setSelectedItemKeys({});
    message.success(`${selected.length} item(s) moved to "${targetTitle}"`);
  }, [sections, getSelectedItems]);

  // Copy selected items to a target section
  const handleCopyToSection = useCallback((targetSectionIndex: number) => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;

    const targetTitle = sections[targetSectionIndex].title;
    const copiedItems = selected.map(s => ({
      ...s.item,
      id: generateId(),
      primary_group: targetTitle,
    }));

    const newSections = sections.map((section, i) => {
      if (i !== targetSectionIndex) return section;
      const newItems = [...section.items, ...copiedItems];
      return { ...section, items: newItems, subtotal: calculateSectionSubtotal(newItems, section) };
    });

    setSections(newSections);
    setSelectedItemKeys({});
    message.success(`${selected.length} item(s) copied to "${targetTitle}"`);
  }, [sections, getSelectedItems]);

  // Delete all selected items across sections
  const handleDeleteAllSelected = useCallback(() => {
    const selected = getSelectedItems();
    if (selected.length === 0) return;

    Modal.confirm({
      title: 'Delete Selected Items',
      content: `Are you sure you want to delete ${selected.length} selected item(s)?`,
      okText: 'Delete',
      okType: 'danger',
      onOk: () => {
        const removeMap = new Map<number, Set<number>>();
        selected.forEach(s => {
          if (!removeMap.has(s.sectionIndex)) removeMap.set(s.sectionIndex, new Set());
          removeMap.get(s.sectionIndex)!.add(s.itemIndex);
        });

        const newSections = sections.map((section, i) => {
          const indices = removeMap.get(i);
          if (!indices) return section;
          const filteredItems = section.items.filter((_, idx) => !indices.has(idx));
          return { ...section, items: filteredItems, subtotal: calculateSectionSubtotal(filteredItems, section) };
        });

        setSections(newSections);
        setSelectedItemKeys({});
        message.success(`${selected.length} item(s) deleted`);
      },
    });
  }, [sections, getSelectedItems]);

  // Clear all selections
  const handleClearSelection = useCallback(() => {
    setSelectedItemKeys({});
  }, []);

  // Add items to a specific section
  const addItemsToSection = (sectionIndex: number, itemsToAdd: EstimateLineItem[]) => {
    const newSections = [...sections];
    const currentSection = sections[sectionIndex];

    // Convert EstimateLineItem to InvoiceItem and update with section title
    // Ensure each item has a stable unique ID for drag and drop
    const convertedItems: InvoiceItem[] = itemsToAdd.map(item => ({
      id: item.id || generateId(),  // Generate new ID if not provided
      line_item_id: item.line_item_id,  // Preserve line_item_id for template creation
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.unit_price,
      amount: item.total,
      taxable: item.taxable !== false,
      primary_group: currentSection.title,
      secondary_group: item.secondary_group,
      sort_order: item.sort_order,
      note: item.note,  // Include note from line item
    }));

    console.log('Converted items:', convertedItems);
    convertedItems.forEach((item, idx) => {
      console.log(`Converted item ${idx}:`, {
        id: item.id,
        line_item_id: item.line_item_id,
        name: item.name,
        hasLineItemId: !!item.line_item_id
      });
    });

    newSections[sectionIndex].items.push(...convertedItems);
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items, newSections[sectionIndex]);

    setSections(newSections);

    // Auto-expand the section when items are added
    expandSection(currentSection.id);

    return convertedItems.length;
  };

  // Handle adding multiple line items from ItemCodeSelector
  const handleLineItemsAdd = (lineItems: EstimateLineItem[]) => {
    if (editingSectionIndex !== null && lineItems.length > 0) {
      const itemsAdded = addItemsToSection(editingSectionIndex, lineItems);

      resetItemModal();
      message.success(`${itemsAdded} item(s) added successfully`);
    }
  };

  // Handle template application
  const handleTemplateApply = async (template: any) => {
    if (templateTargetSectionIndex === null) {
      message.error('No target section selected');
      return;
    }

    try {
      // Fetch full template details with line items
      const fullTemplate = await lineItemService.getTemplate(template.id);

      // Convert template items to InvoiceItems
      const templateItems: EstimateLineItem[] = fullTemplate.template_items.map((templateItem, index) => {
        // Handle both library references (line_item) and embedded data
        const lineItem = templateItem.line_item;
        const embeddedData = templateItem.embedded_data;

        // Get item data from either source
        const itemName = lineItem?.cat || lineItem?.item || embeddedData?.item_code || '';
        const description = lineItem?.description || embeddedData?.description || '';
        const unit = lineItem?.unit || embeddedData?.unit || 'EA';
        const unitPrice = lineItem?.untaxed_unit_price || embeddedData?.rate || 0;

        return {
          id: undefined, // This is the invoice_line_item id (not created yet)
          line_item_id: lineItem?.id || '', // Reference to master line_item (empty for embedded items)
          name: itemName,
          description: description,
          unit: unit,
          unit_price: unitPrice,
          quantity: templateItem.quantity_multiplier || 1,
          total: (templateItem.quantity_multiplier || 1) * unitPrice,
          taxable: true,
          sort_order: index
        };
      });

      // Add items to the target section
      const itemsAdded = addItemsToSection(templateTargetSectionIndex, templateItems);

      message.success(`Template applied: ${itemsAdded} item(s) added to section`);
      setTemplateSelectorVisible(false);
      setTemplateTargetSectionIndex(null);
    } catch (error: any) {
      message.error(error.message || 'Failed to apply template');
    }
  };

  // Section expansion utility
  const expandSection = (sectionId: string) => {
    if (!activeKeys.includes(sectionId)) {
      setActiveKeys([...activeKeys, sectionId]);
    }
  };

  // Modal state management functions
  const resetItemModal = () => {
    setItemModalVisible(false);
    setEditingItem(null);
    setEditingIndex(null);
    setEditingSectionIndex(null);
    setItemImages([]);
  };

  // Consolidated initialization effect
  useEffect(() => {
    // Companies are loaded via React Query useCompanies hook
    setFormMounted(true);
  }, []);

  // Process fetched invoice data from React Query
  useEffect(() => {
    if (!fetchedInvoice || !isEditMode) return;

    console.log('Processing fetched invoice:', fetchedInvoice);
    const data = fetchedInvoice as any;
    setInvoiceData(data);

    // Convert items to sections or use existing sections.
    // data.sections carries section metadata only (title/order/lump-sum) -
    // items live separately in the flat data.items array (normalized in the
    // invoice_items table) and must be grouped back in by primary_group.
    if (data.sections && data.sections.length > 0) {
      const flatItems = (data.items || []).map((item: any) => {
        const quantity = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate || item.unit_price) || 0;
        const amount = parseFloat(item.amount || item.total) || (quantity * rate);
        return {
          id: item.id,
          line_item_id: item.line_item_id,
          name: item.name || item.description || '',
          description: item.description || item.name || '',
          quantity,
          unit: item.unit || 'EA',
          rate,
          amount,
          taxable: item.taxable !== false,
          primary_group: item.primary_group,
          secondary_group: item.secondary_group,
          sort_order: item.sort_order || 0,
          note: item.note,
        };
      });

      const itemsByGroup: Record<string, InvoiceItem[]> = {};
      flatItems.forEach((item: InvoiceItem) => {
        const group = item.primary_group || 'Default Section';
        if (!itemsByGroup[group]) itemsByGroup[group] = [];
        itemsByGroup[group].push(item);
      });

      const mergedSections: InvoiceSection[] = data.sections.map((sd: any) => {
        const sectionItems = itemsByGroup[sd.title] || [];
        const isLumpSum = sd.isLumpSum ?? false;
        return {
          ...sd,
          items: sectionItems,
          subtotal: isLumpSum
            ? (sd.lumpSumAmount ?? 0)
            : sectionItems.reduce((sum: number, item: InvoiceItem) => {
                const quantity = parseFloat(String(item.quantity)) || 0;
                const rate = parseFloat(String(item.rate)) || 0;
                const amount = parseFloat(String(item.amount)) || (quantity * rate);
                return sum + amount;
              }, 0),
        };
      });

      setSections(mergedSections);
      setActiveKeys(mergedSections.map((s: any) => s.id));
      setItems(flatItems);
    } else if (data.items && data.items.length > 0) {
      const processedItems = data.items.map((item: any) => {
        // Ensure numeric values are properly converted
        const quantity = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate || item.unit_price) || 0;
        const amount = parseFloat(item.amount || item.total) || (quantity * rate);
        
        return {
          id: item.id,
          line_item_id: item.line_item_id, // IMPORTANT: Preserve line_item_id for template creation
          name: item.name || item.description || '',
          description: item.description || item.name || '',
          quantity,
          unit: item.unit || 'EA',
          rate,
          amount,
          taxable: item.taxable !== false,
          primary_group: item.primary_group,
          secondary_group: item.secondary_group,
          sort_order: item.sort_order || 0,
          note: item.note,
        };
      });

      const sectionsFromItems = convertItemsToSections(processedItems);
      setSections(sectionsFromItems);
      setActiveKeys(sectionsFromItems.map(s => s.id));
      setItems(processedItems);
    }

    // Set form values
    const formValues = {
      invoice_number: data.invoice_number,
      date: data.date ? dayjs(data.date) : dayjs(),
      due_date: data.due_date ? dayjs(data.due_date) : dayjs().add(30, 'day'),
      status: data.status || 'pending',
      client_name: data.client_name,
      client_address: data.client_address,
      client_city: data.client_city,
      client_state: data.client_state,
      client_zipcode: data.client_zipcode,
      client_phone: data.client_phone,
      client_email: data.client_email,
      notes: data.notes,
      payment_terms: data.payment_terms,
      tax_rate: parseFloat(data.tax_rate) || 0,
      tax_amount: parseFloat(data.tax_amount) || 0,
      discount: parseFloat(data.discount || data.discount_amount) || 0,
      op_percent: parseFloat(data.op_percent) || 0,
      insurance_company: data.insurance_company || '',
      insurance_policy_number: data.insurance_policy_number || '',
      insurance_claim_number: data.insurance_claim_number || '',
      insurance_deductible: parseFloat(data.insurance_deductible) || 0,
    };
    form.setFieldsValue(formValues);

    // Set tax method and amount
    if (data.tax_method) {
      setTaxMethod(data.tax_method);
      if (data.tax_method === 'percentage') {
        setTaxRate(parseFloat(data.tax_rate) || 0);
      }
      if (data.tax_method === 'specific') {
        setSpecificTaxAmount(parseFloat(data.tax_amount) || 0);
      }
    }

    // Set discount state
    setDiscount(parseFloat(data.discount || data.discount_amount) || 0);

    // Set insurance visibility from DB flag (fallback to data presence for legacy invoices)
    if (data.show_insurance != null) {
      setShowInsurance(data.show_insurance);
    } else if (data.insurance_company || data.insurance_policy_number || data.insurance_claim_number || data.insurance_deductible) {
      setShowInsurance(true);
    }

    // Check if client is from Client management system
    if (data.client_id) {
      clientService.getById(data.client_id).then(client => {
        if (client) {
          setSelectedClientRecord(client as unknown as ClientListItem);
          setClientInputMode('client');
          form.setFieldValue('client_record_selection', data.client_id);
        }
      }).catch(() => {});
    } else if (data.client_company_id && companies.length > 0) {
      // Check if client is a registered company
      const clientCompany = companies.find(c => c.id === data.client_company_id);
      if (clientCompany) {
        setSelectedClient(clientCompany);
        setClientInputMode('company');
        // Set client company selection in form
        form.setFieldValue('client_company_selection', clientCompany.id);
      }
    }

    // Set payments
    if (data.payments && data.payments.length > 0) {
      const processedPayments = data.payments.map((payment: any) => ({
        amount: parseFloat(payment.amount) || 0,
        date: payment.date ? dayjs(payment.date) : null,
        method: payment.method || '',
        reference: payment.reference || '',
        top_note: payment.top_note || '',
        bottom_note: payment.bottom_note || '',
        receipt_number: payment.receipt_number || undefined
      }));
      setPayments(processedPayments);
    }

    // Set payment display option
    if (data.show_payment_dates !== undefined) {
      setShowPaymentDates(data.show_payment_dates);
    }

    // Set O&P percent (for backward compatibility)
    if (data.op_percent !== undefined) {
      setOpPercent(parseFloat(data.op_percent) || 0);
    }

    // Set adjustments if provided
    if (data.adjustments && Array.isArray(data.adjustments) && data.adjustments.length > 0) {
      const loadedAdjustments: Adjustment[] = data.adjustments.map((adj: any, index: number) => {
        const pct = parseFloat(String(adj.percentage)) || 0;
        const fixedAmt = adj.fixed_amount != null ? parseFloat(String(adj.fixed_amount)) : undefined;
        return {
          id: `adj-${Date.now()}-${index}`,
          name: adj.name || '',
          percentage: pct,
          // Default to $ mode when percentage is 0 and no fixed_amount set
          fixedAmount: fixedAmt !== undefined ? fixedAmt : (pct === 0 ? 0 : undefined),
          type: adj.type || 'add',
          order: adj.order || index + 1,
          note: adj.note || '',
        };
      });
      setAdjustments(loadedAdjustments);
    } else {
      setAdjustments([]);
    }
  }, [fetchedInvoice, isEditMode, companies, form]);

  // Consolidated reset and mode switching effect
  useEffect(() => {
    // Only reset state when switching from edit mode to create mode
    // Don't reset when entering edit mode or when id changes
    if (!isEditMode) {
      // Reset all state for create mode
      setInvoiceData(null);
      setItems([]);
      setSections([]);
      setActiveKeys([]);
      setNewSectionTitle('');
      setPayments([]);
      setShowPaymentDates(true);
      setTaxMethod('percentage');
      setTaxRate(0);
      setSpecificTaxAmount(0);
      setOpPercent(0);
      setSelectedCompany(null);
      setSelectedClient(null);
      setSelectedClientRecord(null);
      setClientInputMode('manual');
      setClientSearchResults([]);
      setIsSaving(false);

      // Reset form
      form.resetFields();

      // Set default form values for create mode
      form.setFieldsValue({
        date: dayjs(),
        due_date: dayjs().add(30, 'day'),
        status: 'pending',
        tax_rate: 0,
        discount: 0,
        invoice_number: '', // Will be generated
        op_percent: 0,
      });
    }
    // Invoice loading handled by React Query useInvoice hook in edit mode
  }, [isEditMode, id, form]);

  // Prefill client info when navigated here from a client's detail page
  useEffect(() => {
    if (isEditMode || !presetClient) return;

    const clientRecord = presetClient as unknown as ClientListItem;
    const primaryOwner = presetClient.owners?.find((o) => o.is_primary) || presetClient.owners?.[0];

    setClientInputMode('client');
    setSelectedClientRecord(clientRecord);
    setClientSearchResults([clientRecord]);

    form.setFieldsValue({
      client_record_selection: presetClient.id,
      client_name: presetClient.display_name,
      client_email: presetClient.email || primaryOwner?.email || '',
      client_phone: presetClient.phone || primaryOwner?.phone || '',
      client_address: presetClient.address || '',
      client_city: presetClient.city || '',
      client_state: presetClient.state || '',
      client_zipcode: presetClient.zipcode || '',
      insurance_company: presetClient.insurance_company || '',
      insurance_policy_number: presetClient.insurance_policy_number || '',
    });

    if (presetClient.insurance_company || presetClient.insurance_policy_number) {
      setShowInsurance(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, presetClient, form]);

  // Consolidated company and form population effect
  useEffect(() => {
    if (selectedCompany) {
      const companyFields = {
        company_name: selectedCompany.name,
        company_address: selectedCompany.address,
        company_city: selectedCompany.city,
        company_state: selectedCompany.state,
        company_zipcode: selectedCompany.zipcode,
        company_phone: selectedCompany.phone,
        company_email: selectedCompany.email,
      };

      // In edit mode, also set company_selection
      if (isEditMode && invoiceData?.company_id === selectedCompany.id) {
        form.setFieldsValue({
          company_selection: selectedCompany.id,
          ...companyFields,
        });
      } else {
        form.setFieldsValue(companyFields);
      }

      // Set company ID for template builder context
      setCompanyId(selectedCompany.id);

      // Receipt templates are loaded via React Query useReceiptTemplates hook
    }
  }, [selectedCompany, isEditMode, invoiceData?.company_id, form, setCompanyId]);

  // Consolidated invoice data population effect
  useEffect(() => {
    if (!invoiceData || !isEditMode) return;

    // Set company if available
    if (companies.length > 0 && invoiceData.company_id) {
      const company = companies.find(c => c.id === invoiceData.company_id);
      if (company && company !== selectedCompany) {
        setSelectedCompany(company);
      }
    }

    // Set all invoice form values in a single operation
    form.setFieldsValue({
      invoice_number: invoiceData.invoice_number,
      date: invoiceData.invoice_date ? dayjs(invoiceData.invoice_date) : invoiceData.date ? dayjs(invoiceData.date) : dayjs(),
      due_date: invoiceData.due_date ? dayjs(invoiceData.due_date) : undefined,
      status: invoiceData.status,
      company_id: invoiceData.company_id,
      company_selection: invoiceData.company_id, // Set company_selection for the Select component
      company_name: invoiceData.company_name,
      company_address: invoiceData.company_address,
      company_city: invoiceData.company_city,
      company_state: invoiceData.company_state,
      company_zipcode: invoiceData.company_zipcode,
      company_phone: invoiceData.company_phone,
      company_email: invoiceData.company_email,
      client_name: invoiceData.client_name,
      client_address: invoiceData.client_address,
      client_city: invoiceData.client_city,
      client_state: invoiceData.client_state,
      client_zipcode: invoiceData.client_zipcode,
      client_phone: invoiceData.client_phone,
      client_email: invoiceData.client_email,
      tax_rate: invoiceData.tax_rate || 0,
      discount: invoiceData.discount_amount || invoiceData.discount || 0,
    });
    
    // Also update local state for Select component
    if (invoiceData.company_id) {
      setCompanySelectionValue(invoiceData.company_id);
    }
  }, [invoiceData, isEditMode, companies, form, selectedCompany]);

  const handleCompanyChange = async (companyId: string) => {
    console.log('handleCompanyChange called with:', companyId);
    const company = companies.find(c => c.id === companyId);

    if (company) {
      console.log('Found company:', company);
      
      // Update local state immediately for instant UI update
      setCompanySelectionValue(companyId);
      setSelectedCompany(company);
      
      // Prepare all form updates at once
      const updates: any = {
        company_selection: companyId,
        company_id: company.id,
      };

      // Generate new invoice number based on selected company
      try {
        const newInvoiceNumber = await invoiceService.generateInvoiceNumber(company.id);
        updates.invoice_number = newInvoiceNumber;
      } catch (error) {
        console.error('Failed to generate invoice number:', error);
        if (!isEditMode) {
          // Fallback to default number if API fails (only in create mode)
          const fallbackNumber = `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
          updates.invoice_number = fallbackNumber;
        }
      }

      // Update form fields
      form.setFieldsValue(updates);
      
      console.log('Form values updated:', updates);
    } else {
      console.warn('Company not found for ID:', companyId);
      setCompanySelectionValue(undefined);
    }
  };

  const handleClientSearch = useCallback(async (searchText: string) => {
    if (!searchText || searchText.length < 2) {
      setClientSearchResults([]);
      return;
    }
    setClientSearchLoading(true);
    try {
      const result = await clientService.search(searchText, 20);
      setClientSearchResults(result.clients);
    } catch (error) {
      console.error('Client search failed:', error);
    } finally {
      setClientSearchLoading(false);
    }
  }, []);

  const handleClientSelect = useCallback((clientId: string) => {
    const client = clientSearchResults.find(c => c.id === clientId);
    if (client) {
      setSelectedClientRecord(client);
      const primaryOwner = client.owners?.find(o => o.is_primary) || client.owners?.[0];
      form.setFieldsValue({
        client_name: client.display_name,
        client_email: client.email || primaryOwner?.email || '',
        client_phone: client.phone || primaryOwner?.phone || '',
        client_address: client.address || '',
        client_city: client.city || '',
        client_state: client.state || '',
        client_zipcode: client.zipcode || '',
      });
    }
  }, [clientSearchResults, form]);

  const handleAddItem = () => {
    setEditingItem(null);
    setEditingIndex(null);
    setItemModalVisible(true);
  };

  const handleEditItem = (item: InvoiceItem, index: number) => {
    setEditingItem(item);
    setEditingIndex(index);
    itemForm.setFieldsValue({
      ...item,
      rate: typeof item.rate === 'string' ? parseFloat(item.rate) || 0 : item.rate,
      quantity: typeof item.quantity === 'string' ? parseFloat(item.quantity) || 1 : item.quantity,
    });
    setItemImages(item.images || []);
    setItemModalVisible(true);
  };

  // Helper function to generate item code from description
  const generateItemCode = (description: string): string => {
    if (!description?.trim()) {
      return `ITEM_${Date.now().toString().slice(-6)}`;
    }
    
    // Extract alphanumeric words only
    const words = description.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0);
    
    if (words.length === 0) {
      return `ITEM_${Date.now().toString().slice(-6)}`;
    }
    
    let code = '';
    if (words.length === 1) {
      // Single word: take first 7 characters
      code = words[0].substring(0, 7);
    } else if (words.length === 2) {
      // Two words: 4 chars from first + 3 from second
      code = words[0].substring(0, 4) + words[1].substring(0, 3);
    } else {
      // Multiple words: 3+2+2 from first 3 words
      code = words.slice(0, 3).map((word, index) => {
        if (index === 0) return word.substring(0, 3);
        return word.substring(0, 2);
      }).join('');
    }
    
    // Ensure max 7 characters
    if (code.length > 7) {
      code = code.substring(0, 7);
    }
    
    // If too short, pad with timestamp
    if (code.length < 3) {
      code += Date.now().toString().slice(-2);
    }
    
    return code;
  };

  // Convert file to base64 data URL
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle image upload for line item
  const handleItemImageUpload = async (file: File) => {
    try {
      const url = await fileToBase64(file);
      const newImage: LineItemImage = {
        id: generateId(),
        title: file.name.replace(/\.[^/.]+$/, ''), // filename without extension
        url,
        order_index: itemImages.length,
      };
      setItemImages((prev) => [...prev, newImage]);
    } catch (error) {
      message.error('Failed to load image');
    }
    return false; // prevent default upload
  };

  const handleItemSubmit = async () => {
    if (editingSectionIndex === null) {
      message.error('Please select a section to add the item to');
      return;
    }

    try {
      const values = await itemForm.validateFields();

      // Comprehensive validation with user-friendly error messages

      // Auto-generate item code from description if not provided
      if (!values.name || values.name.toString().trim() === '') {
        // Try to extract meaningful text from description field for code generation
        const descriptionText = values.description ? 
          (typeof values.description === 'string' ? values.description : values.description.toString()) : '';
        const plainText = descriptionText.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags
        
        if (plainText) {
          values.name = generateItemCode(plainText);
          console.log('Auto-generated item code:', values.name);
        } else {
          // If no description either, generate a generic code
          values.name = `ITEM_${Date.now().toString().slice(-6)}`;
        }
      }

      // Validate quantity
      if (!values.quantity || values.quantity <= 0) {
        message.error('Please enter a valid quantity greater than 0');
        return;
      }

      // Validate unit
      if (!values.unit || values.unit.toString().trim() === '') {
        message.error('Please select a unit for the item');
        return;
      }

      // Validate rate (allow negative for discounts/credits)
      if (values.rate === null || values.rate === undefined) {
        message.error('Please enter a valid rate');
        return;
      }

      // Additional validation for numeric values
      if (isNaN(values.quantity) || isNaN(values.rate)) {
        message.error('Quantity and rate must be valid numbers');
        return;
      }

      let lineItemId: string | undefined = undefined;

      // Preserve existing line_item_id when editing
      if (editingIndex !== null && editingItem?.line_item_id) {
        lineItemId = editingItem.line_item_id;
      }

      // Save to database if checkbox is checked
      // Note: If not saving to database, we don't need to create a line_item record
      if (values.saveToDatabase) {
        const lineItemData = {
          type: LineItemType.CUSTOM, // Always CUSTOM for manually added items
          cat: undefined, // No category for custom items (will be NULL in DB)
          item: values.name ? values.name.toString().trim() : undefined, // Item code (optional)
          description: values.description ? values.description.toString().trim() : values.name.toString().trim(),
          includes: values.note ? values.note.toString().trim() : '',
          unit: values.unit,
          untaxed_unit_price: Number(values.rate),
          company_id: selectedCompany?.id,
          is_active: true,
          note_ids: [],
        };

        try {
          const result = await lineItemService.upsertLineItem(lineItemData);
          lineItemId = result.line_item.id;
          console.log('Saved line item with ID:', lineItemId, 'Created:', result.is_created);
          message.success(result.message);
        } catch (error) {
          console.error('Failed to save line item to library:', error);
          message.warning('Item will be added to invoice but not saved to library');
        }
      }

      // Process note: keep if it has actual text content (strip HTML tags to check)
      const rawNote = values.note || '';
      const noteTextContent = rawNote.replace(/<[^>]*>/g, '').trim();
      const processedNote = noteTextContent ? rawNote : undefined;

      const newItem: InvoiceItem = {
        ...values,
        // Preserve existing ID when editing, generate new one for new items
        id: editingItem?.id || generateId(),
        line_item_id: lineItemId, // Set line_item_id from created library item or preserved from editing
        name: values.name.toString().trim(),
        description: values.description ? values.description.toString().trim() : '',
        note: processedNote,
        quantity: Number(values.quantity),
        rate: Number(values.rate),
        amount: Number(values.quantity) * Number(values.rate),
        taxable: values.taxable !== false, // Default to taxable if not specified
        primary_group: sections[editingSectionIndex]?.title,
        images: itemImages.length > 0 ? itemImages : undefined,
      };

      console.log('Created invoice item:', { line_item_id: newItem.line_item_id, note: newItem.note });

      const newSections = [...sections];

      if (editingIndex !== null) {
        // Edit existing item
        newSections[editingSectionIndex].items[editingIndex] = newItem;
        message.success('Item updated successfully');
      } else {
        // Add new item
        newSections[editingSectionIndex].items.push(newItem);
        message.success('Item added successfully');
      }

      // Recalculate section subtotal
      newSections[editingSectionIndex].subtotal = calculateSectionSubtotal(newSections[editingSectionIndex].items, newSections[editingSectionIndex]);
      setSections(newSections);

      // Auto-expand the section when an item is added
      const sectionId = sections[editingSectionIndex].id;
      expandSection(sectionId);

      resetItemModal();
    } catch (error: any) {
      console.error('Item validation failed:', error);

      // Handle specific validation errors
      if (error.errorFields && error.errorFields.length > 0) {
        const firstError = error.errorFields[0];
        if (firstError.name && firstError.name.length > 0) {
          const fieldName = firstError.name[0];
          const errorMessages = firstError.errors || [];

          if (fieldName === 'name') {
            message.error('Please enter a valid item code');
          } else if (fieldName === 'quantity') {
            message.error('Please enter a valid quantity greater than 0');
          } else if (fieldName === 'unit') {
            message.error('Please select a unit for the item');
          } else if (fieldName === 'rate') {
            message.error('Please enter a valid rate greater than $0');
          } else if (errorMessages.length > 0) {
            message.error(errorMessages[0]);
          } else {
            message.error('Please fill in all required item information');
          }
        } else {
          message.error('Please fill in all required item information');
        }
      } else {
        message.error('Please fill in all required item information');
      }
    }
  };



  const handleAddPayment = () => {
    setEditingPayment(null);
    setEditingPaymentIndex(null);
    setPaymentModalVisible(true);
  };

  const handleEditPayment = (payment: PaymentRecord, index: number) => {
    setEditingPayment(payment);
    setEditingPaymentIndex(index);
    setPaymentModalVisible(true);
  };

  const handlePaymentSubmit = () => {
    paymentForm.validateFields().then(values => {
      // Validate payment amount
      if (!values.amount || values.amount <= 0) {
        message.error('Please enter a valid payment amount greater than $0');
        return;
      }

      // Date is now optional - no validation needed

      const newPayment: PaymentRecord = {
        amount: values.amount,
        date: values.date || null,
        method: values.method || '',
        reference: values.reference || '',
        top_note: values.top_note || '',
        bottom_note: values.bottom_note || '',
        receipt_number: editingPayment?.receipt_number,  // Preserve existing receipt number
      };

      if (editingPaymentIndex !== null) {
        const updatedPayments = [...payments];
        updatedPayments[editingPaymentIndex] = newPayment;
        setPayments(updatedPayments);
        message.success('Payment updated successfully');
      } else {
        setPayments([...payments, newPayment]);
        message.success('Payment added successfully');
      }

      setPaymentModalVisible(false);
      paymentForm.resetFields();
      setEditingPayment(null);
      setEditingPaymentIndex(null);
    }).catch(error => {
      console.error('Payment validation failed:', error);
      message.error('Please fill in all required payment information');
    });
  };

  const handleDeletePayment = (index: number) => {
    const updatedPayments = payments.filter((_, i) => i !== index);
    setPayments(updatedPayments);
  };

  // Adjustments handlers
  const handleAddAdjustment = () => {
    const newAdjustment: Adjustment = {
      id: `adj-${Date.now()}`,
      name: '',
      percentage: 0,
      fixedAmount: 0,
      type: 'add',
      order: adjustments.length + 1,
    };
    setAdjustments([...adjustments, newAdjustment]);
  };

  const handleRemoveAdjustment = (id: string) => {
    setAdjustments(adjustments.filter(adj => adj.id !== id));
  };

  const handleAdjustmentChange = (id: string, field: keyof Adjustment, value: any) => {
    setAdjustments(prev => prev.map(adj =>
      adj.id === id ? { ...adj, [field]: value } : adj
    ));
  };

  const calculateTotals = useCallback(() => {
    // Calculate subtotal from sections (ensure numeric)
    const itemsSubtotal = sections.reduce((sum, section) => {
      const sectionSubtotal = parseFloat(String(section.subtotal)) || 0;
      return sum + sectionSubtotal;
    }, 0);

    // Apply adjustments in order (new flexible system)
    let currentSubtotal = itemsSubtotal;
    const calculatedAdjustments = adjustments
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(adj => {
        // Use fixedAmount if percentage is 0 and fixedAmount is set
        const amount = (adj.percentage !== 0)
          ? currentSubtotal * (Math.abs(adj.percentage) / 100)
          : Math.abs(adj.fixedAmount || 0);
        if (adj.type === 'subtract' || adj.percentage < 0) {
          currentSubtotal -= amount;
        } else {
          currentSubtotal += amount;
        }
        return { ...adj, amount };
      });

    // Backward compatibility: apply op_percent and discount if no adjustments
    let opAmount = 0;
    let discountAmount = 0;
    
    if (adjustments.length === 0) {
      // Use legacy op_percent and discount
      const opPercentNum = parseFloat(String(opPercent)) || 0;
      opAmount = itemsSubtotal * (opPercentNum / 100);
      currentSubtotal = itemsSubtotal + opAmount;
      
      const discountNum = parseFloat(String(discount)) || 0;
      discountAmount = discountNum;
      currentSubtotal -= discountAmount;
    }

    // Calculate tax on adjusted subtotal
    let taxAmount = 0;
    if (taxMethod === 'percentage') {
      // Calculate tax on taxable items only
      const taxableAmount = sections.reduce((sum, section) => {
        if (section.isLumpSum) {
          return sum + (section.taxable !== false ? (section.lumpSumAmount || 0) : 0);
        }
        return sum + section.items.reduce((itemSum, item) => {
          if (item.taxable !== false) { // Default to taxable if not specified
            const quantity = parseFloat(String(item.quantity)) || 0;
            const rate = parseFloat(String(item.rate)) || 0;
            const amount = parseFloat(String(item.amount)) || (quantity * rate);
            return itemSum + amount;
          }
          return itemSum;
        }, 0);
      }, 0);

      if (taxableAmount > 0 && itemsSubtotal > 0) {
        const taxableRatio = taxableAmount / itemsSubtotal;
        
        // Apply adjustments proportionally to taxable amount
        let taxableCurrent = taxableAmount;
        
        if (adjustments.length > 0) {
          for (const adj of calculatedAdjustments) {
            const taxableAdjAmount = (adj.percentage !== 0)
              ? taxableCurrent * (Math.abs(adj.percentage) / 100)
              : Math.abs(adj.fixedAmount || 0) * taxableRatio;
            if (adj.type === 'subtract' || adj.percentage < 0) {
              taxableCurrent -= taxableAdjAmount;
            } else {
              taxableCurrent += taxableAdjAmount;
            }
          }
        } else {
          // Legacy: apply op_percent and discount proportionally
          const taxableOpAmount = taxableAmount * (parseFloat(String(opPercent)) || 0) / 100;
          taxableCurrent = taxableAmount + taxableOpAmount;
          const taxableDiscount = discountAmount * taxableRatio;
          taxableCurrent -= taxableDiscount;
        }
        
        const taxRateNum = parseFloat(String(taxRate)) || 0;
        taxAmount = taxableCurrent * (taxRateNum / 100);
      }
    } else {
      taxAmount = parseFloat(String(specificTaxAmount)) || 0;
    }

    // Final subtotal includes Items + Adjustments + Tax
    const subtotal = currentSubtotal + taxAmount;

    // Total is subtotal (payments are tracked separately)
    const total = subtotal;
    const totalPaid = payments.reduce((sum, payment) => {
      const paymentAmount = parseFloat(String(payment.amount)) || 0;
      return sum + paymentAmount;
    }, 0);
    const balanceDue = total - totalPaid;

    return {
      itemsSubtotal,
      adjustments: calculatedAdjustments,
      opAmount, // For backward compatibility
      subtotal,
      discount: discountAmount, // For backward compatibility
      taxAmount,
      total,
      totalPaid,
      balanceDue,
    };
  }, [sections, adjustments, taxMethod, taxRate, specificTaxAmount, discount, payments, form, formMounted, opPercent]);

  const handleSave = async (status: string = 'pending', skipNavigation: boolean = false) => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();

      const totals = calculateTotals();

      // Prepare invoice data
      // Use company_id from form values (set by handleCompanyChange) or selectedCompany
      const companyId = values.company_id || values.company_selection || selectedCompany?.id;
      if (!companyId) {
        message.error('Please select a company');
        setIsSaving(false);
        return null;
      }

      const invoiceData: any = {
        invoice_number: values.invoice_number,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        status,
        company_id: companyId, // Use company_id from form or selectedCompany
      };

      // Add client info based on input mode
      if (clientInputMode === 'client' && selectedClientRecord) {
        // Client management system selection
        const primaryOwner = selectedClientRecord.owners?.find(o => o.is_primary) || selectedClientRecord.owners?.[0];
        invoiceData.client = {
          name: selectedClientRecord.display_name,
          address: selectedClientRecord.address || '',
          city: selectedClientRecord.city || '',
          state: selectedClientRecord.state || '',
          zipcode: selectedClientRecord.zipcode || '',
          phone: selectedClientRecord.phone || (primaryOwner?.phone || ''),
          email: selectedClientRecord.email || (primaryOwner?.email || ''),
        };
        invoiceData.client_id = selectedClientRecord.id;
      } else if (clientInputMode === 'company' && selectedClient) {
        // Company selection mode
        invoiceData.client = {
          name: selectedClient.name,
          address: selectedClient.address || '',
          city: selectedClient.city || '',
          state: selectedClient.state || '',
          zipcode: selectedClient.zipcode || '',
          phone: selectedClient.phone || '',
          email: selectedClient.email || '',
        };
        invoiceData.client_company_id = selectedClient.id;
      } else {
        // Manual input mode - get from form fields
        invoiceData.client = {
          name: values.client_name,
          address: values.client_address,
          city: values.client_city,
          state: values.client_state,
          zipcode: values.client_zipcode,
          phone: values.client_phone,
          email: values.client_email,
        };
      }

      invoiceData.show_insurance = showInsurance;
      invoiceData.insurance = showInsurance ? {
        company: values.insurance_company,
        policy_number: values.insurance_policy_number,
        claim_number: values.insurance_claim_number,
        deductible: values.insurance_deductible,
      } : null;

      // Send both items (converted from sections) and sections
      const allItems = convertSectionsToItems().map(item => ({
        ...item,
        name: item.name || item.description || '',
        description: item.description || item.name || '',
      }));
      invoiceData.items = allItems;
      invoiceData.sections = sections;
      invoiceData.subtotal = totals.subtotal;
      // Add adjustments if provided, otherwise use legacy op_percent and discount
      if (adjustments.length > 0) {
        invoiceData.adjustments = adjustments.map(adj => ({
          name: adj.name,
          percentage: adj.percentage,
          fixed_amount: adj.fixedAmount ?? null,
          type: adj.type,
          order: adj.order,
          note: adj.note || '',
        }));
      } else {
        // Backward compatibility
        invoiceData.op_percent = opPercent;
      }
      invoiceData.tax_method = taxMethod;
      invoiceData.tax_rate = taxMethod === 'percentage' ? taxRate : 0;
      invoiceData.tax_amount = taxMethod === 'specific' ? (values.tax_amount || 0) : totals.taxAmount;
      
      // Add discount for backward compatibility (only if no adjustments)
      if (adjustments.length === 0) {
        invoiceData.discount = values.discount || 0;
        invoiceData.discount_amount = values.discount || 0;
      }
      
      invoiceData.total = totals.total;
      invoiceData.payments = payments.map(payment => ({
        amount: payment.amount,
        date: payment.date ? payment.date.format('MM-DD-YYYY') : null,
        method: payment.method,
        reference: payment.reference,
        top_note: payment.top_note,
        bottom_note: payment.bottom_note,
        receipt_number: payment.receipt_number
      }));
      invoiceData.show_payment_dates = showPaymentDates;
      invoiceData.balance_due = totals.balanceDue;
      invoiceData.payment_terms = values.payment_terms;
      invoiceData.notes = values.notes;

      // Safe JSON stringify with error handling
      try {
        console.log('Sending invoice data:', JSON.stringify(invoiceData, null, 2));
      } catch (error) {
        console.log('Sending invoice data (stringify failed):', invoiceData);
      }

      let response;
      if (isEditMode && id) {
        // Update existing invoice using mutation (invalidates cache automatically)
        response = await updateInvoiceMutation.mutateAsync(invoiceData);
        message.success('Invoice updated successfully!');
      } else {
        // Create new invoice using mutation
        response = await createInvoiceMutation.mutateAsync(invoiceData);
        message.success('Invoice saved successfully!');
      }

      if (!skipNavigation) {
        if (isEditMode) {
          // Stay on edit page — React Query cache invalidation triggers refetch
        } else {
          navigate(`/documents/invoice`);
        }
      }

      return response;
    } catch (error) {
      message.error('Failed to save invoice');
      console.error(error);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handlePreviewHTML = async () => {
    try {
      setIsPreviewing(true);
      const values = await form.validateFields();

      // Validate company information
      if (!selectedCompany) {
        message.error('Please select a company');
        setIsPreviewing(false);
        return;
      }

      const totals = calculateTotals();

      const pdfData = {
        invoice_number: values.invoice_number || `INV-${dayjs().format('YYYYMMDDHHmmss')}`,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        company: {
          name: selectedCompany.name,
          address: selectedCompany.address || '',
          city: selectedCompany.city || '',
          state: selectedCompany.state || '',
          zipcode: selectedCompany.zipcode || '',
          phone: selectedCompany.phone || '',
          email: selectedCompany.email || '',
          logo: selectedCompany.logo || '',
        },
        client: clientInputMode === 'client' && selectedClientRecord ? {
          name: selectedClientRecord.display_name,
          address: selectedClientRecord.address || '',
          city: selectedClientRecord.city || '',
          state: selectedClientRecord.state || '',
          zipcode: selectedClientRecord.zipcode || '',
          phone: selectedClientRecord.phone || (selectedClientRecord.owners?.find(o => o.is_primary)?.phone || selectedClientRecord.owners?.[0]?.phone || ''),
          email: selectedClientRecord.email || (selectedClientRecord.owners?.find(o => o.is_primary)?.email || selectedClientRecord.owners?.[0]?.email || ''),
        } : clientInputMode === 'company' && selectedClient ? {
          name: selectedClient.name,
          address: selectedClient.address || '',
          city: selectedClient.city || '',
          state: selectedClient.state || '',
          zipcode: selectedClient.zipcode || '',
          phone: selectedClient.phone || '',
          email: selectedClient.email || '',
        } : {
          name: values.client_name,
          address: values.client_address,
          city: values.client_city,
          state: values.client_state,
          zipcode: values.client_zipcode,
          phone: values.client_phone,
          email: values.client_email,
        },
        show_insurance: showInsurance,
        insurance: showInsurance ? {
          company: values.insurance_company,
          policy_number: values.insurance_policy_number,
          claim_number: values.insurance_claim_number,
          deductible: values.insurance_deductible,
        } : null,
        items: convertSectionsToItems(),
        sections: sections.map(section => ({
          id: section.id,
          title: section.title,
          items: section.items,
          showSubtotal: section.showSubtotal !== false,
          subtotal: section.subtotal || section.items.reduce((sum, item) => sum + (item.quantity * item.rate), 0),
          isLumpSum: section.isLumpSum || false,
          lumpSumAmount: section.isLumpSum ? (section.lumpSumAmount ?? 0) : undefined,
          taxable: section.taxable ?? true,
        })),
        subtotal: totals.subtotal,
        adjustments: adjustments.length > 0 ? adjustments.map(adj => ({
          name: adj.name,
          percentage: adj.percentage,
          fixed_amount: adj.fixedAmount ?? null,
          type: adj.type,
          order: adj.order,
          note: adj.note || '',
        })) : undefined,
        op_percent: adjustments.length === 0 ? opPercent : 0, // For backward compatibility
        tax_method: taxMethod,
        tax_rate: taxMethod === 'percentage' ? taxRate : 0,
        tax_amount: taxMethod === 'specific' ? (values.tax_amount || 0) : totals.taxAmount,
        discount: adjustments.length === 0 ? (values.discount || 0) : 0, // For backward compatibility
        discount_amount: adjustments.length === 0 ? (values.discount || 0) : 0, // For backward compatibility
        total: totals.total,
        payments: payments.map(payment => ({
          amount: payment.amount,
          date: payment.date ? payment.date.format('MM-DD-YYYY') : null,
          method: payment.method,
          reference: payment.reference,
          top_note: payment.top_note,
          bottom_note: payment.bottom_note,
          receipt_number: payment.receipt_number
        })),
        show_payment_dates: showPaymentDates,
        balance_due: totals.balanceDue,
        payment_terms: values.payment_terms,
        notes: values.notes,
      };

      const htmlContent = await invoiceService.previewHTML(pdfData);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      message.error('Failed to generate HTML preview');
      console.error(error);
    } finally {
      setIsPreviewing(false);
    }
  };

  // Removed handleGenerateReceiptPDF - use payment-specific receipt generation instead

  // Generate receipt for a specific payment
  const handleGeneratePaymentReceipt = async (paymentIndex: number) => {
    if (!isEditMode || !id) {
      message.error('Please save the invoice first before generating a receipt');
      return;
    }

    const payment = payments[paymentIndex];
    if (!payment || payment.amount <= 0) {
      message.error('Invalid payment amount');
      return;
    }

    try {
      setGeneratingReceipt(true);

      let receipt;

      // Check if receipt already exists for this payment (Regenerate case)
      if (payment.receipt_number) {
        console.log('Regenerating receipt with receipt_number:', payment.receipt_number);

        // Get the specific receipt by number - more efficient than fetching all receipts
        try {
          const existingReceipt = await receiptService.getReceiptByNumber(id, payment.receipt_number);

          if (existingReceipt) {
            // Update existing receipt with latest payment data
            const updateData = {
              receipt_date: payment.date ? payment.date.format('YYYY-MM-DD') : undefined,
              payment_amount: payment.amount,
              payment_method: payment.method || undefined,
              payment_reference: payment.reference || undefined,
              top_note: payment.top_note || undefined,
              bottom_note: payment.bottom_note || undefined,
            };

            receipt = await receiptService.updateReceipt(existingReceipt.id, updateData);
            message.success('Receipt updated successfully!');
          }
        } catch (error) {
          // Receipt not found, will generate new one below
          console.log('Receipt not found, will generate new one');
        }
      }

      // If no existing receipt found, generate new receipt
      if (!receipt) {
        const receiptData = {
          invoice_id: id,
          template_id: selectedTemplateId || undefined,
          receipt_date: payment.date ? payment.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
          payment_amount: payment.amount,
          payment_method: payment.method || undefined,
          payment_reference: payment.reference || undefined,
          receipt_number: payment.receipt_number || undefined,  // Use existing receipt_number if available
          top_note: payment.top_note || undefined,
          bottom_note: payment.bottom_note || undefined,
        };

        receipt = await receiptService.generateReceipt(receiptData);
        message.success('Receipt generated successfully!');

        // Update payment with receipt number
        const updatedPayments = [...payments];
        updatedPayments[paymentIndex] = {
          ...payment,
          receipt_number: receipt.receipt_number
        };
        setPayments(updatedPayments);

        // Save the updated payments to invoice
        if (id) {
          try {
            const paymentsToSave = updatedPayments.map(p => ({
              amount: p.amount,
              date: p.date?.format('YYYY-MM-DD') || null,
              method: p.method,
              reference: p.reference,
              top_note: p.top_note,
              bottom_note: p.bottom_note,
              receipt_number: p.receipt_number
            }));

            console.log('Saving payments to invoice:', paymentsToSave);

            await invoiceService.updateInvoice(id, {
              payments: paymentsToSave
            });

            console.log('Successfully saved receipt number to invoice');
          } catch (updateError: any) {
            console.error('Failed to save receipt number to invoice:', updateError);
            console.error('Error details:', updateError.response?.data || updateError.message);
            message.warning('Receipt generated but failed to update invoice. Please refresh the page.');
          }
        }
      }

      // Generate and open PDF
      const pdfBlob = await receiptService.generateReceiptPDF(receipt.id);
      const url = window.URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');

    } catch (error: any) {
      message.error(`Failed to generate receipt: ${error.response?.data?.detail || error.message}`);
      console.error('Receipt generation error:', error);
    } finally {
      setGeneratingReceipt(false);
    }
  };

  // Preview receipt for a specific payment (without saving)
  const handlePreviewPaymentReceipt = async (paymentIndex: number) => {
    if (!isEditMode || !id) {
      message.error('Please save the invoice first before previewing a receipt');
      return;
    }

    const payment = payments[paymentIndex];
    if (!payment || payment.amount <= 0) {
      message.error('Invalid payment amount');
      return;
    }

    try {
      setIsPreviewingReceipt(true);

      // Use existing invoiceData if available, only fetch if null
      let currentInvoiceData = invoiceData;
      if (!currentInvoiceData) {
        currentInvoiceData = await invoiceService.getInvoice(id);
      }

      // Convert current payments state to API format for preview
      const paymentsForPreview = payments.map(p => ({
        amount: p.amount,
        date: p.date ? p.date.format('YYYY-MM-DD') : null,
        method: p.method,
        reference: p.reference,
        receipt_number: p.receipt_number,
        top_note: p.top_note,
        bottom_note: p.bottom_note
      }));

      // Create preview data structure similar to invoice preview
      // Include current payments state for payment history display
      const receiptPreviewData = {
        ...currentInvoiceData,
        receipt_number: payment.receipt_number || `PREVIEW-${Date.now()}`,
        receipt_date: payment.date ? payment.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        payment_amount: payment.amount,
        payment_method: payment.method,
        payment_reference: payment.reference,
        top_note: payment.top_note,
        bottom_note: payment.bottom_note,
        // Override payments with current state to include newly added payments
        payments: paymentsForPreview
      };

      // Clean up any existing blob URL first
      if (receiptPdfBlobUrl) {
        window.URL.revokeObjectURL(receiptPdfBlobUrl);
        setReceiptPdfBlobUrl(null);
      }

      // Use receipt PDF preview service to get PDF blob
      const blob = await receiptService.previewPDF(receiptPreviewData);

      // Create blob URL for iframe preview
      const url = window.URL.createObjectURL(blob);
      setReceiptPdfBlobUrl(url);
      setReceiptPreviewVisible(true);

    } catch (error: any) {
      message.error(`Failed to preview receipt: ${error.response?.data?.detail || error.message}`);
      console.error('Receipt preview error:', error);
    } finally {
      setIsPreviewingReceipt(false);
    }
  };

  // Clean up blob URL when closing receipt preview modal
  const handleCloseReceiptPreview = () => {
    setReceiptPreviewVisible(false);
    // Delay cleanup to ensure modal close animation completes
    setTimeout(() => {
      if (receiptPdfBlobUrl) {
        window.URL.revokeObjectURL(receiptPdfBlobUrl);
        setReceiptPdfBlobUrl(null);
      }
    }, 300);
  };

  // Generate filename with client street address
  const generatePdfFilename = (type: 'invoice' | 'receipt', receiptNumber?: string) => {
    const clientAddress = form.getFieldValue('client_address') || '';
    // Extract street address (first line before comma or newline)
    const streetAddress = clientAddress.split(/[,\n]/)[0].trim();
    const sanitizedAddress = streetAddress.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');

    if (type === 'receipt' && receiptNumber) {
      return sanitizedAddress
        ? `${sanitizedAddress}_receipt_${receiptNumber}.pdf`
        : `receipt_${receiptNumber}.pdf`;
    } else {
      const invoiceNumber = form.getFieldValue('invoice_number') || 'draft';
      return sanitizedAddress
        ? `${sanitizedAddress}_invoice_${invoiceNumber}.pdf`
        : `invoice_${invoiceNumber}.pdf`;
    }
  };

  // Download receipt PDF
  const handleDownloadReceiptPdf = () => {
    if (receiptPdfBlobUrl) {
      const link = document.createElement('a');
      link.href = receiptPdfBlobUrl;
      link.download = generatePdfFilename('receipt', 'preview');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success('Receipt PDF downloaded');
    }
  };

  // View receipt PDF in new window/tab (for already generated receipts)
  const handleViewPaymentReceipt = async (paymentIndex: number) => {
    const payment = payments[paymentIndex];
    if (!payment.receipt_number) {
      message.error('No receipt has been generated yet');
      return;
    }

    if (!isEditMode || !id) {
      message.error('Please save the invoice first');
      return;
    }

    try {
      setIsPreviewingReceipt(true);

      // Use existing invoiceData if available, only fetch if null
      let currentInvoiceData = invoiceData;
      if (!currentInvoiceData) {
        currentInvoiceData = await invoiceService.getInvoice(id);
      }

      // Convert current payments state to API format
      const paymentsForPreview = payments.map(p => ({
        amount: p.amount,
        date: p.date ? p.date.format('YYYY-MM-DD') : null,
        method: p.method,
        reference: p.reference,
        receipt_number: p.receipt_number,
        top_note: p.top_note,
        bottom_note: p.bottom_note
      }));

      // Create receipt data structure
      const receiptData = {
        ...currentInvoiceData,
        receipt_number: payment.receipt_number,
        receipt_date: payment.date ? payment.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        payment_amount: payment.amount,
        payment_method: payment.method,
        payment_reference: payment.reference,
        top_note: payment.top_note,
        bottom_note: payment.bottom_note,
        payments: paymentsForPreview
      };

      // Get PDF blob
      const blob = await receiptService.previewPDF(receiptData);
      const url = window.URL.createObjectURL(blob);

      // Generate filename for download
      const filename = generatePdfFilename('receipt', payment.receipt_number);

      // Open in new window with blob URL
      const newWindow = window.open(url, '_blank', 'noopener,noreferrer');

      if (!newWindow) {
        // If popup blocked, try alternative method with download
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        message.info('Receipt downloaded (popup was blocked)');
      } else {
        message.success('Receipt opened in new tab');
      }

      // Clean up blob URL after sufficient delay
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 5000);

    } catch (error: any) {
      message.error(`Failed to view receipt: ${error.response?.data?.detail || error.message}`);
      console.error('Receipt view error:', error);
    } finally {
      setIsPreviewingReceipt(false);
    }
  };

  const handleGenerateReceipt = async () => {
    if (!isEditMode || !id) {
      message.error('Please save the invoice first before generating a receipt');
      return;
    }

    if (!receiptDate) {
      message.error('Please select a receipt date');
      return;
    }

    if (totals.totalPaid <= 0) {
      message.error('Payment amount must be greater than 0');
      return;
    }

    const receiptData = {
      invoice_id: id,
      template_id: selectedTemplateId || undefined,
      receipt_date: receiptDate.format('YYYY-MM-DD'),
      payment_amount: totals.totalPaid,
      top_note: receiptTopNote || undefined,
      bottom_note: receiptBottomNote || undefined,
    };

    try {
      setGeneratingReceipt(true);

      const receipt = await receiptService.generateReceipt(receiptData);
      message.success('Receipt generated successfully!');

      // Open receipt PDF in new tab
      const pdfUrl = receiptService.getReceiptPdfUrl(receipt.id);
      window.open(pdfUrl, '_blank');

      // Reload invoice data
      if (id) {
        const updatedInvoice = await invoiceService.getInvoice(id);
        setInvoiceData(updatedInvoice);
      }
    } catch (error: any) {
      console.error('Failed to generate receipt:', error);
      console.error('Error response:', error.response?.data);
      console.error('Receipt data sent:', receiptData);
      const errorDetail = error.response?.data?.detail;
      const errorMsg = typeof errorDetail === 'string'
        ? errorDetail
        : JSON.stringify(errorDetail) || error.message;
      message.error(`Failed to generate receipt: ${errorMsg}`);
    } finally {
      setGeneratingReceipt(false);
    }
  };

  // JSON paste handler - parses pasted JSON and fills the form
  const handleJsonPaste = () => {
    setJsonPasteError(null);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonPasteValue);
    } catch (e) {
      setJsonPasteError('Invalid JSON format. Please check your JSON syntax.');
      return;
    }

    try {
      // 1. Client info
      if (parsed.client) {
        const c = parsed.client;
        setClientInputMode('manual');
        form.setFieldsValue({
          client_name: c.name || '',
          client_address: c.address || '',
          client_city: c.city || '',
          client_state: c.state || '',
          client_zipcode: c.zipcode || '',
          client_phone: c.phone || '',
          client_email: c.email || '',
        });
      }

      // 2. Insurance info
      if (parsed.insurance) {
        const ins = parsed.insurance;
        setShowInsurance(true);
        form.setFieldsValue({
          insurance_company: ins.company || '',
          insurance_policy_number: ins.policy_number || '',
          insurance_claim_number: ins.claim_number || '',
          insurance_deductible: ins.deductible || 0,
        });
      }

      // 3. Sections & items
      if (parsed.sections && Array.isArray(parsed.sections)) {
        const newSections: InvoiceSection[] = parsed.sections.map((sec: any, sIdx: number) => ({
          id: generateId(),
          title: sec.title || `Section ${sIdx + 1}`,
          showSubtotal: true,
          sort_order: sIdx,
          items: (sec.items || []).map((item: any, iIdx: number) => ({
            name: item.name || item.description || '',
            description: item.description || item.name || '',
            quantity: parseFloat(item.quantity) || 1,
            unit: (item.unit || 'EA').toUpperCase(),
            rate: parseFloat(item.rate) || 0,
            amount: (parseFloat(item.quantity) || 1) * (parseFloat(item.rate) || 0),
            taxable: item.taxable !== false,
            primary_group: sec.title || `Section ${sIdx + 1}`,
            sort_order: iIdx,
            note: item.note || '',
          })),
          subtotal: (sec.items || []).reduce((sum: number, item: any) =>
            sum + (parseFloat(item.quantity) || 1) * (parseFloat(item.rate) || 0), 0),
        }));
        setSections(newSections);
        setActiveKeys(newSections.map(s => s.id));
      }

      // 4. Tax
      if (parsed.tax_rate !== undefined) {
        setTaxMethod('percentage');
        setTaxRate(parseFloat(parsed.tax_rate) || 0);
        form.setFieldsValue({ tax_rate: parseFloat(parsed.tax_rate) || 0 });
      }
      if (parsed.tax_method === 'specific' && parsed.tax_amount !== undefined) {
        setTaxMethod('specific');
        setSpecificTaxAmount(parseFloat(parsed.tax_amount) || 0);
        form.setFieldsValue({ tax_amount: parseFloat(parsed.tax_amount) || 0 });
      }

      // 5. Adjustments
      if (parsed.adjustments && Array.isArray(parsed.adjustments)) {
        const newAdjustments: Adjustment[] = parsed.adjustments.map((adj: any, idx: number) => {
          const pct = parseFloat(adj.percentage) || 0;
          const fixedAmt = adj.fixed_amount != null ? parseFloat(String(adj.fixed_amount)) : undefined;
          return {
          id: `adj-${Date.now()}-${idx}`,
          name: adj.name || '',
          percentage: pct,
          fixedAmount: fixedAmt !== undefined ? fixedAmt : (pct === 0 ? 0 : undefined),
          type: adj.type === 'subtract' ? 'subtract' : 'add',
          order: adj.order || idx + 1,
          note: adj.note || '',
        };});
        setAdjustments(newAdjustments);
      }

      // 6. Payments
      if (parsed.payments && Array.isArray(parsed.payments)) {
        const newPayments: PaymentRecord[] = parsed.payments.map((p: any) => ({
          amount: parseFloat(p.amount) || 0,
          date: p.date ? dayjs(p.date) : null,
          method: p.method || '',
          reference: p.reference || '',
          top_note: p.top_note || '',
          bottom_note: p.bottom_note || '',
        }));
        setPayments(newPayments);
      }

      // 7. Notes & payment terms
      if (parsed.notes) form.setFieldsValue({ notes: parsed.notes });
      if (parsed.payment_terms) form.setFieldsValue({ payment_terms: parsed.payment_terms });

      // 8. Invoice date / due date
      if (parsed.date) form.setFieldsValue({ date: dayjs(parsed.date) });
      if (parsed.due_date) form.setFieldsValue({ due_date: dayjs(parsed.due_date) });

      setJsonPasteVisible(false);
      setJsonPasteValue('');
      message.success('JSON data applied successfully!');
    } catch (e: any) {
      setJsonPasteError(`Failed to apply JSON data: ${e.message}`);
    }
  };

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_: any, __: any, index: number) => index + 1,
    },
    // Item code column hidden - description is the primary identifier
    // {
    //   title: 'Item',
    //   dataIndex: 'name',
    //   key: 'name',
    // },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: 'Note',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (text: string) => {
        if (!text) return '-';
        // Strip HTML tags for table display
        const stripped = text.replace(/<[^>]*>/g, '');
        return <Tooltip title={stripped}>{stripped}</Tooltip>;
      },
    },
    {
      title: 'Qty',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      align: 'center' as const,
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      width: 100,
      align: 'right' as const,
      render: (value: number) => formatCurrency(value),
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: any, record: InvoiceItem) => formatCurrency(record.quantity * record.rate),
    },
    ...(taxMethod === 'percentage' ? [{
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Taxable</span>
          <Tooltip title="Toggle all items">
            <Switch
              size="small"
              checked={items.every(item => item.taxable !== false)}
              onChange={(checked) => {
                const updatedItems = items.map(item => ({
                  ...item,
                  taxable: checked
                }));
                setItems(updatedItems);
              }}
            />
          </Tooltip>
        </div>
      ),
      dataIndex: 'taxable',
      key: 'taxable',
      width: 120,
      align: 'center' as const,
      render: (value: boolean | undefined, record: InvoiceItem, index: number) => (
        <Switch
          size="small"
          checked={value !== false}
          onChange={(checked) => {
            const updatedItems = [...items];
            updatedItems[index] = { ...updatedItems[index], taxable: checked };
            setItems(updatedItems);
          }}
        />
      ),
    }] : []),
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: any, record: InvoiceItem, index: number) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEditItem(record, index)}
            />
          </Tooltip>
          {/* Delete functionality is now handled by section-based system */}
        </Space>
      ),
    },
  ];

  const totals = useMemo(() => calculateTotals(), [calculateTotals]);

  // Set default receipt date to most recent payment date or today when receipt section is visible
  useEffect(() => {
    // Only set if receipt date is not already set and balance is paid (within rounding tolerance)
    if (Math.abs(totals.balanceDue) < 0.01 && !receiptDate) {
      // Find the most recent payment date
      const sortedPayments = [...payments]
        .filter(p => p.date)
        .sort((a, b) => {
          if (!a.date || !b.date) return 0;
          return b.date.valueOf() - a.date.valueOf();
        });

      if (sortedPayments.length > 0 && sortedPayments[0].date) {
        // Use most recent payment date
        setReceiptDate(sortedPayments[0].date);
      } else {
        // Use today's date if no payment dates
        setReceiptDate(dayjs());
      }
    }
  }, [totals.balanceDue, payments, receiptDate]);

  // Safe form values for rendering
  const safeFormValues = useMemo(() => {
    if (!formMounted) {
      return { discount: 0, taxRate: 0 };
    }

    try {
      const values = form.getFieldsValue(['discount', 'tax_rate']);
      return {
        discount: values.discount || 0,
        taxRate: values.tax_rate || 0
      };
    } catch (error) {
      return { discount: 0, taxRate: 0 };
    }
  }, [form, formMounted, formFieldsChanged]);

  // Show loading spinner when editing an existing invoice
  if (isEditMode && invoiceLoading) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spin size="large" tip="Loading invoice..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>{isEditMode ? 'Edit Invoice' : 'Create Invoice'}</Title>
        <Button
          type="primary"
          ghost
          size="large"
          icon={<SnippetsOutlined />}
          onClick={() => { setJsonPasteVisible(true); setJsonPasteError(null); }}
          data-testid="json-paste-button"
        >
          {isEditMode ? 'Override with JSON' : 'Import JSON'}
        </Button>
      </div>
      
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          invoice_number: isEditMode ? '' : '', // Will be generated when company is selected
          date: dayjs(),
          due_date: dayjs().add(30, 'days'),
          tax_rate: 0,
          discount: 0,
          op_percent: 0,
        }}
        onFieldsChange={(changedFields) => {
          if (!formMounted) {
            setFormMounted(true);
          }
          // Track field changes for discount, tax_rate, and op_percent
          const affectedFields = changedFields.filter(field =>
            field.name?.[0] === 'discount' || field.name?.[0] === 'tax_rate' || field.name?.[0] === 'op_percent'
          );
          if (affectedFields.length > 0) {
            setFormFieldsChanged(prev => prev + 1);

            // Update op_percent state when form field changes
            const opPercentField = changedFields.find(field => field.name?.[0] === 'op_percent');
            if (opPercentField && opPercentField.value !== undefined) {
              setOpPercent(opPercentField.value || 0);
            }
          }
        }}
      >
        <Row gutter={24}>
          {/* Invoice Details */}
          <Col xs={24}>
            <Card title="Invoice Details" style={{ marginBottom: 24 }}>
              <Form.Item
                label="Select Company"
                style={{ marginBottom: 16 }}
                name="company_selection"
                rules={[{ required: true, message: 'Please select a company' }]}
              >
                <Select
                  value={companySelectionValue || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  allowClear
                  showSearch
                  filterOption={(input, option) => {
                    const label = String(option?.label || '');
                    return label.toLowerCase().includes(input.toLowerCase());
                  }}
                  options={companies.map(company => ({
                    label: company.name,
                    value: company.id,
                  }))}
                />
              </Form.Item>
              
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="invoice_number"
                    label="Invoice Number"
                    rules={[{ required: true }]}
                  >
                    <Input
                      prefix="#"
                      placeholder={isEditMode ? "Invoice number" : "Select company to generate number"}
                      readOnly={!isEditMode && !selectedCompany}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="date"
                    label="Invoice Date"
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="due_date"
                    label="Due Date"
                    rules={[{ required: true }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>


          {/* Client Information */}
          <Col xs={24}>
            <Card
              title={
                <Space>
                  <span>Client Information</span>
                  <Select
                    size="small"
                    value={clientInputMode}
                    onChange={(mode) => {
                      setClientInputMode(mode);
                      // Clear fields when switching modes
                      form.setFieldsValue({
                        client_name: '',
                        client_email: '',
                        client_phone: '',
                        client_address: '',
                        client_city: '',
                        client_state: '',
                        client_zipcode: '',
                      });
                      setSelectedClient(null);
                      setSelectedClientRecord(null);
                      setClientSearchResults([]);
                    }}
                    style={{ width: 160 }}
                    options={[
                      { label: 'Manual Input', value: 'manual' },
                      { label: 'Select Company', value: 'company' },
                      { label: 'Select Client', value: 'client' },
                    ]}
                  />
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              {clientInputMode === 'company' ? (
                // Company Selection Mode
                <Row gutter={16}>
                  <Col xs={24}>
                    <Form.Item
                      label="Select Client Company"
                      name="client_company_selection"
                      rules={[{ required: true, message: 'Please select a client company' }]}
                    >
                      <Select
                        showSearch
                        placeholder="Select a registered company"
                        optionFilterProp="children"
                        onChange={(value) => {
                          const company = companies.find(c => c.id === value);

                          if (company) {
                            setSelectedClient(company);

                            // Auto-fill client fields
                            const clientFields = {
                              client_name: company.name,
                              client_email: company.email || '',
                              client_phone: company.phone || '',
                              client_address: company.address || '',
                              client_city: company.city || '',
                              client_state: company.state || '',
                              client_zipcode: company.zipcode || '',
                            };

                            form.setFieldsValue(clientFields);
                          }
                        }}
                        filterOption={(input, option) => {
                          const children = option?.children as unknown;
                          if (typeof children === 'string') {
                            return (children as string).toLowerCase().includes(input.toLowerCase());
                          }
                          return false;
                        }}
                      >
                        {companies.map(company => (
                          <Select.Option key={company.id} value={company.id}>
                            {company.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  {/* Display selected company info */}
                  {selectedClient && (
                    <Col xs={24}>
                      <div style={{
                        padding: '16px',
                        background: '#f5f5f5',
                        borderRadius: '4px',
                        marginBottom: '16px'
                      }}>
                        <Row gutter={[16, 8]}>
                          <Col xs={24}>
                            <strong>{selectedClient.name}</strong>
                          </Col>
                          {selectedClient.email && (
                            <Col xs={24} md={12}>
                              <span style={{ color: '#666' }}>Email: {selectedClient.email}</span>
                            </Col>
                          )}
                          {selectedClient.phone && (
                            <Col xs={24} md={12}>
                              <span style={{ color: '#666' }}>Phone: {selectedClient.phone}</span>
                            </Col>
                          )}
                          {selectedClient.address && (
                            <Col xs={24}>
                              <span style={{ color: '#666' }}>
                                {selectedClient.address}
                                {selectedClient.city && `, ${selectedClient.city}`}
                                {selectedClient.state && `, ${selectedClient.state}`}
                                {selectedClient.zipcode && ` ${selectedClient.zipcode}`}
                              </span>
                            </Col>
                          )}
                        </Row>
                      </div>
                    </Col>
                  )}
                </Row>
              ) : clientInputMode === 'client' ? (
                // Client Selection Mode
                <Row gutter={16}>
                  <Col xs={24}>
                    <Form.Item
                      label="Search Client"
                      name="client_record_selection"
                      rules={[{ required: true, message: 'Please select a client' }]}
                    >
                      <Select
                        showSearch
                        placeholder="Search by client name..."
                        filterOption={false}
                        onSearch={handleClientSearch}
                        onChange={handleClientSelect}
                        loading={clientSearchLoading}
                        notFoundContent={clientSearchLoading ? <Spin size="small" /> : 'Type to search clients'}
                        value={selectedClientRecord?.id}
                      >
                        {clientSearchResults.map(client => (
                          <Select.Option key={client.id} value={client.id}>
                            <div>
                              <strong>{client.display_name}</strong>
                              {client.address && (
                                <span style={{ color: '#8c8c8c', marginLeft: 8, fontSize: '12px' }}>
                                  {client.address}{client.city ? `, ${client.city}` : ''}
                                </span>
                              )}
                            </div>
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  {/* Display selected client info */}
                  {selectedClientRecord && (
                    <Col xs={24}>
                      <div style={{
                        padding: '16px',
                        background: '#f5f5f5',
                        borderRadius: '4px',
                        marginBottom: '16px'
                      }}>
                        <Row gutter={[16, 8]}>
                          <Col xs={24}>
                            <strong>{selectedClientRecord.display_name}</strong>
                          </Col>
                          {selectedClientRecord.email && (
                            <Col xs={24} md={12}>
                              <span style={{ color: '#666' }}>Email: {selectedClientRecord.email}</span>
                            </Col>
                          )}
                          {selectedClientRecord.phone && (
                            <Col xs={24} md={12}>
                              <span style={{ color: '#666' }}>Phone: {selectedClientRecord.phone}</span>
                            </Col>
                          )}
                          {selectedClientRecord.address && (
                            <Col xs={24}>
                              <span style={{ color: '#666' }}>
                                {selectedClientRecord.address}
                                {selectedClientRecord.city && `, ${selectedClientRecord.city}`}
                                {selectedClientRecord.state && `, ${selectedClientRecord.state}`}
                                {selectedClientRecord.zipcode && ` ${selectedClientRecord.zipcode}`}
                              </span>
                            </Col>
                          )}
                          {selectedClientRecord.owners && selectedClientRecord.owners.length > 0 && (
                            <Col xs={24}>
                              <span style={{ color: '#666' }}>
                                Owners: {selectedClientRecord.owners.map(o => o.name).join(', ')}
                              </span>
                            </Col>
                          )}
                        </Row>
                      </div>
                    </Col>
                  )}
                </Row>
              ) : (
                // Manual Input Mode
                <Row gutter={16}>
                  {/* Client Name, Email, Phone in one row */}
                  <Col xs={24} md={8}>
                    <Form.Item
                      name="client_name"
                      label="Client Name"
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="client_email" label="Email">
                      <Input type="email" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name="client_phone" label="Phone">
                      <Input />
                    </Form.Item>
                  </Col>

                  {/* Address, City, State, Zip in one row */}
                  <Col xs={24} md={12}>
                    <Form.Item name="client_address" label="Address">
                      <AddressAutocomplete
                        onSelect={(addr) => form.setFieldsValue({
                          client_city: addr.city,
                          client_state: addr.state,
                          client_zipcode: addr.zip,
                        })}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="client_city" label="City">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={3}>
                    <Form.Item name="client_state" label="State">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={3}>
                    <Form.Item name="client_zipcode" label="ZIP">
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>
          </Col>

          {/* Insurance Information */}
          <Col xs={24}>
            <Card
              title={
                <Space>
                  <span>Insurance Information</span>
                  <Switch
                    size="small"
                    checked={showInsurance}
                    onChange={setShowInsurance}
                    checkedChildren="Yes"
                    unCheckedChildren="No"
                  />
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              {showInsurance && (
                <Row gutter={16}>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_company" label="Insurance Company">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_policy_number" label="Policy Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_claim_number" label="Claim Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_deductible" label="Deductible">
                      <InputNumber
                        style={{ width: '100%' }}
                        formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value!.replace(/\$\s?|(,*)/g, '')}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>
          </Col>
        </Row>

        {/* Invoice Items - Section Based */}
        <Card title="Invoice Items" style={{ marginBottom: 24 }}>
          {/* Section Creation */}
          <div className="add-section-row" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              placeholder="Enter section title..."
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              onPressEnter={addSection}
              style={{ flex: '1 1 200px', maxWidth: 300 }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={addSection}>
              Add Section
            </Button>
          </div>

          {/* Sections */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={sections.map(section => section.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="sections-container">
                {sections.map((section, sectionIndex) => (
                  <SortableSectionItem key={section.id} id={section.id}>
                    <SectionPanel
                      section={section}
                      sectionIndex={sectionIndex}
                      isOpen={activeKeys.includes(section.id)}
                      onToggle={() => {
                        if (activeKeys.includes(section.id)) {
                          setActiveKeys(activeKeys.filter(k => k !== section.id));
                        } else {
                          setActiveKeys([...activeKeys, section.id]);
                        }
                      }}
                      onAddItem={() => {
                        setEditingSectionIndex(sectionIndex);
                        setEditingItem(null);
                        setEditingIndex(null);
                        itemForm.resetFields();
                        itemForm.setFieldsValue({
                          quantity: 1,
                          unit: DEFAULT_UNIT,
                          rate: 0,
                          taxable: true,
                        });
                        setItemModalVisible(true);
                      }}
                      onApplyTemplate={() => {
                        setTemplateTargetSectionIndex(sectionIndex);
                        setTemplateSelectorVisible(true);
                      }}
                      onSaveAsTemplate={() => {
                        const templateItems = section.items.map((item, index) => ({
                          line_item_id: item.line_item_id,
                          source_item_id: item.id,
                          name: item.name,
                          description: item.description,
                          unit: item.unit,
                          rate: Number(item.rate) || 0,
                          quantity_multiplier: Number(item.quantity) || 1,
                          order_index: index,
                        }));
                        const companyIdForTemplate = invoiceData?.company_id || selectedCompany?.id;
                        saveSectionAsNewTemplate(section.title, templateItems, companyIdForTemplate);
                      }}
                      onEditSection={() => handleEditSection(section.id, section.title)}
                      onDeleteSection={() => deleteSection(sectionIndex)}
                      formatCurrency={formatCurrency}
                      taxMethod={taxMethod}
                      sections={sections}
                      setSections={setSections}
                      calculateSectionSubtotal={calculateSectionSubtotal}
                      activeId={activeId}
                      setEditingSectionIndex={setEditingSectionIndex}
                      setEditingItem={setEditingItem}
                      setEditingIndex={setEditingIndex}
                      itemForm={itemForm}
                      setItemModalVisible={setItemModalVisible}
                      selectedRowKeys={selectedItemKeys[sectionIndex] || []}
                      onRowSelection={(keys) => handleItemRowSelection(sectionIndex, keys)}
                      onToggleLumpSum={toggleSectionLumpSum}
                      onLumpSumAmountChange={updateSectionLumpSumAmount}
                    />
                  </SortableSectionItem>
                ))}
              </div>
            </SortableContext>

            {/* Drag Overlay for unified drag and drop */}
            <DragOverlay>
              {activeId ? (
                (() => {
                  if (activeDragType === 'section') {
                    const section = sections.find(s => s.id === activeId);
                    if (section) {
                      return (
                        <div
                          style={{
                            backgroundColor: 'white',
                            border: '1px solid #d9d9d9',
                            borderRadius: '6px',
                            padding: '12px 16px',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                            fontSize: '14px',
                            minWidth: '300px',
                            opacity: 0.95,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <HolderOutlined style={{ color: '#8c8c8c', fontSize: '12px' }} />
                          <span style={{ fontWeight: '600' }}>{section.title}</span>
                          <Badge count={section.items.length} showZero color="#108ee9" />
                          <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${formatCurrency(section.subtotal)}</span>
                        </div>
                      );
                    }
                  } else if (activeDragType === 'item' && activeSectionIndex !== null) {
                    // Parse ID format: item-{sectionIndex}-{itemId}
                    const firstDash = activeId.indexOf('-');
                    const secondDash = activeId.indexOf('-', firstDash + 1);
                    if (firstDash !== -1 && secondDash !== -1) {
                      const itemId = activeId.substring(secondDash + 1);
                      const item = sections[activeSectionIndex]?.items.find(i => i.id === itemId);

                      if (item) {
                        return (
                          <div
                            style={{
                              backgroundColor: 'white',
                              border: '1px solid #d9d9d9',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                              fontSize: '13px',
                              minWidth: '200px',
                              opacity: 0.95,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <HolderOutlined style={{ color: '#8c8c8c', fontSize: '12px' }} />
                            <span style={{ fontWeight: '500' }}>{item.name || 'Item'}</span>
                            <span style={{ color: '#8c8c8c' }}>- {item.description?.replace(/<[^>]*>/g, '').substring(0, 30)}...</span>
                            <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${formatCurrency(item.amount || (item.quantity * item.rate) || 0)}</span>
                          </div>
                        );
                      }
                    }
                  }
                  return null;
                })()
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Grand Total Summary */}
          <div style={{ marginTop: 16, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
            <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '16px' }}>
              <Col>Grand Total:</Col>
              <Col>${formatCurrency(totals.itemsSubtotal)}</Col>
            </Row>
          </div>
        </Card>

        {/* Totals and Additional Info */}
        <Row gutter={24}>
          <Col xs={24} lg={12}>
            <Card title="Additional Information" style={{ marginBottom: 24 }}>
              <Form.Item name="notes" label="Invoice Header Notes">
                <RichTextEditor
                  placeholder="Notes that will appear at the top of the invoice..."
                  minHeight={150}
                />
              </Form.Item>
              <Form.Item name="payment_terms" label="Invoice Footer Terms">
                <RichTextEditor
                  placeholder="Terms that will appear at the bottom of the invoice (e.g., Net 30 days, Due on receipt, etc.)"
                  minHeight={120}
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Payment Summary" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item label="Discount">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      value={discount}
                      onChange={value => {
                        const newValue = value || 0;
                        setDiscount(newValue);
                        form.setFieldValue('discount', newValue);
                      }}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                    />
                  </Form.Item>
                </Col>
              </Row>

              {/* Adjustments Section */}
              <Row gutter={16}>
                <Col span={24}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 'bold' }}>Adjustments</span>
                        <Tooltip title="Add custom adjustments (e.g., Holiday Premium, Discount, O&P) that are applied in order to the subtotal">
                          <span style={{ marginLeft: '8px', color: '#8c8c8c', fontSize: '12px', cursor: 'help' }}>ℹ️</span>
                        </Tooltip>
                      </div>
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={handleAddAdjustment}
                      >
                        Add Adjustment
                      </Button>
                    </div>
                    {adjustments.length > 0 && (
                      <div style={{ 
                        padding: '8px 12px', 
                        marginBottom: '8px',
                        background: '#f0f7ff', 
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#666'
                      }}>
                        <strong>Name</strong> | <strong>+/−</strong> (add or subtract) | <strong>Amount</strong> ($ or %) | <strong>Result</strong> (auto-calculated)
                      </div>
                    )}
                    {adjustments.length === 0 && (
                      <div style={{ padding: '8px 0', color: '#8c8c8c', fontSize: '12px' }}>
                        No adjustments. Use legacy O&P and Discount fields below, or add custom adjustments above.
                      </div>
                    )}
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={(event) => {
                        const { active, over } = event;
                        if (!over || active.id === over.id) return;
                        const oldIdx = adjustments.findIndex(a => a.id === active.id);
                        const newIdx = adjustments.findIndex(a => a.id === over.id);
                        if (oldIdx !== -1 && newIdx !== -1) {
                          const reordered = arrayMove(adjustments, oldIdx, newIdx).map((a, i) => ({ ...a, order: i + 1 }));
                          setAdjustments(reordered);
                        }
                      }}
                    >
                      <SortableContext items={adjustments.map(a => a.id)} strategy={verticalListSortingStrategy}>
                        {adjustments.map((adj) => {
                          const calculatedAdj = totals.adjustments?.find(a => a.id === adj.id);
                          return <SortableAdjustmentItem key={adj.id} adj={adj} calculatedAdj={calculatedAdj} handleAdjustmentChange={handleAdjustmentChange} handleRemoveAdjustment={handleRemoveAdjustment} setAdjustments={setAdjustments} />;
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                </Col>
              </Row>

              {/* Legacy O&P and Discount (shown only if no adjustments) */}
              {adjustments.length === 0 && (
                <>
                  <Row gutter={16}>
                    <Col span={24}>
                      <Form.Item name="op_percent" label="O&P Percentage (%) (Legacy)">
                        <InputNumber
                          style={{ width: '100%' }}
                          min={0}
                          max={100}
                          step={0.1}
                          onChange={(value) => setOpPercent(typeof value === 'number' ? value : 0)}
                          formatter={(value?: string | number) => `${value}%`}
                          parser={(value?: string) => parseFloat(value?.replace('%', '') || '0') || 0}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Tax Method">
                    <Select
                      value={taxMethod}
                      onChange={setTaxMethod}
                      options={[
                        { value: 'percentage', label: 'Percentage of Subtotal' },
                        { value: 'specific', label: 'Specific Amount' }
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  {taxMethod === 'percentage' ? (
                    <Form.Item label="Tax Rate (%)">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        max={100}
                        value={taxRate}
                        onChange={value => {
                          const newValue = value || 0;
                          setTaxRate(newValue);
                          form.setFieldValue('tax_rate', newValue);
                        }}
                        formatter={value => `${value}%`}
                        parser={value => value!.replace('%', '') as any}
                      />
                    </Form.Item>
                  ) : (
                    <Form.Item label="Tax Amount" name="tax_amount">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        value={specificTaxAmount}
                        onChange={value => {
                          const newValue = value || 0;
                          setSpecificTaxAmount(newValue);
                          form.setFieldValue('tax_amount', newValue);
                        }}
                        formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                      />
                    </Form.Item>
                  )}
                </Col>
              </Row>

              {taxMethod === 'percentage' && (
                <Row gutter={16}>
                  <Col span={24}>
                    <Form.Item label="All Items Taxable">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Switch
                          checked={items.every(item => item.taxable !== false)}
                          onChange={(checked) => {
                            const updatedItems = items.map(item => ({
                              ...item,
                              taxable: checked
                            }));
                            setItems(updatedItems);
                          }}
                          checkedChildren="All Taxable"
                          unCheckedChildren="Mixed"
                        />
                        <span style={{ color: '#666', fontSize: '12px' }}>
                          Toggle taxable status for all items
                        </span>
                      </div>
                    </Form.Item>
                  </Col>
                </Row>
              )}


              <Space direction="vertical" style={{ width: '100%' }}>
                {payments.map((payment, index) => (
                  <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid #f0f0f0', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        {payment.date && (
                          <span style={{ color: '#666' }}>{payment.date.format('MM/DD/YYYY')}</span>
                        )}
                        <span style={{ fontWeight: 'bold' }}>${formatCurrency(payment.amount)}</span>
                        {payment.method && <span>({payment.method})</span>}
                        {payment.receipt_number && (
                          <span style={{ color: '#52c41a', fontSize: '12px' }}>
                            <FileTextOutlined /> {payment.receipt_number}
                          </span>
                        )}
                      </Space>
                      <Space>
                        <Tooltip title="Edit Payment">
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditPayment(payment, index)}
                          />
                        </Tooltip>
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeletePayment(index)}
                        />
                      </Space>
                    </div>
                    {isEditMode && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Tooltip title="Preview receipt before generating">
                          <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => handlePreviewPaymentReceipt(index)}
                            loading={isPreviewingReceipt}
                            disabled={isSaving || isPreviewing || generatingReceipt}
                          >
                            Preview Receipt
                          </Button>
                        </Tooltip>
                        {!payment.receipt_number ? (
                          <Tooltip title="Generate and save receipt for this payment">
                            <Button
                              size="small"
                              type="primary"
                              icon={<FileTextOutlined />}
                              onClick={() => handleGeneratePaymentReceipt(index)}
                              loading={generatingReceipt}
                              disabled={isSaving || isPreviewing || isPreviewingReceipt}
                              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                            >
                              Generate Receipt
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip title="View generated receipt PDF in new window">
                            <Button
                              size="small"
                              type="default"
                              icon={<FilePdfOutlined />}
                              onClick={() => handleViewPaymentReceipt(index)}
                              loading={isPreviewingReceipt}
                              disabled={isSaving || isPreviewing || generatingReceipt}
                            >
                              View Receipt
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={handleAddPayment}
                >
                  Add Payment
                </Button>
              </Space>


              <Divider />

              <div style={{ fontSize: '16px' }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Items Subtotal:</Col>
                  <Col>${formatCurrency(totals.itemsSubtotal)}</Col>
                </Row>
                
                {/* Show adjustments if available */}
                {totals.adjustments && totals.adjustments.length > 0 ? (
                  totals.adjustments
                    .sort((a, b) => a.order - b.order)
                    .map((adj, index) => (
                      <div key={index}>
                        <Row justify="space-between" style={{ marginBottom: adj.note ? 2 : 8 }}>
                          <Col>
                            {adj.name}
                            {adj.percentage !== 0 && ` (${Math.abs(adj.percentage)}%)`}
                            {adj.percentage === 0 && adj.fixedAmount != null && adj.fixedAmount !== 0 && ` ($${Math.abs(adj.fixedAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}
                          </Col>
                          <Col>
                            {adj.type === 'subtract' || adj.percentage < 0 ? '-' : '+'}
                            ${formatCurrency(adj.amount || 0)}
                          </Col>
                        </Row>
                        {adj.note && (
                          <div style={{ fontSize: '12px', color: '#8c8c8c', paddingLeft: 8, marginBottom: 8 }}>{adj.note}</div>
                        )}
                      </div>
                    ))
                ) : (
                  <>
                    {/* Legacy: Show O&P and Discount if no adjustments */}
                    {opPercent > 0 && (
                      <Row justify="space-between" style={{ marginBottom: 8 }}>
                        <Col>O&P ({opPercent}%):</Col>
                        <Col>${formatCurrency(totals.opAmount)}</Col>
                      </Row>
                    )}
                    {totals.discount > 0 && (
                      <Row justify="space-between" style={{ marginBottom: 8 }}>
                        <Col>Discount:</Col>
                        <Col>-${formatCurrency(totals.discount)}</Col>
                      </Row>
                    )}
                  </>
                )}
                
                {totals.taxAmount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>
                      Tax {taxMethod === 'percentage' ? `(${taxRate}%)` : ''}:
                    </Col>
                    <Col>${formatCurrency(totals.taxAmount)}</Col>
                  </Row>
                )}
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Subtotal:</Col>
                  <Col>${formatCurrency(totals.subtotal)}</Col>
                </Row>
                <Divider />
                <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                  <Col>Total:</Col>
                  <Col>${formatCurrency(totals.total)}</Col>
                </Row>
                {totals.totalPaid > 0 && (
                  <>
                    <Row justify="space-between" style={{ marginTop: 8 }}>
                      <Col>Total Paid:</Col>
                      <Col>${formatCurrency(totals.totalPaid)}</Col>
                    </Row>
                    <Row justify="space-between" style={{ fontWeight: 'bold', color: totals.balanceDue > 0 ? '#ff4d4f' : '#52c41a' }}>
                      <Col>Balance Due:</Col>
                      <Col>${formatCurrency(totals.balanceDue)}</Col>
                    </Row>
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Space size="middle" wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => handleSave('sent')}
              loading={isSaving}
            >
              {isEditMode ? 'Update' : 'Save'}
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewHTML}
              loading={isPreviewing}
            >
              Preview PDF
            </Button>
            <Divider type="vertical" />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => setTemplateManagerVisible(true)}
            >
              Manage Templates
            </Button>
            <Button
              onClick={() => navigate('/invoices')}
            >
              Cancel
            </Button>
          </Space>
        </Card>
      </Form>

      {/* Item Modal */}
      <Modal
        title={editingItem ? 'Edit Item' : 'Add Item'}
        open={itemModalVisible}
        onOk={handleItemSubmit}
        onCancel={() => {
          setItemModalVisible(false);
          itemForm.resetFields();
          setItemImages([]);
        }}
        afterOpenChange={(open) => {
          if (open) {
            if (!editingItem) {
              itemForm.resetFields();
              setItemImages([]);
            }
          }
        }}
        width={600}
      >
        <Form
          form={itemForm}
          layout="vertical"
          initialValues={{
            quantity: 1,
            unit: DEFAULT_UNIT,
            rate: 0,
            taxable: true,
          }}
        >
          <Form.Item
            name="name"
            label="Item Code (Optional)"
            tooltip="If not provided, will be auto-generated from description"
            rules={[
              { whitespace: true, message: 'Item code cannot be just whitespace' }
            ]}
          >
            <ItemCodeSelector
              onLineItemAdd={handleLineItemsAdd}
              placeholder="Enter item code, search line items, or leave blank to auto-generate"
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[
                  { required: true, message: 'Please enter quantity' },
                  {
                    type: 'number',
                    min: 0.01,
                    message: 'Quantity must be greater than 0'
                  }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={1}
                  precision={2}
                  placeholder="Enter quantity"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="unit"
                label="Unit"
                rules={[
                  { required: true, message: 'Please enter unit' }
                ]}
              >
                <UnitSelect
                  componentVariant="autocomplete"
                  style={{ width: '100%' }}
                  placeholder="Select or type unit"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="rate"
                label="Rate"
                rules={[
                  { required: true, message: 'Please enter rate' }
                ]}
                tooltip="Negative values allowed for discounts or credits"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  step={0.01}
                  precision={2}
                  placeholder="0.00"
                />
              </Form.Item>
            </Col>
            {taxMethod === 'percentage' && (
              <Col span={6}>
                <Form.Item
                  name="taxable"
                  label="Taxable"
                  valuePropName="checked"
                >
                  <Switch checkedChildren="Yes" unCheckedChildren="No" />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Form.Item
            name="description"
            label="Description"
          >
            <RichTextEditor
              placeholder="Optional description"
              minHeight={120}
            />
          </Form.Item>
          <Form.Item
            name="note"
            label="Note"
            tooltip="Additional notes or detailed description for this line item"
          >
            <RichTextEditor
              placeholder="Add additional notes or detailed description for this item"
              minHeight={120}
            />
          </Form.Item>
          {/* Image Upload Section */}
          <Form.Item label="Photos" tooltip="Attach photos to this line item. Photos will appear in the PDF appendix.">
            <Upload
              listType="picture-card"
              accept="image/*"
              multiple
              beforeUpload={handleItemImageUpload}
              showUploadList={false}
            >
              <div>
                <PictureOutlined />
                <div style={{ marginTop: 4, fontSize: 12 }}>Upload</div>
              </div>
            </Upload>
            {itemImages.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {itemImages.map((img, idx) => (
                  <div key={img.id} style={{
                    position: 'relative',
                    width: 104,
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    padding: 4,
                  }}>
                    <img
                      src={img.url}
                      alt={img.title}
                      style={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 2 }}
                    />
                    <Input
                      size="small"
                      placeholder="Title"
                      value={img.title}
                      onChange={(e) => {
                        const updated = [...itemImages];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setItemImages(updated);
                      }}
                      style={{ marginTop: 4, fontSize: 11 }}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setItemImages(prev => prev.filter((_, i) => i !== idx))}
                      style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        background: 'rgba(255,255,255,0.85)',
                        borderRadius: '50%',
                        width: 20,
                        height: 20,
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </Form.Item>

          <Form.Item
            name="saveToDatabase"
            valuePropName="checked"
            tooltip="Save this line item with description and note to database for future use"
          >
            <Checkbox>
              Save to database (with description and note)
            </Checkbox>
          </Form.Item>
          <Form.Item dependencies={['quantity', 'rate']} noStyle>
            {({ getFieldValue }) => {
              const quantity = getFieldValue('quantity');
              const rate = getFieldValue('rate');
              return quantity && rate ? (
                <div style={{ textAlign: 'right', fontSize: '16px', fontWeight: 'bold' }}>
                  Total: ${formatCurrency(quantity * rate)}
                </div>
              ) : null;
            }}
          </Form.Item>
        </Form>
      </Modal>

      {/* Payment Modal */}
      <Modal
        title={editingPayment ? 'Edit Payment' : 'Add Payment'}
        open={paymentModalVisible}
        onOk={handlePaymentSubmit}
        onCancel={() => {
          setPaymentModalVisible(false);
          paymentForm.resetFields();
          setEditingPayment(null);
          setEditingPaymentIndex(null);
        }}
        afterOpenChange={(open) => {
          if (open) {
            // Modal이 완전히 열린 후에 form 값 설정
            if (editingPayment) {
              paymentForm.setFieldsValue({
                amount: editingPayment.amount,
                date: editingPayment.date,
                method: editingPayment.method,
                reference: editingPayment.reference,
                top_note: editingPayment.top_note || '',
                bottom_note: editingPayment.bottom_note || '',
              });
            } else {
              paymentForm.resetFields();
              paymentForm.setFieldsValue({
                amount: undefined,
                date: null,
                method: '',
                reference: '',
                top_note: '',
                bottom_note: '',
              });
            }
          }
        }}
        width={500}
      >
        <Form
          form={paymentForm}
          layout="vertical"
          initialValues={{
            amount: undefined,
            date: null,
            method: '',
            reference: '',
            top_note: '',
            bottom_note: '',
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label="Amount"
                rules={[
                  { required: true, message: 'Please enter payment amount' },
                  { 
                    type: 'number',
                    min: 0.01,
                    message: 'Payment amount must be greater than $0'
                  }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="Enter amount"
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={((value: any) => {
                    if (value === null || value === undefined || value === '') return 0;
                    const cleanValue = String(value).replace(/[$,\s]/g, '').trim();
                    const parsed = parseFloat(cleanValue || '0');
                    return isNaN(parsed) ? 0 : parsed;
                  }) as any}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="date"
                label="Payment Date (Optional)"
              >
                <DatePicker style={{ width: '100%' }} placeholder="Select date (optional)" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="method"
                label="Payment Method"
              >
                <Select 
                  placeholder="Select method (optional)" 
                  allowClear
                  options={[
                    { value: 'CA', label: 'Cash' },
                    { value: 'CK', label: 'Check' },
                    { value: 'CC', label: 'Credit Card' },
                    { value: 'DC', label: 'Debit Card' },
                    { value: 'BT', label: 'Bank Transfer' },
                    { value: 'PP', label: 'PayPal' },
                    { value: 'VM', label: 'Venmo' },
                    { value: 'ZL', label: 'Zelle' },
                    { value: 'OT', label: 'Other' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="reference"
                label="Reference/Check #"
              >
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '16px 0' }}>Receipt Notes (Optional)</Divider>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="top_note"
                label="Top Note"
              >
                <Input.TextArea
                  rows={2}
                  placeholder="Optional note to appear at the top of receipt (if generated)"
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="bottom_note"
                label="Bottom Note"
              >
                <Input.TextArea
                  rows={2}
                  placeholder="Optional note to appear at the bottom of receipt (if generated)"
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Section Edit Modal */}
      <Modal
        title="Edit Section Name"
        open={sectionEditModalVisible}
        onOk={handleSectionTitleSave}
        onCancel={handleSectionEditCancel}
        width={400}
        okText="Save"
        cancelText="Cancel"
      >
        <Form layout="vertical">
          <Form.Item
            label="Section Title"
            required
          >
            <Input
              value={editingSectionTitle}
              onChange={(e) => setEditingSectionTitle(e.target.value)}
              placeholder="Enter section title"
              onPressEnter={handleSectionTitleSave}
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Line Item Template Selector Modal */}
      <LineItemTemplateSelector
        open={templateSelectorVisible}
        onClose={() => {
          setTemplateSelectorVisible(false);
          setTemplateTargetSectionIndex(null);
        }}
        onApply={handleTemplateApply}
        companyId={selectedCompany?.id}
        documentType="invoice"
      />

      {/* Line Item Template Manager Modal */}
      <LineItemTemplateManager
        open={templateManagerVisible}
        onClose={() => setTemplateManagerVisible(false)}
        companyId={selectedCompany?.id}
      />

      {/* Template Builder Modal */}
      <TemplateBuilderModal />

      {/* Template Builder Bar (Bottom floating bar) */}
      <TemplateBuilderBar />

      {/* Receipt Preview Modal */}
      <Modal
        title="Receipt Preview"
        open={receiptPreviewVisible}
        onCancel={handleCloseReceiptPreview}
        footer={[
          <Button key="close" onClick={handleCloseReceiptPreview}>
            Close
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownloadReceiptPdf}
          >
            Download PDF
          </Button>,
        ]}
        width="90vw"
        style={{ top: 20 }}
        bodyStyle={{ height: 'calc(90vh - 110px)', padding: 0 }}
      >
        {receiptPdfBlobUrl && (
          <iframe
            src={receiptPdfBlobUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title="Receipt Preview"
          />
        )}
      </Modal>

      {/* JSON Import Modal */}
      <Modal
        title={<span><SnippetsOutlined style={{ marginRight: 8 }} />{isEditMode ? 'Override Invoice with JSON' : 'Import JSON to Fill Invoice'}</span>}
        open={jsonPasteVisible}
        onOk={handleJsonPaste}
        onCancel={() => { setJsonPasteVisible(false); setJsonPasteValue(''); setJsonPasteError(null); }}
        width={800}
        okText="Apply to Form"
        cancelText="Cancel"
        okButtonProps={{ disabled: !jsonPasteValue.trim(), icon: <SaveOutlined /> }}
        data-testid="json-paste-modal"
      >
        {/* Input Methods */}
        <div style={{ marginBottom: 16 }}>
          <Space size="middle">
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={(file) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                  const content = e.target?.result as string;
                  setJsonPasteValue(content);
                  setJsonPasteError(null);
                };
                reader.readAsText(file);
                return false; // prevent actual upload
              }}
            >
              <Button icon={<UploadOutlined />}>Upload .json File</Button>
            </Upload>
            <Typography.Text type="secondary">or paste JSON below</Typography.Text>
          </Space>
        </div>

        <Input.TextArea
          rows={14}
          value={jsonPasteValue}
          onChange={(e) => { setJsonPasteValue(e.target.value); setJsonPasteError(null); }}
          placeholder="Paste your JSON here..."
          style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}
          data-testid="json-paste-textarea"
        />

        {jsonPasteError && (
          <div style={{ color: '#ff4d4f', marginTop: 4, marginBottom: 8 }} data-testid="json-paste-error">
            {jsonPasteError}
          </div>
        )}

        {/* JSON Format Guide */}
        <Collapse
          size="small"
          items={[{
            key: 'guide',
            label: <span><InfoCircleOutlined style={{ marginRight: 6 }} />JSON Format Guide & Example</span>,
            children: (
              <div>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 13 }}>
                  All fields are optional except <Typography.Text code>client.name</Typography.Text> and <Typography.Text code>sections</Typography.Text>.
                  Items default to <Typography.Text code>taxable: true</Typography.Text>.
                </Typography.Paragraph>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <Typography.Text strong style={{ fontSize: 12 }}>Available Fields:</Typography.Text>
                    <ul style={{ fontSize: 12, margin: '4px 0', paddingLeft: 16 }}>
                      <li><Typography.Text code>client</Typography.Text> — name, address, city, state, zipcode, phone, email</li>
                      <li><Typography.Text code>insurance</Typography.Text> — company, policy_number, claim_number, deductible</li>
                      <li><Typography.Text code>sections[]</Typography.Text> — title, items[]</li>
                      <li><Typography.Text code>items[]</Typography.Text> — description, note, quantity, unit, rate, taxable</li>
                      <li><Typography.Text code>tax_rate</Typography.Text> — percentage (e.g., 8.25)</li>
                      <li><Typography.Text code>adjustments[]</Typography.Text> — name, percentage, type (add/subtract)</li>
                      <li><Typography.Text code>payments[]</Typography.Text> — amount, date, method, reference</li>
                      <li><Typography.Text code>payment_terms</Typography.Text>, <Typography.Text code>notes</Typography.Text></li>
                    </ul>
                  </div>
                  <div>
                    <Typography.Text strong style={{ fontSize: 12 }}>Payment Methods:</Typography.Text>
                    <div style={{ fontSize: 11, marginTop: 4, lineHeight: '1.8' }}>
                      CA=Cash, CK=Check, CC=Credit Card, DC=Debit Card, BT=Bank Transfer, PP=PayPal, VM=Venmo, ZL=Zelle, OT=Other
                    </div>
                    <Typography.Text strong style={{ fontSize: 12, marginTop: 8, display: 'block' }}>Unit Examples:</Typography.Text>
                    <div style={{ fontSize: 11, marginTop: 4, lineHeight: '1.8' }}>
                      SF=Sq Ft, LF=Lin Ft, EA=Each, HR=Hour, SY=Sq Yd, CF=Cu Ft, LS=Lump Sum
                    </div>
                  </div>
                </div>
                <Typography.Text strong style={{ fontSize: 12 }}>Full Example:</Typography.Text>
                <pre style={{
                  background: '#f5f5f5', padding: 12, borderRadius: 6, fontSize: 11,
                  maxHeight: 280, overflow: 'auto', marginTop: 4, lineHeight: '1.5',
                  border: '1px solid #e8e8e8',
                }}>
{`{
  "client": {
    "name": "John Smith",
    "address": "123 Main St",
    "city": "Los Angeles",
    "state": "CA",
    "zipcode": "90001",
    "phone": "213-555-1234",
    "email": "john@example.com"
  },
  "insurance": {
    "company": "State Farm",
    "policy_number": "POL-123456",
    "claim_number": "CLM-789012",
    "deductible": 1000
  },
  "sections": [
    {
      "title": "Main Level",
      "items": [
        { "description": "Kitchen", "note": "Demo and rebuild of water-damaged cabinets and flooring", "quantity": 1, "unit": "LS", "rate": 4500.00 },
        { "description": "Living Room", "note": "Remove and replace carpet, pad, and baseboards", "quantity": 1, "unit": "LS", "rate": 2800.00 },
        { "description": "Hallway", "note": "Drywall repair and paint (2 coats)", "quantity": 1, "unit": "LS", "rate": 1200.00 }
      ]
    },
    {
      "title": "Basement Level",
      "items": [
        { "description": "Rec Room", "note": "Full demo of damaged drywall, insulation, and flooring", "quantity": 1, "unit": "LS", "rate": 5200.00 },
        { "description": "Utility Room", "note": "Replace water heater and damaged drywall", "quantity": 1, "unit": "LS", "rate": 3100.00 }
      ]
    },
    {
      "title": "Roof",
      "items": [
        { "description": "Remove and replace damaged shingles (wind damage)", "quantity": 15, "unit": "SQ", "rate": 350.00 },
        { "description": "Replace damaged flashing and seal", "quantity": 1, "unit": "LS", "rate": 800.00 }
      ]
    },
    {
      "title": "General Conditions",
      "items": [
        { "description": "Dumpster rental and debris removal", "note": "2 x 20yd dumpsters", "quantity": 2, "unit": "EA", "rate": 450.00, "taxable": false },
        { "description": "Permit and inspection fees", "quantity": 1, "unit": "LS", "rate": 350.00, "taxable": false },
        { "description": "Project supervision and coordination", "quantity": 40, "unit": "HR", "rate": 75.00, "taxable": false }
      ]
    }
  ],
  "tax_rate": 8.25,
  "adjustments": [
    { "name": "O&P", "percentage": 10, "type": "add" }
  ],
  "payments": [
    { "amount": 5000, "date": "04-01-2026", "method": "CK", "reference": "Check #1234" }
  ],
  "payment_terms": "Net 30",
  "notes": "Water damage restoration per insurance approval. Claim #CLM-789012."
}`}
                </pre>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const example = JSON.stringify({
                      client: { name: "John Smith", address: "123 Main St", city: "Los Angeles", state: "CA", zipcode: "90001", phone: "213-555-1234", email: "john@example.com" },
                      insurance: { company: "State Farm", policy_number: "POL-123456", claim_number: "CLM-789012", deductible: 1000 },
                      sections: [
                        { title: "Main Level", items: [
                          { description: "Kitchen", note: "Demo and rebuild of water-damaged cabinets and flooring", quantity: 1, unit: "LS", rate: 4500.00 },
                          { description: "Living Room", note: "Remove and replace carpet, pad, and baseboards", quantity: 1, unit: "LS", rate: 2800.00 },
                          { description: "Hallway", note: "Drywall repair and paint (2 coats)", quantity: 1, unit: "LS", rate: 1200.00 },
                        ]},
                        { title: "Basement Level", items: [
                          { description: "Rec Room", note: "Flood cut at 2ft, mold remediation included", quantity: 1, unit: "LS", rate: 5200.00 },
                          { description: "Full demo of damaged drywall, insulation, and flooring", quantity: 1, unit: "LS", rate: 3100.00 },
                        ]},
                        { title: "Roof", items: [
                          { description: "Remove and replace damaged shingles (wind damage)", quantity: 15, unit: "SQ", rate: 350.00 },
                          { description: "Replace damaged flashing and seal", quantity: 1, unit: "LS", rate: 800.00 },
                        ]},
                        { title: "General Conditions", items: [
                          { description: "Dumpster rental and debris removal", note: "2 x 20yd dumpsters", quantity: 2, unit: "EA", rate: 450.00, taxable: false },
                          { description: "Permit and inspection fees", quantity: 1, unit: "LS", rate: 350.00, taxable: false },
                          { description: "Project supervision and coordination", quantity: 40, unit: "HR", rate: 75.00, taxable: false },
                        ]},
                      ],
                      tax_rate: 8.25,
                      adjustments: [
                        { name: "O&P", percentage: 10, type: "add" },
                      ],
                      payments: [
                        { amount: 5000, date: "04-01-2026", method: "CK", reference: "Check #1234" },
                      ],
                      payment_terms: "Net 30",
                      notes: "Water damage restoration per insurance approval. Claim #CLM-789012.",
                    }, null, 2);
                    navigator.clipboard.writeText(example);
                    message.success('Example JSON copied to clipboard!');
                  }}
                >
                  Copy Example
                </Button>
              </div>
            ),
          }]}
        />
      </Modal>

      {/* Multi-Select Action Bar */}
      <MultiSelectActionBar
        selectedItemKeys={selectedItemKeys}
        sections={sections.map((s, i) => ({ id: s.id, title: s.title, index: i }))}
        onMoveToSection={handleMoveToSection}
        onCopyToSection={handleCopyToSection}
        onDeleteSelected={handleDeleteAllSelected}
        onClearSelection={handleClearSelection}
      />
    </div>
  );
};

export default InvoiceCreation;
