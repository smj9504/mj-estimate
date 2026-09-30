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
  /**
   * Fired on every keystroke with the live parsed value (NaN-free, 0 when
   * unparseable), for previewing the change on the canvas as the user types.
   *
   * Deliberately separate from onChange: every onChange lands in the reducer,
   * and the reducer pushes an undo entry per dispatch — routing keystrokes
   * through it would put one undo entry per typed character on the stack.
   * onChange still fires once, on blur/Enter, as the committed edit.
   */
  onPreview?: (feet: number) => void;
  placeholder?: string;
  label?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

const DimensionInput: React.FC<DimensionInputProps> = ({
  value,
  onChange,
  onPreview,
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
    // Show current value rounded to 2 decimal places for clean editing
    setRawInput(value > 0 ? String(Math.round(value * 100) / 100) : '');
    setIsInvalid(false);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setRawInput(next);
    // Live feedback while typing. Clear the error as soon as the text becomes
    // parseable again, rather than leaving it red until blur.
    const parsed = parseDimension(next);
    const parseable = next.trim() === '' || parsed > 0 || next.trim() === '0';
    if (parseable) setIsInvalid(false);
    if (onPreview && parsed > 0) onPreview(parsed);
  }, [onPreview]);

  const commitValue = useCallback(() => {
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

  const handleBlur = useCallback(() => {
    commitValue();
  }, [commitValue]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }, []);

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
        onKeyDown={handleKeyDown}
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
