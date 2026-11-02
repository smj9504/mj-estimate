/**
 * AddressAutocomplete Component
 * Every address box in the app uses this. Suggestions come from Google Places
 * through the backend, falling back to OpenStreetMap (see addressService).
 *
 * Usage:
 *   <AddressAutocomplete
 *     onSelect={(addr) => {
 *       form.setFieldsValue({ city: addr.city, state: addr.state, zipcode: addr.zip });
 *     }}
 *   />
 *
 * The box keeps the street only and onSelect moves the rest into its own fields.
 * With no city/state/zip fields next to it, pass fillFullAddress so picking a
 * suggestion keeps the whole address in the box.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AutoComplete, Input } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { InputProps } from 'antd';
import {
  newSessionToken,
  resolveAddress,
  searchAddresses,
} from '../../services/addressService';
import type {
  AddressSearchResult,
  AddressSuggestion,
  ParsedAddress,
} from '../../services/addressService';

export type { ParsedAddress };

interface AddressAutocompleteProps extends Omit<InputProps, 'onChange' | 'value' | 'onSelect'> {
  value?: string;
  onChange?: (value: string) => void;
  onSelect?: (address: ParsedAddress) => void;
  fillFullAddress?: boolean;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

// Not a real autocomplete token: Chrome ignores "off" on anything that looks like
// an address and would open its own saved-address list on top of our suggestions.
// AutoComplete hands it to the input, though antd's types leave it out.
const BROWSER_AUTOFILL_OFF = { autoComplete: 'address-lookup' };

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onSelect,
  fillFullAddress,
  placeholder = 'Enter street address',
  size,
  disabled,
  id,
  autoFocus,
  maxLength,
  ...restProps
}) => {
  const [result, setResult] = useState<AddressSearchResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();
  const sessionToken = useRef(newSessionToken());
  // Bumped by every keystroke and pick: an answer for anything older is dropped
  const latestRequest = useRef(0);

  // A pick finishes after the details call, by which time the form may have re-rendered
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    abortRef.current?.abort();
  }, []);

  const fetchSuggestions = useCallback(async (query: string, request: number) => {
    abortRef.current = new AbortController();
    setFetching(true);
    try {
      const found = await searchAddresses(query, sessionToken.current, abortRef.current.signal);
      if (request === latestRequest.current) setResult(found);
    } catch (err: any) {
      // Aborted because a newer keystroke took over, or nobody could answer.
      // The box still takes whatever is typed.
      if (request === latestRequest.current) setResult(null);
    } finally {
      if (request === latestRequest.current) setFetching(false);
    }
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      const request = ++latestRequest.current;
      onChangeRef.current?.(query);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
      setFetching(false);
      if (query.trim().length < MIN_QUERY_LENGTH) {
        setResult(null);
        return;
      }
      debounceTimer.current = setTimeout(() => fetchSuggestions(query, request), DEBOUNCE_MS);
    },
    [fetchSuggestions]
  );

  const handleSelect = useCallback(
    async (_value: string, option: any) => {
      const request = ++latestRequest.current;
      const suggestion: AddressSuggestion = option.data;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortRef.current?.abort();
      setFetching(false);
      setResult(null);

      // The option's own `value` is the whole address (needed so AutoComplete can
      // tell options apart), but the input should only ever show the street when
      // city/state/zip have their own fields. Show what's known right away.
      onChangeRef.current?.(fillFullAddress ? suggestion.fullText.replace(/, USA$/, '') : suggestion.mainText);

      const parsed = await resolveAddress(suggestion, sessionToken.current);
      sessionToken.current = newSessionToken();
      // They kept typing while the details came back: what they typed wins
      if (request !== latestRequest.current) return;

      onChangeRef.current?.(fillFullAddress ? parsed.fullAddress : parsed.streetAddress);
      onSelectRef.current?.(parsed);
    },
    [fillFullAddress]
  );

  const options = (result?.suggestions ?? []).map(suggestion => ({
    value: suggestion.fullText,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <EnvironmentOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {suggestion.mainText}
          </div>
          <div style={{ fontSize: 12, color: '#8c8c8c', whiteSpace: 'normal' }}>
            {suggestion.secondaryText}
          </div>
        </div>
      </div>
    ),
    data: suggestion,
  }));

  return (
    <AutoComplete
      id={id}
      value={value}
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      style={{ width: '100%' }}
      disabled={disabled}
      autoFocus={autoFocus}
      maxLength={maxLength}
      {...BROWSER_AUTOFILL_OFF}
      filterOption={false}
      notFoundContent={fetching ? 'Searching...' : null}
      popupRender={menu => (
        <>
          {menu}
          {result?.source === 'google' && options.length > 0 && (
            <div style={{ padding: '4px 12px', fontSize: 11, color: '#8c8c8c', textAlign: 'right' }}>
              Powered by Google
            </div>
          )}
        </>
      )}
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
