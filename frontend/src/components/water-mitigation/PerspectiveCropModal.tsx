/**
 * PerspectiveCropModal - 4-point perspective crop for document scanning
 * Allows users to select 4 corners on a photo to perform perspective transform.
 * The photo shows as it will on the page (turned by `rotation`), and the crop comes
 * back upright that way, so the turn costs no second encode.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Segmented, Spin, message } from 'antd';
import { useSheetModal } from '../common/ui';
import waterMitigationService from '../../services/waterMitigationService';
import './documentCreate.css';

interface Point {
  x: number; // ratio 0-1
  y: number; // ratio 0-1
}

interface PerspectiveCropModalProps {
  open: boolean;
  photoId: string;
  /** The photo at full size: what is drawn once loaded, and what its size is read from */
  photoUrl: string;
  /** A smaller copy that is usually in the browser already, shown until then */
  previewUrl?: string;
  rotation?: number;
  onClose: () => void;
  onCropped: (newPhoto: any) => void;
}

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
const INITIAL_POINTS: Point[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const SCAN_EFFECTS = [
  { label: 'None', value: 'none' },
  { label: 'Color scan', value: 'color_scan' },
  { label: 'B&W scan', value: 'bw_scan' },
];
const LOUPE_SIZE = 148;
// The backend crops from at most this many pixels on the photo's longest side
const CROP_PHOTO_PX = 4096;
// About 100dpi across an 11in page: text starts to look soft below this
const SOFT_ON_A_PAGE_PX = 1100;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Corners as seen, turned back onto the photo as it is stored */
const toStoredPhoto = ({ x, y }: Point, rotation: number): Point => {
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
};

const isConvex = (points: Point[]) => {
  let turn = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [points[i], points[(i + 1) % 4], points[(i + 2) % 4]];
    const cross = Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    if (cross && turn && cross !== turn) return false;
    turn = cross || turn;
  }
  return turn !== 0;
};

