/**
 * WMTextRenderer
 * Renders a single text annotation on the Konva canvas.
 * Supports dragging, selection, and inline editing on double-click.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Group, Text, Rect } from 'react-konva';
import type Konva from 'konva';
import type { WMTextAnnotation } from '../../../../types/wmSketch';

export interface WMTextRendererProps {
  annotation: WMTextAnnotation;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onUpdate: (id: string, patch: Partial<WMTextAnnotation>) => void;
}

const WMTextRenderer: React.FC<WMTextRendererProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDragEnd,
  onUpdate,
}) => {
  const { id, x, y, text, font_size, color, bold } = annotation;
  const groupRef = useRef<Konva.Group>(null);
  const textRef = useRef<Konva.Text>(null);
  const [isEditing, setIsEditing] = useState(false);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      onSelect(id, e.evt.ctrlKey || e.evt.metaKey);
    },
    [id, onSelect]
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(id, e.target.x(), e.target.y());
    },
    [id, onDragEnd]
  );

  // Double-click to edit text inline
  const handleDblClick = useCallback(() => {
    const textNode = textRef.current;
    const stage = textNode?.getStage();
    if (!textNode || !stage) return;

    setIsEditing(true);

    const stageContainer = stage.container();
    const stageBox = stageContainer.getBoundingClientRect();
    const textPosition = textNode.getAbsolutePosition();
    const stageScale = stage.scaleX();

    const textarea = document.createElement('textarea');
    stageContainer.appendChild(textarea);

    textarea.value = text;
    textarea.style.position = 'absolute';
    textarea.style.top = `${stageBox.top + textPosition.y * stageScale + stage.y()}px`;
    textarea.style.left = `${stageBox.left + textPosition.x * stageScale + stage.x()}px`;
    textarea.style.width = `${Math.max(200, textNode.width() * stageScale)}px`;
    textarea.style.fontSize = `${font_size * stageScale}px`;
    textarea.style.fontWeight = bold ? '700' : '400';
    textarea.style.fontFamily = "'Inter', 'Segoe UI', sans-serif";
    textarea.style.color = color;
    textarea.style.border = '2px solid #1890ff';
    textarea.style.borderRadius = '4px';
    textarea.style.padding = '4px 6px';
    textarea.style.margin = '0';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'rgba(255,255,255,0.95)';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = '1.3';
    textarea.style.zIndex = '1000';
    textarea.style.transformOrigin = 'left top';

    textarea.focus();
    textarea.select();

    // Auto-resize height
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    autoResize();
    textarea.addEventListener('input', autoResize);

    const finishEditing = () => {
      const newText = textarea.value.trim();
      if (newText && newText !== text) {
        onUpdate(id, { text: newText });
      }
      textarea.removeEventListener('input', autoResize);
      textarea.remove();
      setIsEditing(false);
    };

    textarea.addEventListener('blur', finishEditing);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        textarea.removeEventListener('blur', finishEditing);
        textarea.remove();
        setIsEditing(false);
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        textarea.blur();
      }
    });
  }, [text, font_size, bold, color, id, onUpdate]);

  if (isEditing) {
    // Hide the Konva text while editing in DOM textarea
    return null;
  }

  return (
    <Group
      ref={groupRef}
      x={x}
      y={y}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
      onDblClick={handleDblClick}
      onDblTap={handleDblClick}
    >
      {/* Selection highlight */}
      {isSelected && (
        <Rect
          x={-4}
          y={-4}
          width={(textRef.current?.width() ?? 100) + 8}
          height={(textRef.current?.height() ?? font_size * 1.3) + 8}
          stroke="#1890ff"
          strokeWidth={1.5}
          dash={[4, 3]}
          cornerRadius={3}
          listening={false}
        />
      )}
      <Text
        ref={textRef}
        text={text}
        fontSize={font_size}
        fontFamily="'Inter', 'Segoe UI', sans-serif"
        fontStyle={bold ? 'bold' : 'normal'}
        fill={color}
        listening={true}
      />
    </Group>
  );
};

export default React.memo(WMTextRenderer);
