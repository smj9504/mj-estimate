import React, { useState, useCallback } from 'react';
import { AutoComplete, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import SelectionModal from './SelectionModal';
import { LineItemModalItem, LineItem } from '../../types/lineItem';
import { EstimateLineItem } from '../../services/estimateService';
import { useLineItemsCache } from '../../hooks/useLineItemsCache';

interface ItemCodeSelectorProps {
  value?: string;
  onChange?: (value: string) => void;
  onLineItemAdd?: (lineItems: EstimateLineItem[]) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  mode?: 'add' | 'edit'; // Add mode prop to control behavior
}

interface AutoCompleteOption {
  value: string;
  label: string;
  item: LineItemModalItem | LineItem;
}

// Helper functions to safely access properties from both types
const getItemCode = (item: LineItemModalItem | LineItem): string => {
  if ('component_code' in item) {
    // This is a LineItemModalItem
    return item.component_code || item.item_code || '';
  }
  // This is a LineItem
  return (item as LineItem).item || '';
};

const getItemDescription = (item: LineItemModalItem | LineItem): string => {
  return item.description || '';
};

const getItemUnit = (item: LineItemModalItem | LineItem): string => {
  return item.unit || 'ea';
};

const getItemPrice = (item: LineItemModalItem | LineItem): number => {
  if ('unit_price' in item) {
    // This is a LineItemModalItem
    return item.unit_price || 0;
  }
  // This is a LineItem
  return (item as LineItem).untaxed_unit_price || 0;
};

// Helper function to extract note/includes content from an item
const getItemNote = (item: LineItemModalItem | LineItem): string => {
  // First check for includes field (available in both types)
  if ('includes' in item && item.includes) {
    return item.includes;
  }
  // For LineItem type, also check notes array
  if ('notes' in item && Array.isArray(item.notes) && item.notes.length > 0) {
    // Combine all notes content with newlines
    return item.notes.map((note: { content: string }) => note.content).join('\n');
  }
  return '';
};

const ItemCodeSelector: React.FC<ItemCodeSelectorProps> = ({
  value,
  onChange,
  onLineItemAdd,
  placeholder = "Enter item code or search line items",
  disabled = false,
  style,
  mode = 'add',
}) => {
  const [options, setOptions] = useState<AutoCompleteOption[]>([]);
  const [selectionModalVisible, setSelectionModalVisible] = useState(false);

  // Use shared cache hook instead of local state
  const { filterBySearch, isLoading: isInitialLoading } = useLineItemsCache();

  // Local search function - filters cached items instead of calling API
  const handleLocalSearch = useCallback((searchValue: string) => {
    if (!searchValue || searchValue.length < 2) {
      setOptions([]);
      return;
    }

    // Use shared cache filter (instant, no network call)
    const filteredItems = filterBySearch(searchValue, 10);

    const searchOptions: AutoCompleteOption[] = filteredItems.map(item => ({
      value: getItemCode(item),
      label: `${getItemCode(item)} - ${getItemDescription(item)}`,
      item: item,
    }));

    setOptions(searchOptions);
  }, [filterBySearch]);

  // Handle AutoComplete search - now uses local filtering
  const handleSearch = (searchValue: string) => {
    handleLocalSearch(searchValue);
  };

  // Handle AutoComplete selection
  const handleSelect = (selectedValue: string, option: AutoCompleteOption) => {
    onChange?.(selectedValue);

    // Only add items in 'add' mode, not in 'edit' mode
    if (mode === 'add' && onLineItemAdd && option.item) {
      const itemCode = getItemCode(option.item);
      const itemDescription = getItemDescription(option.item);
      const itemUnit = getItemUnit(option.item);
      const itemPrice = getItemPrice(option.item);
      const itemNote = getItemNote(option.item);

      const estimateItem: EstimateLineItem = {
        id: undefined,
        line_item_id: String(option.item.id), // Add line_item_id for template creation
        name: itemCode,
        description: itemDescription,
        quantity: 1,
        unit: itemUnit,
        unit_price: itemPrice,
        total: itemPrice,
        taxable: true,
        primary_group: '',
        secondary_group: '',
        sort_order: 0,
        note: itemNote,
      };

      onLineItemAdd([estimateItem]);
    }
  };

  // Handle Selection Modal selection
  const handleModalSelect = (selectedItems: LineItemModalItem[]) => {
    setSelectionModalVisible(false);

    if (selectedItems.length > 0) {
      if (mode === 'edit' && selectedItems.length === 1) {
        // In edit mode, just update the name field with the first selected item
        const firstItem = selectedItems[0];
        const itemCode = getItemCode(firstItem);
        onChange?.(itemCode);
      } else if (mode === 'add' && onLineItemAdd) {
        // In add mode, add all selected items
        const estimateItems: EstimateLineItem[] = selectedItems.map(item => {
          const itemCode = getItemCode(item);
          const itemDescription = getItemDescription(item);
          const itemUnit = getItemUnit(item);
          const itemPrice = getItemPrice(item);
          const itemNote = getItemNote(item);

          return {
            id: undefined,
            line_item_id: String(item.id), // Add line_item_id for template creation
            name: itemCode,
            description: itemDescription,
            quantity: 1,
            unit: itemUnit,
            unit_price: itemPrice,
            total: itemPrice,
            taxable: true,
            primary_group: '',
            secondary_group: '',
            sort_order: 0,
            note: itemNote,
          };
        });

        onLineItemAdd(estimateItems);
      }
    }
  };

  return (
    <>
      <Space.Compact style={{ width: '100%', ...style }}>
        <AutoComplete
          value={value}
          options={options}
          onSearch={handleSearch}
          onSelect={handleSelect}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          allowClear={true}
          style={{ flex: 1 }}
          filterOption={false} // We handle filtering client-side
          notFoundContent={isInitialLoading ? 'Loading items...' : 'No line items found'}
        />
        <Button
          icon={<SearchOutlined />}
          onClick={() => setSelectionModalVisible(true)}
          disabled={disabled}
          title="Search Line Items"
        />
      </Space.Compact>

      <SelectionModal
        open={selectionModalVisible}
        onCancel={() => setSelectionModalVisible(false)}
        onSelect={handleModalSelect}
      />
    </>
  );
};

export default ItemCodeSelector;
