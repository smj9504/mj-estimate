import React from 'react';
import { Radio } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined, BorderOutlined } from '@ant-design/icons';
import { ViewMode } from './types';

interface ViewModeSelectorProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({ value, onChange }) => {
  return (
    <Radio.Group
      value={value}
      onChange={(e) => onChange(e.target.value)}
      buttonStyle="solid"
      size="small"
    >
      <Radio.Button value="grid">
        <AppstoreOutlined /> Grid
      </Radio.Button>
      <Radio.Button value="list">
        <UnorderedListOutlined /> List
      </Radio.Button>
      <Radio.Button value="card">
        <BorderOutlined /> Card
      </Radio.Button>
    </Radio.Group>
  );
};

export default ViewModeSelector;