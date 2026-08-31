/**
 * CabinetShapeRenderer
 *
 * Renders a placed cabinet as a rectangle on the Konva canvas.
 * Supports drag, rotate (Shift = 15° snap), and resize via Transformer.
 *
 * Ported from water-mitigation/sketch/canvas/WMShapeRenderer.tsx, keeping
 * only the rectangle path — no ellipse/door/stairs branches, since cabinet
 * shapes are always rectangles.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import type { CabinetSketchCabinet } from '../../../types/cabinetSketch';

/** 15° snap angles for Shift+Rotate (0, 15, 30, …, 345) */
const ROTATION_SNAP_ANGLES = Array.from({ length: 24 }, (_, i) => i * 15);

/** Konva hit-target sizing — fixed desktop sizes (no touch-device variant needed here) */
const ANCHOR_SIZE = 8;
const ROTATE_ANCHOR_OFFSET = 20;

export interface CabinetShapeRendererProps {
  cabinet: CabinetSketchCabinet;
  isSelected: boolean;
  onSelect: (id: string, ctrlKey?: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTransformEnd?: (id: string, width: number, height: number, rotation: number) => void;
}

const CabinetShapeRenderer: React.FC<CabinetShapeRendererProps> = ({
  cabinet,
  isSelected,
  onSelect,
  onDragEnd,
  onTransformEnd,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const rectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const { width, height } = cabinet;

  // Reset Konva node transform state when dimensions change from props
  useEffect(() => {
    const node = rectRef.current;
    if (!node) return;
    node.scaleX(1);
    node.scaleY(1);
    node.x(0);
    node.y(0);
    node.rotation(0);
    node.width(width);
    node.height(height);
    node.getLayer()?.batchDraw();
  }, [width, height]);

  // Attach / detach transformer
  useEffect(() => {
    if (!transformerRef.current || !rectRef.current) return;
    if (isSelected) {
      transformerRef.current.nodes([rectRef.current]);
    } else {
      transformerRef.current.nodes([]);
    }
    transformerRef.current.getLayer()?.batchDraw();
  }, [isSelected]);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      onSelect(cabinet.id, e.evt.ctrlKey || e.evt.metaKey);
    },
    [cabinet.id, onSelect]
  );

  const handleDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      onDragEnd(cabinet.id, e.target.x(), e.target.y());
    },
    [cabinet.id, onDragEnd]
  );

  // Shift-key snap: toggle Konva's native rotationSnaps during transform.
  const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const tr = transformerRef.current;
    if (!tr) return;
    const shiftHeld = !!(e.evt as MouseEvent)?.shiftKey;
    const currentSnaps = tr.rotationSnaps();
    if (shiftHeld && (!currentSnaps || currentSnaps.length === 0)) {
      tr.rotationSnaps(ROTATION_SNAP_ANGLES);
    } else if (!shiftHeld && currentSnaps && currentSnaps.length > 0) {
      tr.rotationSnaps([]);
    }
  }, []);

  // Center-stable transform transfer: compute the shape's visual center
  // BEFORE reset, then reposition the group so the center stays fixed.
  const handleTransformEnd = useCallback(() => {
    if (!rectRef.current || !groupRef.current) return;
    if (transformerRef.current) transformerRef.current.rotationSnaps([]);

    const node = rectRef.current;
    const group = groupRef.current;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    const newWidth = Math.max(10, node.width() * scaleX);
    const newHeight = Math.max(10, node.height() * scaleY);

    const groupRot = group.rotation();
    const nodeRot = node.rotation();
    const nodeX = node.x();
    const nodeY = node.y();

    const localCX = (node.width() * scaleX) / 2;
    const localCY = (node.height() * scaleY) / 2;

    const nRad = (nodeRot * Math.PI) / 180;
    const centerInGroupX = nodeX + localCX * Math.cos(nRad) - localCY * Math.sin(nRad);
    const centerInGroupY = nodeY + localCX * Math.sin(nRad) + localCY * Math.cos(nRad);

    const gRad = (groupRot * Math.PI) / 180;
    const centerParentX = group.x() + centerInGroupX * Math.cos(gRad) - centerInGroupY * Math.sin(gRad);
    const centerParentY = group.y() + centerInGroupX * Math.sin(gRad) + centerInGroupY * Math.cos(gRad);

    const newRotation = groupRot + nodeRot;

    node.rotation(0);
    node.scaleX(1);
    node.scaleY(1);
    node.width(newWidth);
    node.height(newHeight);
    node.x(0);
    node.y(0);

    const newCX = newWidth / 2;
    const newCY = newHeight / 2;
    const newRad = (newRotation * Math.PI) / 180;
    group.x(centerParentX - (newCX * Math.cos(newRad) - newCY * Math.sin(newRad)));
    group.y(centerParentY - (newCX * Math.sin(newRad) + newCY * Math.cos(newRad)));
    group.rotation(newRotation);

    onDragEnd(cabinet.id, group.x(), group.y());
    onTransformEnd?.(cabinet.id, newWidth, newHeight, newRotation);
  }, [cabinet.id, onDragEnd, onTransformEnd]);

  const labelText = cabinet.label || cabinet.preset_code;
  const showLabel = labelText.length > 0 && width > 20 && height > 16;

  return (
    <>
      <Group
        ref={groupRef}
        x={cabinet.x}
        y={cabinet.y}
        rotation={cabinet.rotation}
        draggable
        onClick={handleClick}
        onTap={handleClick}
        onDragEnd={handleDragEnd}
      >
        <Rect
          ref={rectRef}
          width={width}
          height={height}
          fill="#D2B48C"
          opacity={0.85}
          stroke="#8B5E3C"
          strokeWidth={1.5}
          cornerRadius={2}
        />
        {isSelected && (
          <Rect
            width={width}
            height={height}
            fill="transparent"
            stroke="#1890ff"
            strokeWidth={2}
            dash={[6, 3]}
            listening={false}
          />
        )}
        {showLabel && (
          <Text
            x={2}
            y={height / 2 - 7}
            width={width - 4}
            text={labelText}
            fontSize={11}
            fontStyle="bold"
            fontFamily="'Inter', 'Segoe UI', sans-serif"
            fill="#5A3E28"
            align="center"
            listening={false}
            wrap="none"
            ellipsis
          />
        )}
      </Group>

      <Transformer
        ref={transformerRef}
        rotateEnabled
        rotateAnchorOffset={ROTATE_ANCHOR_OFFSET}
        borderStroke="#1890ff"
        borderDash={[3, 3]}
        anchorSize={ANCHOR_SIZE}
        anchorCornerRadius={2}
        anchorStroke="#1890ff"
        anchorFill="#ffffff"
        onTransform={handleTransform}
        onTransformEnd={handleTransformEnd}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 10 || newBox.height < 10) return oldBox;
          return newBox;
        }}
      />
    </>
  );
};

export default React.memo(CabinetShapeRenderer);
