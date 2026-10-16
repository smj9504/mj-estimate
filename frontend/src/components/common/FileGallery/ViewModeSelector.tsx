import React from 'react';
import { Segmented } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined } from '@ant-design/icons';
import { ViewMode } from './types';

interface ViewModeSelectorProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({ value, onChange }) => {
  return (
    <Segmented
      size="small"
      value={value}
      onChange={(v) => onChange(v as ViewMode)}
      options={[
        { value: 'grid', label: 'Grid', icon: <AppstoreOutlined /> },
        { value: 'list', label: 'List', icon: <UnorderedListOutlined /> },
        { value: 'card', label: 'Card', icon: <BorderOutlined /> },
      ]}
    />
  );
};

export default ViewModeSelector;