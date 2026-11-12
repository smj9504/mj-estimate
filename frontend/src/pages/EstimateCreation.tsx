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
  Modal,
  message,
  Divider,
  Typography,
  Tooltip,
  Switch,
  Checkbox,
  Spin,
  Grid,
  Badge,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import AddressAutocomplete from '../components/common/AddressAutocomplete';
import DocumentSectionPanel, { SortableSectionItem } from '../components/common/DocumentSectionPanel';
import SectionItemsTable from '../components/estimate/SectionItemsTable';
import MultiSelectActionBar from '../components/common/MultiSelectActionBar';
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
import RichTextEditor from '../components/editor/RichTextEditor';
import dayjs from 'dayjs';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { estimateService, EstimateLineItem, EstimateResponse, EstimateSection, PaymentScheduleItem } from '../services/estimateService';
import { companyService } from '../services/companyService';
import lineItemService from '../services/lineItemService';
import { LineItemType } from '../types/lineItem';
import { Company } from '../types';
import type { Client } from '../types/client';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';
import ItemCodeSelector from '../components/estimate/ItemCodeSelector';
import { generateId } from '../components/sketch/utils/idUtils';

import { formatCurrency } from '../utils/formatUtils';
import { lineAmount } from '../utils/money';
import { zIndex as zIndexScale } from '../styles/tokens';
import { sanitizeHtmlDocument } from '../utils/safeHtml';

const { Title } = Typography;
const { useBreakpoint } = Grid;

interface Adjustment {
  id: string;
  name: string;
  percentage: number;
  type: 'add' | 'subtract';
  order: number;
  amount?: number; // Calculated
}

// One adjustment in the Payment Summary, laid out like the invoice page's.
// Its place in the list is the order it is applied in (drag to reorder).
const SortableAdjustmentRow: React.FC<{
  adj: Adjustment;
  amount?: number;
  onChange: (id: string, field: keyof Adjustment, value: any) => void;
  onRemove: (id: string) => void;
}> = ({ adj, amount = 0, onChange, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: adj.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    marginBottom: 12, padding: 12,
    border: isDragging ? '1px dashed #1890ff' : '1px solid #f0f0f0',
    borderRadius: 4, background: '#fafafa',
  };
  const effective = adj.type === 'subtract' ? -amount : amount;
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Row gutter={[8, 8]} align="middle">
        <Col flex="20px">
          <span {...listeners} style={{ cursor: 'grab', color: '#8c8c8c', touchAction: 'none' }}><HolderOutlined /></span>
        </Col>
        <Col flex="auto" xs={16} sm={6}>
          <Input placeholder="Name (e.g., O&P)" value={adj.name} onChange={(e) => onChange(adj.id, 'name', e.target.value)} size="small" />
        </Col>
        <Col xs={7} sm={3}>
          <Select value={adj.type} onChange={(value) => onChange(adj.id, 'type', value)} size="small" style={{ width: '100%' }}>
            <Select.Option value="add">+ Add</Select.Option>
            <Select.Option value="subtract">− Sub</Select.Option>
          </Select>
        </Col>
        <Col xs={24} sm={7}>
          <InputNumber
            placeholder="Percentage"
            value={adj.percentage}
            onChange={(value) => onChange(adj.id, 'percentage', value || 0)}
            min={-100}
            max={100}
            step={0.1}
            size="small"
            style={{ width: '100%' }}
            addonAfter="%"
          />
        </Col>
        <Col xs={17} sm={5}>
          <span style={{ fontSize: '13px', color: effective < 0 ? '#cf1322' : '#389e0d', fontWeight: '600' }}>
            {effective < 0 ? '−' : '+'} {formatCurrency(Math.abs(effective))}
          </span>
        </Col>
        <Col xs={7} sm={2} style={{ textAlign: 'right' }}>
          <Button danger size="small" icon={<DeleteOutlined />} onClick={() => onRemove(adj.id)} />
        </Col>
      </Row>
    </div>
  );
};

interface EstimateCreationProps {
  initialEstimate?: EstimateResponse;
}

