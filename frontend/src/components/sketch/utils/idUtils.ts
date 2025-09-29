/**
 * ID generation utilities for sketch elements
 */

/**
 * Generate a unique ID for sketch elements using native crypto API
 */
export const generateId = (): string => {
  // Use crypto.randomUUID() if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback to a manual UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Generate a short ID for display purposes
 */
export const generateShortId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};

/**
 * Validate if a string is a valid UUID
 */
export const isValidId = (id: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

/**
 * Generate prefixed ID for specific element types
 */
export const generateElementId = (type: 'wall' | 'room' | 'fixture' | 'measurement'): string => {
  return `${type}_${generateShortId()}`;
};