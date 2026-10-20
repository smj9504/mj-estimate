import React, { useMemo } from 'react';
import { Select } from 'antd';
import { usePeople } from '../../hooks/useMessaging';
import { useAuth } from '../../contexts/AuthContext';

interface PeopleSelectProps {
  value?: string[];
  onChange?: (ids: string[]) => void;
  /** People who can't be picked, e.g. those already in the group */
  exclude?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}

/** Pick one or more colleagues (never yourself) */
const PeopleSelect: React.FC<PeopleSelectProps> = ({ value, onChange, exclude = [], placeholder, autoFocus }) => {
  const { user } = useAuth();
  const { data: people = [], isLoading } = usePeople();

  const options = useMemo(() => {
    const hidden = new Set([user?.id, ...exclude]);
    return people
      .filter((person) => !hidden.has(person.id))
      .map((person) => ({
        value: person.id,
        label: person.name,
        hint: person.job_title || person.role?.replace(/_/g, ' ') || '',
      }));
  }, [people, user?.id, exclude]);

  return (
    <Select
      mode="multiple"
      value={value}
      onChange={onChange}
      loading={isLoading}
      placeholder={placeholder ?? 'Search by name'}
      autoFocus={autoFocus}
      style={{ width: '100%' }}
      optionFilterProp="label"
      options={options}
      optionRender={(option) => (
        <span>
          {option.data.label}
          {option.data.hint && (
            <span style={{ color: 'var(--color-neutral-600)', marginLeft: 8, fontSize: 12 }}>
              {option.data.hint}
            </span>
          )}
        </span>
      )}
    />
  );
};

export default PeopleSelect;
