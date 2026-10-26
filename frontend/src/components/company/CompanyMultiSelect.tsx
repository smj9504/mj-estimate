/**
 * Picks one or more companies from Company Management: the companies a staff
 * member belongs to, or the companies working a claim or cash job.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { companyService } from '../../services/companyService';

export const useCompanyOptions = () => useQuery({
  queryKey: ['companies', 'options'],
  queryFn: async () => {
    const companies = await companyService.getCompanies();
    return companies
      .filter(c => c.is_active !== false)
      .map(c => ({ id: String(c.id), name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  staleTime: 5 * 60 * 1000,
});

interface Props {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  'aria-label'?: string;
}

const CompanyMultiSelect: React.FC<Props> = ({
  value, onChange, placeholder = 'Choose companies', ...rest
}) => {
  const { data: companies = [], isLoading } = useCompanyOptions();
  return (
    <Select
      mode="multiple"
      allowClear
      showSearch
      loading={isLoading}
      value={value ?? []}
      onChange={(v) => onChange?.(v)}
      placeholder={placeholder}
      optionFilterProp="label"
      options={companies.map(c => ({ value: c.id, label: c.name }))}
      aria-label={rest['aria-label'] ?? 'Companies'}
    />
  );
};

export default CompanyMultiSelect;
