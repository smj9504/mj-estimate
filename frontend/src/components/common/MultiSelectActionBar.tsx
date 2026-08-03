import React, { useMemo, useState } from 'react';
import { Button, Space, Tag, Modal } from 'antd';
import {
  SwapOutlined,
  CopyOutlined,
  DeleteOutlined,
  CloseOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { zIndex as zIndexScale } from '../../styles/tokens';

export interface SectionInfo {
  id: string;
  title: string;
  index: number;
}

interface MultiSelectActionBarProps {
  /** Map of sectionIndex -> selected item keys */
  selectedItemKeys: { [sectionIndex: number]: string[] };
  /** All sections available */
  sections: SectionInfo[];
  /** Called when user wants to move items to a target section */
  onMoveToSection: (targetSectionIndex: number) => void;
  /** Called when user wants to copy items to a target section */
  onCopyToSection: (targetSectionIndex: number) => void;
  /** Called when user wants to delete all selected items */
  onDeleteSelected: () => void;
  /** Called when user wants to clear selection */
  onClearSelection: () => void;
}

const MultiSelectActionBar: React.FC<MultiSelectActionBarProps> = ({
  selectedItemKeys,
  sections,
  onMoveToSection,
  onCopyToSection,
  onDeleteSelected,
  onClearSelection,
}) => {
  const [sectionPickerVisible, setSectionPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'move' | 'copy'>('move');

  const totalSelected = useMemo(() => {
    return Object.values(selectedItemKeys).reduce(
      (sum, keys) => sum + (keys?.length || 0),
      0
    );
  }, [selectedItemKeys]);

  // Sections that have selected items
  const sourceSectionIndices = useMemo(() => {
    return Object.entries(selectedItemKeys)
      .filter(([, keys]) => keys && keys.length > 0)
      .map(([idx]) => parseInt(idx));
  }, [selectedItemKeys]);

  const handleOpenPicker = (mode: 'move' | 'copy') => {
    setPickerMode(mode);
    setSectionPickerVisible(true);
  };

  const handleSectionSelect = (sectionIndex: number) => {
    setSectionPickerVisible(false);
    if (pickerMode === 'move') {
      onMoveToSection(sectionIndex);
    } else {
      onCopyToSection(sectionIndex);
    }
  };

  if (totalSelected === 0) return null;

  return (
    <>
      <div
        className="multi-select-action-bar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: zIndexScale.actionBar,
          backgroundColor: '#fff',
          borderTop: '2px solid #1890ff',
          boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.15)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {/* Left: Selection info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <Tag color="blue" style={{ margin: 0, fontSize: '14px', padding: '4px 12px' }}>
            {totalSelected} item{totalSelected > 1 ? 's' : ''} selected
          </Tag>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onClearSelection}
            style={{ color: '#8c8c8c' }}
          />
        </div>

        {/* Right: Actions */}
        <Space size={8} wrap>
          <Button
            icon={<SwapOutlined />}
            size="middle"
            onClick={() => handleOpenPicker('move')}
          >
            <span className="action-bar-btn-text">Move to</span>
          </Button>

          <Button
            icon={<CopyOutlined />}
            size="middle"
            onClick={() => handleOpenPicker('copy')}
          >
            <span className="action-bar-btn-text">Copy to</span>
          </Button>

          <Button
            danger
            icon={<DeleteOutlined />}
            size="middle"
            onClick={onDeleteSelected}
          >
            <span className="action-bar-btn-text">Delete</span>
          </Button>
        </Space>
      </div>

      {/* Section Picker Modal */}
      <Modal
        title={pickerMode === 'move' ? 'Move to Section' : 'Copy to Section'}
        open={sectionPickerVisible}
        onCancel={() => setSectionPickerVisible(false)}
        footer={null}
        width={400}
        className="section-picker-modal"
      >
        <div>
          {sections.map((section) => {
            const isSameSection = pickerMode === 'move' &&
              sourceSectionIndices.length === 1 &&
              sourceSectionIndices[0] === section.index;
            return (
              <div
                key={section.id}
                className="section-picker-item"
                role="button"
                tabIndex={0}
                style={{
                  cursor: isSameSection ? 'not-allowed' : 'pointer',
                  opacity: isSameSection ? 0.4 : 1,
                  padding: '12px 16px',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onClick={() => { if (!isSameSection) handleSectionSelect(section.index); }}
              >
                <span style={{ fontWeight: 500 }}>{section.title}</span>
                {!isSameSection && <RightOutlined style={{ color: '#8c8c8c' }} />}
                {isSameSection && <span style={{ color: '#8c8c8c', fontSize: 12 }}>Current</span>}
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
};

export default MultiSelectActionBar;
