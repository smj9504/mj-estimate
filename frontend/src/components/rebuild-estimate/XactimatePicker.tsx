/**
 * Finds a repair in the Xactimate price list (the latest month loaded) by
 * its words or its code. Prices shown are ours: the list's +10%.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import rebuildEstimateService from '../../services/rebuildEstimateService';
import type { XactimateMatch } from '../../types/rebuildEstimate';
import { money } from './lineEdit';

interface Props {
  onPick: (match: XactimateMatch) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

const XactimatePicker: React.FC<Props> = ({ onPick, placeholder, style }) => {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ['rebuild-xactimate-search', query],
    queryFn: () => rebuildEstimateService.searchXactimate(query),
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
  const options = useMemo(() => matches.map((m) => {
    const own = m.activities[0];
    const price = own ? `${money(own.marked_up ?? own.price)}/${m.unit}` : '';
    return { value: m.code, label: `${m.code} · ${m.description} ${price ? `· ${price}` : ''}`.trim() };
  }), [matches]);

  return (
    <Select
      showSearch
      size="small"
      value={null}
      filterOption={false}
      placeholder={placeholder ?? 'Add from Xactimate: drywall, paint, insulation…'}
      notFoundContent={isFetching ? <Spin size="small" /> : query.length >= 2 ? 'Nothing found' : 'Type two letters or more'}
      onSearch={setTyped}
      options={options}
      style={{ width: 380, maxWidth: '100%', ...style }}
      aria-label="Add from Xactimate"
      onChange={(code: string) => {
        const match = matches.find((m) => m.code === code);
        if (match) onPick(match);
        setTyped('');
      }}
    />
  );
};

export default XactimatePicker;
