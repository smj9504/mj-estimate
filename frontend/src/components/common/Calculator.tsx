/**
 * Calculator Component
 * Reusable mathematical formula calculator with real-time evaluation
 * Supports basic arithmetic operations: +, -, *, /, (), decimals
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Input, Space, Typography, Tooltip } from 'antd';
import { CalculatorOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { evaluate } from 'mathjs';

const { Text } = Typography;

export interface CalculatorProps {
  /** Initial value or formula */
  initialValue?: string | number;
  /** Placeholder text for the input field */
  placeholder?: string;
  /** Number of decimal places to display in result */
  decimalPlaces?: number;
  /** Unit to display after the result */
  unit?: string;
  /** Callback when the calculated result changes */
  onChange?: (result: number, formula: string) => void;
  /** Callback when the formula string changes */
  onFormulaChange?: (formula: string) => void;
  /** Callback when an error occurs */
  onError?: (error: string | null) => void;
  /** Whether the calculator is disabled */
  disabled?: boolean;
  /** Custom style for the container */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
  /** Size of the input */
  size?: 'small' | 'middle' | 'large';
  /** Show calculator icon */
  showIcon?: boolean;
  /** Allow empty value (doesn't evaluate to 0) */
  allowEmpty?: boolean;
  /** Minimum value allowed */
  min?: number;
  /** Maximum value allowed */
  max?: number;
}

export interface CalculatorResult {
  value: number;
  formula: string;
  isValid: boolean;
  error: string | null;
}

