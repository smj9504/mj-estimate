/**
 * Utility functions for formatting values
 */

/**
 * Format number with thousand separators and decimal places
 * @param num - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted number string
 */
export const formatNumber = (num: number | undefined | null, decimals: number = 2): string => {
  if (num === undefined || num === null) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

/**
 * Format currency with dollar sign and thousand separators
 * @param amount - The amount to format
 * @param showCurrency - Whether to show the currency symbol (default: true)
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number | undefined | null, showCurrency: boolean = true): string => {
  const formatted = formatNumber(amount);
  return showCurrency ? `$${formatted}` : formatted;
};

/**
 * Format percentage
 * @param value - The percentage value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export const formatPercentage = (value: number | undefined | null, decimals: number = 1): string => {
  if (value === undefined || value === null) return '0%';
  return `${value.toFixed(decimals)}%`;
};