import React, { useState, useCallback } from 'react';
import { AutoComplete, Button, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import debounce from 'lodash/debounce';
import lineItemService from '../../services/lineItemService';
import SelectionModal from './SelectionModal';
import { LineItemModalItem, LineItem } from '../../types/lineItem';
import { EstimateLineItem } from '../../services/estimateService';

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
  return (item as LineItem).name || '';
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

const ItemCodeSelector: React.FC<ItemCodeSelectorProps> = ({
  value,
  onChange,
  onLineItemAdd,
  placeholder = "Enter item code or search line items",
  disabled = false,
  style,
  mode = 'add',
}) => {
  // console.log('ItemCodeSelector render - value:', value);
  // console.log('ItemCodeSelector render - onChange:', !!onChange);
  const [options, setOptions] = useState<AutoCompleteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectionModalVisible, setSelectionModalVisible] = useState(false);

  // Debounced search function for AutoComplete
  const debouncedSearch = useCallback(
    debounce(async (searchValue: string) => {
      if (!searchValue || searchValue.length < 2) {
        setOptions([]);
        return;
      }

      setLoading(true);
      try {
        const items = await lineItemService.searchLineItemsSimple(searchValue, 10);

        const searchOptions: AutoCompleteOption[] = items.map(item => ({
          value: getItemCode(item),
          label: `${getItemCode(item)} - ${getItemDescription(item)}`,
          item: item,
        }));

        setOptions(searchOptions);
      } catch (error) {
        console.error('AutoComplete search failed:', error);
        setOptions([]);
      } finally {
        setLoading(false);
      }
    }, 300),
    [setOptions, setLoading]
  );

  // Handle AutoComplete search
  const handleSearch = (searchValue: string) => {
    debouncedSearch(searchValue);
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
        note: '',
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
            note: '',
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
          filterOption={false} // We handle filtering server-side
          notFoundContent={loading ? 'Searching...' : 'No line items found'}
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