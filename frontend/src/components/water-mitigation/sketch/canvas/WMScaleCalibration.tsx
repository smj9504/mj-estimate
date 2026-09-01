/**
 * WMScaleCalibration
 *
 * Overlay component that lets the user draw a reference line on the background
 * image and enter its real-world length in feet. From that, we compute
 * `scale_pixels_per_foot` so all subsequent drawings are dimensionally accurate.
 *
 * The Stage is self-sized via ResizeObserver to match the actual visible canvas
 * area (excluding instruction bar and bottom panel). This ensures the background
 * image is as large as possible for precise calibration, regardless of monitor
 * size.
 *
 * Flow:
 *   1. User clicks two points on the image (or click-drags) to define a line.
 *   2. The pixel distance is displayed; user enters the real-world length.
 *   3. On "Apply", the parent receives the computed scale value.
 *
 * Usage:
 *   <WMScaleCalibration
 *     imageUrl={backgroundImageUrl}
 *     logicalCanvasWidth={canvasWidth}
 *     logicalCanvasHeight={canvasHeight}
 *     currentScale={floorSketch.scale_pixels_per_foot}
 *     onCalibrated={(newScale) => handleScaleChange(newScale)}
 *     onCancel={() => setCalibrating(false)}
 *   />
 */

import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Stage, Layer, Line, Circle, Text as KonvaText, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import { Button, InputNumber, Space, Typography, Alert, theme } from 'antd';
import {
  AimOutlined,
  CheckOutlined,
  CloseOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  DragOutlined,
} from '@ant-design/icons';
import { useIsCoarsePointer } from '../hooks/useWMResponsive';

const { Text } = Typography;

/** Zoom limits shared by wheel, pinch, and the on-screen zoom buttons. */
const MIN_STAGE_SCALE = 0.5;
const MAX_STAGE_SCALE = 10;

type WMPointerEvent = MouseEvent | TouchEvent;

function isTouchEvt(evt: WMPointerEvent): evt is TouchEvent {
  return 'touches' in evt;
}

