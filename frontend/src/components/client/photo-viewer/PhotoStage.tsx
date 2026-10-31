import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { LeftOutlined, MinusOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import type { FileItem } from '../../common/FileGallery/types';
import { getCategoryColor, getCategoryLabel } from '../../common/FileGallery/categoryColors';
import {
  FIT_VIEW, MAX_ZOOM, clampView, photoCategory, photoDate, photoPlace, zoomAt, type PhotoView,
} from './photoViewerUtils';

const ZOOM_STEP = 1.5;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const SWIPE_PX = 50;
const DRAG_PX = 6;
// Long enough that skimming through photos doesn't download every original
const ORIGINAL_DELAY_MS = 250;

interface PhotoStageProps {
  file: FileItem | null;
  prev?: FileItem;
  next?: FileItem;
  position: number;
  total: number;
  onStep: (delta: number) => void;
  /** Shown instead of a photo: loading nothing yet, none in the set, or an error */
  placeholder?: React.ReactNode;
}

// The big photo: fitted to the stage, zoomed with the wheel, a pinch, a double
// tap or the buttons, and dragged once it's bigger than the stage. It shows the
// card's thumbnail straight away, the web size over that, then the original.
const PhotoStage: React.FC<PhotoStageProps> = ({ file, prev, next, position, total, onStep, placeholder }) => {
  const webSrc = file?.url || file?.fileUrl || '';
  const [photoId, setPhotoId] = useState(file?.id);
  const [src, setSrc] = useState(webSrc);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<PhotoView>(FIT_VIEW);
  if (photoId !== file?.id) {
    setPhotoId(file?.id);
    setSrc(webSrc);
    setFailed(false);
    setView(FIT_VIEW);
  }

  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const measure = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      stage: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
      natural: { width: imgRef.current?.naturalWidth ?? 0, height: imgRef.current?.naturalHeight ?? 0 },
    };
  }, []);

  const zoom = useCallback((nextScale: (scale: number) => number, clientX?: number, clientY?: number) => {
    const { left, top, stage, natural } = measure();
    const point = clientX === undefined || clientY === undefined
      ? { x: 0, y: 0 }
      : { x: clientX - left - stage.width / 2, y: clientY - top - stage.height / 2 };
    setView(v => zoomAt(v, nextScale(v.scale), point, stage, natural));
  }, [measure]);

  useEffect(() => {
    const original = file?.fileUrl;
    if (!original || original === file?.url) return undefined;
    let active = true;
    const loader = new window.Image();
    const timer = setTimeout(() => {
      loader.onload = () => {
        if (active) setSrc(original);
      };
      loader.src = original;
    }, ORIGINAL_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      loader.onload = null;
    };
  }, [file?.id, file?.fileUrl, file?.url]);

  // The next photo either way is ready before the arrow is pressed
  useEffect(() => {
    [prev?.url, next?.url].forEach((url) => {
      if (url) new window.Image().src = url;
    });
  }, [prev?.url, next?.url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // A trackpad pinch arrives as small ctrl+wheel deltas; Firefox's wheel counts lines
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      zoom(scale => scale * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // Hiding the cards or resizing the window changes how far a zoomed photo can move
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const { stage, natural } = measure();
      setView(v => (v.scale > 1 ? clampView(v, stage, natural) : v));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoom(scale => scale * ZOOM_STEP);
      else if (e.key === '-' || e.key === '_') zoom(scale => scale / ZOOM_STEP);
      else if (e.key === '0') zoom(() => 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoom]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    startX: 0, startY: 0, moved: false, pinched: false, pinchDistance: 0, tapAt: 0, tapX: 0, tapY: 0,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      Object.assign(g, { startX: e.clientX, startY: e.clientY, moved: false, pinched: false });
    } else {
      Object.assign(g, { pinched: true, pinchDistance: 0 });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > DRAG_PX) g.moved = true;

    if (pointers.current.size > 1) {
      const [a, b] = Array.from(pointers.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDistance) {
        const ratio = distance / g.pinchDistance;
        zoom(scale => scale * ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      g.pinchDistance = distance;
      return;
    }

    const { stage, natural } = measure();
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    setView(v => (v.scale > 1 ? clampView({ ...v, x: v.x + dx, y: v.y + dy }, stage, natural) : v));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId) || pointers.current.size > 0) return;
    const g = gesture.current;
    if (g.pinched) return;

    if (!g.moved) {
      const now = Date.now();
      const isDouble = now - g.tapAt < DOUBLE_TAP_MS
        && Math.hypot(e.clientX - g.tapX, e.clientY - g.tapY) < DOUBLE_TAP_PX;
      Object.assign(g, { tapAt: isDouble ? 0 : now, tapX: e.clientX, tapY: e.clientY });
      if (isDouble) zoom(scale => (scale > 1 ? 1 : DOUBLE_TAP_ZOOM), e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (e.pointerType === 'touch' && view.scale === 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      const target = dx < 0 ? next : prev;
      if (target) onStep(dx < 0 ? 1 : -1);
    }
  };

  const handleImageError = () => {
    if (file?.fileUrl && src !== file.fileUrl) setSrc(file.fileUrl);
    else setFailed(true);
  };

  const thumbnail = file?.thumbnailUrl;
  const category = file ? photoCategory(file) : '';
  const place = file ? photoPlace(file) : '';
  const date = file ? photoDate(file) : '';

  return (
    <div className="cpv-stage">
      <div
        ref={canvasRef}
        className={`cpv-canvas${view.scale > 1 ? ' is-zoomed' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {file && !failed && (
          <img
            key={file.id}
            ref={imgRef}
            className="cpv-photo"
            src={src}
            alt={file.originalName}
            draggable={false}
            onError={handleImageError}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              backgroundImage: thumbnail ? `url(${JSON.stringify(thumbnail)})` : undefined,
            }}
          />
        )}
        {file && failed && (
          <div className="cpv-placeholder" role="alert">
            <strong>This photo couldn't be loaded.</strong>
            <span>Move to another photo, or reopen the viewer to try again.</span>
          </div>
        )}
      </div>

      {/* Outside the canvas: its pointer capture would take this button's click */}
      {!file && placeholder && <div className="cpv-placeholder">{placeholder}</div>}

      {prev && (
        <Tooltip title="Previous photo (←)" placement="right">
          <Button
            type="text"
            className="cpv-nav cpv-nav--prev"
            aria-label="Previous photo"
            icon={<LeftOutlined />}
            onClick={() => onStep(-1)}
          />
        </Tooltip>
      )}
      {next && (
        <Tooltip title="Next photo (→)" placement="left">
          <Button
            type="text"
            className="cpv-nav cpv-nav--next"
            aria-label="Next photo"
            icon={<RightOutlined />}
            onClick={() => onStep(1)}
          />
        </Tooltip>
      )}

      <div className="cpv-caption">
        {file && (
          <div className="cpv-caption-info">
            <span className="cpv-caption-count">{position} of {total}</span>
            <span className="cpv-caption-category">
              <span className="ui-filter-chip-dot" style={{ background: getCategoryColor(category) }} aria-hidden="true" />
              {getCategoryLabel(category)}
            </span>
            {date && <span className="cpv-caption-date">{date}</span>}
            {place && <span className="cpv-caption-place" title={place}>{place}</span>}
            <span className="cpv-caption-name" title={file.originalName}>{file.originalName}</span>
          </div>
        )}
        {file && (
          <div className="cpv-zoom">
            <Tooltip title="Zoom out (−)">
              <Button
                type="text"
                size="small"
                aria-label="Zoom out"
                icon={<MinusOutlined />}
                disabled={view.scale <= 1}
                onClick={() => zoom(scale => scale / ZOOM_STEP)}
              />
            </Tooltip>
            <Tooltip title="Fit to screen (0)">
              <Button
                type="text"
                size="small"
                className="cpv-zoom-level"
                aria-label={`Zoom ${Math.round(view.scale * 100)} percent. Fit to screen`}
                onClick={() => zoom(() => 1)}
              >
                {Math.round(view.scale * 100)}%
              </Button>
            </Tooltip>
            <Tooltip title="Zoom in (+)">
              <Button
                type="text"
                size="small"
                aria-label="Zoom in"
                icon={<PlusOutlined />}
                disabled={view.scale >= MAX_ZOOM}
                onClick={() => zoom(scale => scale * ZOOM_STEP)}
              />
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoStage;
