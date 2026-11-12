/**
 * A length in feet and inches: shows 12' 6", takes 12 6, 12'6", 150" or 12.5.
 * Commits on Enter or when it loses focus; a value it can't read turns red
 * and leaves the length as it was.
 */

import React, { useEffect, useState } from 'react';
import { Input } from 'antd';
import { formatFeet, parseFeet } from './utils/dimensions';

interface FeetInputProps {
  value: number;
  onCommit: (feet: number) => void;
  min?: number;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  style?: React.CSSProperties;
}

const FeetInput: React.FC<FeetInputProps> = ({ value, onCommit, min = 0.05, disabled, style, ...rest }) => {
  const [text, setText] = useState(formatFeet(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatFeet(value));
  }, [value, focused]);

  const commit = () => {
    const feet = parseFeet(text);
    if (feet === null || feet < min) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (Math.abs(feet - value) > 1e-4) onCommit(feet);
    setText(formatFeet(feet));
  };

  return (
    <Input
      size="small"
      value={text}
      disabled={disabled}
      status={invalid ? 'error' : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      style={{ width: 96, ...style }}
      aria-label={rest['aria-label']}
      data-testid={rest['data-testid']}
    />
  );
};

export default FeetInput;