const PerspectiveCropModal: React.FC<PerspectiveCropModalProps> = ({
  open,
  photoId,
  photoUrl,
  previewUrl,
  rotation = 0,
  onClose,
  onCropped,
}) => {
  const { isPhone, sheetProps } = useSheetModal('tall');
  const frameRef = useRef<HTMLDivElement>(null);
  const grabOffset = useRef({ x: 0, y: 0 });
  const [shownSrc, setShownSrc] = useState<string | null>(null);
  const [shownSize, setShownSize] = useState({ width: 0, height: 0 });
  const [fullSize, setFullSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const [points, setPoints] = useState<Point[]>(INITIAL_POINTS);
  const [active, setActive] = useState<number | null>(null);
  const [scanEffect, setScanEffect] = useState('none');
  const [processing, setProcessing] = useState(false);

  // The smaller copy first if there is one, then the full-size photo over it
  useEffect(() => {
    if (!open || !photoUrl) return undefined;
    let current = true;
    let hasFull = false;
    setShownSrc(null);
    setFullSize(null);
    setFailed(false);
    setPoints(INITIAL_POINTS);
    setScanEffect('none');

    const load = (src: string, onLoad: (img: HTMLImageElement) => void, onError: () => void) => {
      const img = new window.Image();
      img.onload = () => current && onLoad(img);
      img.onerror = () => current && onError();
      img.src = src;
    };
    const show = (src: string, img: HTMLImageElement) => {
      setShownSrc(src);
      setShownSize({ width: img.naturalWidth, height: img.naturalHeight });
    };

    let previewFailed = !previewUrl;
    let fullFailed = false;
    const failIfNothing = () => {
      if (previewFailed && fullFailed) {
        setFailed(true);
        message.error('Failed to load image');
      }
    };
    if (previewUrl) {
      load(
        previewUrl,
        (img) => {
          if (!hasFull) show(previewUrl, img);
        },
        () => {
          previewFailed = true;
          failIfNothing();
        },
      );
    }
    load(
      photoUrl,
      (img) => {
        hasFull = true;
        show(photoUrl, img);
        setFullSize({ width: img.naturalWidth, height: img.naturalHeight });
      },
      () => {
        fullFailed = true;
        failIfNothing();
      },
    );
    return () => {
      current = false;
    };
  }, [open, photoUrl, previewUrl]);

  // Keep the photo fitted to the stage, whatever the window does
  const observer = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((stage: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      setRoom({
        width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(stage);
  }, []);

  const sideways = rotation % 180 === 90;
  const aspect = shownSize.height
    ? (sideways ? shownSize.height / shownSize.width : shownSize.width / shownSize.height)
    : 1;
  const frameWidth = Math.floor(Math.max(0, Math.min(room.width, room.height * aspect)));
  const frameHeight = Math.floor(frameWidth / aspect);

  const photo = shownSrc && (
    <div className="wdc-crop-photo" style={{ width: frameWidth, height: frameHeight }}>
      <img
        src={shownSrc}
        alt=""
        draggable={false}
        style={{
          width: sideways ? frameHeight : frameWidth,
          height: sideways ? frameWidth : frameHeight,
          transform: `rotate(${rotation}deg)`,
        }}
      />
    </div>
  );

  const moveCorner = (index: number, clientX: number, clientY: number) => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame) return;
    setPoints((prev) => prev.map((point, i) => (i === index
      ? {
          x: clamp((clientX - grabOffset.current.x - frame.left) / frame.width),
          y: clamp((clientY - grabOffset.current.y - frame.top) / frame.height),
        }
      : point)));
  };

  const handlePointerDown = (index: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = e.currentTarget.getBoundingClientRect();
    grabOffset.current = {
      x: e.clientX - (handle.left + handle.width / 2),
      y: e.clientY - (handle.top + handle.height / 2),
    };
    setActive(index);
  };

  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = nudge[e.key];
    if (!by || !frameWidth) return;
    e.preventDefault();
    setPoints((prev) => prev.map((point, i) => (i === index
      ? { x: clamp(point.x + by[0] / frameWidth), y: clamp(point.y + by[1] / frameHeight) }
      : point)));
  };

  const handleCrop = async () => {
    setProcessing(true);
    try {
      const newPhoto = await waterMitigationService.photos.perspectiveCrop(
        photoId,
        points.map((point) => toStoredPhoto(point, rotation)),
        scanEffect === 'none' ? undefined : scanEffect,
      );
      message.success('Photo cropped successfully');
      onCropped(newPhoto);
      onClose();
    } catch (error: any) {
      console.error('Crop failed:', error);
      message.error(error?.response?.data?.detail || 'Failed to crop photo');
    } finally {
      setProcessing(false);
    }
  };

  // How many pixels the crop will have, from the full-size photo
  const resultSize = (() => {
    if (!fullSize) return null;
    const scale = Math.min(1, CROP_PHOTO_PX / Math.max(fullSize.width, fullSize.height));
    const width = (sideways ? fullSize.height : fullSize.width) * scale;
    const height = (sideways ? fullSize.width : fullSize.height) * scale;
    const side = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
    return {
      width: Math.round(Math.max(side(points[0], points[1]), side(points[3], points[2]))),
      height: Math.round(Math.max(side(points[0], points[3]), side(points[1], points[2]))),
    };
  })();
  const crossed = !isConvex(points);
  const soft = resultSize && Math.max(resultSize.width, resultSize.height) < SOFT_ON_A_PAGE_PX;

  const activePoint = active === null ? null : points[active];
  // True pixels when the photo has them, and never so close it only shows blur
  const loupeZoom = Math.max(2, Math.min(4, fullSize && frameWidth
    ? (sideways ? fullSize.height : fullSize.width) / frameWidth
    : 2));

  return (
    <Modal
      {...sheetProps}
      className="wdc-modal"
      title={(
        <div className="wdc-crop-head">
          Crop photo
          <span className="wdc-crop-lead">Drag the 4 corners to the edges of the document</span>
        </div>
      )}
      open={open}
      onCancel={onClose}
      width={960}
      style={isPhone ? undefined : { maxWidth: '96vw', top: 24 }}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button
          key="crop"
          type="primary"
          onClick={handleCrop}
          loading={processing}
          disabled={!shownSrc || crossed}
        >
          Crop & save
        </Button>,
      ]}
      destroyOnHidden
    >
      <div className="wdc-crop-stage" ref={stageRef}>
        {!shownSrc && (
          <div className="wdc-crop-loading">
            {failed ? 'This photo could not be loaded.' : (
              <>
                <Spin />
                Loading photo...
              </>
            )}
          </div>
        )}
        {shownSrc && (
          <div className="wdc-crop-frame" ref={frameRef} style={{ width: frameWidth, height: frameHeight }}>
            {photo}
            <svg className="wdc-crop-mask" viewBox={`0 0 ${frameWidth} ${frameHeight}`} aria-hidden>
              <path
                fill="rgba(15, 15, 15, 0.58)"
                fillRule="evenodd"
                d={`M0 0H${frameWidth}V${frameHeight}H0Z M${points
                  .map((p) => `${p.x * frameWidth} ${p.y * frameHeight}`)
                  .join('L')}Z`}
              />
              <polygon
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.5"
                points={points.map((p) => `${p.x * frameWidth},${p.y * frameHeight}`).join(' ')}
              />
            </svg>
            {points.map((point, index) => (
              <button
                key={CORNER_NAMES[index]}
                type="button"
                className={`wdc-handle${active === index ? ' is-active' : ''}`}
                aria-label={`${CORNER_NAMES[index]} corner. Arrow keys move it.`}
                style={{ left: point.x * frameWidth, top: point.y * frameHeight }}
                onPointerDown={handlePointerDown(index)}
                onPointerMove={(e) => active === index && moveCorner(index, e.clientX, e.clientY)}
                onPointerUp={() => setActive(null)}
                onPointerCancel={() => setActive(null)}
                onKeyDown={handleKeyDown(index)}
              />
            ))}
          </div>
        )}
        {/* Fingers cover the corner being placed: this shows it, away from the finger */}
        {activePoint && (
          <div className="wdc-loupe" style={activePoint.x < 0.5 ? { right: 12 } : { left: 12 }} aria-hidden>
            <div
              className="wdc-loupe-photo"
              style={{
                width: frameWidth,
                height: frameHeight,
                transform: `translate(${LOUPE_SIZE / 2 - 2 - activePoint.x * frameWidth * loupeZoom}px, ${LOUPE_SIZE / 2 - 2 - activePoint.y * frameHeight * loupeZoom}px) scale(${loupeZoom})`,
              }}
            >
              {photo}
            </div>
          </div>
        )}
      </div>

      <div className="wdc-crop-tools">
        <div className="wdc-crop-effect">
          Scan effect
          <Segmented size="small" options={SCAN_EFFECTS} value={scanEffect} onChange={(value) => setScanEffect(String(value))} />
        </div>
        <div className="wdc-crop-result">
          {crossed ? (
            <span className="wdc-crop-note">Two corners have crossed</span>
          ) : resultSize && (
            <span>
              {resultSize.width} × {resultSize.height} px
              {soft && <span className="wdc-crop-note"> · May look soft on a full page</span>}
            </span>
          )}
          <Button type="text" size="small" onClick={() => setPoints(INITIAL_POINTS)}>Reset corners</Button>
        </div>
      </div>
    </Modal>
  );
};

export default PerspectiveCropModal;
