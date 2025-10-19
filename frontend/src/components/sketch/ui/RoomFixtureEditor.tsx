/**
 * Room Fixture Editor Component
 * Allows editing fixture label and color
 */

import React, { useState, useEffect, useRef } from 'react';
import { Input, Space, Typography, ColorPicker } from 'antd';
import { RoomFixture } from '../../../types/sketch';
import { Color } from 'antd/es/color-picker';

const { Text } = Typography;

interface RoomFixtureEditorProps {
  fixture: RoomFixture;
  onLabelChange: (label: string) => void;
  onColorChange: (fillColor: string, strokeColor: string) => void;
  onClose: () => void;
  position?: { x: number; y: number };
}

export const RoomFixtureEditor: React.FC<RoomFixtureEditorProps> = ({
  fixture,
  onLabelChange,
  onColorChange,
  onClose,
  position = { x: 0, y: 0 }
}) => {
  const [label, setLabel] = useState(fixture.label || '');
  const [fillColor, setFillColor] = useState(fixture.style.fillColor);
  const [strokeColor, setStrokeColor] = useState(fixture.style.strokeColor);
  const editorRef = useRef<HTMLDivElement>(null);

  // Update local state when fixture changes
  useEffect(() => {
    setLabel(fixture.label || '');
    setFillColor(fixture.style.fillColor);
    setStrokeColor(fixture.style.strokeColor);
  }, [fixture.id, fixture.label, fixture.style.fillColor, fixture.style.strokeColor]);

  // Close editor when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (editorRef.current && !editorRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    setLabel(newLabel);
    onLabelChange(newLabel);
  };

  const handleFillColorChange = (color: Color) => {
    const newFillColor = color.toHexString();
    setFillColor(newFillColor);
    onColorChange(newFillColor, strokeColor);
  };

  const handleStrokeColorChange = (color: Color) => {
    const newStrokeColor = color.toHexString();
    setStrokeColor(newStrokeColor);
    onColorChange(fillColor, newStrokeColor);
  };

  return (
    <div
      ref={editorRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        backgroundColor: 'white',
        padding: 12,
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        border: '1px solid #d9d9d9',
        zIndex: 1000,
        minWidth: 250
      }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {/* Label Input */}
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            Label
          </Text>
          <Input
            size="small"
            value={label}
            onChange={handleLabelChange}
            placeholder="Enter fixture label"
            maxLength={20}
          />
        </div>

        {/* Fill Color */}
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            Fill Color
          </Text>
          <ColorPicker
            value={fillColor}
            onChange={handleFillColorChange}
            showText
            size="small"
          />
        </div>

        {/* Stroke Color */}
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            Stroke Color
          </Text>
          <ColorPicker
            value={strokeColor}
            onChange={handleStrokeColorChange}
            showText
            size="small"
          />
        </div>
      </Space>
    </div>
  );
};
