/**
 * Picks the company that writes the rebuild estimate when the carrier asks the
 * contractor for one. Companies that did the claim's water mitigation are
 * listed but disabled: the rebuild estimate has to come from another company.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { companyService } from '../../services/companyService';

// Company types that can write a rebuild estimate
const WRITER_TYPES = ['contractor', 'roofing', 'water_mitigation', 'other'];

interface Props {
  value?: string | null;
  onChange?: (value: string | undefined) => void;
  /** Companies that did this claim's WM */
  wmCompanyIds?: string[];
  placeholder?: string;
}

const RebuildEstimateCompanySelect: React.FC<Props> = ({
  value, onChange, wmCompanyIds = [], placeholder = 'Company that writes the estimate',
}) => {
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['rebuild-estimate-writer-companies'],
    queryFn: async () => {
      const lists = await Promise.all(WRITER_TYPES.map(t => companyService.listCompaniesByType(t)));
      const byId = new Map<string, { id: string; name: string }>();
      lists.flat().forEach(c => byId.set(String(c.id), c));
      return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 5 * 60 * 1000,
  });

  const wm = new Set(wmCompanyIds.map(String));
  // WM companies sink to the bottom so the valid choices come first
  const options = [...companies]
    .sort((a, b) => Number(wm.has(a.id)) - Number(wm.has(b.id)))
    .map(c => ({
      value: c.id,
      label: wm.has(c.id) ? `${c.name} (did the WM)` : c.name,
      disabled: wm.has(c.id),
    }));

  return (
    <Select
      showSearch
      allowClear
      loading={isLoading}
      value={value || undefined}
      onChange={(v) => onChange?.(v)}
      placeholder={placeholder}
      optionFilterProp="label"
      options={options}
      aria-label="Rebuild estimate written by"
    />
  );
};

export default RebuildEstimateCompanySelect;
