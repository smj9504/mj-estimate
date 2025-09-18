import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Select,
  Input,
  Button,
  Table,
  Space,
  message,
  Tooltip,
  Tag,
  Empty,
  Spin,
  AutoComplete,
  InputNumber,
  Modal,
  Form,
  Radio,
  Checkbox,
  List,
  Typography,
  Divider,
  Popconfirm,
  Alert,
  Tabs,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  FileTextOutlined,
  SaveOutlined,
  ClearOutlined,
  CloseOutlined,
  SearchOutlined,
  BookOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { EstimateLineItem } from '../../services/EstimateService';
import lineItemService from '../../services/lineItemService';
import { LineItem, LineItemCategory, LineItemNote, CategoryModalItem, LineItemModalItem } from '../../types/lineItem';
import Calculator from '../common/Calculator';
import CategoryModal from './CategoryModal';
import SelectionModal from './SelectionModal';
import XactimateInputMode from './XactimateInputMode';
import { XactimateLineItemData } from '../../utils/xactimateTransform';
import debounce from 'lodash/debounce';
import { evaluate } from 'mathjs';

const { Option } = Select;
const { TextArea } = Input;
const { Text, Title } = Typography;

// Utility function to format number with thousand separators
const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null) return '0.00';
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
};

// Action types (to be moved to backend later)
export const LINE_ITEM_ACTIONS = {
  REMOVE: { code: 'RMV', symbol: '-', label: 'Remove', priceMultiplier: 0.5 },
  REPLACE: { code: 'RPL', symbol: '+', label: 'Replace', priceMultiplier: 1.0 },
  DETACH_RESET: { code: 'D&R', symbol: '±', label: 'Detach & Reset', priceMultiplier: 0.7 },
  REMOVE_REPLACE: { code: 'R&R', symbol: '↔', label: 'Remove & Replace', priceMultiplier: 1.5 },
  REPAIR: { code: 'RPR', symbol: '⚡', label: 'Repair', priceMultiplier: 0.8 },
  MATERIAL_ONLY: { code: 'MAT', symbol: 'M', label: 'Material Only', priceMultiplier: 0.6 },
  INSTALL_ONLY: { code: 'INS', symbol: 'I', label: 'Install Only', priceMultiplier: 0.4 },
} as const;

export type ActionType = keyof typeof LINE_ITEM_ACTIONS;

interface LineItemManagerProps {
  items: EstimateLineItem[];
  onItemsChange: (items: EstimateLineItem[]) => void;
  selectedGroup?: string;
}

interface FormData {
  category?: string;
  itemCode?: string;
  action?: ActionType;
  description?: string;
  quantity?: number;
  quantityFormula?: string;
  unit?: string;
  unitPrice?: number;
}

