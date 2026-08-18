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
import { Button, InputNumber, Space, Typography, Alert, theme } from 'antd';
import { AimOutlined, CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons';
import { useIsCoarsePointer } from '../hooks/useWMResponsive';

const { Text } = Typography;

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

  // Get stage pointer position
  const getPointerPos = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  }, []);

  const handleStageClick = useCallback(() => {
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
  }, [pointA, pointB, getPointerPos]);

  const handleStageMouseMove = useCallback(() => {
    const pos = getPointerPos();
    if (pos) setHoverPoint(pos);
  }, [getPointerPos]);

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
          onClick={handleStageClick}
          onMouseMove={handleStageMouseMove}
          // Konva dispatches `tap`, not `click`, for touch input — without
          // these the calibration points cannot be placed with a finger.
          onTap={handleStageClick}
          onTouchMove={handleStageMouseMove}
          style={{
            cursor: 'crosshair',
            display: 'block',
            // Let the two calibration taps through instead of letting the
            // browser treat them as scroll/zoom gestures.
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
            message="Tip: Click two ends of a wall or door with a known dimension (e.g. a standard 3ft door)."
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