const EstimateCreation: React.FC<EstimateCreationProps> = ({ initialEstimate }) => {
  const [form] = Form.useForm();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const isEditMode = !!id;
  const importSource = searchParams.get('import'); // 'pack' for pack estimate import
  const presetClient = (location.state as { presetClient?: Client } | null)?.presetClient;

  // Loading states - separate for different operations
  const [isDataLoading, setIsDataLoading] = useState(false); // For initial data loading
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Section-based state
  const [sections, setSections] = useState<EstimateSection[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  
  // Other states
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Unified drag and drop states
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<'section' | 'item' | null>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);

  // Collapse active keys state for controlling which sections are expanded
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<EstimateLineItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
  const [useCustomCompany, setUseCustomCompany] = useState(false);
  const [showInsuranceInfo, setShowInsuranceInfo] = useState(false);

  // Multi-select state
  const [selectedItemKeys, setSelectedItemKeys] = useState<{[sectionIndex: number]: string[]}>({});
  
  // O&P and calculations (DEPRECATED: Use adjustments instead)
  const [opPercent, setOpPercent] = useState(0);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);

  // Tax states
  const [taxMethod, setTaxMethod] = useState<'percentage' | 'specific'>('percentage');
  const [taxRate, setTaxRate] = useState(0);
  const [specificTaxAmount, setSpecificTaxAmount] = useState(0);
  const [sectionModalVisible, setSectionModalVisible] = useState(false);
  const [editingSectionName, setEditingSectionName] = useState<string>('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

  // Rich text editor states
  const [currentItemDescription, setCurrentItemDescription] = useState('');
  const [currentItemNote, setCurrentItemNote] = useState('');

  // PDF Template selection state
  const [pdfTemplateType, setPdfTemplateType] = useState<'estimate' | 'invoice'>('estimate');
  const [includeSignature, setIncludeSignature] = useState(false);

  // Payment schedule state
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentScheduleItem[]>([]);

  // Document-level lump sum: hides qty/unit/rate/amount for all items and
  // replaces the calculated grand total with a single manually-entered amount.
  const [isLumpSumDocument, setIsLumpSumDocument] = useState(false);
  const [lumpSumDocumentAmount, setLumpSumDocumentAmount] = useState(0);


  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ];

  const loadCompanies = useCallback(async () => {
    try {
      const data = await companyService.getCompanies();
      setCompanies(data);
      // Don't auto-select any company - let user choose explicitly
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }, []);

  const loadEstimate = useCallback(async (estimateData?: EstimateResponse) => {
    if (!id) return;

    setIsDataLoading(true);
    try {
      const estimate = estimateData || await estimateService.getEstimate(id);
      
      // Set form values
      form.setFieldsValue({
        estimate_number: estimate.estimate_number,
        client_name: estimate.client_name,
        client_address: estimate.client_address,
        client_city: estimate.client_city,
        client_state: estimate.client_state,
        client_zipcode: estimate.client_zipcode,
        client_phone: estimate.client_phone,
        client_email: estimate.client_email,
        estimate_date: estimate.estimate_date ? dayjs(estimate.estimate_date) : dayjs(),
        claim_number: estimate.claim_number,
        policy_number: estimate.policy_number,
        insurance_company: estimate.insurance_company,
        deductible: estimate.deductible,
        notes: estimate.notes,
        terms: estimate.terms,
        status: estimate.status || 'draft',
      });

      // Show insurance info if any insurance fields are filled
      const hasInsuranceInfo = estimate.claim_number || estimate.policy_number || estimate.insurance_company || estimate.deductible;
      setShowInsuranceInfo(!!hasInsuranceInfo);
      
      // Convert items to sections or use existing sections
      console.log('loadEstimate - received estimate:', estimate);
      console.log('loadEstimate - estimate.items:', estimate.items);
      console.log('loadEstimate - estimate.sections:', estimate.sections);

      if (estimate.sections && estimate.sections.length > 0) {
        console.log('loadEstimate - using existing sections');
        // Ensure all items have stable IDs for drag and drop
        const sectionsWithIds = estimate.sections.map((section: EstimateSection) => ({
          ...section,
          items: (section.items || []).map((item: EstimateLineItem, iIndex: number) => ({
            ...item,
            id: item.id || generateId(),  // Ensure each item has a stable ID
          }))
        }));
        setSections(sectionsWithIds);
        // Expand all sections when loading an existing estimate
        setActiveKeys(sectionsWithIds.map((s: EstimateSection) => s.id));
      } else {
        console.log('loadEstimate - converting items to sections');
        console.log('loadEstimate - items to convert:', estimate.items);
        const sectionsFromItems = convertItemsToSections(estimate.items || []);
        console.log('loadEstimate - converted sections:', sectionsFromItems);
        setSections(sectionsFromItems);
        // Expand all sections when loading converted items
        setActiveKeys(sectionsFromItems.map(s => s.id));
      }
      
      // Set O&P percent (for backward compatibility)
      if (estimate.op_percent) {
        setOpPercent(estimate.op_percent);
      }

      // Set adjustments if provided
      if (estimate.adjustments && Array.isArray(estimate.adjustments) && estimate.adjustments.length > 0) {
        const loadedAdjustments: Adjustment[] = estimate.adjustments.map((adj: any, index: number) => ({
          id: `adj-${Date.now()}-${index}`,
          name: adj.name || '',
          percentage: parseFloat(String(adj.percentage)) || 0,
          type: adj.type || 'add',
          order: adj.order || index + 1,
        }));
        // The list shows adjustments in the order they apply
        setAdjustments(
          [...loadedAdjustments]
            .sort((a, b) => a.order - b.order)
            .map((adj, index) => ({ ...adj, order: index + 1 }))
        );
      } else {
        setAdjustments([]);
      }

      // Set tax method and amount
      if (estimate.tax_method) {
        setTaxMethod(estimate.tax_method);
      }
      if (estimate.tax_amount && estimate.tax_method === 'specific') {
        setSpecificTaxAmount(estimate.tax_amount);
      }

      // Set tax rate if available
      if (estimate.tax_rate) {
        setTaxRate(estimate.tax_rate);
        form.setFieldValue('tax_rate', estimate.tax_rate);
      }

      // Set payment schedule if available
      if (estimate.payment_schedule && estimate.payment_schedule.length > 0) {
        setPaymentSchedule(estimate.payment_schedule);
      } else {
        setPaymentSchedule([]);
      }

      // Set document-level lump sum mode
      setIsLumpSumDocument(estimate.is_lump_sum_document || false);
      setLumpSumDocumentAmount(estimate.lump_sum_document_amount ?? 0);
      
      // Set company
      if (estimate.company_id) {
        const company = companies.find(c => c.id === estimate.company_id);
        if (company) {
          setSelectedCompany(company);
          setUseCustomCompany(false);
          form.setFieldValue('company_selection', company.id);
        }
      }
      
    } catch (error) {
      console.error('Failed to load estimate:', error);
      message.error('Failed to load estimate');
    } finally {
      setIsDataLoading(false);
    }
  }, [id, form, companies]);

  const convertItemsToSections = (items: EstimateLineItem[]): EstimateSection[] => {
    const groupedItems: { [key: string]: EstimateLineItem[] } = {};

    items.forEach(item => {
      const groupKey = item.primary_group || 'Default Section';
      if (!groupedItems[groupKey]) {
        groupedItems[groupKey] = [];
      }
      // Ensure each item has a stable ID for drag and drop
      groupedItems[groupKey].push({
        ...item,
        id: item.id || generateId(),
      });
    });

    return Object.entries(groupedItems).map(([title, groupItems], index) => ({
      id: `section-${index}`,
      title,
      items: groupItems,
      showSubtotal: true,
      subtotal: groupItems.reduce((sum, item) => sum + lineAmount(item.quantity, item.unit_price), 0),
    }));
  };

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // Import from Pack Calculator
  useEffect(() => {
    if (importSource === 'pack' && !isEditMode) {
      const packExportData = sessionStorage.getItem('packEstimateExport');
      if (packExportData) {
        try {
          const { items, metadata } = JSON.parse(packExportData);

          // Set form values from metadata
          form.setFieldsValue({
            client_name: metadata.calculation_name || 'Pack-Out Estimate',
            client_address: metadata.project_address || '',
            notes: `Imported from Pack Calculator on ${new Date(metadata.exported_at).toLocaleDateString()}. Total items: ${metadata.total_items}`,
          });

          // Convert imported items to sections
          const importedItems: EstimateLineItem[] = items.map((item: any, index: number) => ({
            id: item.id || `imported-${Date.now()}-${index}`,
            name: item.name,
            description: item.description || '',
            note: item.note || '',
            quantity: item.quantity,
            unit: item.unit || 'EA',
            unit_price: item.unit_price || 0,
            total: item.total || 0,
            taxable: item.taxable || false,
            primary_group: item.primary_group || 'Moving/Packing',
            secondary_group: item.secondary_group || '',
            sort_order: index,
          }));

          const importedSections = convertItemsToSections(importedItems);
          setSections(importedSections);
          setActiveKeys(importedSections.map(s => s.id));

          message.success(`Imported ${items.length} items from Pack Calculator`);

          // Clear session storage
          sessionStorage.removeItem('packEstimateExport');
        } catch (error) {
          console.error('Failed to parse pack export data:', error);
          message.error('Failed to import pack estimate data');
        }
      }
    }
  }, [importSource, isEditMode, form]);

  // Prefill client info when navigated here from a client's detail page
  useEffect(() => {
    if (isEditMode || !presetClient) return;

    const owner = presetClient.owners?.find((o) => o.is_primary) || presetClient.owners?.[0];
    form.setFieldsValue({
      client_name: presetClient.display_name,
      client_address: presetClient.address || '',
      client_city: presetClient.city || '',
      client_state: presetClient.state || '',
      client_zipcode: presetClient.zipcode || '',
      client_phone: presetClient.phone || owner?.phone || '',
      client_email: presetClient.email || owner?.email || '',
      insurance_company: presetClient.insurance_company || '',
      policy_number: presetClient.insurance_policy_number || '',
    });

    if (presetClient.insurance_company || presetClient.insurance_policy_number) {
      setShowInsuranceInfo(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, presetClient, form]);

  // Load estimate data when entering edit mode
  useEffect(() => {
    if (companies.length > 0 && id && isEditMode) {
      if (initialEstimate) {
        loadEstimate(initialEstimate);
      } else {
        loadEstimate();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies.length, id, isEditMode, initialEstimate]);
  // Note: loadEstimate intentionally excluded to prevent infinite loop
  // It's stable because it uses useCallback with correct dependencies

  // Section management functions
  const addSection = () => {
    if (!newSectionTitle.trim()) {
      message.warning('Please enter a section title');
      return;
    }

    const newSection: EstimateSection = {
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

  // Unified drag and drop sensors with improved activation
  // PointerSensor for mouse/stylus; TouchSensor with delay for mobile (prevents scroll/drag conflict)
  const unifiedSensors = useSensors(
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

  const handleUnifiedDragStart = (event: DragStartEvent) => {
    const { active, activatorEvent } = event;
    const activeIdStr = active.id as string;

    if (activeIdStr.startsWith('section-')) {
      // Section drag
      if (activatorEvent && 'target' in activatorEvent) {
        const target = activatorEvent.target as Element;
        const isFromSectionHandle = target.closest('.section-drag-handle');

        // Cancel if not from section handle
        if (!isFromSectionHandle) {
          return;
        }
      }
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

  const handleUnifiedDragEnd = (event: DragEndEvent) => {
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
            const newItems = arrayMove([...sectionItems], activeItemIdx, overItemIdx);
            const newSections = sections.map((section, i) =>
              i !== sectionIdx ? section : { ...section, items: newItems, subtotal: calculateSectionSubtotal(newItems, section) }
            );
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

  const updateSectionTitle = (sectionIndex: number, newTitle: string) => {
    const newSections = sections.map((section, i) =>
      i !== sectionIndex ? section : { ...section, title: newTitle }
    );
    setSections(newSections);
  };

  // Handle section name update in modal
  const handleSectionNameUpdate = () => {
    if (editingSectionName.trim() && editingSectionId) {
      const sectionIndex = sections.findIndex(s => s.id === editingSectionId);
      if (sectionIndex !== -1) {
        updateSectionTitle(sectionIndex, editingSectionName.trim());
        setSectionModalVisible(false);
        setEditingSectionName('');
        setEditingSectionId(null);
        message.success('Section name updated');
      }
    }
  };

  // Reset section modal state
  const resetSectionModal = () => {
    setSectionModalVisible(false);
    setEditingSectionName('');
    setEditingSectionId(null);
  };

  // Modal state management functions
  const resetItemModal = () => {
    setItemModalVisible(false);
    setEditingItem(null);
    setEditingIndex(null);
    setEditingSectionIndex(null);
    setCurrentItemDescription('');
    setCurrentItemNote('');
  };

  // Section expansion utility
  const expandSection = (sectionId: string) => {
    if (!activeKeys.includes(sectionId)) {
      setActiveKeys([...activeKeys, sectionId]);
    }
  };

  // Add items to a specific section
  const addItemsToSection = (sectionIndex: number, itemsToAdd: EstimateLineItem[]) => {
    const currentSection = sections[sectionIndex];

    // Update each line item with the current section's title and ensure ID
    const itemsWithGroup = itemsToAdd.map(item => ({
      ...item,
      id: item.id || generateId(),  // Ensure each item has a stable ID
      primary_group: currentSection.title,
    }));

    // Immutably update the target section so memo() detects the change
    const newSections = sections.map((section, i) => {
      if (i !== sectionIndex) return section;
      const newItems = [...section.items, ...itemsWithGroup];
      return {
        ...section,
        items: newItems,
        subtotal: calculateSectionSubtotal(newItems, section),
      };
    });

    setSections(newSections);

    // Auto-expand the section when items are added
    expandSection(currentSection.id);

    return itemsWithGroup.length;
  };

  // Handle adding multiple line items from ItemCodeSelector
  const handleLineItemsAdd = (lineItems: EstimateLineItem[]) => {
    if (editingSectionIndex !== null && lineItems.length > 0) {
      const itemsAdded = addItemsToSection(editingSectionIndex, lineItems);

      resetItemModal();
      message.success(`${itemsAdded} item(s) added successfully`);
    }
  };

  // Item management functions
  const addItemToSection = (sectionIndex: number) => {
    setEditingSectionIndex(sectionIndex);
    setEditingItem(null);
    setEditingIndex(null);
    setCurrentItemDescription('');
    setCurrentItemNote('');
    itemForm.resetFields();
    itemForm.setFieldsValue({
      quantity: 1,
      unit: DEFAULT_UNIT,
      unit_price: 0,
      taxable: true, // Default to taxable
    });
    setItemModalVisible(true);
  };

  const editItemInSection = (sectionIndex: number, itemIndex: number) => {
    const item = sections[sectionIndex].items[itemIndex];
    // console.log('editItemInSection - item data:', item);
    // console.log('editItemInSection - item.name value:', item.name);

    setEditingSectionIndex(sectionIndex);
    setEditingItem(item);
    setEditingIndex(itemIndex);
    setCurrentItemDescription(item.description || '');
    setCurrentItemNote(item.note || '');

    const formValues = {
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      taxable: item.taxable !== false, // Default to taxable if not specified
    };
    // console.log('editItemInSection - setting form values:', formValues);

    itemForm.setFieldsValue(formValues);
    setItemModalVisible(true);
  };



  // Multi-select handlers
  const handleItemRowSelection = (sectionIndex: number, selectedRowKeys: string[]) => {
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: selectedRowKeys
    }));
  };

  // Delete selected items with keyboard
  const handleDeleteKeyPress = (event: React.KeyboardEvent, sectionIndex: number) => {
    if (event.key === 'Delete') {
      const selectedKeys = selectedItemKeys[sectionIndex] || [];
      if (selectedKeys.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        deleteMultipleItems(sectionIndex, selectedKeys);
      }
    }
  };

  // Delete single item from section
  const deleteSingleItem = (sectionIndex: number, itemIndex: number) => {
    const newSections = sections.map((section, i) => {
      if (i !== sectionIndex) return section;
      const newItems = section.items.filter((_, j) => j !== itemIndex);
      return { ...section, items: newItems, subtotal: calculateSectionSubtotal(newItems, section) };
    });
    setSections(newSections);
    message.success('Item deleted successfully');
  };

  // Toggle taxable status for a single item
  const handleTaxableChange = useCallback((sectionIndex: number, itemIndex: number, checked: boolean) => {
    setSections(prev => prev.map((section, i) => {
      if (i !== sectionIndex) return section;
      const newItems = section.items.map((item, j) =>
        j !== itemIndex ? item : { ...item, taxable: checked }
      );
      return { ...section, items: newItems };
    }));
  }, []);

  // Toggle taxable status for all items in a section
  const handleToggleAllTaxable = useCallback((sectionIndex: number, checked: boolean) => {
    setSections(prev => prev.map((section, i) => {
      if (i !== sectionIndex) return section;
      const newItems = section.items.map(item => ({ ...item, taxable: checked }));
      return { ...section, items: newItems };
    }));
  }, []);

  // Delete multiple selected items
  const deleteMultipleItems = (sectionIndex: number, selectedKeys: string[]) => {
    const newSections = sections.map((section, i) => {
      if (i !== sectionIndex) return section;
      const filteredItems = section.items.filter((_, index) => !selectedKeys.includes(String(index)));
      return { ...section, items: filteredItems, subtotal: calculateSectionSubtotal(filteredItems, section) };
    });
    setSections(newSections);

    // Clear selection
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: []
    }));

    message.success(`${selectedKeys.length} item(s) deleted successfully`);
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
    const result: { item: EstimateLineItem; sectionIndex: number; itemIndex: number }[] = [];
    Object.entries(selectedItemKeys).forEach(([sectionIdx, keys]) => {
      const si = parseInt(sectionIdx);
      const section = sections[si];
      if (!section) return;
      keys.forEach(key => {
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

    const newSections = sections.map((section, i) => ({ ...section, items: [...section.items] }));

    // Collect items to move (with their new primary_group)
    const targetTitle = newSections[targetSectionIndex].title;
    const itemsToMove = selected.map(s => ({
      ...s.item,
      primary_group: targetTitle,
    }));

    // Remove from source sections (process in reverse to keep indices valid)
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

  const calculateSectionSubtotal = (
    items: EstimateLineItem[],
    section?: { isLumpSum?: boolean; lumpSumAmount?: number }
  ): number => {
    if (section?.isLumpSum) {
      return section.lumpSumAmount ?? 0;
    }
    return items.reduce((sum, item) => sum + lineAmount(item.quantity, item.unit_price), 0);
  };

  // Adjustments handlers
  const handleAddAdjustment = () => {
    const newAdjustment: Adjustment = {
      id: `adj-${Date.now()}`,
      name: '',
      percentage: 0,
      type: 'add',
      order: adjustments.length + 1,
    };
    setAdjustments([...adjustments, newAdjustment]);
  };

  const handleRemoveAdjustment = (id: string) => {
    setAdjustments(
      adjustments
        .filter(adj => adj.id !== id)
        .map((adj, index) => ({ ...adj, order: index + 1 }))
    );
  };

  // Dragging an adjustment changes the order it applies in
  const handleAdjustmentDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = adjustments.findIndex(a => a.id === active.id);
    const newIdx = adjustments.findIndex(a => a.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) {
      setAdjustments(
        arrayMove(adjustments, oldIdx, newIdx).map((adj, index) => ({ ...adj, order: index + 1 }))
      );
    }
  };

  const handleAdjustmentChange = (id: string, field: keyof Adjustment, value: any) => {
    setAdjustments(adjustments.map(adj => 
      adj.id === id ? { ...adj, [field]: value } : adj
    ));
  };

  const calculateGrandTotal = useMemo((): {
    subtotal: number;
    opAmount: number;
    taxAmount: number;
    total: number;
    adjustments?: Array<{ adjustment: Adjustment; amount: number }>;
  } => {
    // Document-level lump sum: ignore item/section/tax/adjustment calculations
    // entirely and use the single manually-entered amount as the grand total.
    if (isLumpSumDocument) {
      return {
        subtotal: lumpSumDocumentAmount,
        opAmount: 0,
        taxAmount: 0,
        total: lumpSumDocumentAmount,
      };
    }

    const subtotal = sections.reduce((sum, section) => sum + section.subtotal, 0);
    
    // Process adjustments if provided (new flexible system)
    let currentSubtotal = subtotal;
    const adjustmentsWithAmounts: Array<{ adjustment: Adjustment; amount: number }> = [];
    
    if (adjustments.length > 0) {
      // Sort adjustments by order
      const sortedAdjustments = [...adjustments].sort((a, b) => a.order - b.order);
      
      sortedAdjustments.forEach(adj => {
        const amount = currentSubtotal * (adj.percentage / 100);
        if (adj.type === 'add') {
          currentSubtotal += amount;
        } else {
          currentSubtotal -= amount;
        }
        adjustmentsWithAmounts.push({ adjustment: adj, amount });
      });
    }
    
    // Legacy O&P calculation (only if no adjustments)
    const opAmount = adjustments.length === 0 ? subtotal * (opPercent / 100) : 0;

    // Calculate tax amount
    let taxAmount = 0;
    if (taxMethod === 'percentage') {
      // Calculate tax on taxable items only
      const taxableAmount = sections.reduce((sum, section) => {
        if (section.isLumpSum) {
          return sum + (section.taxable !== false ? (section.lumpSumAmount || 0) : 0);
        }
        return sum + section.items.reduce((itemSum, item) => {
          if (item.taxable !== false) { // Default to taxable if not specified
            return itemSum + lineAmount(item.quantity, item.unit_price);
          }
          return itemSum;
        }, 0);
      }, 0);

      if (adjustments.length > 0) {
        // Calculate tax on (taxable amount + adjustments proportional to taxable items)
        const taxableRatio = subtotal > 0 ? taxableAmount / subtotal : 0;
        const adjustmentsTotal = adjustmentsWithAmounts.reduce((sum, adj) => {
          return sum + (adj.adjustment.type === 'add' ? adj.amount : -adj.amount);
        }, 0);
        const taxableAdjustmentsAmount = adjustmentsTotal * taxableRatio;
        taxAmount = (taxableAmount + taxableAdjustmentsAmount) * (taxRate / 100);
      } else {
        // Legacy: Calculate tax on (taxable amount + O&P proportional to taxable items)
        const taxableRatio = subtotal > 0 ? taxableAmount / subtotal : 0;
        const taxableOpAmount = opAmount * taxableRatio;
        taxAmount = (taxableAmount + taxableOpAmount) * (taxRate / 100);
      }
    } else {
      taxAmount = specificTaxAmount;
    }

    const total = adjustments.length > 0 
      ? currentSubtotal + taxAmount 
      : subtotal + opAmount + taxAmount;

    return { 
      subtotal, 
      opAmount, 
      taxAmount, 
      total,
      adjustments: adjustmentsWithAmounts.length > 0 ? adjustmentsWithAmounts : undefined
    };
  }, [sections, opPercent, adjustments, taxMethod, taxRate, specificTaxAmount, isLumpSumDocument, lumpSumDocumentAmount]);

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

  // Validate item form values
  const validateItemValues = (values: any): string | null => {
    // Auto-generate item code if not provided
    if (!values.name || values.name.trim() === '') {
      // Try to extract text from description for code generation
      // currentItemDescription is always a string (from useState)
      const plainText = currentItemDescription.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags
      
      if (plainText) {
        values.name = generateItemCode(plainText);
        console.log('Auto-generated item code:', values.name);
      } else {
        // If no description either, generate a generic code
        values.name = `ITEM_${Date.now().toString().slice(-6)}`;
      }
    }
    
    if (!values.quantity || values.quantity <= 0) {
      return 'Please enter valid quantity';
    }
    if (!values.unit) {
      return 'Please select unit';
    }
    if (values.unit_price === null || values.unit_price === undefined) {
      return 'Please enter unit price';
    }
    if (isNaN(values.unit_price)) {
      return 'Unit price must be a valid number';
    }
    return null;
  };

  // Create item object from form values
  const createItemFromValues = (values: any): EstimateLineItem => {
    return {
      ...values,
      id: editingItem?.id || generateId(),  // Preserve existing ID or generate new one
      name: values.name.trim(),
      description: currentItemDescription,
      note: currentItemNote,
      total: lineAmount(values.quantity, values.unit_price),
      primary_group: sections[editingSectionIndex!]?.title,
      taxable: values.taxable !== false, // Default to taxable if not specified
    };
  };

  // Save or update item in section
  const saveItemToSection = (item: EstimateLineItem) => {
    const idx = editingSectionIndex!;
    const newSections = sections.map((section, i) => {
      if (i !== idx) return section;
      // Deep copy the target section and its items array so memo() detects the change
      const newItems = editingIndex !== null
        ? section.items.map((it, j) => j === editingIndex ? item : it)
        : [...section.items, item];
      return {
        ...section,
        items: newItems,
        subtotal: calculateSectionSubtotal(newItems, section),
      };
    });

    setSections(newSections);

    // Auto-expand the section when an item is added
    const sectionId = sections[idx].id;
    expandSection(sectionId);
  };

  const handleItemSave = async () => {
    try {
      const values = await itemForm.validateFields();
      
      // Validate form values
      const validationError = validateItemValues(values);
      if (validationError) {
        message.error(validationError);
        return;
      }

      let lineItemId: string | undefined = undefined;

      // Save to database if checkbox is checked
      if (values.saveToDatabase) {
        const lineItemData = {
          type: LineItemType.CUSTOM, // Always CUSTOM for manually added items
          cat: undefined, // No category for custom items (will be NULL in DB)
          item: values.name ? values.name.toString().trim() : undefined, // Item code (optional)
          description: currentItemDescription ? currentItemDescription.trim() : values.name.toString().trim(),
          includes: currentItemNote ? currentItemNote.trim() : '',
          unit: values.unit,
          untaxed_unit_price: Number(values.unit_price),
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
          message.warning('Item will be added to estimate but not saved to library');
        }
      }

      const newItem = createItemFromValues(values);
      
      // Add line_item_id if saved to database
      if (lineItemId) {
        newItem.line_item_id = lineItemId;
      }
      
      saveItemToSection(newItem);

      resetItemModal();
      message.success(editingIndex !== null ? 'Item updated successfully' : 'Item added successfully');
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  // Generate estimate number for selected company
  const generateEstimateNumber = async (companyId: string) => {
    try {
      const newEstimateNumber = await estimateService.generateEstimateNumber(
        companyId,
        'standard'
      );
      form.setFieldsValue({ estimate_number: newEstimateNumber });
      console.log('Generated new estimate number:', newEstimateNumber);
    } catch (error) {
      console.error('Failed to generate estimate number:', error);
      // Fallback to default number if API fails
      const fallbackNumber = `EST-STD-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      form.setFieldsValue({ estimate_number: fallbackNumber });
    }
  };

  // Handle company selection
  const selectCustomCompany = () => {
    setUseCustomCompany(true);
    setSelectedCompany(null);
    form.setFieldValue('company_selection', 'custom');
  };

  const selectExistingCompany = async (companyId: string) => {
    setUseCustomCompany(false);
    const company = companies.find(c => c.id === companyId);

    // Check if company actually changed BEFORE setting the new value
    // Also generate if no company was previously selected (new estimate)
    const currentCompanyId = form.getFieldValue('company_id');
    const shouldGenerateNumber = !currentCompanyId || currentCompanyId !== companyId;

    setSelectedCompany(company || null);
    form.setFieldValue('company_selection', companyId);
    form.setFieldValue('company_id', companyId);

    // Generate new estimate number when company changes or first selection
    if (company && shouldGenerateNumber) {
      await generateEstimateNumber(company.id);
    }
  };

  const handleCompanyChange = async (value: string) => {
    if (value === 'custom') {
      selectCustomCompany();
    } else {
      await selectExistingCompany(value);
    }
  };

  // Validate company selection
  const validateCompanySelection = (): string | null => {
    if (!selectedCompany && !useCustomCompany) {
      return 'Please select a company or choose to enter custom company information';
    }
    return null;
  };

  // Convert sections to flat items array
  const convertSectionsToItems = (): EstimateLineItem[] => {
    const allItems: EstimateLineItem[] = [];
    sections.forEach(section => {
      section.items.forEach(item => {
        console.log('convertSectionsToItems - item before saving:', item);
        console.log('convertSectionsToItems - item.name:', item.name);
        allItems.push({
          ...item,
          primary_group: section.title,
        });
      });
    });
    console.log('convertSectionsToItems - final allItems:', allItems);
    return allItems;
  };

  // Clean notes from duplicate O&P information
  const cleanNotesFromOPInfo = (notes: string): string => {
    if (!notes) return notes;

    // Remove O&P information patterns
    return notes
      .replace(/\n\nO&P:\s*\d+(\.\d+)?%/g, '') // Remove "\n\nO&P: X%"
      .replace(/^O&P:\s*\d+(\.\d+)?%\n?/g, '') // Remove "O&P: X%" at start
      .replace(/\nO&P:\s*\d+(\.\d+)?%/g, '')   // Remove "\nO&P: X%"
      .trim();
  };

  // Create estimate data object
  const createEstimateData = (values: any): EstimateResponse => {
    const allItems = convertSectionsToItems();
    const grandTotal = calculateGrandTotal;

    return {
      ...values,
      estimate_type: 'standard',  // Mark as standard estimate
      company_id: useCustomCompany ? undefined : selectedCompany?.id,
      estimate_date: values.estimate_date?.format('YYYY-MM-DD'),
      items: allItems,
      sections: sections,
      is_lump_sum_document: isLumpSumDocument,
      lump_sum_document_amount: isLumpSumDocument ? lumpSumDocumentAmount : undefined,
      op_percent: opPercent,
      op_amount: grandTotal.opAmount,
      subtotal: grandTotal.subtotal,
      adjustments: adjustments.length > 0 ? adjustments.map(adj => ({
        name: adj.name,
        percentage: adj.percentage,
        type: adj.type,
        order: adj.order,
      })) : undefined,
      tax_method: taxMethod,
      tax_rate: taxMethod === 'percentage' ? taxRate : 0,
      tax_amount: grandTotal.taxAmount,
      total_amount: grandTotal.total,
      notes: cleanNotesFromOPInfo(values.notes),
      payment_schedule: paymentSchedule,
    };
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const values = await form.validateFields();

      // Validate company information
      const companyValidationError = validateCompanySelection();
      if (companyValidationError) {
        message.error(companyValidationError);
        return;
      }

      const estimateData = createEstimateData(values);

      // Ensure company_id from form is used (for edit mode company changes)
      const formCompanyId = form.getFieldValue('company_id') || form.getFieldValue('company_selection');
      if (formCompanyId && formCompanyId !== 'custom') {
        estimateData.company_id = formCompanyId;
      }

      if (isEditMode) {
        await estimateService.updateEstimate(id!, estimateData);
        message.success('Estimate updated successfully');
        // Reload the estimate data instead of navigating away
        await loadEstimate();
      } else {
        const created = await estimateService.createEstimate(estimateData);
        message.success('Estimate created successfully');
        navigate(`/edit/estimate/${created.id}`);
      }
    } catch (error) {
      console.error('Failed to save estimate:', error);
      message.error('Failed to save estimate');
    } finally {
      setIsSaving(false);
    }
  };

  // Create PDF preview data with company fields
  const createPdfPreviewData = (values: any) => {
    const allItems = convertSectionsToItems();
    const grandTotal = calculateGrandTotal;

    const previewData = {
      ...values,
      estimate_date: values.estimate_date?.format('YYYY-MM-DD'),
      items: allItems,
      sections: sections,
      is_lump_sum_document: isLumpSumDocument,
      lump_sum_document_amount: isLumpSumDocument ? lumpSumDocumentAmount : undefined,
      op_percent: opPercent,
      op_amount: grandTotal.opAmount,
      subtotal: grandTotal.subtotal,
      adjustments: adjustments.length > 0 ? adjustments.map(adj => ({
        name: adj.name,
        percentage: adj.percentage,
        type: adj.type,
        order: adj.order,
      })) : undefined,
      tax_method: taxMethod,
      tax_rate: taxMethod === 'percentage' ? taxRate : 0,
      tax_amount: grandTotal.taxAmount,
      total_amount: grandTotal.total,
      // Add company fields AFTER spreading values to prevent override
      company_id: useCustomCompany ? undefined : selectedCompany?.id,
      company_name: selectedCompany?.name || '',
      company_address: selectedCompany?.address || '',
      company_city: selectedCompany?.city || '',
      company_state: selectedCompany?.state || '',
      company_zipcode: selectedCompany?.zipcode || '',
      company_phone: selectedCompany?.phone || '',
      company_email: selectedCompany?.email || '',
      company_logo: selectedCompany?.logo || '',
      payment_schedule: paymentSchedule,
    };

    return previewData;
  };


  // Handle PDF preview errors
  const handlePdfPreviewError = (error: any) => {
    console.error('Failed to generate PDF preview:', error);

    const errorMessage = error?.message || 'Failed to generate PDF preview';
    message.error(errorMessage);

    // If it's a network error, suggest checking connection
    if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('Network')) {
      message.error('Network error. Please check your internet connection and try again.');
    }
  };

  const handlePreviewPDF = async () => {
    try {
      setIsPreviewing(true);
      const values = await form.validateFields();

      // Validate company information
      const companyValidationError = validateCompanySelection();
      if (companyValidationError) {
        message.error(companyValidationError);
        return;
      }

      const pdfData = createPdfPreviewData(values);

      // Get HTML preview and open in new window (working approach without WeasyPrint)
      const htmlContent = await estimateService.previewHTML(pdfData, pdfTemplateType, includeSignature);

      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(sanitizeHtmlDocument(htmlContent));
        newWindow.document.close();
        newWindow.document.title = `Estimate Preview - ${pdfData.estimate_number || 'Draft'}`;
      } else {
        message.error('Popup blocked. Please allow popups for this site to view the preview.');
      }

    } catch (error: any) {
      handlePdfPreviewError(error);
    } finally {
      setIsPreviewing(false);
    }
  };


  const companySelectOptions = [
    ...companies.map(company => ({
      key: company.id,
      value: company.id,
      label: company.name
    })),
    {
      value: 'custom',
      label: (
        <>
          <Space>
            <EditOutlined />
            <span>Enter Custom Company</span>
          </Space>
        </>
      )
    }
  ];

  // Show loading spinner when editing an existing estimate
  if (isEditMode && isDataLoading) {
    return (
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spin size="large" tip="Loading estimate..." />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '12px' : '24px', paddingBottom: isMobile ? 84 : undefined }}>
      <Title level={isMobile ? 3 : 2} style={{ marginTop: 0, marginBottom: 16 }}>
        {isEditMode ? 'Edit Estimate' : 'Create Estimate'}
      </Title>

      <Form form={form} layout="vertical" initialValues={{ estimate_date: dayjs(), status: 'draft' }}>
        <Row gutter={24}>
          {/* Estimate Details */}
          <Col xs={24}>
            <Card title="Estimate Details" style={{ marginBottom: 24 }}>
              <Form.Item
                label="Select Company"
                style={{ marginBottom: 16 }}
                name="company_selection"
                rules={[{ required: true, message: 'Please select a company or choose custom company' }]}
              >
                <Select
                  value={useCustomCompany ? 'custom' : selectedCompany?.id || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  showSearch
                  filterOption={(input, option) =>
                    typeof option?.label === 'string' && option.label.toLowerCase().includes(input.toLowerCase())
                  }
                  options={companySelectOptions}
                />
              </Form.Item>

              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="estimate_number"
                    label="Estimate Number"
                    rules={[{ required: true, message: 'Please enter estimate number' }]}
                  >
                    <Input
                      prefix="#"
                      placeholder={isEditMode ? "Estimate number" : "Select company to generate number"}
                      readOnly={!isEditMode && !selectedCompany}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="estimate_date"
                    label="Estimate Date"
                    rules={[{ required: true, message: 'Please select estimate date' }]}
                  >
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="status" label="Status">
                    <Select options={statusOptions} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Client Information */}
          <Col xs={24}>
            <Card title="Client Information" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                {/* Client Name, Email, Phone in one row */}
                <Col xs={24} md={8}>
                  <Form.Item name="client_name" label="Client Name">
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
                    checked={showInsuranceInfo}
                    onChange={setShowInsuranceInfo}
                    checkedChildren="Yes"
                    unCheckedChildren="No"
                  />
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              {showInsuranceInfo && (
                <Row gutter={16}>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_company" label="Insurance Company">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="policy_number" label="Policy Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="claim_number" label="Claim Number">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="deductible" label="Deductible">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        step={100}
                        formatter={(value?: string | number) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={(value?: string) => parseFloat(value?.replace(/\$\s?|(,*)/g, '') || '0') || 0}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Card>
          </Col>
        </Row>

        {/* Estimate Items - Section Based */}
        <Card title="Estimate Items" style={{ marginBottom: 24 }}>
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
            sensors={unifiedSensors}
            collisionDetection={closestCenter}
            onDragStart={handleUnifiedDragStart}
            onDragEnd={handleUnifiedDragEnd}
            onDragCancel={resetDragState}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="sections-container">
                {sections.map((section, sectionIndex) => (
                  <SortableSectionItem key={section.id} id={section.id}>
                    <DocumentSectionPanel
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
                      formatAmount={formatCurrency}
                      onAddItem={() => addItemToSection(sectionIndex)}
                      onEditSection={() => {
                        setEditingSectionName(section.title);
                        setEditingSectionId(section.id);
                        setSectionModalVisible(true);
                      }}
                      onDeleteSection={() => deleteSection(sectionIndex)}
                      onToggleLumpSum={toggleSectionLumpSum}
                      onLumpSumAmountChange={updateSectionLumpSumAmount}
                      hidePricing={isLumpSumDocument}
                    >
                      {section.items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#8c8c8c' }}>
                          No items in this section. Click "Add Item" to add items.
                        </div>
                      ) : (
                        <div
                          tabIndex={0}
                          onKeyDown={(e) => handleDeleteKeyPress(e, sectionIndex)}
                          style={{ outline: 'none' }}
                        >
                          <SectionItemsTable
                            sectionIndex={sectionIndex}
                            items={section.items}
                            activeId={activeId}
                            taxMethod={taxMethod}
                            selectedRowKeys={selectedItemKeys[sectionIndex] || []}
                            onRowSelection={(keys) => handleItemRowSelection(sectionIndex, keys)}
                            onEditItem={(index) => editItemInSection(sectionIndex, index)}
                            onDeleteItem={(index) => deleteSingleItem(sectionIndex, index)}
                            onTaxableChange={(index, checked) => handleTaxableChange(sectionIndex, index, checked)}
                            onToggleAllTaxable={(checked) => handleToggleAllTaxable(sectionIndex, checked)}
                            formatCurrency={formatCurrency}
                            hidePricing={isLumpSumDocument}
                          />
                        </div>
                      )}
                    </DocumentSectionPanel>
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
                          <span style={{ color: '#1890ff', marginLeft: 'auto' }}>{formatCurrency(section.subtotal)}</span>
                        </div>
                      );
                    }
                  } else if (activeDragType === 'item' && activeSectionIndex !== null) {
                    // Parse ID format: item-{sectionIndex}-{itemId} where itemId may contain dashes (UUID)
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
                            <span style={{ color: '#1890ff', marginLeft: 'auto' }}>{formatCurrency(lineAmount(item.quantity, item.unit_price))}</span>
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
              <Col>{formatCurrency(calculateGrandTotal.subtotal)}</Col>
            </Row>
          </div>
        </Card>

        {/* Notes and Payment Summary */}
        <Row gutter={24}>
          <Col xs={24} lg={12}>
            <Card title="Additional Information" style={{ marginBottom: 24 }}>
              <Form.Item name="notes" label="Notes">
                <RichTextEditor
                  placeholder="Additional notes for the estimate..."
                  minHeight={150}
                />
              </Form.Item>
              <Form.Item name="terms" label="Terms & Conditions">
                <RichTextEditor
                  placeholder="Terms and conditions..."
                  minHeight={120}
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card
              title="Payment Summary"
              style={{ marginBottom: 24 }}
              extra={
                <Tooltip title="Lump sum document: hides qty/unit/rate/amount for all items and shows a single total you enter directly, instead of the calculated total">
                  <Space onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 12, color: '#8c8c8c' }}>Lump Sum Document</span>
                    <Switch
                      checked={isLumpSumDocument}
                      onChange={setIsLumpSumDocument}
                    />
                  </Space>
                </Tooltip>
              }
            >
              {isLumpSumDocument ? (
                <Form.Item label="Total Amount">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    size="large"
                    value={lumpSumDocumentAmount}
                    onChange={(value) => setLumpSumDocumentAmount(value || 0)}
                    formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                  />
                </Form.Item>
              ) : (
                <>
                  {/* Adjustments Section */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 'bold' }}>Adjustments</span>
                        <Tooltip title="Add custom adjustments (e.g., Holiday Premium, Discount, O&P) that are applied in order to the subtotal. Drag to change the order.">
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
                        <strong>Name</strong> | <strong>+/−</strong> (add or subtract) | <strong>%</strong> (of the running subtotal) | <strong>Result</strong> (auto-calculated)
                      </div>
                    )}
                    {adjustments.length === 0 && (
                      <div style={{ padding: '8px 0', color: '#8c8c8c', fontSize: '12px' }}>
                        No adjustments. Use legacy O&P field below, or add custom adjustments above.
                      </div>
                    )}
                    <DndContext
                      sensors={unifiedSensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={handleAdjustmentDragEnd}
                    >
                      <SortableContext items={adjustments.map(a => a.id)} strategy={verticalListSortingStrategy}>
                        {adjustments.map((adj) => (
                          <SortableAdjustmentRow
                            key={adj.id}
                            adj={adj}
                            amount={calculateGrandTotal.adjustments?.find(a => a.adjustment.id === adj.id)?.amount}
                            onChange={handleAdjustmentChange}
                            onRemove={handleRemoveAdjustment}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </div>

                  {/* Legacy O&P (shown only if no adjustments) */}
                  {adjustments.length === 0 && (
                    <Form.Item label="O&P Percentage (%) (Legacy)">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        max={100}
                        step={0.1}
                        value={opPercent}
                        onChange={(value) => setOpPercent(typeof value === 'number' ? value : 0)}
                        formatter={(value?: string | number) => `${value}%`}
                        parser={(value?: string) => parseFloat(value?.replace('%', '') || '0') || 0}
                      />
                    </Form.Item>
                  )}

                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
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
                    <Col xs={24} sm={12}>
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
                        <Form.Item label="Tax Amount">
                          <InputNumber
                            style={{ width: '100%' }}
                            min={0}
                            value={specificTaxAmount}
                            onChange={value => setSpecificTaxAmount(value || 0)}
                            formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={value => value!.replace(/\$\s?|(,*)/g, '') as any}
                          />
                        </Form.Item>
                      )}
                    </Col>
                  </Row>

                  {taxMethod === 'percentage' && (
                    <Form.Item label="All Items Taxable">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Switch
                          checked={sections.every(section =>
                            section.items.every(item => item.taxable !== false)
                          )}
                          onChange={(checked) => {
                            const newSections = sections.map(section => ({
                              ...section,
                              items: section.items.map(item => ({
                                ...item,
                                taxable: checked
                              }))
                            }));
                            setSections(newSections);
                          }}
                          checkedChildren="All Taxable"
                          unCheckedChildren="Mixed"
                        />
                        <span style={{ color: '#666', fontSize: '12px' }}>
                          Toggle taxable status for all items across all sections
                        </span>
                      </div>
                    </Form.Item>
                  )}
                </>
              )}

              {/* Payment Schedule */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 'bold' }}>Payment Schedule</span>
                  <Tooltip title="Payment milestones shown on the estimate, as a percentage of the total or a fixed amount">
                    <span style={{ marginLeft: '8px', color: '#8c8c8c', fontSize: '12px', cursor: 'help' }}>ℹ️</span>
                  </Tooltip>
                </div>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {paymentSchedule.map((item, index) => {
                    const computedAmount = item.type === 'percentage'
                      ? (calculateGrandTotal.total * item.value / 100)
                      : item.value;
                    const updateScheduleItem = (patch: Partial<PaymentScheduleItem>) => {
                      setPaymentSchedule(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
                    };
                    return (
                      <div
                        key={index}
                        style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid #f0f0f0', borderRadius: '4px' }}
                      >
                        <Row gutter={8} align="middle" wrap={false}>
                          <Col flex="auto">
                            <Input
                              placeholder="Label (e.g. Deposit)"
                              value={item.label}
                              onChange={e => updateScheduleItem({ label: e.target.value })}
                              size="small"
                            />
                          </Col>
                          <Col>
                            <span style={{ fontWeight: 'bold' }}>{formatCurrency(computedAmount)}</span>
                          </Col>
                          <Col>
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                setPaymentSchedule(prev =>
                                  prev.filter((_, i) => i !== index).map((p, i) => ({ ...p, sort_order: i }))
                                );
                              }}
                            />
                          </Col>
                        </Row>
                        <Row gutter={8}>
                          <Col xs={24} sm={10}>
                            <InputNumber
                              value={item.value}
                              onChange={val => updateScheduleItem({ value: val || 0 })}
                              size="small"
                              style={{ width: '100%' }}
                              min={0}
                              max={item.type === 'percentage' ? 100 : undefined}
                              precision={2}
                              addonAfter={
                                <Select
                                  value={item.type}
                                  onChange={val => updateScheduleItem({ type: val as 'percentage' | 'fixed' })}
                                  size="small"
                                  style={{ width: 52 }}
                                  popupMatchSelectWidth={false}
                                  options={[
                                    { label: '%', value: 'percentage' },
                                    { label: '$', value: 'fixed' },
                                  ]}
                                />
                              }
                            />
                          </Col>
                          <Col xs={24} sm={14}>
                            <Input
                              placeholder="Due (e.g. Upon signing)"
                              value={item.due_label || ''}
                              onChange={e => updateScheduleItem({ due_label: e.target.value })}
                              size="small"
                            />
                          </Col>
                        </Row>
                      </div>
                    );
                  })}
                  {paymentSchedule.length > 0 && (() => {
                    const scheduleTotal = paymentSchedule.reduce((sum, item) => {
                      return sum + (item.type === 'percentage'
                        ? calculateGrandTotal.total * item.value / 100
                        : item.value);
                    }, 0);
                    const diff = calculateGrandTotal.total - scheduleTotal;
                    return (
                      <div style={{ padding: '8px 12px', background: '#fafafa', borderRadius: 4 }}>
                        <Row justify="space-between">
                          <span>Schedule Total:</span>
                          <strong>{formatCurrency(scheduleTotal)}</strong>
                        </Row>
                        {Math.abs(diff) > 0.01 && (
                          <Row justify="space-between" style={{ color: diff > 0 ? '#cb912f' : '#d44c47' }}>
                            <span>{diff > 0 ? 'Remaining:' : 'Over:'}</span>
                            <strong>{formatCurrency(Math.abs(diff))}</strong>
                          </Row>
                        )}
                      </div>
                    );
                  })()}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setPaymentSchedule(prev => [
                        ...prev,
                        {
                          label: '',
                          type: 'percentage',
                          value: 0,
                          due_label: '',
                          sort_order: prev.length,
                        },
                      ]);
                    }}
                  >
                    Add Payment
                  </Button>
                </Space>
              </div>

              <Divider />

              {isLumpSumDocument ? (
                <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                  <Col>Total:</Col>
                  <Col>{formatCurrency(calculateGrandTotal.total)}</Col>
                </Row>
              ) : (
                <div style={{ fontSize: '16px' }}>
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Items Subtotal:</Col>
                    <Col>{formatCurrency(calculateGrandTotal.subtotal)}</Col>
                  </Row>

                  {calculateGrandTotal.adjustments && calculateGrandTotal.adjustments.length > 0 ? (
                    calculateGrandTotal.adjustments.map((adjData) => {
                      const effective = adjData.adjustment.type === 'subtract' ? -adjData.amount : adjData.amount;
                      return (
                        <Row key={adjData.adjustment.id} justify="space-between" style={{ marginBottom: 8 }}>
                          <Col>
                            {adjData.adjustment.name || 'Adjustment'}
                            {adjData.adjustment.percentage !== 0 && ` (${Math.abs(adjData.adjustment.percentage)}%)`}
                          </Col>
                          <Col>
                            {effective < 0 ? '-' : '+'}
                            {formatCurrency(Math.abs(effective))}
                          </Col>
                        </Row>
                      );
                    })
                  ) : (
                    opPercent > 0 && (
                      <Row justify="space-between" style={{ marginBottom: 8 }}>
                        <Col>O&P ({opPercent}%):</Col>
                        <Col>{formatCurrency(calculateGrandTotal.opAmount)}</Col>
                      </Row>
                    )
                  )}

                  {calculateGrandTotal.taxAmount > 0 && (
                    <Row justify="space-between" style={{ marginBottom: 8 }}>
                      <Col>
                        Tax {taxMethod === 'percentage' ? `(${taxRate}%)` : ''}:
                      </Col>
                      <Col>{formatCurrency(calculateGrandTotal.taxAmount)}</Col>
                    </Row>
                  )}
                  <Divider />
                  <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                    <Col>Total:</Col>
                    <Col>{formatCurrency(calculateGrandTotal.total)}</Col>
                  </Row>
                </div>
              )}
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Space size="middle" wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={isSaving}
              disabled={isPreviewing || isDataLoading}
            >
              {isEditMode ? 'Update' : 'Save'}
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewPDF}
              loading={isPreviewing}
              disabled={isSaving || isDataLoading}
            >
              Preview PDF
            </Button>
            <Divider type="vertical" />
            <Space size={8}>
              <span>PDF Template</span>
              <Select
                value={pdfTemplateType}
                onChange={setPdfTemplateType}
                style={{ width: 132 }}
                aria-label="PDF template"
                options={[
                  { value: 'invoice', label: 'Standard' },
                  { value: 'estimate', label: 'Enhanced' }
                ]}
              />
            </Space>
            <Checkbox
              checked={includeSignature}
              onChange={(e) => setIncludeSignature(e.target.checked)}
              style={{ whiteSpace: 'nowrap' }}
            >
              Include Signature Area
            </Checkbox>
            <Divider type="vertical" />
            <Button onClick={() => navigate('/documents/estimate')}>
              Cancel
            </Button>
          </Space>
        </Card>
      </Form>

      {isMobile && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: zIndexScale.actionBar,
            display: 'flex',
            gap: 8,
            padding: '10px 12px',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
            background: '#fff',
            borderTop: '1px solid #d9d9d9',
            boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.15)',
          }}
        >
          <Button
            icon={<EyeOutlined />}
            onClick={handlePreviewPDF}
            loading={isPreviewing}
            disabled={isSaving || isDataLoading}
            style={{ flex: 1 }}
          >
            Preview
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={isSaving}
            disabled={isPreviewing || isDataLoading}
            style={{ flex: 1 }}
          >
            {isEditMode ? 'Update' : 'Save'}
          </Button>
        </div>
      )}

      {/* Item Modal */}
      <Modal
        title={editingItem ? 'Edit Item' : 'Add Item'}
        open={itemModalVisible}
        onOk={handleItemSave}
        onCancel={resetItemModal}
        width={600}
      >
        <Form form={itemForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item
                name="name"
                label="Item Code (Optional)"
                tooltip="If not provided, will be auto-generated from description"
              >
                <ItemCodeSelector
                  placeholder="Enter item code, search line items, or leave blank to auto-generate"
                  onLineItemAdd={handleLineItemsAdd}
                  mode={editingIndex !== null ? 'edit' : 'add'}
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[{ required: true, message: 'Please enter quantity' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="0"
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Form.Item
                name="unit"
                label="Unit"
                rules={[{ required: true, message: 'Please select or enter unit' }]}
              >
                <UnitSelect
                  componentVariant="autocomplete"
                  placeholder="Select or enter unit"
                />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Form.Item
                name="unit_price"
                label="Unit Price"
                rules={[
                  { required: true, message: 'Please enter unit price' },
                  { type: 'number', message: 'Unit price must be a valid number' }
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
              <Col xs={12} sm={8} md={6}>
                <Form.Item
                  name="taxable"
                  label="Taxable"
                  valuePropName="checked"
                >
                  <Switch checkedChildren="Yes" unCheckedChildren="No" />
                </Form.Item>
              </Col>
            )}
            <Col xs={24}>
              <Form.Item label="Description">
                <RichTextEditor
                  value={currentItemDescription}
                  onChange={setCurrentItemDescription}
                  placeholder="Enter item description with formatting..."
                  minHeight={120}
                  maxHeight={180}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="Note">
                <RichTextEditor
                  value={currentItemNote}
                  onChange={setCurrentItemNote}
                  placeholder="Additional notes or specifications..."
                  minHeight={80}
                  maxHeight={120}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item
                name="saveToDatabase"
                valuePropName="checked"
                tooltip="Save this line item with description and note to database for future use in other estimates"
              >
                <Checkbox>
                  Save to database (with description and note)
                </Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Section Name Edit Modal */}
      <Modal
        title="Edit Section Name"
        open={sectionModalVisible}
        onOk={handleSectionNameUpdate}
        onCancel={resetSectionModal}
      >
        <Input
          value={editingSectionName}
          onChange={(e) => setEditingSectionName(e.target.value)}
          placeholder="Enter section name"
          onPressEnter={handleSectionNameUpdate}
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

export default EstimateCreation;