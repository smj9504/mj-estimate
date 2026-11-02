/**
 * Address lookup behind AddressAutocomplete.
 *
 * Google Places through our backend, which holds the key. When that can't answer
 * (key not set in this environment, Google or the backend down) the browser asks
 * OpenStreetMap directly, so the address boxes keep suggesting either way.
 */
import axios from 'axios';
import api from './api';

export interface ParsedAddress {
  fullAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
}

export interface AddressSuggestion {
  fullText: string;
  mainText: string;
  secondaryText: string;
  /** Google: the parts are fetched once this suggestion is picked */
  placeId?: string;
  /** OpenStreetMap: the parts come with the suggestion */
  parsed?: ParsedAddress;
}

export interface AddressSearchResult {
  source: 'google' | 'openstreetmap';
  suggestions: AddressSuggestion[];
}

// A slow lookup is as good as none here: fall back while the person is still typing
const LOOKUP_TIMEOUT_MS = 6000;

// Bundles a run of keystrokes and the pick that ends it into one billed Google lookup
export const newSessionToken = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

// US state abbreviation mapping
const STATE_ABBREV: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

const toStateCode = (state: string): string => {
  if (!state) return '';
  if (state.length === 2) return state.toUpperCase();
  return STATE_ABBREV[state] || state;
};

const formatFullAddress = (street: string, city: string, state: string, zip: string) =>
  [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

interface NominatimResult {
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    state?: string;
    postcode?: string;
    county?: string;
  };
}

const searchOpenStreetMap = async (query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> => {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    countrycodes: 'us',
    limit: '5',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'Accept-Language': 'en' },
    signal,
  });
  if (!res.ok) return [];

  const results: NominatimResult[] = await res.json();
  const seen = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  results.forEach(r => {
    const addr = r.address;
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const state = toStateCode(addr.state || '');
    const zip = addr.postcode || '';
    const fullAddress = formatFullAddress(street, city, state, zip) || r.display_name;
    if (seen.has(fullAddress)) return;
    seen.add(fullAddress);
    const mainText = street || r.display_name.split(',')[0];
    suggestions.push({
      fullText: fullAddress,
      mainText,
      secondaryText: [city, state, zip].filter(Boolean).join(', '),
      parsed: { fullAddress, streetAddress: mainText, city, state, zip, county: addr.county },
    });
  });
  return suggestions;
};

export const searchAddresses = async (
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<AddressSearchResult> => {
  try {
    const { data } = await api.get('/api/address/autocomplete', {
      params: { q: query, session_token: sessionToken },
      signal,
      timeout: LOOKUP_TIMEOUT_MS,
      suppressErrorNotification: true,
    });
    return {
      source: 'google',
      suggestions: data.suggestions.map((s: any) => ({
        fullText: s.full_text,
        mainText: s.main_text,
        secondaryText: s.secondary_text,
        placeId: s.place_id,
      })),
    };
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    return { source: 'openstreetmap', suggestions: await searchOpenStreetMap(query, signal) };
  }
};

// "Bethesda, MD, USA" -> the parts, for when Google can't give us the place details
const parseSuggestionText = (suggestion: AddressSuggestion): ParsedAddress => {
  const parts = suggestion.secondaryText.split(',').map(p => p.trim()).filter(p => p && p !== 'USA');
  const stateAndZip = (parts.pop() || '').split(/\s+/);
  const state = toStateCode(stateAndZip[0] || '');
  const zip = stateAndZip[1] || '';
  const city = parts.pop() || '';
  return {
    fullAddress: formatFullAddress(suggestion.mainText, city, state, zip),
    streetAddress: suggestion.mainText,
    city,
    state,
    zip,
  };
};

/** The street, city, state and zip of a picked suggestion. Never fails. */
export const resolveAddress = async (
  suggestion: AddressSuggestion,
  sessionToken: string,
): Promise<ParsedAddress> => {
  if (suggestion.parsed) return suggestion.parsed;
  try {
    const { data } = await api.get('/api/address/details', {
      params: { place_id: suggestion.placeId, session_token: sessionToken },
      timeout: LOOKUP_TIMEOUT_MS,
      suppressErrorNotification: true,
    });
    // Google doesn't list every house number: the suggestion keeps the number that
    // was typed, but the place it points at is only the street
    const street: string = data.street_address;
    const lostHouseNumber = /^\d/.test(suggestion.mainText) && !/^\d/.test(street);
    const streetAddress = lostHouseNumber || !street ? suggestion.mainText : street;
    return {
      fullAddress: formatFullAddress(streetAddress, data.city, data.state, data.zip),
      streetAddress,
      city: data.city,
      state: data.state,
      zip: data.zip,
      county: data.county ?? undefined,
    };
  } catch {
    return parseSuggestionText(suggestion);
  }
};