const Calculator: React.FC<CalculatorProps> = ({
  initialValue = '',
  placeholder = 'Enter formula (e.g., 10 + 5 * 2)',
  decimalPlaces = 2,
  unit = '',
  onChange,
  onFormulaChange,
  onError,
  disabled = false,
  style,
  className,
  size = 'middle',
  showIcon = true,
  allowEmpty = false,
  min,
  max,
}) => {
  const [formula, setFormula] = useState<string>(
    typeof initialValue === 'number' ? initialValue.toString() : initialValue || ''
  );
  const [result, setResult] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState<boolean>(true);

  // Safe mathematical expression evaluator
  const evaluateExpression = useCallback((expression: string): { result: number; error: string | null } => {
    if (!expression.trim()) {
      if (allowEmpty) {
        return { result: 0, error: null };
      }
      return { result: 0, error: null };
    }

    try {
      // Remove any non-mathematical characters for safety
      const sanitized = expression
        .replace(/[^0-9+\-*/.() ]/g, '')
        .trim();

      if (!sanitized) {
        return { result: 0, error: allowEmpty ? null : 'Invalid formula' };
      }

      // Check for valid mathematical expression pattern
      const validPattern = /^[0-9+\-*/.() ]+$/;
      if (!validPattern.test(sanitized)) {
        return { result: 0, error: 'Invalid characters in formula' };
      }

      // Check for balanced parentheses
      const openParens = (sanitized.match(/\(/g) || []).length;
      const closeParens = (sanitized.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        return { result: 0, error: 'Unbalanced parentheses' };
      }

      // Use mathjs for safe evaluation
      const computed = evaluate(sanitized);
      
      // Handle complex numbers or non-finite results
      if (typeof computed === 'object' || !isFinite(computed)) {
        return { result: 0, error: 'Invalid calculation result' };
      }

      const numResult = Number(computed);

      // Check min/max constraints
      if (min !== undefined && numResult < min) {
        return { result: numResult, error: `Result must be at least ${min}` };
      }
      if (max !== undefined && numResult > max) {
        return { result: numResult, error: `Result must be at most ${max}` };
      }

      return { result: numResult, error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid formula';
      return { result: 0, error: errorMessage };
    }
  }, [allowEmpty, min, max]);

  // Calculate result whenever formula changes
  useEffect(() => {
    const { result: calculatedResult, error: calculationError } = evaluateExpression(formula);
    
    setResult(calculatedResult);
    setError(calculationError);
    setIsValid(!calculationError);

    // Call callbacks
    if (onError) {
      onError(calculationError);
    }
    
    if (onChange && !calculationError) {
      onChange(calculatedResult, formula);
    }
    
    if (onFormulaChange) {
      onFormulaChange(formula);
    }
  }, [formula, evaluateExpression, onChange, onFormulaChange, onError]);

  // Handle input change
  const handleFormulaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setFormula(newValue);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow Enter to blur the input (submit the calculation)
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Format result for display
  const formatResult = useMemo(() => {
    if (error && !allowEmpty) {
      return 'Error';
    }
    
    if (!formula.trim() && allowEmpty) {
      return '';
    }

    // Use native toFixed for consistent formatting
    return result.toFixed(decimalPlaces);
  }, [result, decimalPlaces, error, formula, allowEmpty]);

  // Container style with exact Ant Design Input heights
  const containerStyle: React.CSSProperties = {
    width: '100%',
    ...style,
  };

  return (
    <div style={containerStyle} className={className}>
      <Space.Compact 
        style={{ 
          width: '100%'
        }}
        size={size}
      >
        {showIcon && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            paddingRight: '4px',
            color: disabled ? '#d9d9d9' : '#8c8c8c'
          }}>
            <CalculatorOutlined />
          </div>
        )}
        
        <Input
          value={formula}
          onChange={handleFormulaChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          size={size}
          status={error ? 'error' : undefined}
          style={{ 
            flex: 1,
            minWidth: '120px'
          }}
          addonAfter={
            <Space 
              size="small" 
              style={{ 
                minWidth: '60px', 
                justifyContent: 'flex-end',
                alignItems: 'center',
                display: 'flex'
              }}
            >
              <Text 
                style={{ 
                  fontSize: size === 'small' ? '12px' : size === 'large' ? '16px' : '14px',
                  fontFamily: 'monospace',
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                =
              </Text>
              <Tooltip 
                title={error || (formula.trim() ? `Formula: ${formula}` : undefined)}
                placement="top"
              >
                <Text
                  style={{
                    color: error ? '#ff4d4f' : disabled ? '#d9d9d9' : '#262626',
                    fontFamily: 'monospace',
                    fontWeight: 500,
                    fontSize: size === 'small' ? '12px' : size === 'large' ? '16px' : '14px',
                    lineHeight: 1,
                    cursor: error ? 'help' : 'default',
                  }}
                >
                  {formatResult}
                  {unit && formatResult !== 'Error' && formatResult !== '' && (
                    <span style={{ 
                      marginLeft: '2px', 
                      fontSize: size === 'small' ? '10px' : size === 'large' ? '14px' : '12px', 
                      opacity: 0.8 
                    }}>
                      {unit}
                    </span>
                  )}
                </Text>
              </Tooltip>
              {error && (
                <ExclamationCircleOutlined 
                  style={{ 
                    color: '#ff4d4f',
                    fontSize: '12px',
                    cursor: 'help'
                  }}
                />
              )}
            </Space>
          }
        />
      </Space.Compact>
    </div>
  );
};

export default Calculator;

// Helper function for external validation
export const validateFormula = (formula: string): CalculatorResult => {
  if (!formula.trim()) {
    return {
      value: 0,
      formula,
      isValid: true,
      error: null
    };
  }

  try {
    const sanitized = formula.replace(/[^0-9+\-*/.() ]/g, '').trim();
    const validPattern = /^[0-9+\-*/.() ]+$/;
    
    if (!validPattern.test(sanitized)) {
      return {
        value: 0,
        formula,
        isValid: false,
        error: 'Invalid characters in formula'
      };
    }

    const openParens = (sanitized.match(/\(/g) || []).length;
    const closeParens = (sanitized.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return {
        value: 0,
        formula,
        isValid: false,
        error: 'Unbalanced parentheses'
      };
    }

    const result = evaluate(sanitized);
    
    if (typeof result === 'object' || !isFinite(result)) {
      return {
        value: 0,
        formula,
        isValid: false,
        error: 'Invalid calculation result'
      };
    }

    return {
      value: Number(result),
      formula,
      isValid: true,
      error: null
    };
  } catch (err) {
    return {
      value: 0,
      formula,
      isValid: false,
      error: err instanceof Error ? err.message : 'Invalid formula'
    };
  }
};