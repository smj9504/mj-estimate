/**
 * WMTextRenderer
 * Renders a single text annotation on the Konva canvas.
 *
 * Editing happens in a DOM textarea overlaid on the canvas. It opens on
 * double-click/double-tap, and also whenever the parent asks for it via
 * `editRequested` — the canvas is usually fitted to the viewport, which on a
 * phone renders a 16px label at about 4px, far too small to double-tap.
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
  /** When true, open the inline editor (used right after a text is placed). */
  editRequested?: boolean;
  /** Called once the requested edit has been opened, so it fires only once. */
  onEditOpened?: (id: string) => void;
}

/**
 * Anything smaller than this triggers a zoom-on-focus on iOS and is awkward
 * to type into, so the editor never renders below it regardless of stage zoom.
 */
const MIN_EDITOR_FONT_PX = 16;

/** Invisible padding (canvas units) that widens a label's tap target. */
const HIT_PADDING = 8;

const WMTextRenderer: React.FC<WMTextRendererProps> = ({
  annotation,
  isSelected,
  onSelect,
  onDragEnd,
  onUpdate,
  editRequested = false,
  onEditOpened,
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

  // Open the inline editor. Shared by double-click/tap and by `editRequested`.
  const openEditor = useCallback(() => {
    const textNode = textRef.current;
    const stage = textNode?.getStage();
    if (!textNode || !stage) return;

    setIsEditing(true);

    // The textarea is absolutely positioned inside the stage container, so its
    // offsets are container-relative. Konva leaves that container `static`, in
    // which case `absolute` would resolve against some ancestor further up and
    // the textarea would land a full container-offset away — off-screen once
    // the canvas area clips its overflow.
    const stageContainer = stage.container();
    if (getComputedStyle(stageContainer).position === 'static') {
      stageContainer.style.position = 'relative';
    }

    const stageScale = stage.scaleX();
    // Absolute position is in canvas units; convert to container pixels.
    const textPosition = textNode.getAbsolutePosition();

    const textarea = document.createElement('textarea');
    stageContainer.appendChild(textarea);

    const editorFontSize = Math.max(MIN_EDITOR_FONT_PX, font_size * stageScale);

    textarea.value = text;
    textarea.style.position = 'absolute';
    textarea.style.top = `${textPosition.y}px`;
    textarea.style.left = `${textPosition.x}px`;
    textarea.style.width = `${Math.max(200, textNode.width() * stageScale)}px`;
    // Never let the editor spill outside the visible canvas area
    textarea.style.maxWidth = `calc(100% - ${Math.max(0, textPosition.x)}px)`;
    textarea.style.fontSize = `${editorFontSize}px`;
    textarea.style.fontWeight = bold ? '700' : '400';
    textarea.style.fontFamily = "'Inter', 'Segoe UI', sans-serif";
    textarea.style.color = color;
    textarea.style.border = '2px solid #1890ff';
    textarea.style.borderRadius = '4px';
    textarea.style.padding = '4px 6px';
    textarea.style.margin = '0';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'rgba(255,255,255,0.98)';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = '1.3';
    textarea.style.zIndex = '1000';
    textarea.style.transformOrigin = 'left top';
    // The canvas suppresses touch handling; the editor must accept it again
    textarea.style.touchAction = 'auto';
    textarea.setAttribute('data-testid', 'wm-sketch-text-editor');

    textarea.focus();
    textarea.select();

    // Auto-resize height
    const autoResize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    autoResize();
    textarea.addEventListener('input', autoResize);

    let finished = false;
    const cleanup = () => {
      textarea.removeEventListener('input', autoResize);
      textarea.remove();
      setIsEditing(false);
    };

    const finishEditing = () => {
      if (finished) return;
      finished = true;
      const newText = textarea.value.trim();
      if (newText && newText !== text) {
        onUpdate(id, { text: newText });
      }
      cleanup();
    };

    textarea.addEventListener('blur', finishEditing);
    textarea.addEventListener('keydown', (e) => {
      // Typing must not reach the canvas shortcuts (V/H/T/W/R, Delete, ...)
      e.stopPropagation();
      if (e.key === 'Escape') {
        finished = true;
        cleanup();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishEditing();
      }
    });
  }, [text, font_size, bold, color, id, onUpdate]);

  // Parent-requested edit — e.g. immediately after the text is placed, or from
  // the element menu, neither of which can rely on hitting a tiny hit target.
  useEffect(() => {
    if (!editRequested || isEditing) return;
    onEditOpened?.(id);
    openEditor();
  }, [editRequested, isEditing, openEditor, onEditOpened, id]);

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
      onDblClick={openEditor}
      onDblTap={openEditor}
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
      {/*
        Invisible padded hit area. A label's glyphs are a thin target even at
        full zoom, and Konva only hits the drawn text itself, so tapping or
        dragging a label is otherwise a game of chance.
      */}
      <Rect
        x={-HIT_PADDING}
        y={-HIT_PADDING}
        width={(textRef.current?.width() ?? font_size * 2.5) + HIT_PADDING * 2}
        height={(textRef.current?.height() ?? font_size * 1.3) + HIT_PADDING * 2}
        fill="transparent"
      />
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
