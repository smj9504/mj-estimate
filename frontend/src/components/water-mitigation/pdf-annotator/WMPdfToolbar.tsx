/**
 * WMPdfToolbar - Controls for PDF annotation
 * Tool selection, font size, page navigation, save
 */

import React from 'react';
import { Button, Select, Space, Tooltip, InputNumber, Divider, ColorPicker, Typography } from 'antd';
import {
  FontSizeOutlined,
  EditOutlined,
  DragOutlined,
  LeftOutlined,
  RightOutlined,
  SaveOutlined,
  BoldOutlined,
  ItalicOutlined,
  DeleteOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import type { AnnotatorState, AnnotationTool } from './types';
import { FONT_SIZE_OPTIONS } from './types';

const { Text } = Typography;

interface WMPdfToolbarProps {
  state: AnnotatorState;
  onToolChange: (tool: AnnotationTool) => void;
  onPageChange: (page: number) => void;
  onFontSizeChange: (size: number) => void;
  onFontColorChange: (color: string) => void;
  onBoldToggle: () => void;
  onItalicToggle: () => void;
  onDeleteSelected: () => void;
  onSave: () => void;
  onOpenSignaturePad: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  saving: boolean;
  hasSelection: boolean;
}

const WMPdfToolbar: React.FC<WMPdfToolbarProps> = ({
  state,
  onToolChange,
  onPageChange,
  onFontSizeChange,
  onFontColorChange,
  onBoldToggle,
  onItalicToggle,
  onDeleteSelected,
  onSave,
  onOpenSignaturePad,
  onZoomIn,
  onZoomOut,
  saving,
  hasSelection,
}) => {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: '#fafafa',
      borderBottom: '1px solid #e8e8e8',
      borderRadius: '8px 8px 0 0',
    }}>
      {/* Tool Selection */}
      <Space.Compact>
        <Tooltip title="Select / Move (V)">
          <Button
            type={state.tool === 'select' ? 'primary' : 'default'}
            icon={<DragOutlined />}
            onClick={() => onToolChange('select')}
          />
        </Tooltip>
        <Tooltip title="Add Text (T)">
          <Button
            type={state.tool === 'text' ? 'primary' : 'default'}
            icon={<FontSizeOutlined />}
            onClick={() => onToolChange('text')}
          />
        </Tooltip>
        <Tooltip title="Add Signature">
          <Button
            icon={<EditOutlined />}
            onClick={onOpenSignaturePad}
          />
        </Tooltip>
      </Space.Compact>

      <Divider type="vertical" style={{ height: 24 }} />

      {/* Font Controls */}
      <Space size={4}>
        <Select
          value={state.fontSize}
          onChange={onFontSizeChange}
          style={{ width: 70 }}
          size="small"
          options={FONT_SIZE_OPTIONS.map(s => ({ value: s, label: `${s}` }))}
        />
        <Tooltip title="Bold">
          <Button
            size="small"
            type={state.fontBold ? 'primary' : 'default'}
            icon={<BoldOutlined />}
            onClick={onBoldToggle}
          />
        </Tooltip>
        <Tooltip title="Italic">
          <Button
            size="small"
            type={state.fontItalic ? 'primary' : 'default'}
            icon={<ItalicOutlined />}
            onClick={onItalicToggle}
          />
        </Tooltip>
        <ColorPicker
          value={state.fontColor}
          onChange={(_, hex) => onFontColorChange(hex)}
          size="small"
          presets={[{
            label: 'Preset',
            colors: ['#000000', '#333333', '#FF0000', '#0000FF', '#008000', '#FF6600', '#800080'],
          }]}
        />
      </Space>

      <Divider type="vertical" style={{ height: 24 }} />

      {/* Zoom */}
      <Space size={4}>
        <Tooltip title="Zoom Out">
          <Button size="small" icon={<ZoomOutOutlined />} onClick={onZoomOut} disabled={state.scale <= 0.5} />
        </Tooltip>
        <Text style={{ fontSize: 12, minWidth: 36, textAlign: 'center' }}>
          {Math.round(state.scale * 100)}%
        </Text>
        <Tooltip title="Zoom In">
          <Button size="small" icon={<ZoomInOutlined />} onClick={onZoomIn} disabled={state.scale >= 3} />
        </Tooltip>
      </Space>

      <Divider type="vertical" style={{ height: 24 }} />

      {/* Page Navigation */}
      <Space size={4}>
        <Button
          size="small"
          icon={<LeftOutlined />}
          onClick={() => onPageChange(state.currentPage - 1)}
          disabled={state.currentPage <= 0}
        />
        <Text style={{ fontSize: 12, minWidth: 60, textAlign: 'center' }}>
          {state.currentPage + 1} / {state.totalPages}
        </Text>
        <Button
          size="small"
          icon={<RightOutlined />}
          onClick={() => onPageChange(state.currentPage + 1)}
          disabled={state.currentPage >= state.totalPages - 1}
        />
      </Space>

      {/* Right side actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {hasSelection && (
          <Tooltip title="Delete Selected">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={onDeleteSelected}
            />
          </Tooltip>
        )}
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={onSave}
          loading={saving}
        >
          Save
        </Button>
      </div>
    </div>
  );
};

export default WMPdfToolbar;
