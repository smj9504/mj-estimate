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
import { EstimateLineItem } from '../services/EstimateService';
import SortableSection from '../components/common/SortableSection';
import {
  Collapse,
  Tag,
  Badge,
} from 'antd';

const { Title } = Typography;
const { TextArea } = Input;

interface InvoiceItem {
  id?: string;
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
}

interface PaymentRecord {
  amount: number;
  date?: dayjs.Dayjs | null;
  method?: string;
  reference?: string;
}

const InvoiceCreation: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  const [formFieldsChanged, setFormFieldsChanged] = useState(0);
  // Section-based state
  const [sections, setSections] = useState<InvoiceSection[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState('');

  // Legacy items array for backward compatibility
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [showInsurance, setShowInsurance] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
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
  const [useCustomCompany, setUseCustomCompany] = useState(false);
  const [opPercent, setOpPercent] = useState(0);

  // Section editing state
  const [sectionEditModalVisible, setSectionEditModalVisible] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');

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

  const loadCompanies = useCallback(async () => {
    try {
      const data = await companyService.getCompanies();
      setCompanies(data);
      // Don't auto-select any company - let user choose explicitly
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }, [isEditMode]);

  const [invoiceData, setInvoiceData] = useState<any>(null);

  const loadInvoice = useCallback(async () => {
    if (!id) return;
    
    setLoading(true);
    try {
      console.log('Loading invoice with ID:', id);
      const invoice = await invoiceService.getInvoice(id);
      console.log('Invoice loaded:', invoice);
      console.log('Invoice items:', JSON.stringify(invoice.items, null, 2));
      
      const data = invoice as any;
      setInvoiceData(data);
      
      // Convert items to sections or use existing sections
      if (data.sections && data.sections.length > 0) {
        setSections(data.sections);
        // Expand all sections when loading an existing invoice
        setActiveKeys(data.sections.map((s: any) => s.id));
      } else if (data.items && data.items.length > 0) {
        console.log('Processing loaded items:', JSON.stringify(data.items, null, 2));
        const processedItems = data.items.map((item: any) => ({
          id: item.id,
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
        }));
        console.log('Processed items:', processedItems);

        // Convert items to sections
        const sectionsFromItems = convertItemsToSections(processedItems);
        setSections(sectionsFromItems);
        // Expand all sections when loading converted items
        setActiveKeys(sectionsFromItems.map(s => s.id));

        // Keep legacy items for backward compatibility
        setItems(processedItems);
      }
      
      // Set form values immediately
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
        // Insurance information
        insurance_company: data.insurance_company || '',
        insurance_policy_number: data.insurance_policy_number || '',
        insurance_claim_number: data.insurance_claim_number || '',
        insurance_deductible: data.insurance_deductible || 0,
      };
      // console.log('Setting form values:', formValues);
      form.setFieldsValue(formValues);
      
      // Set tax method and amount
      if (data.tax_method) {
        setTaxMethod(data.tax_method);
        // Set tax rate for percentage method
        if (data.tax_method === 'percentage') {
          setTaxRate(data.tax_rate || 0);
        }
        // Set specific tax amount regardless of whether it's 0 or not
        if (data.tax_method === 'specific') {
          setSpecificTaxAmount(data.tax_amount || 0);
        }
      }

      // Set discount state
      setDiscount(data.discount || data.discount_amount || 0);

      // Set insurance visibility if insurance data exists
      if (data.insurance_company || data.insurance_policy_number || data.insurance_claim_number || data.insurance_deductible) {
        setShowInsurance(true);
      }
      
      // Set payments
      if (data.payments && data.payments.length > 0) {
        const processedPayments = data.payments.map((payment: any) => ({
          amount: payment.amount || 0,
          date: payment.date ? dayjs(payment.date) : null,
          method: payment.method || '',
          reference: payment.reference || ''
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
      
      // Set up company info - will be handled separately when companies load
      if (data.company_id && !data.company_name) {
        // Will set company when companies are loaded
      } else if (data.company_name) {
        setUseCustomCompany(true);
        // Set custom company form values
        form.setFieldsValue({
          company_name: data.company_name,
          company_address: data.company_address,
          company_city: data.company_city,
          company_state: data.company_state,
          company_zipcode: data.company_zipcode,
          company_phone: data.company_phone,
          company_email: data.company_email,
        });
      }
    } catch (error: any) {
      console.error('Failed to load invoice:', error);
      console.error('Error details:', error.response?.data || error.message);
      message.error(`Failed to load invoice: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLoading(false);
    }
  }, [id, form]); // Remove companies dependency

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

    // Convert EstimateLineItem to InvoiceItem and update with section title
    const convertedItems: InvoiceItem[] = itemsToAdd.map(item => ({
      id: item.id,
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

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // Reset form when switching between edit/create modes
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
    setUseCustomCompany(false);
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
  }, [isEditMode, id, form]); // Reset when isEditMode or id changes

  useEffect(() => {
    // Load invoice data when in edit mode
    if (isEditMode && id) {
      loadInvoice();
    }
  }, [isEditMode, id, loadInvoice]); // Keep loadInvoice but now it won't change due to companies

  // Set company after both invoice and companies are loaded
  useEffect(() => {
    if (isEditMode && invoiceData && companies.length > 0 && invoiceData.company_id) {
      const company = companies.find(c => c.id === invoiceData.company_id);
      if (company) {
        setSelectedCompany(company);
        // Update form with company data and selection
        form.setFieldsValue({
          company_selection: company.id,
          company_name: company.name,
          company_address: company.address,
          company_city: company.city,
          company_state: company.state,
          company_zipcode: company.zipcode,
          company_phone: company.phone,
          company_email: company.email,
        });
      }
    } else if (isEditMode && invoiceData && invoiceData.company_name && !invoiceData.company_id) {
      // Handle case where custom company data exists in edit mode
      setUseCustomCompany(true);
      form.setFieldValue('company_selection', 'custom');
    }
  }, [isEditMode, invoiceData, companies, form]);

  // Set default company form values after Form is rendered and companies are loaded
  useEffect(() => {
    if (companies.length > 0 && selectedCompany && !isEditMode && !useCustomCompany) {
      form.setFieldsValue({
        company_name: selectedCompany.name,
        company_address: selectedCompany.address,
        company_city: selectedCompany.city,
        company_state: selectedCompany.state,
        company_zipcode: selectedCompany.zipcode,
        company_phone: selectedCompany.phone,
        company_email: selectedCompany.email,
      });
    }
  }, [form, companies, selectedCompany, isEditMode, useCustomCompany]);

  // Set invoice form values after Form is rendered and invoice data is loaded
  useEffect(() => {
    if (invoiceData && isEditMode) {
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
    }
  }, [form, invoiceData, isEditMode]);

  // Set company form values when company selection changes
  useEffect(() => {
    if (selectedCompany && !useCustomCompany) {
      form.setFieldsValue({
        company_name: selectedCompany.name,
        company_address: selectedCompany.address,
        company_city: selectedCompany.city,
        company_state: selectedCompany.state,
        company_zipcode: selectedCompany.zipcode,
        company_phone: selectedCompany.phone,
        company_email: selectedCompany.email,
      });
    } else if (useCustomCompany) {
      form.setFieldsValue({
        company_name: '',
        company_address: '',
        company_city: '',
        company_state: '',
        company_zipcode: '',
        company_phone: '',
        company_email: '',
      });
    }
  }, [form, selectedCompany, useCustomCompany]);

  // Set formMounted to true after component mounts
  useEffect(() => {
    setFormMounted(true);
  }, []);

  const handleCompanyChange = async (companyId: string) => {
    if (companyId === 'custom') {
      setUseCustomCompany(true);
      setSelectedCompany(null);
      // Set form value to indicate custom company is selected
      form.setFieldValue('company_selection', 'custom');

      // Generate invoice number for custom company too (only in create mode)
      if (!isEditMode) {
        try {
          const newInvoiceNumber = await invoiceService.generateInvoiceNumber();
          form.setFieldsValue({ invoice_number: newInvoiceNumber });
          console.log('Generated new invoice number for custom company:', newInvoiceNumber);
        } catch (error) {
          console.error('Failed to generate invoice number:', error);
          // Fallback to default number if API fails
          const fallbackNumber = `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
          form.setFieldsValue({ invoice_number: fallbackNumber });
        }
      }
    } else {
      setUseCustomCompany(false);
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

  const handleItemSubmit = () => {
    if (editingSectionIndex === null) {
      message.error('Please select a section to add the item to');
      return;
    }

    itemForm.validateFields().then(values => {
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

      const newItem: InvoiceItem = {
        ...values,
        name: values.name.toString().trim(),
        description: values.description ? values.description.toString().trim() : '',
        quantity: Number(values.quantity),
        rate: Number(values.rate),
        amount: Number(values.quantity) * Number(values.rate),
        taxable: values.taxable !== false, // Default to taxable if not specified
        primary_group: sections[editingSectionIndex]?.title,
      };

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
    }).catch(error => {
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
    });
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

  const handleSave = async (status: string = 'pending') => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }
      
      let companyName = values.company_name;
      if (!useCustomCompany && selectedCompany) {
        companyName = selectedCompany.name;
      }
      
      if (!companyName && useCustomCompany) {
        message.error('Please enter company name for custom company');
        setLoading(false);
        return;
      }

      const totals = calculateTotals();
      
      // Prepare invoice data based on company type
      const invoiceData: any = {
        invoice_number: values.invoice_number,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        status,
      };
      
      // Add company info based on type
      if (!useCustomCompany && selectedCompany) {
        // Using saved company - send company_id
        invoiceData.company_id = selectedCompany.id;
      } else {
        // Using custom company - send full company info
        invoiceData.company = {
          name: values.company_name || '',
          address: values.company_address || '',
          city: values.company_city || '',
          state: values.company_state || '',
          zipcode: values.company_zipcode || '',
          phone: values.company_phone || '',
          email: values.company_email || '',
          logo: '',
        };
      }
      
      // Add rest of the data
      invoiceData.client = {
        name: values.client_name,
        address: values.client_address,
        city: values.client_city,
        state: values.client_state,
        zipcode: values.client_zipcode,
        phone: values.client_phone,
        email: values.client_email,
      };
      
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
        reference: payment.reference
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
      
      navigate(`/documents/invoice`);
    } catch (error) {
      message.error('Failed to save invoice');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewHTML = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // Validate company information
      if (!selectedCompany && !useCustomCompany) {
        message.error('Please select a company or choose to enter custom company information');
        setLoading(false);
        return;
      }

      let companyName = values.company_name;
      if (!useCustomCompany && selectedCompany) {
        companyName = selectedCompany.name;
      }

      if (!companyName && useCustomCompany) {
        message.error('Please enter company name for custom company');
        setLoading(false);
        return;
      }

      const totals = calculateTotals();

      const pdfData = {
        invoice_number: values.invoice_number || `INV-${dayjs().format('YYYYMMDDHHmmss')}`,
        date: values.date ? values.date.format('MM-DD-YYYY') : dayjs().format('MM-DD-YYYY'),
        due_date: values.due_date ? values.due_date.format('MM-DD-YYYY') : dayjs().add(30, 'days').format('MM-DD-YYYY'),
        company: {
          name: companyName || '',
          address: values.company_address || selectedCompany?.address || '',
          city: values.company_city || selectedCompany?.city || '',
          state: values.company_state || selectedCompany?.state || '',
          zipcode: values.company_zipcode || selectedCompany?.zipcode || '',
          phone: values.company_phone || selectedCompany?.phone || '',
          email: values.company_email || selectedCompany?.email || '',
          logo: selectedCompany?.logo || '',
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
          reference: payment.reference
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

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: 'Item',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
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
      render: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      title: 'Amount',
      key: 'amount',
      width: 120,
      align: 'right' as const,
      render: (_: any, record: InvoiceItem) => `$${(record.quantity * record.rate).toFixed(2)}`,
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
                rules={[{ required: true, message: 'Please select a company or choose custom company' }]}
              >
                <Select
                  value={useCustomCompany ? 'custom' : selectedCompany?.id || undefined}
                  onChange={handleCompanyChange}
                  placeholder="Select company"
                  options={[
                    ...companies.map(company => ({
                      key: company.id,
                      value: company.id,
                      label: company.name
                    })),
                    {
                      value: 'custom',
                      label: (
                        <>
                          <Divider style={{ margin: '4px 0' }} />
                          <Space>
                            <EditOutlined />
                            <span>Enter Custom Company</span>
                          </Space>
                        </>
                      )
                    }
                  ]}
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
                      readOnly={!isEditMode && !selectedCompany && !useCustomCompany}
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
              
              {useCustomCompany && (
                <>
                  <Divider orientation="left" style={{ margin: '16px 0' }}>Custom Company Information</Divider>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_name" label="Company Name" rules={[{ required: true }]}>
                        <Input placeholder="Enter company name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_email" label="Company Email">
                        <Input type="email" placeholder="Enter email" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_phone" label="Company Phone">
                        <Input placeholder="Enter phone" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="company_address" label="Company Address">
                        <Input placeholder="Enter address" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_city" label="City">
                        <Input placeholder="City" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_state" label="State">
                        <Input placeholder="State" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="company_zipcode" label="ZIP">
                        <Input placeholder="ZIP" />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}
            </Card>
          </Col>


          {/* Client Information */}
          <Col xs={24}>
            <Card title="Client Information" style={{ marginBottom: 24 }}>
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
                          <Tag color="blue">${section.subtotal.toFixed(2)}</Tag>
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
                            {
                              title: 'Item Code',
                              dataIndex: 'name',
                              key: 'name',
                              width: 120,
                            },
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
                              render: (value) => `$${value?.toFixed(2) || '0.00'}`,
                            },
                            {
                              title: 'Amount',
                              key: 'amount',
                              width: 100,
                              align: 'right' as const,
                              render: (_: any, record: InvoiceItem) => `$${((record.quantity || 0) * (record.rate || 0)).toFixed(2)}`,
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
                          <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${section.subtotal.toFixed(2)}</span>
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
                            <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${(item.amount || (item.quantity * item.rate) || 0).toFixed(2)}</span>
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
              <Col>${totals.itemsSubtotal.toFixed(2)}</Col>
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
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      {payment.date && (
                        <span style={{ color: '#666' }}>{payment.date.format('MM/DD/YYYY')}</span>
                      )}
                      <span>${payment.amount.toFixed(2)}</span>
                      {payment.method && <span>({payment.method})</span>}
                    </Space>
                    <Space>
                      <Tooltip title="Edit">
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
                  <Col>${totals.itemsSubtotal.toFixed(2)}</Col>
                </Row>
                {opPercent > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>O&P ({opPercent}%):</Col>
                    <Col>${totals.opAmount.toFixed(2)}</Col>
                  </Row>
                )}
                {totals.taxAmount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>
                      Tax {taxMethod === 'percentage' ? `(${taxRate}%)` : ''}:
                    </Col>
                    <Col>${totals.taxAmount.toFixed(2)}</Col>
                  </Row>
                )}
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Col>Subtotal:</Col>
                  <Col>${totals.subtotal.toFixed(2)}</Col>
                </Row>
                {totals.discount > 0 && (
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Col>Discount:</Col>
                    <Col>-${totals.discount.toFixed(2)}</Col>
                  </Row>
                )}
                <Divider />
                <Row justify="space-between" style={{ fontWeight: 'bold', fontSize: '18px' }}>
                  <Col>Total:</Col>
                  <Col>${totals.total.toFixed(2)}</Col>
                </Row>
                {totals.totalPaid > 0 && (
                  <>
                    <Row justify="space-between" style={{ marginTop: 8 }}>
                      <Col>Total Paid:</Col>
                      <Col>${totals.totalPaid.toFixed(2)}</Col>
                    </Row>
                    <Row justify="space-between" style={{ fontWeight: 'bold', color: totals.balanceDue > 0 ? '#ff4d4f' : '#52c41a' }}>
                      <Col>Balance Due:</Col>
                      <Col>${totals.balanceDue.toFixed(2)}</Col>
                    </Row>
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>

        {/* Action Buttons */}
        <Card>
          <Space size="middle">
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
              value={itemForm.getFieldValue('name')}
              onChange={(value) => itemForm.setFieldValue('name', value)}
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
          <Form.Item dependencies={['quantity', 'rate']} noStyle>
            {({ getFieldValue }) => {
              const quantity = getFieldValue('quantity');
              const rate = getFieldValue('rate');
              return quantity && rate ? (
                <div style={{ textAlign: 'right', fontSize: '16px', fontWeight: 'bold' }}>
                  Total: ${(quantity * rate).toFixed(2)}
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
              });
            } else {
              paymentForm.resetFields();
              paymentForm.setFieldsValue({
                amount: undefined,
                date: null,
                method: '',
                reference: '',
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
    </div>
  );
};

export default InvoiceCreation;
