import React from 'react';
import { Select, SelectProps, AutoComplete, AutoCompleteProps } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { UNITS, DEFAULT_UNIT } from '../../constants/units';

// Create a common base interface for shared props
interface BaseUnitProps {
  showDescription?: boolean;
  componentVariant?: 'select' | 'autocomplete';
}

// Select variant props - exclude 'options' and 'variant' to avoid conflicts
interface UnitSelectProps extends Omit<SelectProps, 'options' | 'variant'>, BaseUnitProps {
  componentVariant?: 'select';
}

// AutoComplete variant props - exclude 'options' and 'variant' to avoid conflicts  
interface UnitAutoCompleteProps extends Omit<AutoCompleteProps, 'options' | 'variant'>, BaseUnitProps {
  componentVariant: 'autocomplete';
}

type Props = UnitSelectProps | UnitAutoCompleteProps;

const UnitSelect: React.FC<Props> = ({ 
  showDescription = false, 
  placeholder = "Select unit",
  componentVariant = 'select',
  ...props 
}) => {
  const options = UNITS.map(unit => ({
    value: unit.value,
    label: showDescription && unit.description ? `${unit.label} - ${unit.description}` : unit.label,
  }));

  if (componentVariant === 'autocomplete') {
    return (
      <AutoComplete
        placeholder={placeholder}
        options={options}
        filterOption={(inputValue: string, option?: DefaultOptionType) => {
          if (!option || !inputValue) return false;
          
          const label = option.label;
          const value = option.value;
          
          // Safely convert label to string for comparison
          const labelStr = typeof label === 'string' ? label : String(label || '');
          // Safely convert value to string for comparison
          const valueStr = typeof value === 'string' ? value : String(value || '');
          
          const input = inputValue.toLowerCase();
          return labelStr.toLowerCase().includes(input) || valueStr.toLowerCase().includes(input);
        }}
        {...(props as Omit<AutoCompleteProps, 'options' | 'variant' | 'placeholder' | 'filterOption'>)}
      />
    );
  }

  return (
    <Select
      placeholder={placeholder}
      options={options}
      {...(props as Omit<SelectProps, 'options' | 'variant' | 'placeholder'>)}
    />
  );
};

export default UnitSelect;