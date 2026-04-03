/**
 * DimensionInput - Reusable smart dimension input component for WM sketch panels.
 *
 * Displays a formatted dimension string (e.g. "6' 3\"") when not focused.
 * Accepts raw user input in multiple formats when focused.
 * Highlights in red when the parsed result is 0 or invalid.
 *
 * Usage:
 *   <DimensionInput value={zone.dimension1_ft} onChange={(ft) => update({ dimension1_ft: ft })} label="Width" />
 */
import React, { useState, useCallback } from 'react';
import { Input } from 'antd';
import { parseDimension, formatDimension } from '../utils/wmCalculations';

export interface DimensionInputProps {
  /** Current value in decimal feet */
  value: number;
  onChange: (feet: number) => void;
  placeholder?: string;
  label?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

const DimensionInput: React.FC<DimensionInputProps> = ({
  value,
  onChange,
  placeholder = "e.g. 6' 3\" or 6.25",
  label,
  style,
  disabled = false,
}) => {
  const [focused, setFocused] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [isInvalid, setIsInvalid] = useState(false);

  const handleFocus = useCallback(() => {
    setFocused(true);
    // When user focuses, show current value as raw feet string so they can edit
    setRawInput(value > 0 ? String(value) : '');
    setIsInvalid(false);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRawInput(e.target.value);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (rawInput.trim() === '') {
      setIsInvalid(false);
      return;
    }
    const parsed = parseDimension(rawInput);
    if (parsed === 0 && rawInput.trim() !== '0') {
      setIsInvalid(true);
    } else {
      setIsInvalid(false);
      onChange(parsed);
    }
  }, [rawInput, onChange]);

  const displayValue = focused ? rawInput : (value > 0 ? formatDimension(value) : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
      {label && (
        <span style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{label}</span>
      )}
      <Input
        value={displayValue}
        placeholder={placeholder}
        size="small"
        disabled={disabled}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        status={isInvalid ? 'error' : undefined}
        style={{
          borderColor: isInvalid ? '#ff4d4f' : undefined,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      {isInvalid && (
        <span style={{ fontSize: 11, color: '#ff4d4f' }}>
          Cannot parse — try 6&apos; 3&quot; or 6.25
        </span>
      )}
    </div>
  );
};

export default DimensionInput;
