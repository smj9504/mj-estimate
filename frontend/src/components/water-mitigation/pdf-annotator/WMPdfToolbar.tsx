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
      gap: 6,
      padding: '6px 8px',
      background: '#fafafa',
      borderBottom: '1px solid #e8e8e8',
      borderRadius: '8px 8px 0 0',
    }}>
      {/* Row 1: Tools + Page Nav + Save */}
      <Space.Compact size="small">
        <Tooltip title="Select / Move (V)">
          <Button
            size="small"
            type={state.tool === 'select' ? 'primary' : 'default'}
            icon={<DragOutlined />}
            onClick={() => onToolChange('select')}
          />
        </Tooltip>
        <Tooltip title="Add Text (T)">
          <Button
            size="small"
            type={state.tool === 'text' ? 'primary' : 'default'}
            icon={<FontSizeOutlined />}
            onClick={() => onToolChange('text')}
          />
        </Tooltip>
        <Tooltip title="Add Signature">
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={onOpenSignaturePad}
          />
        </Tooltip>
      </Space.Compact>

      <Divider type="vertical" style={{ height: 20, margin: '0 2px' }} />

      {/* Font Controls */}
      <Space size={2}>
        <Select
          value={state.fontSize}
          onChange={onFontSizeChange}
          style={{ width: 60 }}
          size="small"
          options={FONT_SIZE_OPTIONS.map(s => ({ value: s, label: `${s}` }))}
        />
        <Button
          size="small"
          type={state.fontBold ? 'primary' : 'default'}
          icon={<BoldOutlined />}
          onClick={onBoldToggle}
        />
        <Button
          size="small"
          type={state.fontItalic ? 'primary' : 'default'}
          icon={<ItalicOutlined />}
          onClick={onItalicToggle}
        />
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

      <Divider type="vertical" style={{ height: 20, margin: '0 2px' }} />

      {/* Zoom */}
      <Space size={2}>
        <Button size="small" icon={<ZoomOutOutlined />} onClick={onZoomOut} disabled={state.scale <= 0.5} />
        <Text style={{ fontSize: 11, minWidth: 32, textAlign: 'center' }}>
          {Math.round(state.scale * 100)}%
        </Text>
        <Button size="small" icon={<ZoomInOutlined />} onClick={onZoomIn} disabled={state.scale >= 3} />
      </Space>

      <Divider type="vertical" style={{ height: 20, margin: '0 2px' }} />

      {/* Page Navigation */}
      <Space size={2}>
        <Button
          size="small"
          icon={<LeftOutlined />}
          onClick={() => onPageChange(state.currentPage - 1)}
          disabled={state.currentPage <= 0}
        />
        <Text style={{ fontSize: 11, minWidth: 40, textAlign: 'center' }}>
          {state.currentPage + 1}/{state.totalPages}
        </Text>
        <Button
          size="small"
          icon={<RightOutlined />}
          onClick={() => onPageChange(state.currentPage + 1)}
          disabled={state.currentPage >= state.totalPages - 1}
        />
      </Space>

      {/* Right side actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        {hasSelection && (
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={onDeleteSelected}
          />
        )}
        <Button
          type="primary"
          size="small"
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
