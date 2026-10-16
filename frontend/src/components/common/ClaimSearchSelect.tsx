import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Typography } from 'antd';
import type { SelectProps } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { claimService, type ClaimSearchResult } from '../../services/clientService';

const { Text } = Typography;

interface ClaimSearchSelectProps
  extends Omit<SelectProps, 'value' | 'onChange' | 'options' | 'showSearch' | 'filterOption' | 'onSearch'> {
  value?: string;
  onChange?: (claimId: string | undefined, claim: ClaimSearchResult | null) => void;
}

/**
 * Pick a claim by typing the homeowner's name, property address, or claim #.
 * Drop-in for a Form.Item whose field holds the claim UUID.
 */
const ClaimSearchSelect: React.FC<ClaimSearchSelectProps> = ({ value, onChange, loading, ...rest }) => {
  const [search, setSearch] = useState('');
  const term = search.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ['claim-search', term],
    queryFn: () => claimService.search(term),
    enabled: term.length >= 2,
  });

  // Resolve a preset value (e.g. set via form.setFieldsValue) so it shows a label, not a UUID
  const found = results?.claims.find(c => c.id === value);
  const { data: presetClaim } = useQuery({
    queryKey: ['claim-lookup', value],
    queryFn: () => claimService.lookup(value!),
    enabled: !!value && !found,
    staleTime: Infinity,
  });

  const claims = [
    ...(presetClaim && presetClaim.id === value && !found ? [presetClaim] : []),
    ...(results?.claims || []),
  ];

  return (
    <Select
      showSearch
      allowClear
      placeholder="Search by name, address, or claim #"
      {...rest}
      value={value}
      filterOption={false}
      onSearch={setSearch}
      onChange={(v?: string) => onChange?.(v, claims.find(c => c.id === v) || null)}
      loading={isFetching || loading}
      notFoundContent={
        term.length < 2 ? 'Type at least 2 characters...'
          : isFetching ? <LoadingOutlined /> : 'No claims found'
      }
      optionLabelProp="label"
      options={claims.map(c => ({
        value: c.id,
        label: `${c.client_name} — ${c.claim_number}`,
        claim: c,
      }))}
      optionRender={opt => {
        const c = (opt.data as { claim: ClaimSearchResult }).claim;
        return (
          <div style={{ lineHeight: 1.3, padding: '2px 0' }}>
            <div>
              <Text strong>{c.client_name}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>#{c.claim_number}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
              {c.address || 'No address'}
              {c.insurance_company ? ` · ${c.insurance_company}` : ''}
            </Text>
          </div>
        );
      }}
    />
  );
};

export default ClaimSearchSelect;