const LineItemManager: React.FC<LineItemManagerProps> = ({
  items,
  onItemsChange,
  selectedGroup,
}) => {
  // Log when items prop changes
  useEffect(() => {
    console.log('LineItemManager: items prop updated:', {
      itemCount: items?.length || 0,
      selectedGroup: selectedGroup,
      items: items
    });
  }, [items, selectedGroup]);
  // Helper functions for group validation
  const validateGroupSelection = (selectedGroup?: string): boolean => {
    // Allow item creation even without group selection - user can assign group later
    return true; // Always allow item creation
  };

  const getGroupValidationMessage = (selectedGroup?: string): string => {
    if (!selectedGroup) {
      return 'No group selected - items will be created without grouping';
    }
    return '';
  };

  const isGroupSelected = validateGroupSelection(selectedGroup);

  // Helper function to generate item code from description
  const generateItemCode = (description: string): string => {
    if (!description?.trim()) {
      return '';
    }
    
    // Extract meaningful words and create code (including numbers)
    const words = description.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '') // Remove special characters but keep numbers
      .split(/\s+/)
      .filter(word => word.length > 0);
    
    if (words.length === 0) {
      return `CUS${Date.now().toString().slice(-4)}`;
    }
    
    let code = '';
    if (words.length === 1) {
      // Single word: take first 7 characters (including numbers)
      code = words[0].substring(0, 7);
    } else if (words.length === 2) {
      // Two words: take first 3-4 chars from each (including numbers)
      code = words[0].substring(0, 4) + words[1].substring(0, 3);
    } else {
      // Multiple words: take first 2-3 chars from first few words (including numbers)
      code = words.slice(0, 3).map((word, index) => {
        if (index === 0) return word.substring(0, 3);
        return word.substring(0, 2);
      }).join('');
    }
    
    // Ensure code is max 7 characters
    if (code.length > 7) {
      code = code.substring(0, 7);
    }
    
    // If code is too short, pad with timestamp
    if (code.length < 3) {
      code += Date.now().toString().slice(-2);
    }
    
    return code;
  };

  // State
  const [formData, setFormData] = useState<FormData>({});
  const [categories, setCategories] = useState<LineItemCategory[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingLineItems, setLoadingLineItems] = useState(false);
  const [searchingItems, setSearchingItems] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [selectedItemForNote, setSelectedItemForNote] = useState<EstimateLineItem | null>(null);
  // Unified notes array - combines saved and unsaved notes with internal _isSaved flag
  
  // Smart save behavior state
  const [userSavePattern, setUserSavePattern] = useState(() => {
    const saved = localStorage.getItem('userSavePattern');
    return saved ? JSON.parse(saved) : { totalCreated: 0, savedToDb: 0 };
  });

  // Get auto-save behavior based on global preference and user pattern
  const getAutoSaveBehavior = () => {
    const globalPref = localStorage.getItem('autoSaveLineItems');
    if (globalPref !== null) return globalPref === 'true';
    
    // Pattern-based decision (if user saved 70% or more of items, auto-save)
    if (userSavePattern.totalCreated >= 3) {
      return (userSavePattern.savedToDb / userSavePattern.totalCreated) >= 0.7;
    }
    
    // Default for new users: ask first few times
    return false;
  };

  // Update user save pattern and persist to localStorage
  const updateSavePattern = (saved: boolean) => {
    const newPattern = {
      totalCreated: userSavePattern.totalCreated + 1,
      savedToDb: userSavePattern.savedToDb + (saved ? 1 : 0)
    };
    setUserSavePattern(newPattern);
    localStorage.setItem('userSavePattern', JSON.stringify(newPattern));
  };
  
  // Xactimate mode state
  const [xactimateModalVisible, setXactimateModalVisible] = useState(false);

  // Memoized table data source with validation
  const tableDataSource = useMemo(() => {
    console.log('[tableDataSource] Starting data processing:', {
      itemsIsArray: Array.isArray(items),
      itemsLength: items?.length,
      items: items
    });

    const filteredItems = Array.isArray(items) ? items.filter(item => {
      const isValid = item != null &&
        typeof item === 'object' &&
        item.description &&
        typeof item.quantity === 'number' &&
        item.unit &&
        typeof item.unit_price === 'number';

      if (!isValid) {
        console.log('[tableDataSource] Filtering out invalid item:', {
          item,
          hasDescription: !!item?.description,
          quantityType: typeof item?.quantity,
          quantityValue: item?.quantity,
          hasUnit: !!item?.unit,
          unitPriceType: typeof item?.unit_price,
          unitPriceValue: item?.unit_price
        });
      }
      return isValid;
    }) : [];

    console.log('[tableDataSource] Final result:', {
      totalItems: items?.length || 0,
      validItems: filteredItems.length,
      filteredItems: filteredItems
    });

    return filteredItems;
  }, [items]);
  
  // Modal states
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [selectionModalVisible, setSelectionModalVisible] = useState(false);
  const [categoryModalEditingIndex, setCategoryModalEditingIndex] = useState<number | null>(null);
  const [selectionModalEditingIndex, setSelectionModalEditingIndex] = useState<number | null>(null);
  
  // Inline editing states
  const [editingCell, setEditingCell] = useState<{ index: number; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<any>(null);
  const [showCalculatorMessage, setShowCalculatorMessage] = useState(false);
  
  
  // File manager style states
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuItems, setContextMenuItems] = useState<EstimateLineItem[]>([]);
  
  // Copy/paste functionality
  const [copiedItems, setCopiedItems] = useState<EstimateLineItem[]>([]);
  const [lastCopyAction, setLastCopyAction] = useState<Date | null>(null);
  const [noteForm] = Form.useForm();
  const [noteEditForm] = Form.useForm();
  
  // Simplified note management state
  const [allNotes, setAllNotes] = useState<LineItemNote[]>([]); // Unified notes array
  const [noteTemplates, setNoteTemplates] = useState<LineItemNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [noteCreationType, setNoteCreationType] = useState<'template' | 'custom'>('template');
  const [editingNote, setEditingNote] = useState<LineItemNote | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<LineItemNote | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<LineItemNote | null>(null);
  const [noteEditorMode, setNoteEditorMode] = useState<'template' | 'custom'>('template');

  // Load categories only when actually needed (not on mount)
  // Categories will be loaded when CategoryModal opens

  // Load line items when category changes (but not for custom items)
  // Removed automatic loading to prevent duplicate API calls when SelectionModal is used
  // Line items will be loaded on-demand when SelectionModal opens

  // Calculate price when action changes
  useEffect(() => {
    if (formData.action && formData.unitPrice) {
      const action = LINE_ITEM_ACTIONS[formData.action];
      const adjustedPrice = formData.unitPrice * action.priceMultiplier;
      setFormData(prev => ({
        ...prev,
        unitPrice: Number(adjustedPrice.toFixed(2)),
      }));
    }
  }, [formData.action]);

  // Load categories with improved error handling
  const loadCategories = async () => {
    setLoadingCategories(true);
    try {
      const response = await lineItemService.getCategories();
      setCategories(response || []);
    } catch (error) {
      console.error('Failed to load categories:', error);
      // Graceful degradation: set empty array instead of showing error popup
      setCategories([]);
      // Only show subtle notification, don't block user workflow
      console.warn('Categories unavailable, you can still add custom items');
    } finally {
      setLoadingCategories(false);
    }
  };

  // Load line items by category with improved error handling
  const loadLineItemsByCategory = async (categoryCode: string) => {
    setLoadingLineItems(true);
    try {
      const response = await lineItemService.searchLineItems({
        search_term: '',
        cat: categoryCode,
      });
      setLineItems(response.items || []);
    } catch (error) {
      console.error('Failed to load line items:', error);
      // Graceful degradation: set empty array, allow custom item creation
      setLineItems([]);
      console.warn('Line items unavailable for this category');
    } finally {
      setLoadingLineItems(false);
    }
  };

  // Search line items with improved error handling
  const searchLineItems = useCallback(
    debounce(async (query: string) => {
      if (!query.trim()) {
        setLineItems([]);
        return;
      }
      
      setSearchingItems(true);
      try {
        const response = await lineItemService.searchLineItems({
          search_term: query.trim(),
        });
        setLineItems(response.items || []);
      } catch (error) {
        console.error('Search failed:', error);
        // Graceful degradation: show empty results instead of error
        setLineItems([]);
        console.warn('Search unavailable, you can create custom items instead');
      } finally {
        setSearchingItems(false);
      }
    }, 300),
    []
  );

  // Handle line item selection
  const handleLineItemSelect = (itemCode: string) => {
    const selectedItem = (lineItems || []).find(item => item.item === itemCode);
    if (selectedItem) {
      setFormData(prev => ({
        ...prev,
        itemCode: selectedItem.item,
        description: selectedItem.description,
        unit: selectedItem.unit,
        unitPrice: selectedItem.untaxed_unit_price,
      }));
    }
  };

  // Handle category modal selection
  const handleCategorySelect = (category: CategoryModalItem) => {
    if (categoryModalEditingIndex !== null) {
      // Update existing item's category but preserve other values
      const updatedItems = [...(items || [])];
      const currentItem = updatedItems[categoryModalEditingIndex];
      
      updatedItems[categoryModalEditingIndex] = {
        ...currentItem,
        // Keep all existing values, only update the category reference
        // This preserves description, quantity, unit, unit_price, etc.
        category: category.code,
        // Clear only the line_item_id since we're changing category
        line_item_id: undefined,
        // Reset item code to indicate it needs to be reselected
        item: currentItem.item || `CUSTOM-${Date.now()}`,
      };
      onItemsChange(updatedItems);
      message.success('Category updated - other values preserved');
      setCategoryModalEditingIndex(null);
    } else {
      // Form mode
      setFormData(prev => ({
        ...prev,
        category: category.code,
        // Clear item selection when category changes
        itemCode: undefined,
        description: undefined,
        unit: undefined,
        unitPrice: undefined,
      }));
    }
    setCategoryModalVisible(false);
  };

  // Transform modal item data to handle both regular and Xactimate formats
  const transformModalItem = (selectedItem: LineItemModalItem) => {
    // Get the correct ID (handle both string and number IDs)
    const itemId = typeof selectedItem.id === 'number' ? selectedItem.id.toString() : selectedItem.id;

    // Get the component code (handle both component_code and item_code)
    // Also check for 'item' field as fallback
    const componentCode = selectedItem.component_code ||
                          (selectedItem as any).item_code ||
                          (selectedItem as any).item ||
                          itemId ||
                          `CUSTOM-${Date.now()}`;

    // Log the transformation for debugging
    console.log('LineItemManager: Transforming modal item:', {
      originalItem: selectedItem,
      transformedId: itemId,
      transformedComponentCode: componentCode,
      type: (selectedItem as any).type || 'unknown'
    });

    return {
      id: itemId,
      component_code: componentCode,
      description: selectedItem.description || 'No description',
      unit: selectedItem.unit || 'EA',
      unit_price: selectedItem.unit_price || 0,
      category: selectedItem.category,
      type: (selectedItem as any).type || 'custom'
    };
  };

  // Handle selection modal selection
  const handleSelectionSelect = (selectedItems: LineItemModalItem[]) => {
    if (selectedItems.length > 0) {
      if (selectionModalEditingIndex !== null && selectedItems.length === 1) {
        // Update existing item
        const selectedItem = selectedItems[0];
        const transformed = transformModalItem(selectedItem);
        const updatedItems = [...(items || [])];
        const currentItem = updatedItems[selectionModalEditingIndex];
        
        updatedItems[selectionModalEditingIndex] = {
          ...currentItem,
          line_item_id: transformed.id, // Update reference to master line item
          item: transformed.component_code,
          description: transformed.description,
          unit: transformed.unit,
          unit_price: transformed.unit_price,
          // Reset quantity to 0 and recalculate total
          quantity: 0,
          total: 0 * transformed.unit_price,
          // Add category from the modal item for note template lookup
          category: transformed.category,
        } as EstimateLineItem & { category?: string };
        
        onItemsChange(updatedItems);
        message.success('Line item updated');
        setSelectionModalEditingIndex(null);
        console.log('LineItemManager: Updated existing item with transformed data:', updatedItems[selectionModalEditingIndex]);
      } else {
        // Add new items with proper data transformation
        const newItems = selectedItems.map((selectedItem, index) => {
          const transformed = transformModalItem(selectedItem);
          const quantity = 0; // Default quantity
          const total = quantity * transformed.unit_price; // Calculate total correctly
          
          const newItem: EstimateLineItem = {
            id: `temp-${Date.now()}-${index}`, // Temporary ID for frontend, will be replaced by backend
            line_item_id: transformed.id, // Reference to master line item
            item: transformed.component_code || transformed.id, // Ensure item field is set with fallback to id
            description: transformed.description,
            quantity: quantity,
            unit: transformed.unit,
            unit_price: transformed.unit_price,
            total: total,
            primary_group: selectedGroup?.split('/')[0],
            secondary_group: selectedGroup?.includes('/') ? selectedGroup.split('/')[1] : undefined,
            // Add category from the modal item for note template lookup
            category: transformed.category,
          } as EstimateLineItem & { category?: string };
          
          console.log('LineItemManager: Created new item with transformed data:', newItem);
          return newItem;
        });

        // Add all selected items to the existing list
        const updatedItems = [...(items || []), ...newItems];
        console.log('LineItemManager: Adding items to list:', newItems);
        console.log('LineItemManager: Updated items array:', updatedItems);
        console.log('LineItemManager: Total items count:', updatedItems.length);
        
        // Validate that items have required fields
        const invalidItems = newItems.filter(item => !item.item || !item.description);
        if (invalidItems.length > 0) {
          console.error('LineItemManager: Some items are missing required fields:', invalidItems);
          message.error('Some items could not be added due to missing data');
          return;
        }
        
        onItemsChange(updatedItems);
        message.success(`${newItems.length} item(s) added to list`);

        // Clear form data
        setFormData({});
      }
    }
    setSelectionModalVisible(false);
  };

  // Handle save with improved validation
  const handleSave = () => {
    // Always allow saving - no group restrictions
    validateAndSave();
  };

  const validateAndSave = () => {
    // Enhanced validation with specific field feedback
    const missingFields = [];
    if (!formData.description?.trim()) missingFields.push('Description');

    // Description이 있으면 다른 필드들은 기본값으로 처리
    if (missingFields.length > 0) {
      message.warning(`Please fill in: ${missingFields.join(', ')}`);
      return;
    }

    // Set defaults
    const quantity = formData.quantity || 0;
    const unit = formData.unit || 'EA';
    const unitPrice = formData.unitPrice || 0;
    
    const newItem: EstimateLineItem = {
      id: editingIndex !== null ? items[editingIndex]?.id : undefined,
      item: formData.itemCode || generateItemCode(formData.description || 'Custom Item'),
      description: formData.description!,
      quantity: quantity,
      unit: unit,
      unit_price: unitPrice,
      total: quantity * unitPrice,
      primary_group: selectedGroup?.split('/')[0],
      secondary_group: selectedGroup?.includes('/') ? selectedGroup.split('/')[1] : undefined,
      note: formData.quantityFormula ? `Formula: ${formData.quantityFormula}` : undefined,
      // Add category for note template lookup - use default if not selected
      category: formData.category || 'CUSTOM',
    } as EstimateLineItem & { category?: string };

    // Check if this is a new line item (not from existing DB)
    const isNewLineItem = !formData.itemCode || !items.some(item => 
      item.line_item_id && item.item === formData.itemCode
    );

    if (editingIndex !== null) {
      // Update existing item
      const updatedItems = [...(items || [])];
      updatedItems[editingIndex] = newItem;
      onItemsChange(updatedItems);
      message.success('Item updated');
      setEditingIndex(null);
      handleClear();
    } else {
      // Add new item to estimate
      console.log('[validateAndSave] Adding new item:', {
        newItem,
        currentItemsLength: items?.length || 0,
        newItemsArrayLength: [...(items || []), newItem].length
      });

      onItemsChange([...(items || []), newItem]);
      message.success('Item added to estimate');

      // Handle database saving for new line items
      if (isNewLineItem && formData.description) {
        handleNewLineItemSave(newItem);
      }

      handleClear();
    }
  };

  // Handle saving new line items to database with smart behavior
  const handleNewLineItemSave = async (newItem: EstimateLineItem) => {
    const shouldAutoSave = getAutoSaveBehavior();
    const globalPref = localStorage.getItem('autoSaveLineItems');
    
    if (shouldAutoSave && globalPref !== null) {
      // Auto-save based on learned preference
      try {
        await saveLineItemToDatabase(newItem, true);
      } catch (error) {
        console.error('Failed to auto-save line item:', error);
      }
    } else if (userSavePattern.totalCreated < 3 || globalPref === null) {
      // Ask user for the first few times or if no global preference set
      Modal.confirm({
        title: 'Save to Line Item Database?',
        content: (
          <div>
            <p>Would you like to save "{newItem.description}" to the line item database for future use?</p>
            {userSavePattern.totalCreated < 3 && (
              <Checkbox 
                onChange={(e) => {
                  if (e.target.checked) {
                    localStorage.setItem('autoSaveLineItems', 'true');
                  }
                }}
              >
                Remember my choice and always save new items
              </Checkbox>
            )}
          </div>
        ),
        okText: 'Yes, Save to Database',
        cancelText: 'No, This Estimate Only',
        onOk: async () => {
          await saveLineItemToDatabase(newItem, true);
        },
        onCancel: () => {
          updateSavePattern(false);
        }
      });
    }
    // If user pattern shows they don't usually save, just skip silently
  };

  // Save line item to database
  const saveLineItemToDatabase = async (item: EstimateLineItem, userChose: boolean) => {
    try {
      await lineItemService.createLineItem({
        cat: formData.category || '',
        item: item.item,
        description: item.description || '',
        unit: item.unit || '',
        untaxed_unit_price: item.unit_price || 0,
        is_active: true
      });
      message.success('Line item saved to database for future use');
      if (userChose) updateSavePattern(true);
    } catch (error) {
      console.error('Failed to save line item to database:', error);
      message.error('Failed to save to database, but item added to estimate');
      if (userChose) updateSavePattern(false);
    }
  };

  // Handle clear - includes calculator reset
  const handleClear = () => {
    setFormData({});
    setEditingIndex(null);
    // Force Calculator component to reset by incrementing the key
    setCalculatorKey(prev => prev + 1);
  };
  
  // Add calculator key state for forcing resets
  const [calculatorKey, setCalculatorKey] = useState(0);
  

  // Handle edit
  const handleEdit = (index: number) => {
    const item = (items || [])[index];
    setFormData({
      category: item.primary_group,
      itemCode: item.item,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price,
    });
    setEditingIndex(index);
  };

  // Handle delete
  const handleDelete = (index: number) => {
    const updatedItems = (items || []).filter((_, i) => i !== index);
    onItemsChange(updatedItems);
    message.success('Item deleted');
  };

  // Handle duplicate
  const handleDuplicate = (index: number) => {
    const item = (items || [])[index];
    const newItem = { ...item, id: undefined };
    onItemsChange([...(items || []), newItem]);
    message.success('Item duplicated');
  };

  // Handle Xactimate items addition
  const handleAddXactimateItems = (xactimateItems: XactimateLineItemData[]) => {
    // Allow adding Xactimate items even without group selection
    // Keep the original primary_group from Xactimate if selectedGroup is not provided
    const itemsWithGroup = xactimateItems.map(item => {
      // Parse the selected group to check if it has primary and secondary parts
      let primary_group = item.primary_group; // Default to the item's own group from Xactimate
      let secondary_group = item.secondary_group;

      if (selectedGroup) {
        // If selectedGroup contains '/', it's a subgroup selection
        if (selectedGroup.includes('/')) {
          const [primary, secondary] = selectedGroup.split('/');
          primary_group = primary;
          secondary_group = secondary;
        } else {
          // Otherwise it's just a primary group
          primary_group = selectedGroup;
          secondary_group = undefined;
        }
      }

      return {
        ...item,
        primary_group: primary_group || 'Xactimate Items',
        secondary_group: secondary_group,
      };
    });

    console.log('LineItemManager: Adding Xactimate items:', itemsWithGroup);
    onItemsChange([...(items || []), ...itemsWithGroup]);
    setXactimateModalVisible(false);

    // Show appropriate success message
    const groupMessage = selectedGroup
      ? ` to ${selectedGroup}`
      : ' (using Xactimate categories)';
    message.success(`${xactimateItems.length} Xactimate item(s) added successfully${groupMessage}`);
  };

  // Handle Xactimate modal close
  const handleXactimateModalClose = () => {
    setXactimateModalVisible(false);
    // Keep the input mode as 'xactimate' when modal is closed
    // The onClick handler will handle reopening the modal
  };

  // File manager style handlers
  const handleRowSelection = useMemo(() => {
    // 순환참조 방지를 위해 로그 최소화
    // Only provide row selection when we have valid data
    if (!Array.isArray(tableDataSource) || tableDataSource.length === 0) {
      return {
        type: 'checkbox' as const,
        selectedRowKeys: [],
        onChange: () => {},
        getCheckboxProps: () => ({ disabled: true }),
      };
    }

    return {
      type: 'checkbox' as const,
      selectedRowKeys: selectedRowKeys || [],
      onChange: (newSelectedRowKeys: React.Key[]) => {
        setSelectedRowKeys(newSelectedRowKeys as string[]);
      },
      onSelectAll: (selected: boolean, selectedRows: EstimateLineItem[], changeRows: EstimateLineItem[]) => {
        if (selected && Array.isArray(tableDataSource)) {
          const allKeys = tableDataSource.map((_, index) => index.toString());
          setSelectedRowKeys(allKeys);
        } else {
          setSelectedRowKeys([]);
        }
      },
      preserveSelectedRowKeys: true,
      getCheckboxProps: (record?: EstimateLineItem, index?: number) => {
        // 순환참조 방지를 위해 로그 최소화
        if (!record?.description) {
          return { disabled: true };
        }
        return { disabled: false };
      },
    };
  }, [selectedRowKeys]); // tableDataSource 제거하여 순환참조 방지

  // Handle right-click context menu
  const handleRightClick = (event: React.MouseEvent, record: EstimateLineItem, index: number) => {
    event.preventDefault();
    
    // If the right-clicked item is not selected, select only it
    if (!(selectedRowKeys || []).includes(index.toString())) {
      setSelectedRowKeys([index.toString()]);
      setContextMenuItems([record]);
    } else {
      // Get all selected items
      const selectedItems = (items || []).filter((_, i) => (selectedRowKeys || []).includes(i.toString()));
      setContextMenuItems(selectedItems);
    }
    
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setContextMenuVisible(true);
  };

  // Handle right-click on empty table area
  const handleEmptyAreaRightClick = (event: React.MouseEvent) => {
    event.preventDefault();

    // Clear selection when right-clicking on empty area
    setSelectedRowKeys([]);
    setContextMenuItems([]);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setContextMenuVisible(true);
  };

  // Handle context menu actions
  const handleContextMenuAction = (action: string) => {
    const selectedIndices = selectedRowKeys.map(key => parseInt(key));
    
    switch (action) {
      case 'edit':
        if (selectedIndices.length === 1) {
          handleEdit(selectedIndices[0]);
        }
        break;
      case 'duplicate':
        const duplicatedItems = selectedIndices.map(index => {
          const item = (items || [])[index];
          return { ...item, id: undefined };
        });
        onItemsChange([...(items || []), ...duplicatedItems]);
        message.success(`${selectedIndices.length} item(s) duplicated`);
        break;
      case 'delete':
        const remainingItems = (items || []).filter((_, index) => !selectedIndices.includes(index));
        onItemsChange(remainingItems);
        setSelectedRowKeys([]);
        message.success(`${selectedIndices.length} item(s) deleted`);
        break;
      case 'copy':
        const selectedItems = selectedIndices.map(index => (items || [])[index]);
        setCopiedItems(selectedItems);
        setLastCopyAction(new Date());
        
        // Also copy to system clipboard as JSON for external paste
        try {
          const clipboardData = JSON.stringify(selectedItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_price: item.unit_price,
            total: item.total,
            item: item.item,
            primary_group: item.primary_group,
            secondary_group: item.secondary_group,
          })), null, 2);
          
          navigator.clipboard.writeText(clipboardData).catch(() => {
            // Fallback for browsers that don't support clipboard API
            console.log('Clipboard API not available, items stored internally');
          });
        } catch (error) {
          console.log('Error copying to clipboard:', error);
        }
        
        message.success(`${selectedIndices.length} item(s) copied`);
        break;
      
      case 'paste':
        if ((copiedItems || []).length === 0) {
          message.warning('No items to paste');
          break;
        }
        
        const newItems = (copiedItems || []).map(item => ({
          ...item,
          id: undefined, // Generate new ID
          item: generateItemCode(item.description || 'Copied Item'), // Generate new item code
          primary_group: selectedGroup?.split('/')[0] || item.primary_group,
          secondary_group: selectedGroup?.includes('/') ? selectedGroup.split('/')[1] : item.secondary_group,
        }));
        
        onItemsChange([...(items || []), ...newItems]);
        message.success(`${newItems.length} item(s) pasted`);
        break;
    }
    
    setContextMenuVisible(false);
  };

  // Handle keyboard shortcuts for table
  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Delete' && (selectedRowKeys || []).length > 0) {
      event.preventDefault();
      handleContextMenuAction('delete');
    } else if (event.ctrlKey && event.key === 'c' && (selectedRowKeys || []).length > 0) {
      event.preventDefault();
      handleContextMenuAction('copy');
    } else if (event.ctrlKey && event.key === 'v') {
      event.preventDefault();
      handleContextMenuAction('paste');
    } else if (event.ctrlKey && event.key === 'a') {
      event.preventDefault();
      const allKeys = (items || []).map((_, index) => index.toString());
      setSelectedRowKeys(allKeys);
    } else if (event.ctrlKey && event.key === 'd' && (selectedRowKeys || []).length > 0) {
      event.preventDefault();
      handleContextMenuAction('duplicate');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedRowKeys([]);
      setContextMenuVisible(false);
    }
  };

  // Close context menu when clicking elsewhere
  const handleClickOutside = () => {
    setContextMenuVisible(false);
  };

  // Add event listeners for context menu
  useEffect(() => {
    if (contextMenuVisible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenuVisible]);

  // Show save button condition
  const showSaveButton = useMemo(() => {
    if (!isGroupSelected || !formData.description?.trim()) return false;

    // Description만 있으면 Save 버튼 표시 (다른 필드들은 기본값 사용)
    return true;
  }, [formData.description, isGroupSelected]);

  // Load all notes for selected line item (saved + unsaved)
  const loadLineItemNotes = useCallback(async () => {
    if (!selectedItemForNote?.id) {
      setAllNotes([]);
      return;
    }
    
    // Get the latest item state from items array
    const currentItem = items.find(item => item.id === selectedItemForNote.id);
    if (!currentItem) {
      console.warn('Selected item not found in items array');
      setAllNotes([]);
      return;
    }
    
    // Additional check for currentItem.id
    if (!currentItem.id) {
      console.warn('Current item has no ID');
      setAllNotes([]);
      setLoadingNotes(false);
      return;
    }

    setLoadingNotes(true);
    try {
      let savedNotes: LineItemNote[] = [];
      
      if (currentItem.id.startsWith('temp-')) {
        // For temporary items, load locally stored notes by fetching them individually
        if (currentItem.temp_note_ids?.length) {
          console.log('Loading temp notes for item:', currentItem.id, 'note IDs:', currentItem.temp_note_ids);
          const notePromises = currentItem.temp_note_ids.map(noteId => 
            lineItemService.getNote(noteId).catch(err => {
              console.warn(`Failed to load note ${noteId}:`, err);
              return null;
            })
          );
          const tempNotes = await Promise.all(notePromises);
          savedNotes = tempNotes.filter(note => note !== null) as LineItemNote[];
          console.log('Loaded temp notes:', savedNotes);
        } else {
          console.log('No temp notes for item:', currentItem.id);
        }
      } else {
        // For real items, load from backend
        try {
          savedNotes = await lineItemService.getLineItemNotes(currentItem.id);
        } catch (error) {
          console.warn('Failed to load notes from backend, using empty array');
          savedNotes = [];
        }
      }
      
      // Mark all loaded notes as saved and set to allNotes
      const notesWithSavedFlag = savedNotes.map(note => ({ ...note, _isSaved: true }));
      setAllNotes(notesWithSavedFlag);
    } catch (error) {
      console.error('Failed to load line item notes:', error);
      // Graceful degradation: set empty array, allow note creation
      setAllNotes([]);
      console.warn('Notes unavailable, you can still create new notes');
    } finally {
      setLoadingNotes(false);
    }
  }, [selectedItemForNote, items]);

  // Load note templates with improved error handling
  const loadNoteTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      // Get actual category code from the line item
      const category = (selectedItemForNote as any)?.category;
      
      const templates = await lineItemService.getNoteTemplates(category);
      console.log('Received templates:', templates);
      console.log('Templates type:', typeof templates);
      console.log('Templates length:', Array.isArray(templates) ? templates.length : 'not array');
      setNoteTemplates(templates || []);
    } catch (error) {
      console.error('Failed to load note templates:', error);
      // Graceful degradation: set empty array, allow custom note creation
      setNoteTemplates([]);
      console.warn('Note templates unavailable, you can create custom notes');
    } finally {
      setLoadingTemplates(false);
    }
  }, [selectedItemForNote]);

  // Load line item notes when modal opens
  useEffect(() => {
    if (noteModalVisible && selectedItemForNote) {
      loadLineItemNotes();
      loadNoteTemplates();
    }
  }, [noteModalVisible, selectedItemForNote, items, loadLineItemNotes, loadNoteTemplates]);

  // Handle add note to pending list
  const handleAddNote = async (values: any) => {
    // Validate template selection or custom note content
    if (noteEditorMode === 'template' && !selectedTemplate) {
      message.error('Please select a template');
      return;
    }
    
    if (noteEditorMode === 'custom' && !values.content?.trim()) {
      message.error('Please enter note content');
      return;
    }
    
    setSavingNote(true);
    try {
      let newNote: LineItemNote;
      
      if (noteEditorMode === 'template' && selectedTemplate) {
        // Create a new note based on selected template
        const categoryToUse = (selectedItemForNote as any)?.category;

        const noteData = {
          title: selectedTemplate.title,
          content: selectedTemplate.content,
          category: categoryToUse,
          is_template: false, // This is a note instance, not a template
        };
        
        newNote = await lineItemService.createNote(noteData);
        message.success('Template note added to pending list');
      } else {
        // Create custom note
        // Get the actual category code from the line item
        const categoryToUse = (selectedItemForNote as any)?.category;
        
        const noteData = {
          title: values.title,
          content: values.content,
          category: categoryToUse,
          is_template: values.saveAsTemplate || false,
        };
        
        newNote = await lineItemService.createNote(noteData);
        message.success('Note added to pending list');
        
        if (values.saveAsTemplate) {
          setNoteTemplates(prev => [...prev, newNote]);
        }
      }
      
      // Add to allNotes with _isSaved: false (pending save)
      setAllNotes(prev => [...prev, { ...newNote, _isSaved: false }]);
      
      // Clear form for next note
      noteForm.resetFields();
      setSelectedTemplate(null);
      setPreviewTemplate(null);
      setNoteEditorMode('template');
    } catch (error) {
      console.error('Failed to add note:', error);
      if (error instanceof Error) {
        message.error(`Failed to add note: ${error.message}`);
      } else {
        message.error('Failed to add note. Please try again.');
      }
    } finally {
      setSavingNote(false);
    }
  };

  // Handle save all unsaved notes to line item
  const handleSaveNotes = async () => {
    const unsavedNotes = allNotes.filter(note => !note._isSaved);
    if (unsavedNotes.length === 0) {
      message.warning('No unsaved notes to save');
      return;
    }

    setSavingNote(true);
    try {
      if (selectedItemForNote?.id && !selectedItemForNote.id.startsWith('temp-')) {
        // For real items, save all notes in parallel for better performance
        const itemId = selectedItemForNote.id; // TypeScript assertion
        const savePromises = unsavedNotes.map(note =>
          lineItemService.associateNoteWithLineItem(itemId, note.id)
        );

        await Promise.all(savePromises);
      } else if (selectedItemForNote?.id?.startsWith('temp-')) {
        // For temporary items, store all note IDs at once
        const allNoteIds = unsavedNotes.map(note => note.id);
        const updatedItems = items.map(item => {
          if (item.id === selectedItemForNote.id) {
            return {
              ...item,
              temp_note_ids: [...(item.temp_note_ids || []), ...allNoteIds]
            };
          }
          return item;
        });
        onItemsChange(updatedItems);
      }

      // Mark all notes as saved in a single state update
      setAllNotes(prev => prev.map(note => ({ ...note, _isSaved: true })));

      message.success(`${unsavedNotes.length} note(s) saved successfully`);

      // Close modal
      resetNoteModal();
    } catch (error) {
      console.error('Failed to save notes:', error);
      if (error instanceof Error) {
        message.error(`Failed to save notes: ${error.message}`);
      } else {
        message.error('Failed to save notes. Please try again.');
      }
    } finally {
      setSavingNote(false);
    }
  };

  // Handle note edit - now uses the unified editor in right panel
  const handleNoteEdit = (note: LineItemNote) => {
    setEditingNote(note);
    // Set the form values in the unified editor
    const form = editingNote ? noteEditForm : noteForm;
    form.setFieldsValue({
      title: note.title,
      content: note.content,
    });
    // Switch to custom mode for editing
    setNoteEditorMode('custom');
  };

  // Handle note update
  const handleNoteUpdate = async (values: any) => {
    if (!editingNote) return;
    
    setSavingNote(true);
    try {
      // Check if the note is saved or unsaved
      if (editingNote._isSaved) {
        // For saved notes, update via API
        const updatedNote = await lineItemService.updateNote(editingNote.id, {
          title: values.title,
          content: values.content,
        });
        
        setAllNotes(prev => 
          prev.map(note => note.id === editingNote.id ? { ...updatedNote, _isSaved: true } : note)
        );
      } else {
        // For unsaved notes (templates), update locally
        setAllNotes(prev => 
          prev.map(note => 
            note.id === editingNote.id 
              ? { ...note, title: values.title, content: values.content }
              : note
          )
        );
      }
      
      message.success('Note updated successfully');
      setEditingNote(null);
      noteEditForm.resetFields();
    } catch (error) {
      console.error('Failed to update note:', error);
      // More specific error handling
      if (error instanceof Error) {
        message.error(`Failed to update note: ${error.message}`);
      } else {
        message.error('Failed to update note. Please try again.');
      }
    } finally {
      setSavingNote(false);
    }
  };

  // Handle note delete
  const handleNoteDelete = async (noteId: string) => {
    try {
      await lineItemService.deleteNote(noteId);
      setAllNotes(prev => prev.filter(note => note.id !== noteId));
      message.success('Note deleted successfully');
    } catch (error) {
      console.error('Failed to delete note:', error);
      // More specific error handling
      if (error instanceof Error) {
        message.error(`Failed to delete note: ${error.message}`);
      } else {
        message.error('Failed to delete note. Please try again.');
      }
    }
  };

  // Reset note modal state
  const resetNoteModal = () => {
    setNoteModalVisible(false);
    setSelectedItemForNote(null);
    setAllNotes([]); // Clear all notes when closing modal
    setNoteTemplates([]);
    setNoteCreationType('template');
    setEditingNote(null);
    setTemplateSearch('');
    setSelectedTemplate(null);
    setPreviewTemplate(null);
    setNoteEditorMode('template');
    
    // Reset forms only if they exist and are connected to DOM
    try {
      noteForm.resetFields();
      noteEditForm.resetFields();
    } catch (error) {
      // Ignore form reset errors when modal is closing
      console.debug('Form reset skipped - forms may be unmounted');
    }
  };

  // Filter templates by search
  const filteredTemplates = useMemo(() => {
    // Ensure noteTemplates is always an array
    const templates = noteTemplates || [];
    if (!templateSearch) return templates;
    const searchLower = templateSearch.toLowerCase();
    return templates.filter(template => 
      template.title?.toLowerCase().includes(searchLower) ||
      template.content?.toLowerCase().includes(searchLower) ||
      template.category?.toLowerCase().includes(searchLower)
    );
  }, [noteTemplates, templateSearch]);

  // Inline editing handlers
  const handleCellClick = (index: number, field: string, currentValue: any, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (field === 'category') {
      setCategoryModalEditingIndex(index);
      setCategoryModalVisible(true);
      return;
    }
    
    if (field === 'item') {
      setSelectionModalEditingIndex(index);
      setSelectionModalVisible(true);
      return;
    }
    
    if (field === 'calc') {
      // Enable inline calculator editing
      const currentItem = (items || [])[index];
      // Extract formula from note if it exists, otherwise use quantity
      const existingFormula = currentItem.note?.includes('Formula:') 
        ? currentItem.note.replace('Formula: ', '') 
        : currentItem.quantity.toString();
      
      setEditingCell({ index, field });
      setEditingValue(existingFormula);
      return;
    }
    
    setEditingCell({ index, field });
    setEditingValue(currentValue);
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    
    const { index, field } = editingCell;
    const updatedItems = [...(items || [])];
    const item = { ...updatedItems[index] };
    
    // Update the field value
    (item as any)[field] = editingValue;
    
    // Recalculate total if quantity or unit_price changed
    if (field === 'quantity' || field === 'unit_price') {
      item.total = item.quantity * item.unit_price;
    }
    
    updatedItems[index] = item;
    onItemsChange(updatedItems);
    
    setEditingCell(null);
    setEditingValue(null);
    message.success('Item updated');
  };

  const handleCellCancel = () => {
    setEditingCell(null);
    setEditingValue(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellSave();
    } else if (e.key === 'Escape') {
      handleCellCancel();
    }
  };

  // Table columns - File manager style with inline editing
  const columns: ColumnsType<EstimateLineItem> = useMemo(() => [
    {
      title: 'Cat',
      dataIndex: 'category',
      key: 'category',
      width: 80,
      render: (value: string, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return (record as any)?.category_code || (record as any)?.category || record.primary_group || '-';
        
        // Show actual category code if available, fallback to primary_group
        // For Xactimate items, check category_code first, then category, then primary_group
        const displayValue = (record as any)?.category_code || (record as any)?.category || record.primary_group || '-';
        
        return (
          <div
            onClick={(e) => {
              loadCategories();
              handleCellClick(index, 'category', displayValue, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to change category"
          >
            {displayValue}
          </div>
        );
      },
    },
    {
      title: 'Sel',
      dataIndex: 'item',
      key: 'item',
      width: 100,
      render: (value: string, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return <span>{value || '-'}</span>;
        
        return (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setSelectionModalEditingIndex(index);
              setSelectionModalVisible(true);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to select different line item"
          >
            {value || '-'}
          </div>
        );
      },
    },
    {
      title: 'Notes',
      key: 'notes',
      dataIndex: 'note',
      width: 60,
      render: (_: string | undefined, record: EstimateLineItem) => (
        <Button
          type="text"
          icon={<FileTextOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedItemForNote(record);
            setNoteModalVisible(true);
          }}
        />
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (value: string, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return value || '-';
        
        const isEditing = editingCell?.index === index && editingCell?.field === 'description';
        
        if (isEditing) {
          return (
            <Input
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={handleCellSave}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{ margin: '-5px 0' }}
            />
          );
        }
        
        return (
          <div
            onClick={(e) => {
              handleCellClick(index, 'description', value, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to edit description"
          >
            {value || '-'}
          </div>
        );
      },
    },
    {
      title: 'Calc',
      key: 'calc',
      dataIndex: 'quantity',
      width: 120,
      render: (_: number, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return '-';
        
        const isEditing = editingCell?.index === index && editingCell?.field === 'calc';
        
        if (isEditing) {
          return (
            <Input
              key={`calc-input-${index}`}
              defaultValue={editingValue}
              placeholder="Formula"
              size="small"
              style={{ width: '100%' }}
              autoFocus
              onPressEnter={(e) => {
                const formula = (e.target as HTMLInputElement).value;
                try {
                  // Use mathjs to evaluate the formula
                  const result = evaluate(formula);
                  
                  if (typeof result === 'number' && !isNaN(result)) {
                    // Update the item with new quantity and formula
                    const updatedItems = [...(items || [])];
                    const item = { ...updatedItems[index] };
                    
                    item.quantity = result;
                    item.total = result * item.unit_price;
                    item.note = formula !== result.toString() ? `Formula: ${formula}` : undefined;
                    
                    updatedItems[index] = item;
                    onItemsChange(updatedItems);
                    
                    message.success(`Quantity updated: ${result}`);
                  } else {
                    message.error('Invalid calculation result');
                  }
                } catch (error) {
                  message.error('Invalid formula');
                }
                
                // Exit editing mode
                setEditingCell(null);
                setEditingValue(null);
              }}
              onBlur={(e) => {
                const formula = e.target.value;
                if (formula && formula !== editingValue) {
                  try {
                    const result = evaluate(formula);
                    
                    if (typeof result === 'number' && !isNaN(result)) {
                      const updatedItems = [...(items || [])];
                      const item = { ...updatedItems[index] };
                      
                      item.quantity = result;
                      item.total = result * item.unit_price;
                      item.note = formula !== result.toString() ? `Formula: ${formula}` : undefined;
                      
                      updatedItems[index] = item;
                      onItemsChange(updatedItems);
                    }
                  } catch (error) {
                    // Silently ignore on blur if formula is invalid
                  }
                }
                
                // Exit editing mode
                setEditingCell(null);
                setEditingValue(null);
              }}
            />
          );
        }
        
        return (
          <div
            onClick={(e) => {
              handleCellClick(index, 'calc', null, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to show calculator"
          >
            {record.note?.includes('Formula:') ? 
              record.note.replace('Formula: ', '') : '-'}
          </div>
        );
      },
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right' as const,
      render: (value: number, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return value || 0;
        
        const isEditing = editingCell?.index === index && editingCell?.field === 'quantity';
        
        if (isEditing) {
          return (
            <InputNumber
              value={editingValue}
              onChange={(val) => setEditingValue(val || 0)}
              onBlur={handleCellSave}
              onKeyDown={handleKeyDown}
              autoFocus
              min={0}
              precision={2}
              style={{ width: '100%', margin: '-5px 0' }}
            />
          );
        }
        
        return (
          <div
            onClick={(e) => {
              handleCellClick(index, 'quantity', value, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to edit quantity"
          >
            {value || 0}
          </div>
        );
      },
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      key: 'unit',
      width: 60,
      render: (value: string, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return value || '-';
        
        const isEditing = editingCell?.index === index && editingCell?.field === 'unit';
        
        if (isEditing) {
          return (
            <Select
              value={editingValue}
              onChange={(val) => setEditingValue(val)}
              onBlur={handleCellSave}
              autoFocus
              style={{ width: '100%', margin: '-5px 0' }}
              dropdownMatchSelectWidth={false}
            >
              <Option value="EA">EA</Option>
              <Option value="SF">SF</Option>
              <Option value="LF">LF</Option>
              <Option value="SY">SY</Option>
              <Option value="SQ">SQ</Option>
              <Option value="HR">HR</Option>
              <Option value="DAY">DAY</Option>
            </Select>
          );
        }
        
        return (
          <div
            onClick={(e) => {
              handleCellClick(index, 'unit', value, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to edit unit"
          >
            {value || '-'}
          </div>
        );
      },
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 100,
      align: 'right' as const,
      render: (value: number, record: EstimateLineItem, index: number | undefined) => {
        // Safety check for index
        if (typeof index !== 'number') return `$${formatNumber(value)}`;
        
        const isEditing = editingCell?.index === index && editingCell?.field === 'unit_price';
        
        if (isEditing) {
          return (
            <InputNumber
              value={editingValue}
              onChange={(val) => setEditingValue(val || 0)}
              onBlur={handleCellSave}
              onKeyDown={handleKeyDown}
              autoFocus
              min={0}
              precision={2}
              formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
              style={{ width: '100%', margin: '-5px 0' }}
            />
          );
        }
        
        return (
          <div
            onClick={(e) => {
              handleCellClick(index, 'unit_price', value, e);
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              minHeight: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title="Click to edit unit price"
          >
            ${formatNumber(value)}
          </div>
        );
      },
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      width: 100,
      align: 'right' as const,
      render: (value: number) => <strong>${formatNumber(value)}</strong>,
    },
  ].filter(col => col && col.title && col.key), [editingCell, editingValue, selectedItemForNote, handleCellClick, handleCellSave, handleKeyDown, items, onItemsChange]);


  return (
    <div>
      {/* Input Section */}
      <Card 
        size="small" 
        style={{ 
          marginBottom: 16,
        }}
      >



        {/* Row 1: Cat, Sel, Act */}
        <Row gutter={[8, 8]} align="middle" style={{ marginBottom: 8 }}>
          <Col xs={8} sm={8} md={4}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Category</Text>
              <Button
                style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => {
                  // Load categories only when modal opens
                  loadCategories();
                  setCategoryModalVisible(true);
                }}
                disabled={!isGroupSelected}
              >
                {formData.category || 'Category'}
              </Button>
            </div>
          </Col>

          <Col xs={8} sm={8} md={4}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Selection</Text>
              <Button
                style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => {
                  if (formData.category) {
                    setSelectionModalVisible(true);
                  }
                }}
                disabled={!isGroupSelected}
              >
                {formData.itemCode ? `${formData.itemCode}` : 'Browse'}
              </Button>
            </div>
          </Col>

          <Col xs={8} sm={8} md={4}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Action</Text>
              <Select
                placeholder="Act"
                value={formData.action}
                onChange={(value) => setFormData(prev => ({ ...prev, action: value }))}
                style={{ width: '100%' }}
              >
                {Object.entries(LINE_ITEM_ACTIONS).map(([key, action]) => (
                  <Option key={key} value={key}>
                    {action.symbol} {action.label}
                  </Option>
                ))}
              </Select>
            </div>
          </Col>

          <Col xs={24} sm={24} md={{ span: 4, offset: 8 }}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Xactimate Database</Text>
              <Button
                style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => {
                  setXactimateModalVisible(true);
                }}
                disabled={!isGroupSelected}
              >
                Xactimate
              </Button>
            </div>
          </Col>
        </Row>

        {/* Row 2: Description */}
        <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
          <Col span={24}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Description</Text>
              <Input
                placeholder="Enter item description"
                value={formData.description}
                onChange={(e) => {
                  const description = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    description,
                    // Auto-generate item code when description changes and no item code is manually set
                    ...(!prev.itemCode ? {
                      itemCode: description ? generateItemCode(description) : undefined
                    } : {})
                  }));
                }}
                style={{ width: '100%' }}
              />
            </div>
          </Col>
        </Row>

        {/* Row 3: Quantity Calculation and Amount Calculation */}
        <Row gutter={[8, 8]} align="middle">
          <Col xs={10} sm={8} md={6}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Quantity</Text>
              <Calculator
                key={calculatorKey}
                placeholder="Calc quantity"
                initialValue={formData.quantityFormula}
                onChange={(value: number, formula: string) => setFormData(prev => ({
                  ...prev,
                  quantity: value,
                  quantityFormula: formula,
                }))}
                style={{
                  width: '100%'
                }}
              />
            </div>
          </Col>

          <Col xs={6} sm={4} md={3}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Unit</Text>
              <Select
                placeholder="Unit"
                value={formData.unit}
                onChange={(value) => setFormData(prev => ({ ...prev, unit: value }))}
                style={{ width: '100%' }}
              >
                <Option value="EA">EA</Option>
                <Option value="SF">SF</Option>
                <Option value="LF">LF</Option>
                <Option value="SY">SY</Option>
                <Option value="SQ">SQ</Option>
                <Option value="HR">HR</Option>
                <Option value="DAY">DAY</Option>
              </Select>
            </div>
          </Col>

          <Col xs={6} sm={5} md={3}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2 }}>Unit Price</Text>
              <InputNumber
                placeholder="0.00"
                value={formData.unitPrice}
                onChange={(value) => {
                  // 소숫점 두 자리까지만 허용
                  if (value !== null && value !== undefined) {
                    const rounded = Math.round(value * 100) / 100;
                    setFormData(prev => ({ ...prev, unitPrice: rounded }));
                  } else {
                    setFormData(prev => ({ ...prev, unitPrice: 0 }));
                  }
                }}
                addonBefore="$"
                style={{ width: '100%' }}
                min={0}
                max={999999.99}
                step={0.01}
                precision={2}
                controls={true}
                keyboard={true}
              />
            </div>
          </Col>

          <Col xs={6} sm={4} md={3}>
            <div style={{ paddingTop: '18px' }}>
              <Text strong style={{ fontSize: '14px', color: '#52c41a' }}>
                ${formatNumber((formData.quantity || 0) * (formData.unitPrice || 0))}
              </Text>
            </div>
          </Col>

          <Col xs={8} sm={6} md={6}>
            <div>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginBottom: 2, visibility: 'hidden' }}>Actions</Text>
              <Space>
                {showSaveButton && (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSave}
                    size="small"
                  >
                    {editingIndex !== null ? 'Update' : 'Add'}
                  </Button>
                )}
                <Button
                  icon={<ClearOutlined />}
                  onClick={handleClear}
                  size="small"
                >
                  Clear
                </Button>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>


      {/* Table Section - File Manager Style */}
      <Card>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">
            {(selectedRowKeys || []).length > 0 ? `${(selectedRowKeys || []).length} item(s) selected` : 'No items selected'}
            {(copiedItems || []).length > 0 && ` • ${(copiedItems || []).length} item(s) in clipboard`}
          </Text>
        </div>
        <div
          onKeyDown={handleTableKeyDown}
          onContextMenu={handleEmptyAreaRightClick}
          tabIndex={0}
          style={{ outline: 'none' }}
        >
          <Table
            columns={columns}
            dataSource={tableDataSource}
            rowKey={(record, index) => {
              // Use index as primary key for consistency
              if (typeof index === 'number') return index.toString();
              // Fallback to record ID if available
              if (record?.id) return record.id;
              // Generate safe temporary key
              return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            }}
            pagination={false}
            scroll={{ x: 1000 }}
            size="small"
            rowSelection={tableDataSource.length > 0 && tableDataSource.every(item => item?.description) ? handleRowSelection : undefined}
            onRow={(record, index) => {
              // Safety check for record and index
              if (!record || typeof record !== 'object' || record === null || record === undefined || typeof index !== 'number') {
                return {};
              }

              // Additional safety check for record properties
              if (!record.description) {
                return {};
              }

              return {
                onClick: (event) => {
                  const rowIndex = index;
                  // Handle Ctrl+click for multi-selection
                  if (event.ctrlKey || event.metaKey) {
                    const key = rowIndex.toString();
                    const currentSelected = selectedRowKeys || [];
                    if (currentSelected.includes(key)) {
                      setSelectedRowKeys(currentSelected.filter(k => k !== key));
                    } else {
                      setSelectedRowKeys([...currentSelected, key]);
                    }
                  } else {
                    // Single selection
                    setSelectedRowKeys([rowIndex.toString()]);
                  }
                },
                onContextMenu: (event) => {
                  handleRightClick(event, record, index);
                },
                style: {
                  cursor: 'pointer',
                  backgroundColor: (selectedRowKeys || []).includes(index.toString()) ? '#e6f7ff' : undefined,
                },
              };
            }}
            locale={{
              emptyText: <Empty description="No line items. Add items using the form above." />,
            }}
          />
        </div>
      </Card>

      {/* Context Menu */}
      {contextMenuVisible && (
        <div
          style={{
            position: 'fixed',
            top: contextMenuPosition.y,
            left: contextMenuPosition.x,
            zIndex: 1000,
            backgroundColor: 'white',
            border: '1px solid #d9d9d9',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            padding: '4px 0',
            minWidth: '120px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Only show item-specific options when items are selected */}
          {(contextMenuItems || []).length > 0 && (
            <>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
                onClick={() => handleContextMenuAction('edit')}
                onMouseEnter={(e) => (e.target as HTMLElement).style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => (e.target as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <EditOutlined style={{ marginRight: 8 }} />Edit
              </div>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
                onClick={() => handleContextMenuAction('duplicate')}
                onMouseEnter={(e) => (e.target as HTMLElement).style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => (e.target as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <CopyOutlined style={{ marginRight: 8 }} />Duplicate
              </div>
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
                onClick={() => handleContextMenuAction('copy')}
                onMouseEnter={(e) => (e.target as HTMLElement).style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => (e.target as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <CopyOutlined style={{ marginRight: 8 }} />Copy
              </div>
            </>
          )}
          {(copiedItems || []).length > 0 && (
            <div
              style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px' }}
              onClick={() => handleContextMenuAction('paste')}
              onMouseEnter={(e) => (e.target as HTMLElement).style.backgroundColor = '#f5f5f5'}
              onMouseLeave={(e) => (e.target as HTMLElement).style.backgroundColor = 'transparent'}
            >
              <CopyOutlined style={{ marginRight: 8 }} />Paste ({(copiedItems || []).length})
            </div>
          )}
          {/* Show separator and delete option only when items are selected */}
          {(contextMenuItems || []).length > 0 && (
            <>
              <div
                style={{
                  height: '1px',
                  backgroundColor: '#f0f0f0',
                  margin: '4px 0'
                }}
              />
              <div
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#ff4d4f' }}
                onClick={() => handleContextMenuAction('delete')}
                onMouseEnter={(e) => (e.target as HTMLElement).style.backgroundColor = '#fff2f0'}
                onMouseLeave={(e) => (e.target as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <DeleteOutlined style={{ marginRight: 8 }} />Delete
              </div>
            </>
          )}
        </div>
      )}

      {/* Note Management Modal - Two Panel Layout */}
      <Modal
        title={(
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Line Item Notes
            </Title>
            <Text type="secondary">
              {selectedItemForNote?.description}
            </Text>
          </div>
        )}
        open={noteModalVisible}
        onCancel={resetNoteModal}
        footer={null}
        width={1100}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Row gutter={24}>
          {/* Left Panel: Current Notes List */}
          <Col span={10}>
            <div style={{ borderRight: '1px solid #f0f0f0', paddingRight: 16, height: '100%', minHeight: 500 }}>
              <Title level={5} style={{ marginBottom: 16 }}>Notes ({allNotes.length})</Title>
            {loadingNotes ? (
              <Spin size="small" />
            ) : allNotes.length > 0 ? (
              <List
                size="small"
                dataSource={allNotes}
                renderItem={(note, index) => (
                  <List.Item
                    actions={[
                      <Button
                        key="edit"
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => handleNoteEdit(note)}
                      />,
                      <Popconfirm
                        key="delete"
                        title="Delete this note?"
                        onConfirm={() => {
                          if (note._isSaved) {
                            handleNoteDelete(note.id);
                          } else {
                            // Remove unsaved note from local state
                            setAllNotes(prev => prev.filter(n => n.id !== note.id));
                            message.info('Note removed');
                          }
                        }}
                        okText="Yes"
                        cancelText="No"
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={(
                        <div>
                          <Text strong={note._isSaved} type={note._isSaved ? undefined : 'secondary'}>
                            {note.title || `Note ${index + 1}`}
                            {!note._isSaved && <span style={{ marginLeft: 8, color: '#faad14' }}>(unsaved)</span>}
                          </Text>
                          {note.category && (
                            <Tag style={{ marginLeft: 8 }}>
                              {note.category}
                            </Tag>
                          )}
                          {note.is_template && (
                            <Tag color="blue" style={{ marginLeft: 8 }}>
                              Template
                            </Tag>
                          )}
                        </div>
                      )}
                      description={note.content}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Empty
                description="No notes yet"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ margin: '16px 0' }}
              />
            )}
            </div>
          </Col>

          {/* Right Panel: Note Editor */}
          <Col span={14}>
            <div style={{ paddingLeft: 8 }}>
              <Title level={5} style={{ marginBottom: 16 }}>
                {editingNote ? 'Edit Note' : 'Add New Note'}
              </Title>
              
              {/* Note Creation Type Selection */}
              {!editingNote && (
                <Segmented
                  value={noteEditorMode}
                  onChange={(value) => setNoteEditorMode(value as 'template' | 'custom')}
                  style={{ marginBottom: 16 }}
                  block
                  options={[
                    {
                      label: 'From Template',
                      value: 'template',
                      icon: <BookOutlined />,
                    },
                    {
                      label: 'Custom Note',
                      value: 'custom',
                      icon: <EditOutlined />,
                    },
                  ]}
                />
              )}

              <Form
                form={editingNote ? noteEditForm : noteForm}
                onFinish={editingNote ? handleNoteUpdate : handleAddNote}
                layout="vertical"
              >
                {(editingNote || noteEditorMode === 'custom') ? (
                  /* Custom Note Form */
                  <div>
                    <Form.Item
                      name="title"
                      label="Note Title"
                      initialValue={editingNote?.title || ''}
                    >
                      <Input placeholder="Enter note title..." />
                    </Form.Item>
                    
                    <Form.Item
                      name="content"
                      label="Note Content"
                      rules={[{ required: true, message: 'Please enter note content' }]}
                      initialValue={editingNote?.content || ''}
                    >
                      <TextArea
                        rows={6}
                        placeholder="Enter note content..."
                        showCount
                        maxLength={1000}
                      />
                    </Form.Item>
                    
                    {!editingNote && (
                      <Form.Item name="saveAsTemplate" valuePropName="checked">
                        <Checkbox>Save as template for future use</Checkbox>
                      </Form.Item>
                    )}
                  </div>
                ) : (
                  <div>
                    <Input
                      placeholder="Search templates..."
                      prefix={<SearchOutlined />}
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      style={{ marginBottom: 12 }}
                    />
                    
                    {loadingTemplates ? (
                      <div style={{ textAlign: 'center', padding: 40 }}>
                        <Spin />
                      </div>
                    ) : filteredTemplates.length === 0 ? (
                      <Empty
                        description="No templates available"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        style={{ margin: '40px 0' }}
                      />
                    ) : (
                      <Row gutter={16}>
                        <Col span={14}>
                          <div style={{ 
                            maxHeight: 300, 
                            overflowY: 'auto', 
                            border: '1px solid #d9d9d9', 
                            borderRadius: 6 
                          }}>
                            <List
                              size="small"
                              dataSource={filteredTemplates}
                              renderItem={(template) => (
                                <List.Item
                                  style={{
                                    cursor: 'pointer',
                                    backgroundColor: selectedTemplate?.id === template.id ? '#1890ff' :
                                                     (previewTemplate?.id === template.id ? '#f0f8ff' : 'transparent'),
                                    padding: '8px 12px',
                                    border: selectedTemplate?.id === template.id ? '1px solid #1890ff' : 'none',
                                    borderRadius: selectedTemplate?.id === template.id ? '4px' : '0',
                                  }}
                                  onClick={() => {
                                    setSelectedTemplate(template);
                                    setPreviewTemplate(template);
                                  }}
                                  onMouseEnter={() => {
                                    if (selectedTemplate?.id !== template.id) {
                                      setPreviewTemplate(template);
                                    }
                                  }}
                                  onMouseLeave={() => {
                                    if (selectedTemplate?.id !== template.id) {
                                      setPreviewTemplate(selectedTemplate);
                                    }
                                  }}
                                >
                                  <List.Item.Meta
                                    title={(
                                      <div>
                                        {template.title}
                                        {template.category && (
                                          <Tag style={{ marginLeft: 8, fontSize: '11px', padding: '0 4px' }}>
                                            {template.category}
                                          </Tag>
                                        )}
                                      </div>
                                    )}
                                    description={
                                      <Text type="secondary" ellipsis>
                                        {template.content?.substring(0, 60)}...
                                      </Text>
                                    }
                                  />
                                </List.Item>
                              )}
                            />
                          </div>
                        </Col>
                        <Col span={10}>
                          {previewTemplate ? (
                            <Card 
                              size="small" 
                              title="Preview"
                              style={{ height: 300, overflowY: 'auto' }}
                            >
                              <Title level={5}>{previewTemplate.title}</Title>
                              <Text>{previewTemplate.content}</Text>
                              {previewTemplate.category && (
                                <div style={{ marginTop: 12 }}>
                                  <Tag color="blue">{previewTemplate.category}</Tag>
                                </div>
                              )}
                            </Card>
                          ) : (
                            <Card 
                              size="small" 
                              style={{ height: 300 }}
                            >
                              <Empty
                                description="Select a template to preview"
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                              />
                            </Card>
                          )}
                        </Col>
                      </Row>
                    )}
                  </div>
                )}
                
                <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Button 
                      onClick={() => {
                        if (editingNote) {
                          setEditingNote(null);
                          noteEditForm.resetFields();
                        } else {
                          noteForm.resetFields();
                          setSelectedTemplate(null);
                          setPreviewTemplate(null);
                        }
                      }}
                    >
                      {editingNote ? 'Cancel Edit' : 'Clear'}
                    </Button>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={savingNote}
                      icon={<SaveOutlined />}
                    >
                      {editingNote ? 'Update Note' : 'Add Note'}
                    </Button>
                  </Space>
                </Form.Item>
              </Form>
            </div>
          </Col>
        </Row>

        {/* Modal Footer - Save all unsaved notes */}
        {allNotes.filter(note => !note._isSaved).length > 0 && (
          <div style={{
            borderTop: '1px solid #e8e8e8',
            padding: '16px 0 0 0',
            marginTop: 24,
            textAlign: 'right'
          }}>
            <Space>
              <Text type="secondary">
                {allNotes.filter(note => !note._isSaved).length} unsaved note(s)
              </Text>
              <Button
                type="primary"
                onClick={handleSaveNotes}
                loading={savingNote}
              >
                Save All Notes to Item
              </Button>
            </Space>
          </div>
        )}

      </Modal>

      {/* Category Selection Modal - Only render when modal is actually open */}
      {categoryModalVisible && (
        <CategoryModal
          open={categoryModalVisible}
          onCancel={() => {
            setCategoryModalVisible(false);
            setCategoryModalEditingIndex(null);
          }}
          onSelect={handleCategorySelect}
          selectedValue={categoryModalEditingIndex !== null ? 
            (items[categoryModalEditingIndex] as any)?.category : formData.category}
        />
      )}

      {/* Line Item Selection Modal - Only render when modal is actually open */}
      {selectionModalVisible && (
        <SelectionModal
          open={selectionModalVisible}
          onCancel={() => {
            setSelectionModalVisible(false);
            setSelectionModalEditingIndex(null);
          }}
          onSelect={handleSelectionSelect}
          selectedCategory={selectionModalEditingIndex !== null ? 
            (items[selectionModalEditingIndex] as any)?.category : formData.category}
        />
      )}

      {/* Xactimate Input Mode Modal */}
      <Modal
        title="Add Items from Xactimate Database"
        open={xactimateModalVisible}
        onCancel={handleXactimateModalClose}
        footer={null}
        width={1200}
        style={{ top: 20 }}
        styles={{ body: { padding: 0, height: '70vh' } }}
      >
        <XactimateInputMode
          onAddItems={handleAddXactimateItems}
          onCancel={handleXactimateModalClose}
        />
      </Modal>
    </div>
  );
};

export default LineItemManager;