function getClientPoint(evt: WMPointerEvent): { x: number; y: number } | null {
  if (isTouchEvt(evt)) {
    const t = evt.touches[0] ?? evt.changedTouches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  return { x: evt.clientX, y: evt.clientY };
}

/** Distance and midpoint between the first two touch points. */
function getPinchGeometry(evt: TouchEvent) {
  const [a, b] = [evt.touches[0], evt.touches[1]];
  if (!a || !b) return null;
  return {
    dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
    center: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
  };
}

// ============================================================================
// Types
// ============================================================================

export interface WMScaleCalibrationProps {
  imageUrl: string;
  /**
   * @deprecated Use logicalCanvasWidth/logicalCanvasHeight instead.
   * Stage now self-sizes via ResizeObserver.
   */
  canvasWidth?: number;
  /**
   * @deprecated Use logicalCanvasWidth/logicalCanvasHeight instead.
   * Stage now self-sizes via ResizeObserver.
   */
  canvasHeight?: number;
  /** Logical canvas dimensions where overlay elements are drawn (fixed coordinate system) */
  logicalCanvasWidth: number;
  logicalCanvasHeight: number;
  currentScale: number;
  onCalibrated: (scalePixelsPerFoot: number) => void;
  onCancel: () => void;
}

interface Point {
  x: number;
  y: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Compute contain-fit dimensions and centered position */
function fitContain(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; width: number; height: number; scale: number } {
  const scaleX = canvasW / imgW;
  const scaleY = canvasH / imgH;
  const scale = Math.min(scaleX, scaleY);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: (canvasW - width) / 2,
    y: (canvasH - height) / 2,
    width,
    height,
    scale,
  };
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ============================================================================
// Component
// ============================================================================

const WMScaleCalibration: React.FC<WMScaleCalibrationProps> = ({
  imageUrl,
  logicalCanvasWidth,
  logicalCanvasHeight,
  currentScale,
  onCalibrated,
  onCancel,
}) => {
  const { token } = theme.useToken();
  // Instructions should name the gesture the user actually has
  const tapWord = useIsCoarsePointer() ? 'Tap' : 'Click';

  // ------------------------------------------------------------------
  // Self-sizing: measure the actual visible canvas area
  // ------------------------------------------------------------------
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  useLayoutEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setStageSize({
        width: Math.max(300, Math.floor(rect.width)),
        height: Math.max(200, Math.floor(rect.height)),
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure(); // initial
    return () => observer.disconnect();
  }, []);

  const canvasWidth = stageSize.width;
  const canvasHeight = stageSize.height;

  // Image loading
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageFit, setImageFit] = useState<ReturnType<typeof fitContain> | null>(null);

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const fit = fitContain(img.naturalWidth, img.naturalHeight, canvasWidth, canvasHeight);
      setLoadedImage(img);
      setImageFit(fit);
    };
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, canvasWidth, canvasHeight]);

  // Reference line state
  const [pointA, setPointA] = useState<Point | null>(null);
  const [pointB, setPointB] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [realFeet, setRealFeet] = useState<number | null>(null);

  const stageRef = useRef<any>(null);

  const pixelDist = pointA && pointB ? distance(pointA, pointB) : 0;

  // Compute scale in viewport pixels, then convert to logical canvas pixels.
  // The calibration stage renders the image fitted to viewport dimensions,
  // but elements are placed in the logical canvas coordinate system where
  // the same image is fitted to (logicalCanvasWidth × logicalCanvasHeight).
  const viewportScale = realFeet && realFeet > 0 && pixelDist > 0
    ? pixelDist / realFeet
    : null;

  // Ratio to convert viewport pixels → logical canvas pixels
  const logicalToViewportRatio = (loadedImage && imageFit)
    ? imageFit.scale / fitContain(
        loadedImage.naturalWidth,
        loadedImage.naturalHeight,
        logicalCanvasWidth,
        logicalCanvasHeight,
      ).scale
    : 1;

  const computedScale = viewportScale
    ? viewportScale / logicalToViewportRatio
    : null;

  // ------------------------------------------------------------------
  // Zoom / pan — the image is often too small to read the measurement
  // numbers printed on it (e.g. a sketch photo), so calibration needs the
  // same zoom/pan the main sketch editor has, not just a fixed contain-fit.
  // ------------------------------------------------------------------
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;
  const stagePosRef = useRef(stagePos);
  stagePosRef.current = stagePos;

  const containerRef = canvasAreaRef;
  const [panMode, setPanMode] = useState(false);
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);
  const gestureConsumedRef = useRef(false);

  /** Rescale the stage while keeping the point under `anchor` pinned in place. */
  const zoomAroundPoint = useCallback(
    (nextScale: number, anchor: { x: number; y: number }) => {
      const oldScale = stageScaleRef.current;
      const oldPos = stagePosRef.current;
      const newScale = Math.max(MIN_STAGE_SCALE, Math.min(MAX_STAGE_SCALE, nextScale));
      if (newScale === oldScale) return;

      const pointTo = {
        x: (anchor.x - oldPos.x) / oldScale,
        y: (anchor.y - oldPos.y) / oldScale,
      };
      const newPos = {
        x: anchor.x - pointTo.x * newScale,
        y: anchor.y - pointTo.y * newScale,
      };

      stageScaleRef.current = newScale;
      stagePosRef.current = newPos;
      setStageScale(newScale);
      setStagePos(newPos);
    },
    []
  );

  const zoomByStep = useCallback(
    (direction: 'in' | 'out') => {
      const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
      const factor = direction === 'in' ? 1.25 : 1 / 1.25;
      zoomAroundPoint(stageScaleRef.current * factor, center);
    },
    [canvasWidth, canvasHeight, zoomAroundPoint]
  );

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const oldScale = stageScaleRef.current;
    zoomAroundPoint(e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy, pointer);
  }, [zoomAroundPoint]);

  const handleResetView = useCallback(() => {
    stageScaleRef.current = 1;
    stagePosRef.current = { x: 0, y: 0 };
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
  }, []);

  // Get stage pointer position, converted through the current zoom/pan
  // transform so calibration points stay anchored to the actual image pixel
  // regardless of how far the user has zoomed in.
  const getPointerPos = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  }, []);

  const handleStageClick = useCallback(() => {
    if (gestureConsumedRef.current) {
      gestureConsumedRef.current = false;
      return;
    }
    if (panMode) return;
    const pos = getPointerPos();
    if (!pos) return;

    if (!pointA) {
      setPointA(pos);
      setPointB(null);
    } else if (!pointB) {
      setPointB(pos);
    } else {
      // Reset — start new line
      setPointA(pos);
      setPointB(null);
      setRealFeet(null);
    }
  }, [pointA, pointB, panMode, getPointerPos]);

  const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Two-finger gesture: pinch-zoom + pan
    if (isTouchEvt(e.evt) && e.evt.touches.length >= 2) {
      e.evt.preventDefault();
      isPanningRef.current = false;
      gestureConsumedRef.current = true;

      const geo = getPinchGeometry(e.evt);
      if (!geo) return;
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const center = rect
        ? { x: geo.center.x - rect.left, y: geo.center.y - rect.top }
        : geo.center;
      const prev = pinchRef.current;
      if (!prev || prev.dist === 0) {
        pinchRef.current = { dist: geo.dist, center };
        return;
      }
      const dx = center.x - prev.center.x;
      const dy = center.y - prev.center.y;
      if (dx || dy) {
        const panned = { x: stagePosRef.current.x + dx, y: stagePosRef.current.y + dy };
        stagePosRef.current = panned;
        setStagePos(panned);
      }
      zoomAroundPoint(stageScaleRef.current * (geo.dist / prev.dist), center);
      pinchRef.current = { dist: geo.dist, center };
      return;
    }

    if (isPanningRef.current) {
      const client = getClientPoint(e.evt);
      if (!client) return;
      if (isTouchEvt(e.evt)) e.evt.preventDefault();
      const dx = client.x - lastPointerRef.current.x;
      const dy = client.y - lastPointerRef.current.y;
      lastPointerRef.current = client;
      const next = { x: stagePosRef.current.x + dx, y: stagePosRef.current.y + dy };
      stagePosRef.current = next;
      setStagePos(next);
      return;
    }

    const pos = getPointerPos();
    if (pos) setHoverPoint(pos);
  }, [getPointerPos, containerRef, zoomAroundPoint]);

  const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const isMiddleClick = !isTouchEvt(e.evt) && e.evt.button === 1;
    if (panMode || isMiddleClick) {
      const client = getClientPoint(e.evt);
      if (!client) return;
      e.evt.preventDefault();
      isPanningRef.current = true;
      lastPointerRef.current = client;
    }
  }, [panMode]);

  const handleStageMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      gestureConsumedRef.current = true;
    }
    pinchRef.current = null;
  }, []);

  const handleReset = useCallback(() => {
    setPointA(null);
    setPointB(null);
    setHoverPoint(null);
    setRealFeet(null);
  }, []);

  const handleApply = useCallback(() => {
    if (computedScale && computedScale > 0) {
      onCalibrated(Math.round(computedScale * 100) / 100);
    }
  }, [computedScale, onCalibrated]);

  // Preview line: from A to hover (before B is placed)
  const previewEnd = pointA && !pointB ? hoverPoint : null;
  const previewDist = pointA && previewEnd ? distance(pointA, previewEnd) : 0;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f5f5',
      }}
    >
      {/* Instruction bar */}
      <div
        style={{
          padding: '8px 16px',
          background: '#1677ff',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <AimOutlined style={{ fontSize: 18 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            Scale Calibration
          </div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {!pointA
              ? `Step 1: ${tapWord} on the image to set the start point of a known dimension.`
              : !pointB
              ? `Step 2: ${tapWord} the end point of the same dimension.`
              : `Step 3: Enter the real-world length, then ${tapWord.toLowerCase()} Apply.`}
          </div>
        </div>
        <Space>
          <Button
            size="small"
            type={panMode ? 'primary' : 'default'}
            icon={<DragOutlined />}
            onClick={() => setPanMode((v) => !v)}
            style={panMode ? undefined : { color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
            ghost={!panMode}
          >
            Pan
          </Button>
          {(pointA || pointB) && (
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={handleReset}
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
              ghost
            >
              Reset
            </Button>
          )}
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={onCancel}
            style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
            ghost
          >
            Cancel
          </Button>
        </Space>
      </div>

      {/* Canvas area — self-measured via ResizeObserver */}
      <div
        ref={canvasAreaRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
      >
        <Stage
          ref={stageRef}
          width={canvasWidth}
          height={canvasHeight}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onClick={handleStageClick}
          onMouseMove={handleStageMouseMove}
          onMouseDown={handleStageMouseDown}
          onMouseUp={handleStageMouseUp}
          onWheel={handleWheel}
          // Konva dispatches `tap`, not `click`, for touch input — without
          // these the calibration points cannot be placed with a finger.
          onTap={handleStageClick}
          onTouchMove={handleStageMouseMove}
          onTouchStart={handleStageMouseDown}
          onTouchEnd={handleStageMouseUp}
          style={{
            cursor: panMode ? 'grab' : 'crosshair',
            display: 'block',
            // Let taps/drags through instead of letting the browser treat
            // them as scroll/zoom gestures — pinch-zoom and pan are handled
            // manually so the calibration points stay precise.
            touchAction: 'none',
          }}
        >
          {/* Background image */}
          <Layer listening={false}>
            {loadedImage && imageFit && (
              <KonvaImage
                image={loadedImage}
                x={imageFit.x}
                y={imageFit.y}
                width={imageFit.width}
                height={imageFit.height}
                opacity={0.85}
              />
            )}
          </Layer>

          {/* Calibration line overlay */}
          <Layer>
            {/* Preview line (A → hover) */}
            {pointA && previewEnd && (
              <>
                <Line
                  points={[pointA.x, pointA.y, previewEnd.x, previewEnd.y]}
                  stroke="#ff4d4f"
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
                {previewDist > 30 && (
                  <KonvaText
                    x={midpoint(pointA, previewEnd).x + 8}
                    y={midpoint(pointA, previewEnd).y - 18}
                    text={`${Math.round(previewDist)} px`}
                    fill="#ff4d4f"
                    fontSize={12}
                    fontStyle="bold"
                    listening={false}
                  />
                )}
              </>
            )}

            {/* Confirmed line (A → B) */}
            {pointA && pointB && (
              <>
                <Line
                  points={[pointA.x, pointA.y, pointB.x, pointB.y]}
                  stroke="#52c41a"
                  strokeWidth={3}
                  listening={false}
                />
                {/* End caps */}
                {[pointA, pointB].map((pt, i) => {
                  // Perpendicular cap
                  const dx = pointB.x - pointA.x;
                  const dy = pointB.y - pointA.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  if (len === 0) return null;
                  const nx = -dy / len;
                  const ny = dx / len;
                  const capSize = 10;
                  return (
                    <Line
                      key={`cap-${i}`}
                      points={[
                        pt.x - nx * capSize, pt.y - ny * capSize,
                        pt.x + nx * capSize, pt.y + ny * capSize,
                      ]}
                      stroke="#52c41a"
                      strokeWidth={2}
                      listening={false}
                    />
                  );
                })}
                {/* Pixel distance label */}
                <KonvaText
                  x={midpoint(pointA, pointB).x + 10}
                  y={midpoint(pointA, pointB).y - 20}
                  text={`${Math.round(pixelDist)} px`}
                  fill="#52c41a"
                  fontSize={13}
                  fontStyle="bold"
                  listening={false}
                />
              </>
            )}

            {/* Point markers */}
            {pointA && (
              <>
                <Circle
                  x={pointA.x}
                  y={pointA.y}
                  radius={6}
                  fill="#52c41a"
                  stroke="#fff"
                  strokeWidth={2}
                  listening={false}
                />
                <KonvaText
                  x={pointA.x + 10}
                  y={pointA.y - 6}
                  text="A"
                  fill="#52c41a"
                  fontSize={14}
                  fontStyle="bold"
                  listening={false}
                />
              </>
            )}
            {pointB && (
              <>
                <Circle
                  x={pointB.x}
                  y={pointB.y}
                  radius={6}
                  fill="#52c41a"
                  stroke="#fff"
                  strokeWidth={2}
                  listening={false}
                />
                <KonvaText
                  x={pointB.x + 10}
                  y={pointB.y - 6}
                  text="B"
                  fill="#52c41a"
                  fontSize={14}
                  fontStyle="bold"
                  listening={false}
                />
              </>
            )}
          </Layer>
        </Stage>

        {/* Zoom controls — floating, bottom-right of canvas area */}
        <Space
          direction="vertical"
          size={4}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 12,
            zIndex: 10,
            background: 'rgba(255,255,255,0.9)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          <Button size="small" icon={<ZoomInOutlined />} onClick={() => zoomByStep('in')} />
          <Button size="small" icon={<ZoomOutOutlined />} onClick={() => zoomByStep('out')} />
          <Button size="small" icon={<ExpandOutlined />} onClick={handleResetView} title="Reset zoom" />
        </Space>

        {/* Zoom level indicator */}
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 10,
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(stageScale * 100)}%
        </div>
      </div>

      {/* Bottom panel — dimension input + apply */}
      <div
        style={{
          padding: '12px 16px',
          background: '#fff',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Line info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Reference line:
          </Text>
          <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
            {pixelDist > 0 ? `${Math.round(pixelDist)} px` : '— not drawn —'}
          </Text>
        </div>

        {/* Real-world length input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Actual length:
          </Text>
          <InputNumber
            value={realFeet}
            onChange={(val) => setRealFeet(val)}
            min={0.1}
            max={500}
            step={0.5}
            placeholder="e.g. 10"
            addonAfter="ft"
            size="small"
            style={{ width: 140 }}
            disabled={pixelDist === 0}
          />
        </div>

        {/* Computed scale */}
        {computedScale !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Scale:
            </Text>
            <Text
              strong
              style={{
                fontSize: 13,
                color: token.colorPrimary,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {computedScale.toFixed(1)} px/ft
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              (was {currentScale} px/ft)
            </Text>
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Actions */}
        <Space>
          <Button size="small" onClick={onCancel}>
            Skip
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            disabled={!computedScale || computedScale <= 0}
            onClick={handleApply}
          >
            Apply Scale
          </Button>
        </Space>
      </div>

      {/* Tip */}
      {!pointA && (
        <div
          style={{
            position: 'absolute',
            bottom: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
        >
          <Alert
            message="Tip: Scroll/pinch to zoom in on the measurement numbers, use the Pan button (or middle-click drag) to move around, then click two ends of a known dimension."
            type="info"
            showIcon
            style={{ fontSize: 12, padding: '6px 12px' }}
          />
        </div>
      )}
    </div>
  );
};

export default WMScaleCalibration;
