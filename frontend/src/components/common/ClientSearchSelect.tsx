import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, Typography } from 'antd';
import type { SelectProps } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { clientService } from '../../services/clientService';
import type { ClientListItem } from '../../types/client';

const { Text } = Typography;

interface ClientSearchSelectProps
  extends Omit<SelectProps, 'value' | 'onChange' | 'options' | 'showSearch' | 'filterOption' | 'onSearch'> {
  value?: string | null;
  onChange?: (clientId: string | undefined, client: ClientListItem | null) => void;
  /** Name to show for a preset value, so it shows without looking the client up */
  selectedLabel?: string | null;
}

/**
 * Pick a client by typing the name, address, or phone.
 * Drop-in for a Form.Item whose field holds the client UUID.
 */
const ClientSearchSelect: React.FC<ClientSearchSelectProps> = ({
  value, onChange, selectedLabel, loading, ...rest
}) => {
  const [search, setSearch] = useState('');
  const term = search.trim();

  const { data: results, isFetching } = useQuery({
    queryKey: ['client-search', term],
    queryFn: () => clientService.search(term),
    enabled: term.length >= 2,
  });

  // Resolve a preset value so it shows a name, not a UUID
  const found = results?.clients.find(c => c.id === value);
  const { data: presetClient } = useQuery({
    queryKey: ['client', value],
    queryFn: () => clientService.getById(value!),
    enabled: !!value && !found && !selectedLabel,
    staleTime: Infinity,
  });

  const presetLabel = selectedLabel || (presetClient?.id === value ? presetClient?.display_name : undefined);
  const clients = results?.clients || [];
  const options = [
    ...(value && !found && presetLabel ? [{ value, label: presetLabel, client: null }] : []),
    ...clients.map(c => ({ value: c.id, label: c.display_name, client: c })),
  ];

  return (
    <Select
      showSearch
      allowClear
      placeholder="Search clients"
      {...rest}
      value={value || undefined}
      filterOption={false}
      onSearch={setSearch}
      onChange={(v?: string) => onChange?.(v, clients.find(c => c.id === v) || null)}
      loading={isFetching || loading}
      notFoundContent={
        term.length < 2 ? 'Type at least 2 characters...'
          : isFetching ? <LoadingOutlined /> : 'No clients found'
      }
      options={options}
      optionRender={opt => {
        const c = (opt.data as { client: ClientListItem | null }).client;
        if (!c) return opt.label;
        const address = [c.address, c.city].filter(Boolean).join(', ');
        return (
          <div style={{ lineHeight: 1.3, padding: '2px 0' }}>
            <div><Text strong>{c.display_name}</Text></div>
            {(address || c.phone) && (
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
                {[address, c.phone].filter(Boolean).join(' · ')}
              </Text>
            )}
          </div>
        );
      }}
    />
  );
};

export default ClientSearchSelect;
