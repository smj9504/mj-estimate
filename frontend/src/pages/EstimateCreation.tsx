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
  Popconfirm,
  Collapse,
  Switch,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EyeOutlined,
  EditOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import DraggableTable from '../components/common/DraggableTable';
import SortableSection from '../components/common/SortableSection';
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
import RichTextEditor from '../components/editor/RichTextEditor';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import { estimateService, EstimateLineItem, EstimateResponse, EstimateSection } from '../services/EstimateService';
import { companyService } from '../services/companyService';
import { Company } from '../types';
import UnitSelect from '../components/common/UnitSelect';
import { DEFAULT_UNIT } from '../constants/units';
import ItemCodeSelector from '../components/estimate/ItemCodeSelector';

const { Title } = Typography;

interface EstimateCreationProps {
  initialEstimate?: EstimateResponse;
}

const EstimateCreation: React.FC<EstimateCreationProps> = ({ initialEstimate }) => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  
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
  
  // O&P and calculations
  const [opPercent, setOpPercent] = useState(0);

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

    setLoading(true);
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
        estimate.sections.forEach((section: EstimateSection, sIndex: number) => {
          console.log(`loadEstimate - section ${sIndex}:`, section.title);
          section.items?.forEach((item: EstimateLineItem, iIndex: number) => {
            console.log(`loadEstimate - section ${sIndex} item ${iIndex}:`, {
              name: item.name,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unit_price
            });
          });
        });
        setSections(estimate.sections);
        // Expand all sections when loading an existing estimate
        setActiveKeys(estimate.sections.map((s: EstimateSection) => s.id));
      } else {
        console.log('loadEstimate - converting items to sections');
        console.log('loadEstimate - items to convert:', estimate.items);
        const sectionsFromItems = convertItemsToSections(estimate.items || []);
        console.log('loadEstimate - converted sections:', sectionsFromItems);
        setSections(sectionsFromItems);
        // Expand all sections when loading converted items
        setActiveKeys(sectionsFromItems.map(s => s.id));
      }
      
      // Set O&P percent
      if (estimate.op_percent) {
        setOpPercent(estimate.op_percent);
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
      setLoading(false);
    }
  }, [id, form, companies]);

  const convertItemsToSections = (items: EstimateLineItem[]): EstimateSection[] => {
    // console.log('convertItemsToSections - input items:', items);
    const groupedItems: { [key: string]: EstimateLineItem[] } = {};

    items.forEach(item => {
      // console.log('convertItemsToSections - processing item:', item);
      // console.log('convertItemsToSections - item.name value:', item.name);
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
      subtotal: groupItems.reduce((sum, item) => sum + (item.total || 0), 0),
    }));
  };

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (companies.length > 0 && id) {
      if (initialEstimate) {
        loadEstimate(initialEstimate);
      } else {
        loadEstimate();
      }
    }
  }, [companies, id, loadEstimate, initialEstimate]);

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

  // Unified drag and drop sensors with improved activation
  const unifiedSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
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

  const updateSectionTitle = (sectionIndex: number, newTitle: string) => {
    const newSections = [...sections];
    newSections[sectionIndex].title = newTitle;
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
    const newSections = [...sections];
    const currentSection = sections[sectionIndex];

    // Update each line item with the current section's title
    const itemsWithGroup = itemsToAdd.map(item => ({
      ...item,
      primary_group: currentSection.title,
    }));

    newSections[sectionIndex].items.push(...itemsWithGroup);
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);

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
    const newSections = [...sections];
    newSections[sectionIndex].items.splice(itemIndex, 1);
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(newSections[sectionIndex].items);
    setSections(newSections);
    message.success('Item deleted successfully');
  };

  // Delete multiple selected items
  const deleteMultipleItems = (sectionIndex: number, selectedKeys: string[]) => {
    const newSections = [...sections];
    const currentItems = newSections[sectionIndex].items;

    // Filter out selected items (selectedKeys are indices as strings)
    const filteredItems = currentItems.filter((_, index) => !selectedKeys.includes(String(index)));

    newSections[sectionIndex].items = filteredItems;
    newSections[sectionIndex].subtotal = calculateSectionSubtotal(filteredItems);
    setSections(newSections);

    // Clear selection
    setSelectedItemKeys(prev => ({
      ...prev,
      [sectionIndex]: []
    }));

    message.success(`${selectedKeys.length} item(s) deleted successfully`);
  };

  const calculateSectionSubtotal = (items: EstimateLineItem[]): number => {
    return items.reduce((sum, item) => sum + (item.total || 0), 0);
  };

  const calculateGrandTotal = useMemo((): { subtotal: number; opAmount: number; taxAmount: number; total: number } => {
    const subtotal = sections.reduce((sum, section) => sum + section.subtotal, 0);
    const opAmount = subtotal * (opPercent / 100);

    // Calculate tax amount
    let taxAmount = 0;
    if (taxMethod === 'percentage') {
      // Calculate tax on taxable items only
      const taxableAmount = sections.reduce((sum, section) => {
        return sum + section.items.reduce((itemSum, item) => {
          if (item.taxable !== false) { // Default to taxable if not specified
            return itemSum + (item.total || 0);
          }
          return itemSum;
        }, 0);
      }, 0);

      // Calculate tax on (taxable amount + O&P proportional to taxable items)
      const taxableRatio = subtotal > 0 ? taxableAmount / subtotal : 0;
      const taxableOpAmount = opAmount * taxableRatio;
      taxAmount = (taxableAmount + taxableOpAmount) * (taxRate / 100);
    } else {
      taxAmount = specificTaxAmount;
    }

    const total = subtotal + opAmount + taxAmount;

    return { subtotal, opAmount, taxAmount, total };
  }, [sections, opPercent, taxMethod, taxRate, specificTaxAmount]);

  // Validate item form values
  const validateItemValues = (values: any): string | null => {
    if (!values.name || values.name.trim() === '') {
      return 'Please enter item name';
    }
    if (!values.quantity || values.quantity <= 0) {
      return 'Please enter valid quantity';
    }
    if (!values.unit) {
      return 'Please select unit';
    }
    if (!values.unit_price || values.unit_price <= 0) {
      return 'Please enter valid unit price';
    }
    return null;
  };

  // Create item object from form values
  const createItemFromValues = (values: any): EstimateLineItem => {
    return {
      ...values,
      name: values.name.trim(),
      description: currentItemDescription,
      note: currentItemNote,
      total: values.quantity * values.unit_price,
      primary_group: sections[editingSectionIndex!]?.title,
      taxable: values.taxable !== false, // Default to taxable if not specified
    };
  };

  // Save or update item in section
  const saveItemToSection = (item: EstimateLineItem) => {
    const newSections = [...sections];

    if (editingIndex !== null) {
      // Edit existing item
      newSections[editingSectionIndex!].items[editingIndex] = item;
    } else {
      // Add new item
      newSections[editingSectionIndex!].items.push(item);
    }

    // Recalculate section subtotal
    newSections[editingSectionIndex!].subtotal = calculateSectionSubtotal(newSections[editingSectionIndex!].items);

    setSections(newSections);

    // Auto-expand the section when an item is added
    const sectionId = sections[editingSectionIndex!].id;
    expandSection(sectionId);
  };

  const handleItemSave = () => {
    itemForm.validateFields().then((values) => {
      // Validate form values
      const validationError = validateItemValues(values);
      if (validationError) {
        message.error(validationError);
        return;
      }

      const newItem = createItemFromValues(values);
      saveItemToSection(newItem);

      resetItemModal();
      message.success(editingIndex !== null ? 'Item updated successfully' : 'Item added successfully');
    });
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
    setSelectedCompany(company || null);
    form.setFieldValue('company_selection', companyId);

    // Generate new estimate number (only in create mode)
    if (!isEditMode && company) {
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
      op_percent: opPercent,
      op_amount: grandTotal.opAmount,
      subtotal: grandTotal.subtotal,
      tax_method: taxMethod,
      tax_rate: taxMethod === 'percentage' ? taxRate : 0,
      tax_amount: grandTotal.taxAmount,
      total_amount: grandTotal.total,
      notes: cleanNotesFromOPInfo(values.notes),
    };
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const values = await form.validateFields();

      // Validate company information
      const companyValidationError = validateCompanySelection();
      if (companyValidationError) {
        message.error(companyValidationError);
        setLoading(false);
        return;
      }

      const estimateData = createEstimateData(values);

      if (isEditMode) {
        await estimateService.updateEstimate(id!, estimateData);
        message.success('Estimate updated successfully');
        // Reload the estimate data instead of navigating away
        await loadEstimate();
      } else {
        const created = await estimateService.createEstimate(estimateData);
        message.success('Estimate created successfully');
        navigate(`/estimates/${created.id}/edit`);
      }
    } catch (error) {
      console.error('Failed to save estimate:', error);
      message.error('Failed to save estimate');
    } finally {
      setLoading(false);
    }
  };

  // Create PDF preview data with company fields
  const createPdfPreviewData = (values: any) => {
    const allItems = convertSectionsToItems();
    const grandTotal = calculateGrandTotal;

    return {
      ...values,
      company_id: useCustomCompany ? undefined : selectedCompany?.id,
      estimate_date: values.estimate_date?.format('YYYY-MM-DD'),
      items: allItems,
      sections: sections,
      // Add company fields that EstimateService expects
      company_name: selectedCompany?.name || '',
      company_address: selectedCompany?.address || '',
      company_city: selectedCompany?.city || '',
      company_state: selectedCompany?.state || '',
      company_zipcode: selectedCompany?.zipcode || '',
      company_phone: selectedCompany?.phone || '',
      company_email: selectedCompany?.email || '',
      op_percent: opPercent,
      op_amount: grandTotal.opAmount,
      subtotal: grandTotal.subtotal,
      tax_method: taxMethod,
      tax_rate: taxMethod === 'percentage' ? taxRate : 0,
      tax_amount: grandTotal.taxAmount,
      total_amount: grandTotal.total,
    };
  };

  // Open PDF preview in new window
  const openPdfPreview = (htmlContent: string, estimateNumber?: string) => {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(htmlContent);
      newWindow.document.close();
      newWindow.document.title = `Estimate Preview - ${estimateNumber || 'Draft'}`;
    } else {
      message.error('Popup blocked. Please allow popups for this site to view the preview.');
    }
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
      setLoading(true);
      const values = await form.validateFields();

      // Validate company information
      const companyValidationError = validateCompanySelection();
      if (companyValidationError) {
        message.error(companyValidationError);
        setLoading(false);
        return;
      }

      const pdfData = createPdfPreviewData(values);
      const htmlContent = await estimateService.previewHTML(pdfData);

      openPdfPreview(htmlContent, pdfData.estimate_number);

    } catch (error: any) {
      handlePdfPreviewError(error);
    } finally {
      setLoading(false);
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

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={2}>
          {isEditMode ? 'Edit Estimate' : 'Create New Estimate'}
        </Title>
        <Space>
          <Button onClick={() => navigate('/documents/estimate')}>Cancel</Button>
          <Button type="primary" icon={<EyeOutlined />} onClick={handlePreviewPDF}>
            Preview PDF
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={loading}>
            {isEditMode ? 'Update' : 'Save'} Estimate
          </Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" initialValues={{ estimate_date: dayjs(), status: 'draft' }}>
        <Row gutter={[24, 24]}>
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
                      disabled={!isEditMode && !selectedCompany}
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
                  <Form.Item
                    name="client_name"
                    label="Client Name"
                  >
                    <Input placeholder="Enter client name (optional)" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_email" label="Client Email">
                    <Input placeholder="Enter email address" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="client_phone" label="Client Phone">
                    <Input placeholder="Enter phone number" />
                  </Form.Item>
                </Col>

                {/* Address, City, State, Zip in one row */}
                <Col xs={24} md={12}>
                  <Form.Item name="client_address" label="Street Address">
                    <Input placeholder="Enter street address" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="client_city" label="City">
                    <Input placeholder="Enter city" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={3}>
                  <Form.Item name="client_state" label="State">
                    <Input placeholder="Enter state" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={3}>
                  <Form.Item name="client_zipcode" label="ZIP Code">
                    <Input placeholder="Enter ZIP code" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Insurance Information */}
          <Col xs={24}>
            {showInsuranceInfo ? (
              <Card
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Insurance Information (Optional)</span>
                    <Switch
                      checked={showInsuranceInfo}
                      onChange={setShowInsuranceInfo}
                      checkedChildren="Show"
                      unCheckedChildren="Hide"
                    />
                  </div>
                }
                style={{ marginBottom: 24 }}
              >
                <Row gutter={16}>
                  <Col xs={24} md={6}>
                    <Form.Item name="insurance_company" label="Insurance Company">
                      <Input placeholder="Enter insurance company name" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="claim_number" label="Claim Number">
                      <Input placeholder="Enter claim number" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="policy_number" label="Policy Number">
                      <Input placeholder="Enter policy number" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item name="deductible" label="Deductible">
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder="Enter deductible amount"
                        min={0}
                        step={100}
                        formatter={(value?: string | number) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={(value?: string) => parseFloat(value?.replace(/\$\s?|(,*)/g, '') || '0') || 0}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            ) : (
              <div
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: '6px',
                  marginBottom: 24,
                  backgroundColor: '#fafafa',
                }}
              >
                <div
                  style={{
                    padding: '16px 24px',
                    borderBottom: 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontWeight: 500,
                    fontSize: '16px',
                  }}
                >
                  <span>Insurance Information (Optional)</span>
                  <Switch
                    checked={showInsuranceInfo}
                    onChange={setShowInsuranceInfo}
                    checkedChildren="Show"
                    unCheckedChildren="Hide"
                  />
                </div>
              </div>
            )}
          </Col>

          {/* Section Management */}
          <Col xs={24}>
            <Card title="Estimate Sections" style={{ marginBottom: 24 }}>
              {/* Add New Section */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col flex="auto">
                  <Input
                    placeholder="Enter section name (e.g., Kitchen, Living Room, Bathroom)"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    onPressEnter={addSection}
                  />
                </Col>
                <Col>
                  <Button type="primary" icon={<PlusOutlined />} onClick={addSection}>
                    Add Section
                  </Button>
                </Col>
              </Row>

              {/* Sections List */}
              {sections.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  <Title level={4} type="secondary">No sections added yet</Title>
                  <p>Add sections to organize your estimate items by room or category</p>
                </div>
              ) : (
                <DndContext
                  sensors={unifiedSensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleUnifiedDragStart}
                  onDragEnd={handleUnifiedDragEnd}
                  onDragCancel={resetDragState}
                  modifiers={[restrictToVerticalAxis]}
                >
                  <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <Collapse
                      activeKey={activeKeys}
                      onChange={(keys) => setActiveKeys(keys as string[])}
                      items={sections.map((section, sectionIndex) => ({
                        key: section.id,
                        label: (
                          <SortableSection
                            section={section}
                            sectionIndex={sectionIndex}
                            onAddItem={addItemToSection}
                            onEditSection={(sectionId, title) => {
                              setEditingSectionName(title);
                              setEditingSectionId(sectionId);
                              setSectionModalVisible(true);
                            }}
                            onDeleteSection={deleteSection}
                            renderHeaderOnly={true}
                          />
                        ),
                        children: (
                          <div>
                            {/* Section Items */}
                            {section.items.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                                <p>No items in this section yet</p>
                                <Button type="dashed" icon={<PlusOutlined />} onClick={() => addItemToSection(sectionIndex)}>
                                  Add First Item
                                </Button>
                              </div>
                            ) : (
                              <div
                                tabIndex={0}
                                onKeyDown={(e) => handleDeleteKeyPress(e, sectionIndex)}
                                style={{ outline: 'none' }}
                              >
                                <div style={{ marginBottom: '8px', fontSize: '12px', color: '#888' }}>
                                  <Space>
                                    <span>Double-click row or use Edit button to edit</span>
                                    <Divider type="vertical" />
                                    <span>Use Actions buttons or select items and press Delete key to remove</span>
                                  </Space>
                                </div>
                                <DraggableTable
                                  className="draggable-table"
                                  dataSource={section.items.map((item, index) => ({
                                    ...item,
                                    key: item.id || `${sectionIndex}-${index}-${item.name || 'unnamed'}-${item.unit_price || 0}`
                                  }))}
                                  onReorder={() => {}} // Not used anymore - handled by unified handler
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
                                  rowSelection={{
                                    selectedRowKeys: selectedItemKeys[sectionIndex] || [],
                                    onChange: (selectedRowKeys) => handleItemRowSelection(sectionIndex, selectedRowKeys as string[]),
                                    type: 'checkbox',
                                  }}
                                  onRow={(record, index) => ({
                                    onDoubleClick: () => editItemInSection(sectionIndex, index!),
                                    style: {
                                      cursor: 'pointer',
                                    }
                                  })}
                                  columns={[
                                    {
                                      title: 'Item',
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
                                    },
                                    {
                                      title: 'Unit',
                                      dataIndex: 'unit',
                                      key: 'unit',
                                      width: 80,
                                    },
                                    {
                                      title: 'Rate',
                                      dataIndex: 'unit_price',
                                      key: 'unit_price',
                                      width: 100,
                                      render: (value) => `$${value?.toFixed(2) || '0.00'}`,
                                    },
                                    {
                                      title: 'Total',
                                      dataIndex: 'total',
                                      key: 'total',
                                      width: 100,
                                      render: (value) => `$${value?.toFixed(2) || '0.00'}`,
                                    },
                                    {
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
                                                setSections(newSections);
                                              }}
                                            />
                                          </Tooltip>
                                        </div>
                                      ),
                                      dataIndex: 'taxable',
                                      key: 'taxable',
                                      width: taxMethod === 'percentage' ? 120 : 0,
                                      align: 'center' as const,
                                      render: (value: boolean | undefined, record: EstimateLineItem, recordIndex: number) => (
                                        taxMethod === 'percentage' ? (
                                          <Switch
                                            size="small"
                                            checked={value !== false}
                                            onChange={(checked) => {
                                              const newSections = [...sections];
                                              const itemIndex = newSections[sectionIndex].items.findIndex((item, idx) => idx === recordIndex);
                                              if (itemIndex !== -1) {
                                                newSections[sectionIndex].items[itemIndex] = {
                                                  ...newSections[sectionIndex].items[itemIndex],
                                                  taxable: checked
                                                };
                                                setSections(newSections);
                                              }
                                            }}
                                          />
                                        ) : null
                                      ),
                                    },
                                    {
                                      title: 'Actions',
                                      key: 'actions',
                                      width: 100,
                                      align: 'center' as const,
                                      render: (_: any, record: EstimateLineItem, index: number) => (
                                        <Space size="small">
                                          <Tooltip title="Edit item">
                                            <Button
                                              type="text"
                                              size="small"
                                              icon={<EditOutlined />}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                editItemInSection(sectionIndex, index);
                                              }}
                                            />
                                          </Tooltip>
                                          <Tooltip title="Delete item">
                                            <Popconfirm
                                              title="Are you sure you want to delete this item?"
                                              onConfirm={(e) => {
                                                e?.stopPropagation();
                                                deleteSingleItem(sectionIndex, index);
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
                              </div>
                            )}
                          </div>
                        ),
                      }))}
                    />
                  </SortableContext>

                  <DragOverlay>
                    {activeId && activeDragType === 'section' ? (
                      <div
                        style={{
                          backgroundColor: 'white',
                          border: '1px solid #d9d9d9',
                          borderRadius: '6px',
                          padding: '12px 16px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                          fontSize: '14px',
                          minWidth: '300px',
                          opacity: 0.9,
                        }}
                      >
                        <HolderOutlined style={{ marginRight: 8, color: '#999' }} />
                        <strong>
                          {sections.find(s => s.id === activeId)?.title || 'Section'}
                        </strong>
                      </div>
                    ) : activeId && activeDragType === 'item' && activeSectionIndex !== null ? (
                      (() => {
                        const parts = activeId.split('-');
                        if (parts.length >= 3) {
                          const sectionIdx = parseInt(parts[1]);
                          const itemIdx = parseInt(parts[2]);
                          const section = sections[sectionIdx];
                          const item = section?.items[itemIdx];

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
                                <span style={{ color: '#1890ff', marginLeft: 'auto' }}>${(item.total || 0).toFixed(2)}</span>
                              </div>
                            );
                          }
                        }
                        return null;
                      })()
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </Card>
          </Col>

          {/* O&P, Tax and Totals */}
          <Col xs={24}>
            <Card title="O&P, Tax & Totals" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Row gutter={16}>
                    <Col span={24}>
                      <Form.Item label="O&P Percentage (%)">
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
                    <Row gutter={16}>
                      <Col span={24}>
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
                      </Col>
                    </Row>
                  )}
                </Col>

                <Col xs={24} md={12}>
                  <div style={{ textAlign: 'right', fontSize: '16px' }}>
                    <div>Subtotal: <strong>${calculateGrandTotal.subtotal.toFixed(2)}</strong></div>
                    {opPercent > 0 && (
                      <div>O&P ({opPercent}%): <strong>${calculateGrandTotal.opAmount.toFixed(2)}</strong></div>
                    )}
                    {calculateGrandTotal.taxAmount > 0 && (
                      <div>
                        Tax {taxMethod === 'percentage' ? `(${taxRate}%)` : ''}:
                        <strong> ${calculateGrandTotal.taxAmount.toFixed(2)}</strong>
                      </div>
                    )}
                    <Divider style={{ margin: '8px 0' }} />
                    <div style={{ fontSize: '20px', color: '#1890ff' }}>
                      <strong>Total: ${calculateGrandTotal.total.toFixed(2)}</strong>
                    </div>
                  </div>
                </Col>
              </Row>
            </Card>
          </Col>

          {/* Notes and Terms */}
          <Col xs={24}>
            <Card title="Notes & Terms" style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="notes" label="Notes">
                    <RichTextEditor
                      placeholder="Additional notes for the estimate"
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="terms" label="Terms & Conditions">
                    <RichTextEditor
                      placeholder="Terms and conditions"
                      minHeight={120}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Form>

      {/* Item Modal */}
      <Modal
        title={editingItem ? 'Edit Item' : 'Add New Item'}
        open={itemModalVisible}
        onOk={handleItemSave}
        onCancel={resetItemModal}
        width="90%"
        style={{ maxWidth: '900px' }}
        styles={{
          body: {
            overflowX: 'hidden',
            padding: '20px'
          }
        }}
      >
        <Form form={itemForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item
                name="name"
                label="Item Name"
                rules={[{ required: true, message: 'Please enter item name' }]}
              >
                <ItemCodeSelector
                  placeholder="Enter item name or search line items"
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
                rules={[{ required: true, message: 'Please enter unit price' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  formatter={(value?: string | number) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value?: string) => parseFloat(value?.replace(/\$\s?|(,*)/g, '') || '0') || 0}
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
              <Form.Item label="Additional Notes">
                <RichTextEditor
                  value={currentItemNote}
                  onChange={setCurrentItemNote}
                  placeholder="Additional notes or specifications..."
                  minHeight={80}
                  maxHeight={120}
                />
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
    </div>
  );
};

export default EstimateCreation;