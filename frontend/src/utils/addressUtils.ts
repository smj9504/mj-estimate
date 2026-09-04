/**
 * US address parsing helpers.
 *
 * Mirrors backend/app/common/utils/address.py. Used when an address arrives as
 * a single combined string (legacy Client rows, free-form entry) but the form
 * shows street / city / state / zip as separate fields.
 */

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

const EMPTY: AddressParts = { street: '', city: '', state: '', zip: '' };

/**
 * Split a combined US address into components.
 *
 * "13042 Quartz Lane, Clifton VA 20124"
 *   -> { street: '13042 Quartz Lane', city: 'Clifton', state: 'VA', zip: '20124' }
 *
 * An address with no recognizable city/state/zip is returned as street only.
 */
export function parseUsAddress(fullAddress?: string | null): AddressParts {
  if (!fullAddress || !fullAddress.trim()) return { ...EMPTY };

  let address = fullAddress.trim();
  const result: AddressParts = { ...EMPTY };

  // Trailing ZIP (5 digits or ZIP+4)
  const zipMatch = address.match(/\b(\d{5}(?:-\d{4})?)\s*$/);
  if (zipMatch) {
    result.zip = zipMatch[1];
    address = address.slice(0, zipMatch.index).trim().replace(/,$/, '').trim();
  }

  // Trailing 2-letter state code
  const stateMatch = address.match(/\b([A-Z]{2})\s*$/);
  if (stateMatch && US_STATES.has(stateMatch[1])) {
    result.state = stateMatch[1];
    address = address.slice(0, stateMatch.index).trim().replace(/,$/, '').trim();
  }

  // Last comma-separated part is the city, the rest is the street
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    result.city = parts[parts.length - 1];
    result.street = parts.slice(0, -1).join(', ');
  } else if (parts.length === 1) {
    result.street = parts[0];
  }

  return result;
}

/**
 * Resolve address fields from a record that may store them split, combined, or
 * both. Explicit values win; the combined string only fills what is missing —
 * so a correct city on the record is never overwritten by a parse.
 */
export function resolveAddressParts(source: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}): AddressParts {
  const parsed = parseUsAddress(source.address);
  const pick = (explicit: string | null | undefined, fallback: string) =>
    explicit && explicit.trim() ? explicit.trim() : fallback;

  return {
    street: parsed.street || (source.address || '').trim(),
    city: pick(source.city, parsed.city),
    state: pick(source.state, parsed.state),
    zip: pick(source.zipcode, parsed.zip),
  };
}
