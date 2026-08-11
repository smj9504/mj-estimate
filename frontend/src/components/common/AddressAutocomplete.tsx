/**
 * AddressAutocomplete Component
 * Reusable address autocomplete using Nominatim (OpenStreetMap) - completely free, no API key.
 *
 * Usage:
 *   <AddressAutocomplete
 *     onSelect={(addr) => {
 *       form.setFieldsValue({ city: addr.city, state: addr.state, zipcode: addr.zip });
 *     }}
 *   />
 */
import React, { useCallback, useRef, useState } from 'react';
import { AutoComplete, Input } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { InputProps } from 'antd';

export interface ParsedAddress {
  fullAddress: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
}

interface AddressAutocompleteProps extends Omit<InputProps, 'onChange' | 'value' | 'onSelect'> {
  value?: string;
  onChange?: (value: string) => void;
  onSelect?: (address: ParsedAddress) => void;
}

const DEBOUNCE_MS = 400;

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

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter street address',
  size,
  disabled,
  ...restProps
}) => {
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode; data: ParsedAddress }[]>([]);
  const [fetching, setFetching] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();
  const justSelected = useRef(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setOptions([]);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setFetching(true);
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        countrycodes: 'us',
        limit: '5',
      });

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        {
          headers: { 'Accept-Language': 'en' },
          signal: abortRef.current.signal,
        }
      );

      if (!res.ok) {
        setOptions([]);
        return;
      }

      const results: NominatimResult[] = await res.json();

      setOptions(
        results.map((r, idx) => {
          const addr = r.address;
          const streetAddr = [addr.house_number, addr.road].filter(Boolean).join(' ');
          const city = addr.city || addr.town || addr.village || addr.hamlet || '';
          const stateCode = toStateCode(addr.state || '');
          const parsed: ParsedAddress = {
            fullAddress: r.display_name,
            streetAddress: streetAddr,
            city,
            state: stateCode,
            zip: addr.postcode || '',
            county: addr.county,
          };
          return {
            key: `addr-${idx}`,
            value: [streetAddr, city, stateCode, parsed.zip].filter(Boolean).join(', '),
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <EnvironmentOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {streetAddr || r.display_name.split(',')[0]}
                  </div>
                  <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                    {[city, stateCode, parsed.zip].filter(Boolean).join(', ')}
                  </div>
                </div>
              </div>
            ),
            data: parsed,
          };
        })
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setOptions([]);
      }
    } finally {
      setFetching(false);
    }
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      if (justSelected.current) {
        justSelected.current = false;
        return;
      }
      onChange?.(query);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    },
    [fetchSuggestions, onChange]
  );

  const handleSelect = useCallback(
    (val: string, option: any) => {
      justSelected.current = true;
      const parsed: ParsedAddress = option.data;
      // The option's own `value` is "street, city, state, zip" (needed so
      // AutoComplete can match/highlight it) — but the input itself should
      // only ever show the street portion; city/state/zip go to their own
      // fields via onSelect below.
      onChange?.(parsed.streetAddress);
      onSelect?.(parsed);
      setOptions([]);
    },
    [onChange, onSelect]
  );

  return (
    <AutoComplete
      value={value}
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      style={{ width: '100%' }}
      notFoundContent={fetching ? 'Searching...' : null}
    >
      <Input
        placeholder={placeholder}
        size={size}
        disabled={disabled}
        suffix={<EnvironmentOutlined style={{ color: '#bfbfbf' }} />}
        {...restProps}
      />
    </AutoComplete>
  );
};

export default AddressAutocomplete;
