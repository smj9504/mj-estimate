/**
 * Who a new todo is for: the person adding it to start with, and whoever else
 * they pick. It is one todo, on each of their boards.
 */

import React from 'react';
import { Select } from 'antd';
import type { SelectProps } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { usePeople } from '../../hooks/useMessaging';
import { assigneeOptions } from './todoPeople';

interface AssigneeSelectProps extends Omit<SelectProps<string[]>, 'value' | 'onChange' | 'options' | 'mode'> {
  value: string[];
  onChange: (ids: string[]) => void;
}

const AssigneeSelect: React.FC<AssigneeSelectProps> = ({ value, onChange, ...rest }) => {
  const { user } = useAuth();
  const people = usePeople();
  const options = assigneeOptions(people.data ?? [], user?.id, value);

  return (
    <Select
      mode="multiple"
      prefix={<TeamOutlined />}
      placeholder="Pick who it's for"
      aria-label="Who it's for"
      maxTagCount="responsive"
      optionFilterProp="label"
      loading={people.isLoading}
      notFoundContent={people.isError ? "Couldn't load people" : undefined}
      {...rest}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
};

export default AssigneeSelect;
