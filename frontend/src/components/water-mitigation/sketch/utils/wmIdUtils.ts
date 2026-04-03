/**
 * Water Mitigation Sketch ID Utilities
 *
 * Lightweight, prefix-aware ID generation for overlay elements.
 * Uses `crypto.randomUUID()` when available (modern browsers / Node 15+),
 * and falls back to a timestamp + random string for older environments.
 */

/**
 * Generate a unique ID, optionally prefixed for readability.
 *
 * @param prefix - Optional string prepended before the generated UUID,
 *                 separated by an underscore. e.g. "demo", "equip", "contain"
 *
 * @example
 *   generateWMId()          // "f47ac10b-58cc-4372-a567-0e02b2c3d479"
 *   generateWMId('demo')    // "demo_f47ac10b-58cc-4372-a567-0e02b2c3d479"
 *   generateWMId('equip')   // "equip_1713892345678-x7k2p9q"
 */
export function generateWMId(prefix?: string): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  return prefix ? `${prefix}_${id}` : id;
}
