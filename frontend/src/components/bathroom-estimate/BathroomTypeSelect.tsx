/**
 * A bathroom's type: a listed one (Master, Hall, Powder, Three Quarter,
 * Jack & Jill) or a name typed in ("Basement bath"), kept as typed. Works as
 * a Form.Item's control (value / onChange). See types/bathroomEstimate
 * bathroomName and backend job_share.bathroom_name.
 */

import React, { useState } from 'react';
import { Select } from 'antd';
import { BATH_NAMES } from '../../types/bathroomEstimate';

/** The listed types, by their short labels */
const LISTED = Object.keys(BATH_NAMES).map((value) => ({
  value,
  label: value === 'jack_jill' ? 'Jack & Jill' : value.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
}));

/** The column holds 50 characters */
const MAX_NAME = 50;

interface BathroomTypeSelectProps {
  value?: string | null;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  'aria-label'?: string;
  style?: React.CSSProperties;
}

const BathroomTypeSelect: React.FC<BathroomTypeSelectProps> = ({ value, onChange, placeholder, style, ...rest }) => {
  const [search, setSearch] = useState('');
  const typed = search.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const isListed = (text: string) => LISTED.some((o) => o.value === text || o.label.toLowerCase() === text.toLowerCase());
  const options = [
    ...LISTED,
    // A name typed in before: shown as it is
    ...(value && !LISTED.some((o) => o.value === value) ? [{ value, label: value }] : []),
    // What's being typed, as a name of its own
    ...(typed && !isListed(typed) && typed !== value ? [{ value: typed, label: `Use “${typed}”` }] : []),
  ];
  return (
    <Select
      {...rest}
      showSearch
      allowClear
      style={style}
      value={value || undefined}
      placeholder={placeholder ?? 'Pick a type or type a name'}
      searchValue={search}
      onSearch={setSearch}
      onChange={(v?: string) => {
        setSearch('');
        onChange?.(v || undefined);
      }}
      filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase())
        || option?.value === typed}
      notFoundContent={null}
      options={options}
    />
  );
};

export default BathroomTypeSelect;
