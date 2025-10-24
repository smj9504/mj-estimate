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
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
  FileTextOutlined,
  AppstoreAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import DraggableTable from '../components/common/DraggableTable';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { invoiceService, InvoiceSection } from '../services/invoiceService';
import { companyService } from '../services/companyService';
import { Company } from '../types';
import RichTextEditor from '../components/editor/RichTextEditor';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';
import ItemCodeSelector from '../components/estimate/ItemCodeSelector';
import { EstimateLineItem } from '../services/estimateService';
import SortableSection from '../components/common/SortableSection';
import LineItemTemplateSelector from '../components/line-items/LineItemTemplateSelector';
import LineItemTemplateManager from '../components/line-items/LineItemTemplateManager';
import TemplateBuilderBar from '../components/line-items/TemplateBuilderBar';
import TemplateBuilderModal from '../components/line-items/TemplateBuilderModal';
import lineItemService from '../services/lineItemService';
import { useTemplateBuilder } from '../contexts/TemplateBuilderContext';
import {
  Collapse,
  Tag,
  Badge,
  Checkbox,
} from 'antd';
import { receiptService } from '../services/receiptService';
import type { ReceiptTemplate } from '../types/receipt';
import { useCompanies } from '../hooks/useCompanyQueries';
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

const InvoiceCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  const [formMounted, setFormMounted] = useState(false);

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

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [itemForm] = Form.useForm();
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
  const [useCustomClient, setUseCustomClient] = useState(true); // Default to manual input
  const [selectedClient, setSelectedClient] = useState<Company | null>(null);
  const [opPercent, setOpPercent] = useState(0);

  // Receipt generation state
  // React Query: Load receipt templates when company is selected
  const { data: receiptTemplates = [] } = useReceiptTemplates(selectedCompany?.id);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [receiptDate, setReceiptDate] = useState<dayjs.Dayjs | null>(null);
  const [receiptTopNote, setReceiptTopNote] = useState<string>('');
  const [receiptBottomNote, setReceiptBottomNote] = useState<string>('');
  const [generatingReceipt, setGeneratingReceipt] = useState(false);

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

  // Setup sensors for drag interactions
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
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
      if (activeIdStr.startsWith('item-') && overIdStr.startsWith('item-')) {
        const activeParts = activeIdStr.split('-');
        const overParts = overIdStr.split('-');

        if (activeParts.length >= 3 && overParts.length >= 3) {
          const activeSectionIdx = parseInt(activeParts[1]);
          const overSectionIdx = parseInt(overParts[1]);

          // Only allow reordering within the same section
          if (activeSectionIdx === overSectionIdx) {
            const activeItemIdx = parseInt(activeParts[2]);
            const overItemIdx = parseInt(overParts[2]);

            if (activeItemIdx !== overItemIdx) {
              const newSections = [...sections];
              const sectionItems = [...newSections[activeSectionIdx].items];
              const newItems = arrayMove(sectionItems, activeItemIdx, overItemIdx);
              newSections[activeSectionIdx].items = newItems;
              newSections[activeSectionIdx].subtotal = calculateSectionSubtotal(newItems);
              setSections(newSections);
            }
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
    const groupedItems: { [key: string]: InvoiceItem[] } = {};

    items.forEach(item => {
      const groupKey = item.primary_group || 'Default Section';
      if (!groupedItems[groupKey]) {
        groupedItems[groupKey] = [];
      }
      groupedItems[groupKey].push(item);
    });

    return Object.entries(groupedItems).map(([title, groupItems], index) => ({
      id: `section-${index}`,
      title,
      items: groupItems,
      showSubtotal: true,
      subtotal: groupItems.reduce((sum, item) => sum + (item.amount || (item.quantity * item.rate)), 0),
    }));
  };

  const convertSectionsToItems = (): InvoiceItem[] => {
    const allItems: InvoiceItem[] = [];
    sections.forEach(section => {
      section.items.forEach(item => {
        allItems.push({
          ...item,
          primary_group: section.title,
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

  const calculateSectionSubtotal = (items: InvoiceItem[]): number => {
    return items.reduce((sum, item) => sum + (item.amount || (item.quantity * item.rate)), 0);
  };

  // Add items to a specific section
  const addItemsToSection = (sectionIndex: number, itemsToAdd: EstimateLineItem[]) => {
    const newSections = [...sections];
    const currentSection = sections[sectionIndex];

    // Debug: Log incoming items
    console.log('=== DEBUG: addItemsToSection ===');
    console.log('Items to add:', itemsToAdd);
    itemsToAdd.forEach((item, idx) => {
      console.log(`Source item ${idx}:`, {
        id: item.id,
        line_item_id: item.line_item_id,
        name: item.name,
        hasLineItemId: !!item.line_item_id
      });
    });

    // Convert EstimateLineItem to InvoiceItem and update with section title
    const convertedItems: InvoiceItem[] = itemsToAdd.map(item => ({
      id: item.id,
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
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);

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
        const itemName = lineItem?.cat || lineItem?.name || embeddedData?.item_code || '';
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

    // DEBUG: Check raw items data from backend
    if (data.items && data.items.length > 0) {
      console.log('=== RAW ITEMS FROM BACKEND ===');
      data.items.forEach((item: any, idx: number) => {
        console.log(`Raw item ${idx}:`, {
          id: item.id,
          line_item_id: item.line_item_id,
          name: item.name,
          hasLineItemId: !!item.line_item_id
        });
      });
    }

    // Convert items to sections or use existing sections
    if (data.sections && data.sections.length > 0) {
      setSections(data.sections);
      setActiveKeys(data.sections.map((s: any) => s.id));
    } else if (data.items && data.items.length > 0) {
      const processedItems = data.items.map((item: any) => ({
        id: item.id,
        line_item_id: item.line_item_id, // IMPORTANT: Preserve line_item_id for template creation
        name: item.name || item.description,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit || 'EA',
        rate: item.rate || item.unit_price,
        amount: item.amount || item.total,
        taxable: item.taxable !== false,
        primary_group: item.primary_group,
        secondary_group: item.secondary_group,
        sort_order: item.sort_order,
        note: item.note,
      }));

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
      tax_rate: data.tax_rate || 0,
      tax_amount: data.tax_amount || 0,
      discount: data.discount || data.discount_amount || 0,
      op_percent: data.op_percent || 0,
      insurance_company: data.insurance_company || '',
      insurance_policy_number: data.insurance_policy_number || '',
      insurance_claim_number: data.insurance_claim_number || '',
      insurance_deductible: data.insurance_deductible || 0,
    };
    form.setFieldsValue(formValues);

    // Set tax method and amount
    if (data.tax_method) {
      setTaxMethod(data.tax_method);
      if (data.tax_method === 'percentage') {
        setTaxRate(data.tax_rate || 0);
      }
      if (data.tax_method === 'specific') {
        setSpecificTaxAmount(data.tax_amount || 0);
      }
    }

    // Set discount state
    setDiscount(data.discount || data.discount_amount || 0);

    // Set insurance visibility
    if (data.insurance_company || data.insurance_policy_number || data.insurance_claim_number || data.insurance_deductible) {
      setShowInsurance(true);
    }

    // Check if client is a registered company
    if (data.client_company_id && companies.length > 0) {
      const clientCompany = companies.find(c => c.id === data.client_company_id);
      if (clientCompany) {
        setSelectedClient(clientCompany);
        setUseCustomClient(false);
      }
    }

    // Set payments
    if (data.payments && data.payments.length > 0) {
      const processedPayments = data.payments.map((payment: any) => ({
        amount: payment.amount || 0,
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

    // Set O&P percent
    if (data.op_percent !== undefined) {
      setOpPercent(data.op_percent || 0);
    }
  }, [fetchedInvoice, isEditMode, companies, form]);

  // Consolidated reset and mode switching effect
  useEffect(() => {
    // Reset all state when mode changes
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
    setLoading(false);

    // Reset form
    form.resetFields();

    // Set default form values for create mode
    if (!isEditMode) {
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
    // Invoice loading handled by React Query useInvoice hook
  }, [isEditMode, id, form]);

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
      notes: invoiceData.notes,
      terms: invoiceData.terms,
      payment_terms: invoiceData.payment_terms,
    });
  }, [invoiceData, isEditMode, companies, form, selectedCompany]);

  const handleCompanyChange = async (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    if (company) {
      setSelectedCompany(company);
      // Set form value to the selected company ID
      form.setFieldValue('company_selection', companyId);

      // Generate new invoice number based on selected company (only in create mode)
      if (!isEditMode) {
        try {
          const newInvoiceNumber = await invoiceService.generateInvoiceNumber(company.id);
          form.setFieldsValue({ invoice_number: newInvoiceNumber });
          console.log('Generated new invoice number:', newInvoiceNumber);
        } catch (error) {
          console.error('Failed to generate invoice number:', error);
          // Fallback to default number if API fails
          const fallbackNumber = `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
          form.setFieldsValue({ invoice_number: fallbackNumber });
        }
      }
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setEditingIndex(null);
    setItemModalVisible(true);
  };

  const handleEditItem = (item: InvoiceItem, index: number) => {
    setEditingItem(item);
    setEditingIndex(index);
    setItemModalVisible(true);
  };

  const handleItemSubmit = async () => {
    if (editingSectionIndex === null) {
      message.error('Please select a section to add the item to');
      return;
    }

    try {
      const values = await itemForm.validateFields();

      // Comprehensive validation with user-friendly error messages

      // Validate item name/description
      if (!values.name || values.name.toString().trim() === '') {
        message.error('Please enter a valid item code');
        return;
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

      // Validate rate
      if (values.rate === null || values.rate === undefined || values.rate <= 0) {
        message.error('Please enter a valid rate greater than $0');
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

      // Save to database if checkbox is checked or if we need it for templates
      // Always save to library so it can be used in templates
      if (values.saveToDatabase || (!editingIndex && !lineItemId)) {
        const lineItemData = {
          cat: '', // Category code - empty for custom items
          description: values.name.toString().trim(),
          includes: values.description ? values.description.toString().trim() : '',
          unit: values.unit,
          untaxed_unit_price: Number(values.rate),
          company_id: selectedCompany?.id,
          is_active: true,
          note_ids: [],
        };

        try {
          const createdLineItem = await lineItemService.createLineItem(lineItemData);
          lineItemId = createdLineItem.id;
          console.log('Created line item with ID:', lineItemId);
          if (values.saveToDatabase) {
            message.success('Item saved to library successfully');
          }
        } catch (error) {
          console.error('Failed to save line item to library:', error);
          if (values.saveToDatabase) {
            message.warning('Item will be added to invoice but not saved to library');
          }
        }
      }

      const newItem: InvoiceItem = {
        ...values,
        line_item_id: lineItemId, // Set line_item_id from created library item or preserved from editing
        name: values.name.toString().trim(),
        description: values.description ? values.description.toString().trim() : '',
        note: values.note || '',
        quantity: Number(values.quantity),
        rate: Number(values.rate),
        amount: Number(values.quantity) * Number(values.rate),
        taxable: values.taxable !== false, // Default to taxable if not specified
        primary_group: sections[editingSectionIndex]?.title,
      };

      console.log('Created invoice item with line_item_id:', newItem.line_item_id);

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
      newSections[editingSectionIndex].subtotal = calculateSectionSubtotal(newSections[editingSectionIndex].items);
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

  const calculateTotals = useCallback(() => {
    // Calculate subtotal from sections
    const itemsSubtotal = sections.reduce((sum, section) => sum + section.subtotal, 0);

    // Calculate O&P on items subtotal
    const opAmount = itemsSubtotal * (opPercent / 100);

    let taxAmount = 0;
    if (taxMethod === 'percentage') {
      // Calculate tax on taxable items only
      const taxableAmount = sections.reduce((sum, section) => {
        return sum + section.items.reduce((itemSum, item) => {
          if (item.taxable !== false) { // Default to taxable if not specified
            return itemSum + (item.amount || (item.quantity * item.rate));
          }
          return itemSum;
        }, 0);
      }, 0);

      // Calculate tax on taxable amount + proportional O&P
      const taxableRatio = itemsSubtotal > 0 ? taxableAmount / itemsSubtotal : 0;
      const taxableOpAmount = opAmount * taxableRatio;
      taxAmount = (taxableAmount + taxableOpAmount) * (taxRate / 100);
    } else {
      taxAmount = specificTaxAmount;
    }

    // Subtotal includes Items + O&P + Tax
    const subtotal = itemsSubtotal + opAmount + taxAmount;

    // Total is subtotal minus discount, then subtract payments for balance
    const total = subtotal - discount;
    const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balanceDue = total - totalPaid;

    return {
      itemsSubtotal,
      opAmount,
      subtotal,
      discount,
      taxAmount,
      total,
      totalPaid,
      balanceDue,
    };
  }, [sections, taxMethod, taxRate, specificTaxAmount, discount, payments, form, formMounted, opPercent]);

  const handleSave = async (status: string = 'pending', skipNavigation: boolean = false) => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Validate company information
      if (!selectedCompany) {
        message.error('Please select a company');
        setLoading(false);
        return null;
      }

      const totals = calculateTotals();

      // Prepare invoice data
      const invoiceData: any = {
        invoice_number: values.invoice_number,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        status,
        company_id: selectedCompany.id, // Always use company_id from selected company
      };

      // Add client info (always from form fields, which are auto-filled if company selected)
      invoiceData.client = {
        name: values.client_name,
        address: values.client_address,
        city: values.client_city,
        state: values.client_state,
        zipcode: values.client_zipcode,
        phone: values.client_phone,
        email: values.client_email,
      };

      // Optionally store client_company_id if client was selected from registered companies
      if (!useCustomClient && selectedClient) {
        invoiceData.client_company_id = selectedClient.id;
      }

      invoiceData.insurance = showInsurance ? {
        company: values.insurance_company,
        policy_number: values.insurance_policy_number,
        claim_number: values.insurance_claim_number,
        deductible: values.insurance_deductible,
      } : null;

      console.log('Current sections state:', JSON.stringify(sections, null, 2));

      // Send both items (converted from sections) and sections
      const allItems = convertSectionsToItems();
      invoiceData.items = allItems;
      invoiceData.sections = sections;
      invoiceData.subtotal = totals.subtotal;
      invoiceData.op_percent = opPercent;
      invoiceData.tax_method = taxMethod;
      invoiceData.tax_rate = taxMethod === 'percentage' ? taxRate : 0;
      invoiceData.tax_amount = taxMethod === 'specific' ? (values.tax_amount || 0) : totals.taxAmount;
      invoiceData.discount = values.discount || 0;
      invoiceData.discount_amount = values.discount || 0;
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

      console.log('Sending invoice data:', JSON.stringify(invoiceData, null, 2));

      let response;
      if (isEditMode && id) {
        // Update existing invoice
        response = await invoiceService.updateInvoice(id, invoiceData);
        message.success('Invoice updated successfully!');
      } else {
        // Create new invoice
        response = await invoiceService.createInvoice(invoiceData);
        message.success('Invoice saved successfully!');
      }

      if (!skipNavigation) {
        navigate(`/documents/invoice`);
      }

      return response;
    } catch (error) {
      message.error('Failed to save invoice');
      console.error(error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewHTML = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // Validate company information
      if (!selectedCompany) {
        message.error('Please select a company');
        setLoading(false);
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
        client: {
          name: values.client_name,
          address: values.client_address,
          city: values.client_city,
          state: values.client_state,
          zipcode: values.client_zipcode,
          phone: values.client_phone,
          email: values.client_email,
        },
        insurance: showInsurance ? {
          company: values.insurance_company,
          policy_number: values.insurance_policy_number,
          claim_number: values.insurance_claim_number,
          deductible: values.insurance_deductible,
        } : null,
        items: convertSectionsToItems(),
        subtotal: totals.subtotal,
        op_percent: opPercent,
        tax_method: taxMethod,
        tax_rate: taxMethod === 'percentage' ? taxRate : 0,
        tax_amount: taxMethod === 'specific' ? (values.tax_amount || 0) : totals.taxAmount,
        discount: values.discount || 0,
        discount_amount: values.discount || 0,
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
      setLoading(false);
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
      setLoading(true);

      // Use existing invoiceData if available, only fetch if null
      let currentInvoiceData = invoiceData;
      if (!currentInvoiceData) {
        currentInvoiceData = await invoiceService.getInvoice(id);
      }

      // Create preview data structure similar to invoice preview
      // Keep all payments from invoiceData for payment history table
      const receiptPreviewData = {
        ...currentInvoiceData,
        receipt_number: payment.receipt_number || `PREVIEW-${Date.now()}`,
        receipt_date: payment.date ? payment.date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        payment_amount: payment.amount,
        payment_method: payment.method,
        payment_reference: payment.reference,
        top_note: payment.top_note,
        bottom_note: payment.bottom_note,
        // Keep all payments from invoice for payment history display
      };

      // Use receipt HTML preview service
      const htmlContent = await receiptService.previewHTML(receiptPreviewData);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');

    } catch (error: any) {
      message.error(`Failed to preview receipt: ${error.response?.data?.detail || error.message}`);
      console.error('Receipt preview error:', error);
    } finally {
      setLoading(false);
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
      render: (value: number) => `$${formatCurrency(value)}`,
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: any, record: InvoiceItem) => `$${formatCurrency(record.quantity * record.rate)}`,
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

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>{isEditMode ? 'Edit Invoice' : 'Create Invoice'}</Title>
      
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
                  value={selectedCompany?.id || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  options={companies.map(company => ({
                    key: company.id,
                    value: company.id,
                    label: company.name
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
                  <Switch
                    size="small"
                    checked={useCustomClient}
                    onChange={(checked) => {
                      setUseCustomClient(checked);
                      if (!checked) {
                        // Clear manual input fields when switching to company selection
                        form.setFieldsValue({
                          client_name: '',
                          client_email: '',
                          client_phone: '',
                          client_address: '',
                          client_city: '',
                          client_state: '',
                          client_zipcode: '',
                        });
                      } else {
                        // Clear selected client
                        setSelectedClient(null);
                      }
                    }}
                    checkedChildren="Manual Input"
                    unCheckedChildren="Select Company"
                  />
                </Space>
              }
              style={{ marginBottom: 24 }}
            >
              {!useCustomClient ? (
                // Company Selection Mode
                <Row gutter={16}>
                  <Col xs={24}>
                    <Form.Item
                      label="Select Client Company"
                      rules={[{ required: true, message: 'Please select a client company' }]}
                    >
                      <Select
                        showSearch
                        placeholder="Select a registered company"
                        optionFilterProp="children"
                        value={selectedClient?.id}
                        onChange={(value) => {
                          const company = companies.find(c => c.id === value);
                          if (company) {
                            setSelectedClient(company);
                            // Auto-fill client fields
                            form.setFieldsValue({
                              client_name: company.name,
                              client_email: company.email || '',
                              client_phone: company.phone || '',
                              client_address: company.address || '',
                              client_city: company.city || '',
                              client_state: company.state || '',
                              client_zipcode: company.zipcode || '',
                            });
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
              ) : (
                // Manual Input Mode
                <Row gutter={16}>
                  {/* Client Name, Email, Phone in one row */}
                  <Col xs={24} md={8}>
                    <Form.Item
                      name="client_name"
                      label="Client Name"
                      rules={[{ required: true, message: 'Please enter client name' }]}
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
                      <Input />
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
          <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              placeholder="Enter section title..."
              value={newSectionTitle}
              onChange={(e) => setNewSectionTitle(e.target.value)}
              onPressEnter={addSection}
              style={{ maxWidth: 300 }}
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
              <Collapse
                activeKey={activeKeys}
                onChange={setActiveKeys}
                expandIconPosition="end"
                size="small"
                items={sections.map((section, sectionIndex) => ({
                  key: section.id,
                  label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Space>
                        <HolderOutlined className="section-drag-handle" style={{ cursor: 'grab', color: '#999' }} />
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
                        >
                          Add Item
                        </Button>
                        <Button
                          size="small"
                          icon={<AppstoreAddOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTemplateTargetSectionIndex(sectionIndex);
                            setTemplateSelectorVisible(true);
                          }}
                        >
                          Apply Template
                        </Button>
                        <Tooltip title="Save section as template">
                          <Button
                            size="small"
                            icon={<FolderAddOutlined />}
                            onClick={async (e) => {
                              e.stopPropagation();

                              // Prepare template items with embedded data support
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

                              console.log('Creating template from section:', {
                                title: section.title,
                                items: templateItems,
                                withLibraryRef: templateItems.filter(i => i.line_item_id).length,
                                withoutLibraryRef: templateItems.filter(i => !i.line_item_id).length
                              });

                              // Save template directly - backend will handle embedded vs reference mode
                              const companyIdForTemplate = invoiceData?.company_id || selectedCompany?.id;
                              saveSectionAsNewTemplate(section.title, templateItems, companyIdForTemplate);
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
                              handleEditSection(section.id, section.title);
                            }}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="Delete this section?"
                          description="This will delete all items in this section."
                          onConfirm={() => deleteSection(sectionIndex)}
                        >
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    </div>
                  ),
                  children: (
                    <div style={{ padding: '8px 0' }}>
                      {section.items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                          No items in this section. Click "Add Item" to add items.
                        </div>
                      ) : (
                        <DraggableTable
                          className="draggable-table"
                          dataSource={section.items.map((item, index) => ({
                            ...item,
                            key: `item-${sectionIndex}-${index}`
                          }))}
                          onReorder={() => {}} // Handled by DnD context
                          pagination={false}
                          size="small"
                          showDragHandle={true}
                          dragHandlePosition="start"
                          dragColumnWidth={30}
                          getRowId={(record, index) => `item-${sectionIndex}-${index}`}
                          disableDrag={false}
                          sectionIndex={sectionIndex}
                          dragType="item"
                          activeId={activeId}
                          columns={[
                            // Item code column hidden - description is the primary identifier
                            // {
                            //   title: 'Item Code',
                            //   dataIndex: 'name',
                            //   key: 'name',
                            //   width: 120,
                            // },
                            {
                              title: 'Description',
                              dataIndex: 'description',
                              key: 'description',
                              ellipsis: true,
                              render: (value) => value ? (
                                <div dangerouslySetInnerHTML={{ __html: value }} />
                              ) : null,
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
                              render: (value) => `$${formatCurrency(value || 0)}`,
                            },
                            {
                              title: 'Amount',
                              key: 'amount',
                              width: 100,
                              align: 'right' as const,
                              render: (_: any, record: InvoiceItem) => `$${formatCurrency((record.quantity || 0) * (record.rate || 0))}`,
                            },
                            ...(taxMethod === 'percentage' ? [{
                              title: (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span>Taxable</span>
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
                                        newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);
                                        setSections(newSections);
                                      }}
                                    />
                                  </Tooltip>
                                </div>
                              ),
                              dataIndex: 'taxable',
                              key: 'taxable',
                              width: 120,
                              align: 'center' as const,
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
                                    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);
                                    setSections(newSections);
                                  }}
                                />
                              ),
                            }] : []),
                            {
                              title: 'Actions',
                              key: 'actions',
                              width: 100,
                              align: 'center' as const,
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
                                        newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);
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
                  ),
                }))}
              />
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
                          <HolderOutlined style={{ color: '#999', fontSize: '12px' }} />
                          <span style={{ fontWeight: '600' }}>{section.title}</span>
                          <Badge count={section.items.length} showZero color="#108ee9" />
                          <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${formatCurrency(section.subtotal)}</span>
                        </div>
                      );
                    }
                  } else if (activeDragType === 'item' && activeSectionIndex !== null) {
                    const parts = activeId.split('-');
                    if (parts.length >= 3 && parts[0] === 'item') {
                      const itemIdx = parseInt(parts[2]);
                      const item = sections[activeSectionIndex]?.items[itemIdx];

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
                            <HolderOutlined style={{ color: '#999', fontSize: '12px' }} />
                            <span style={{ fontWeight: '500' }}>{item.name || 'Item'}</span>
                            <span style={{ color: '#999' }}>- {item.description?.replace(/<[^>]*>/g, '').substring(0, 30)}...</span>
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

              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item name="op_percent" label="O&P Percentage (%)">
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
                            disabled={loading || generatingReceipt}
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
                              disabled={loading || generatingReceipt}
                              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                            >
                              Generate Receipt
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip title="Receipt already generated">
                            <Button
                              size="small"
                              type="default"
                              icon={<FileTextOutlined />}
                              onClick={() => handleGeneratePaymentReceipt(index)}
                              disabled={loading || generatingReceipt}
                            >
                              Regenerate Receipt
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
                {opPercent > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>O&P ({opPercent}%):</Col>
                    <Col>${formatCurrency(totals.opAmount)}</Col>
                  </Row>
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
                {totals.discount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Discount:</Col>
                    <Col>-${formatCurrency(totals.discount)}</Col>
                  </Row>
                )}
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
              loading={loading}
            >
              {isEditMode ? 'Update' : 'Save'}
            </Button>
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreviewHTML}
              loading={loading}
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
        }}
        afterOpenChange={(open) => {
          if (open) {
            // Modal이 완전히 열린 후에 form 값 설정
            if (editingItem) {
              itemForm.setFieldsValue(editingItem);
            } else {
              itemForm.resetFields();
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
            label="Item Code"
            rules={[
              { required: true, message: 'Please enter item code' },
              { whitespace: true, message: 'Item code cannot be empty or just whitespace' },
              { min: 1, message: 'Item code is required' }
            ]}
          >
            <ItemCodeSelector
              onLineItemAdd={handleLineItemsAdd}
              placeholder="Enter item code or search line items"
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
                  { required: true, message: 'Please select unit' }
                ]}
              >
                <UnitSelect />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="rate"
                label="Rate"
                rules={[
                  { required: true, message: 'Please enter rate' },
                  {
                    type: 'number',
                    min: 0.01,
                    message: 'Rate must be greater than $0'
                  }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={0.01}
                  precision={2}
                  placeholder="Enter rate"
                  formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={((value: any) => {
                    const parsed = parseFloat(value!.replace(/\$\s?|(,*)/g, ''));
                    return isNaN(parsed) ? undefined : parsed;
                  }) as any}
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
                    const parsed = parseFloat(value!.replace(/\$\s?|(,*)/g, ''));
                    return isNaN(parsed) ? undefined : parsed;
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
    </div>
  );
};

export default InvoiceCreation;
