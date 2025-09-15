// Unit constants for consistent usage across the application

export interface Unit {
  value: string;
  label: string;
  description?: string;
}

export const UNITS: Unit[] = [
  { value: 'EA', label: 'EA', description: 'Each' },
  { value: 'HR', label: 'HR', description: 'Hour' },
  { value: 'DY', label: 'DY', description: 'Day' },
  { value: 'SF', label: 'SF', description: 'Square Feet' },
  { value: 'SQ', label: 'SQ', description: 'Square' },
  { value: 'LF', label: 'LF', description: 'Linear Feet' },
  { value: 'GL', label: 'GL', description: 'Gallon' },
  { value: 'BX', label: 'BX', description: 'Box' },
  { value: 'RL', label: 'RL', description: 'Roll' },
  { value: 'PC', label: 'PC', description: 'Piece' },
  { value: 'ST', label: 'ST', description: 'Set' },
  { value: 'LT', label: 'LT', description: 'Lot' },
];

// Default unit for new items
export const DEFAULT_UNIT = 'EA';

// Helper function to get unit label by value
export const getUnitLabel = (value: string): string => {
  const unit = UNITS.find(u => u.value === value);
  return unit ? unit.label : value;
};

// Helper function to get unit description by value
export const getUnitDescription = (value: string): string => {
  const unit = UNITS.find(u => u.value === value);
  return unit ? unit.description || unit.label : value;
};