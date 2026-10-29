/**
 * Room Dimensions — inside wall lengths from a room sketch capture.
 *
 * Drop, pick or paste a screenshot of one room (Xactimate, MagicPlan…). Two
 * ways to measure it:
 *
 *  • Auto-detect finds the walls from the pixels and letters every inside
 *    face. It reads room captures (walls as filled bands) and dimensioned
 *    plans alike; when a capture shows several rooms it measures the largest,
 *    and clicking another room on the drawing measures that one.
 *  • Trace walls is for a busy, fully dimensioned plan the pixels can't be
 *    read from: click the corners and the tool gives each wall run's length
 *    and each corner's angle, flagging the ones that are not square.
 *
 * Either way a capture has no scale of its own, so the user gives one wall's
 * real length and every other length follows from it. When no single wall is
 * a length they know, they draw a line between two points that is — across
 * the gap between two wall pieces, say — and give its length instead.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Modal, Segmented, Select, Spin, Upload, message } from 'antd';
import {
  BorderOuterOutlined,
  ClearOutlined,
  CloseOutlined,
  ColumnWidthOutlined,
  DownloadOutlined,
  EditOutlined,
  UndoOutlined,
  UploadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { saveAs } from 'file-saver';
import type { InputNumberRef } from 'rc-input-number';
import { PageHeader, PropertyList } from '../components/common/ui';
import RoomDimensionsDrawing from '../components/room-dimensions/RoomDimensionsDrawing';
import RoomTraceEditor from '../components/room-dimensions/RoomTraceEditor';
import type { ScaleLineState } from '../components/room-dimensions/ScaleLine';
import { LINE_LABEL, lengthText, renderDrawingPng, renderTracePng } from '../components/room-dimensions/roomDrawing';
import { detectRoomFaces, type Point, type RoomDetection, type WallFace } from '../utils/roomDimensions';
import { angleText, outlineCorners, traceMetrics } from '../utils/roomTrace';
import '../components/room-dimensions/roomDimensions.css';

/** Larger captures are measured at this size; the scale is set on the same pixels, so lengths are unaffected */
const MAX_WORKING_SIZE = 2000;
/** Drawing sizes relative to fitting the stage; labels keep their size, so zooming in pulls crowded ones apart */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
/** Above this many auto faces the capture is too busy to trust; start in Trace mode instead */
const AUTO_FACE_CEILING = 40;

type Mode = 'auto' | 'trace';

interface Capture {
  url: string;
  image: HTMLImageElement;
  name: string;
}

interface Reference {
  label: string;
  feet: number;
  /** The line's pixel length when it set the scale, kept once it is redrawn or removed so the scale holds */
  px?: number;
  /** Auto-detect: the room the wall belongs to, so the scale holds when another room is measured */
  room?: number;
  /** What to call it when it came from elsewhere: Auto-detect's scale carried into Trace walls */
  name?: string;
}

/** A scale that does not hang on a traced wall's letter outlives the outline changing */
const keepsScale = (ref: Reference | null) => (ref && (ref.label === LINE_LABEL || ref.px != null) ? ref : null);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the image'));
    image.src = url;
  });
}

/** Feet and inches for the form, rounded to the inch */
function splitFeet(feet: number): { ft: number; inches: number } {
  let ft = Math.floor(feet);
  let inches = Math.round((feet - ft) * 12);
  if (inches === 12) {
    ft += 1;
    inches = 0;
  }
  return { ft, inches };
}

const scalePoint = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

const lineLength = (line: Point[]) => (line.length === 2 ? Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y) : null);

/** How the scale form names its reference; a wall of a room other than `room` says which */
const referenceName = (ref: Reference, room = 0) => {
  if (ref.name) return ref.name;
  if (ref.label === LINE_LABEL) return ref.px != null ? 'Earlier line' : 'Line';
  return ref.room != null && ref.room !== room ? `Room ${ref.room + 1} wall ${ref.label}` : `Wall ${ref.label}`;
};

const LINE_HINT = 'Click the two ends of a length you know. An end snaps to a nearby corner; Esc cancels.';

const longestFace = (faces: WallFace[]) =>
  faces.reduce<WallFace | null>((best, face) => (!best || face.lengthPx > best.lengthPx ? face : best), null);

const RoomDimensions: React.FC = () => {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [detection, setDetection] = useState<RoomDetection | null>(null);
  /** Which of the capture's rooms Auto-detect measures; 0 is the largest */
  const [roomIndex, setRoomIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('auto');
  const [processing, setProcessing] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [formLabel, setFormLabel] = useState<string | null>(null);
  const [formFt, setFormFt] = useState<number | null>(null);
  const [formIn, setFormIn] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Trace walls mode: a polyline the user draws over the capture, in natural image pixels
  const [tracePoints, setTracePoints] = useState<Point[]>([]);
  const [traceClosed, setTraceClosed] = useState(false);
  const [traceSelected, setTraceSelected] = useState<string | null>(null);
  const [traceHovered, setTraceHovered] = useState<string | null>(null);
  const [traceRef, setTraceRef] = useState<Reference | null>(null);

  // A line between two points the user knows the distance of, in natural image pixels, shared by both modes
  const [line, setLine] = useState<Point[]>([]);
  const [placingLine, setPlacingLine] = useState(false);

  const urlRef = useRef<string | null>(null);
  const feetInputRef = useRef<InputNumberRef>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    if (!placingLine) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlacingLine(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [placingLine]);

  /** Start the outline over; a scale set from the drawn line (or carried from Auto-detect) is not part of it and stays */
  const resetTrace = () => {
    setTracePoints([]);
    setTraceClosed(false);
    setTraceSelected(label => (label === LINE_LABEL ? label : null));
    setTraceRef(keepsScale);
    setTraceHovered(null);
  };

  /** Put a length in the form, or empty it */
  const fillLength = useCallback((feet: number | null) => {
    if (feet) {
      const { ft, inches } = splitFeet(feet);
      setFormFt(ft);
      setFormIn(inches);
    } else {
      setFormFt(null);
      setFormIn(null);
    }
  }, []);

  const loadCapture = useCallback(async (file: Blob, name: string) => {
    if (!file.type.startsWith('image/')) {
      message.error('That file is not an image.');
      return;
    }
    setProcessing(true);
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const shrink = Math.min(1, MAX_WORKING_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * shrink));
      const height = Math.max(1, Math.round(image.naturalHeight * shrink));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);

      // Let the spinner paint before the measuring blocks the page
      await new Promise(resolve => setTimeout(resolve, 30));
      const result = detectRoomFaces({ width, height, data: pixels.data });

      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setCapture({ url, image, name });
      setDetection(result);
      setRoomIndex(0);
      setReference(null);
      setHovered(null);
      setZoom(1);
      resetTrace();
      setTraceSelected(null);
      setTraceRef(null);
      setLine([]);
      setPlacingLine(false);
      // A busy, over-dimensioned plan yields a storm of spurious faces; trace it by hand instead
      setMode(result.faces.length === 0 || result.faces.length > AUTO_FACE_CEILING ? 'trace' : 'auto');
      // Suggest the longest wall: the one most likely to have a known length
      setFormLabel(longestFace(result.faces)?.label ?? null);
      setFormFt(null);
      setFormIn(null);
    } catch {
      URL.revokeObjectURL(url);
      message.error("Couldn't read that image. Try a PNG or JPG screenshot.");
    } finally {
      setProcessing(false);
    }
  }, []);

  // Paste a screenshot anywhere on the page, except into a text field
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      loadCapture(file, 'pasted-room');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [loadCapture]);

  // ── Auto-detect scale ─────────────────────────────────────────────
  // The room being measured, with the capture's size; the bare detection when it found no room
  const view = useMemo<RoomDetection | null>(() => {
    const room = detection?.rooms[roomIndex];
    return detection && room ? { ...detection, ...room } : detection;
  }, [detection, roomIndex]);
  const faces = useMemo(() => view?.faces ?? [], [view]);
  // A large capture is measured shrunk to its working size; the drawn line is kept in the capture's own pixels
  const workScale = capture && detection ? detection.width / capture.image.naturalWidth : 1;
  const lineNaturalPx = lineLength(line);
  const autoLinePx = lineNaturalPx != null ? lineNaturalPx * workScale : null;
  const referencePx = reference
    ? reference.px ??
      (reference.label === LINE_LABEL
        ? autoLinePx
        : detection?.rooms[reference.room ?? 0]?.faces.find(f => f.label === reference.label)?.lengthPx ?? null)
    : null;
  const pxPerFt = reference && referencePx ? referencePx / reference.feet : null;

  const pickFace = useCallback(
    (label: string) => {
      setFormLabel(label);
      if (label === LINE_LABEL && autoLinePx == null) {
        // Nothing drawn yet: picking the line starts one
        setPlacingLine(true);
        return;
      }
      const px = label === LINE_LABEL ? autoLinePx : faces.find(f => f.label === label)?.lengthPx;
      fillLength(px && pxPerFt ? px / pxPerFt : null);
      feetInputRef.current?.focus();
    },
    [faces, pxPerFt, autoLinePx, fillLength],
  );

  /**
   * Carry the room Auto-detect measured into Trace walls, its corners ready to
   * move, add or remove where the detection went wrong. Its scale comes along.
   */
  const editCorners = () => {
    if (!view?.outline) return;
    const carry = () => {
      // Corners closer together than a wall is thick are one corner by hand
      const corners = outlineCorners(view.outline!, view.wallThicknessPx);
      setTracePoints(corners.map(p => scalePoint(p, 1 / workScale)));
      setTraceClosed(true);
      setTraceSelected(null);
      setTraceHovered(null);
      if (reference && referencePx) {
        setTraceRef(
          reference.label === LINE_LABEL && reference.px == null
            ? { label: LINE_LABEL, feet: reference.feet }
            : {
                label: reference.label,
                feet: reference.feet,
                px: referencePx / workScale,
                name: `${referenceName(reference, roomIndex)} (Auto-detect)`,
              },
        );
      }
      setPlacingLine(false);
      setHovered(null);
      setMode('trace');
    };
    if (tracePoints.length === 0) {
      carry();
      return;
    }
    Modal.confirm({
      title: 'Replace your traced outline?',
      content: 'The corners you clicked in Trace walls are replaced by the room Auto-detect found.',
      okText: 'Replace',
      onOk: carry,
    });
  };

  /** Measure another of the capture's rooms. The scale holds; the wall offered for it is the new room's longest */
  const pickRoom = useCallback(
    (index: number) => {
      const room = detection?.rooms[index];
      if (!room) return;
      setRoomIndex(index);
      setHovered(null);
      if (formLabel === LINE_LABEL) return;
      const longest = longestFace(room.faces);
      setFormLabel(longest?.label ?? null);
      fillLength(longest && pxPerFt ? longest.lengthPx / pxPerFt : null);
    },
    [detection, formLabel, pxPerFt, fillLength],
  );

  // Corners a line end snaps to: where faces end, and where openings turn, in every room
  const autoSnapPoints = useMemo(
    () =>
      detection
        ? detection.rooms.flatMap(r => [...r.faces.flatMap(f => [f.start, f.end]), ...r.openings.flatMap(o => o.path)])
        : [],
    [detection],
  );

  // ── Trace walls scale ─────────────────────────────────────────────
  const naturalSize = capture ? { w: capture.image.naturalWidth, h: capture.image.naturalHeight } : { w: 1, h: 1 };
  const metrics = useMemo(() => traceMetrics(tracePoints, traceClosed), [tracePoints, traceClosed]);
  const traceReferencePx = traceRef
    ? traceRef.px ??
      (traceRef.label === LINE_LABEL
        ? lineNaturalPx
        : metrics.segments.find(s => s.label === traceRef.label)?.lengthPx ?? null)
    : null;
  const tracePxPerFt = traceRef && traceReferencePx ? traceReferencePx / traceRef.feet : null;

  const pickSegment = useCallback(
    (label: string) => {
      setTraceSelected(label);
      if (label === LINE_LABEL && lineNaturalPx == null) {
        setPlacingLine(true);
        return;
      }
      const px = label === LINE_LABEL ? lineNaturalPx : metrics.segments.find(s => s.label === label)?.lengthPx;
      fillLength(px && tracePxPerFt ? px / tracePxPerFt : null);
      feetInputRef.current?.focus();
    },
    [metrics.segments, tracePxPerFt, lineNaturalPx, fillLength],
  );

  const addPoint = useCallback((p: Point) => setTracePoints(prev => [...prev, p]), []);
  const moveVertex = useCallback(
    (index: number, p: Point) => setTracePoints(prev => prev.map((q, i) => (i === index ? p : q))),
    [],
  );
  /** Wall letters shift as corners come and go; a scale that does not hang on a letter stays */
  const lettersShift = () => {
    setTraceSelected(label => (label === LINE_LABEL ? label : null));
    setTraceRef(keepsScale);
    setTraceHovered(null);
  };
  const undoTrace = () => {
    if (traceClosed) {
      setTraceClosed(false);
    } else {
      setTracePoints(prev => prev.slice(0, -1));
    }
    lettersShift();
  };
  const removeVertex = (index: number) => {
    if (tracePoints.length <= 3) return;
    setTracePoints(prev => prev.filter((_, i) => i !== index));
    lettersShift();
  };
  const insertVertex = (after: number, p: Point) => {
    setTracePoints(prev => [...prev.slice(0, after + 1), p, ...prev.slice(after + 1)]);
    lettersShift();
  };

  // ── Scale line ────────────────────────────────────────────────────
  /**
   * A scale set from the line outlives it: before the line is redrawn or
   * removed, its length is kept. Only dragging its ends moves the scale.
   */
  const keepLineScale = () => {
    const keep = (ref: Reference | null, px: number | null) =>
      ref?.label === LINE_LABEL && ref.px == null && px ? { ...ref, px } : ref;
    setReference(ref => keep(ref, autoLinePx));
    setTraceRef(ref => keep(ref, lineNaturalPx));
  };

  /** A new line, in natural image pixels: picked in the form, showing its length once there is a scale */
  const placeLine = (a: Point, b: Point) => {
    keepLineScale();
    setLine([a, b]);
    setPlacingLine(false);
    const trace = mode === 'trace';
    const scale = trace ? tracePxPerFt : pxPerFt;
    const px = Math.hypot(b.x - a.x, b.y - a.y) * (trace ? 1 : workScale);
    if (trace) setTraceSelected(LINE_LABEL);
    else setFormLabel(LINE_LABEL);
    fillLength(scale ? px / scale : null);
    feetInputRef.current?.focus();
  };

  const moveLineEnd = useCallback(
    (index: number, p: Point) => setLine(prev => prev.map((q, i) => (i === index ? p : q))),
    [],
  );

  const removeLine = () => {
    keepLineScale();
    setLine([]);
    setPlacingLine(false);
    if (formLabel === LINE_LABEL) setFormLabel(null);
    if (traceSelected === LINE_LABEL) setTraceSelected(null);
  };

  const applyScale = () => {
    const feet = (formFt ?? 0) + (formIn ?? 0) / 12;
    if (mode === 'trace') {
      if (!traceSelected || feet <= 0) {
        message.warning('Pick a wall and enter its length.');
        return;
      }
      setTraceRef({ label: traceSelected, feet });
      return;
    }
    if (!formLabel || feet <= 0) {
      message.warning('Pick a wall and enter its length.');
      return;
    }
    setReference({ label: formLabel, feet, room: roomIndex });
  };

  const download = async () => {
    if (!capture) return;
    setDownloading(true);
    try {
      const blob =
        mode === 'trace'
          ? await renderTracePng(capture.image, naturalSize.w, naturalSize.h, metrics, tracePoints, tracePxPerFt, line)
          : view
            ? await renderDrawingPng(capture.image, view, pxPerFt, line.map(p => scalePoint(p, workScale)))
            : null;
      if (!blob) return;
      const base = capture.name.replace(/\.[^.]+$/, '') || 'room';
      saveAs(blob, `${base}-dimensions.png`);
    } catch {
      message.error("Couldn't create the image.");
    } finally {
      setDownloading(false);
    }
  };

  const autoTotals = useMemo(() => {
    if (!view || !pxPerFt) return null;
    const walls = view.faces.reduce((sum, f) => sum + f.lengthPx, 0);
    const openings = view.openings.reduce((sum, o) => sum + o.lengthPx, 0);
    return {
      walls: lengthText(walls, pxPerFt),
      openings: view.openings.length ? lengthText(openings, pxPerFt) : null,
      perimeter: lengthText(walls + openings, pxPerFt),
      area:
        view.areaPx != null
          ? `${(view.areaPx / (pxPerFt * pxPerFt)).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} SF`
          : null,
    };
  }, [view, pxPerFt]);

  const traceTotals = useMemo(() => {
    if (!tracePxPerFt) return null;
    return {
      perimeter: lengthText(metrics.perimeterPx, tracePxPerFt),
      area:
        metrics.areaPx != null
          ? `${(metrics.areaPx / (tracePxPerFt * tracePxPerFt)).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} SF`
          : null,
    };
  }, [metrics, tracePxPerFt]);

  const chooseFile = (file: File) => {
    loadCapture(file, file.name);
    return false; // measured here, never uploaded
  };

  const canDownload = mode === 'trace' ? metrics.segments.length > 0 : faces.length > 0;

  const header = (
    <PageHeader
      title="Room Dimensions"
      meta="Inside wall lengths from a room sketch capture"
      actions={
        capture && (
          <>
            <Upload accept="image/*" showUploadList={false} beforeUpload={chooseFile}>
              <Button icon={<UploadOutlined />}>Replace image</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} onClick={download} loading={downloading} disabled={!canDownload}>
              Download PNG
            </Button>
          </>
        )
      }
    />
  );

  if (!capture) {
    return (
      <div className="rd-page">
        {header}
        <Spin spinning={processing} tip="Measuring walls…">
          <Upload.Dragger className="rd-dropzone" accept="image/*" showUploadList={false} beforeUpload={chooseFile}>
            <BorderOuterOutlined className="rd-dropzone-icon" aria-hidden="true" />
            <p className="rd-dropzone-title">Drop a room capture here, or click to choose one</p>
            <p className="rd-dropzone-hint">
              You can also paste a screenshot with Ctrl+V. Auto-detect reads room captures and dimensioned plans,
              and measures the largest room in the picture; click another room to measure it. If it misreads a
              plan, switch to Trace walls and click the corners.
            </p>
          </Upload.Dragger>
        </Spin>
      </div>
    );
  }

  const trace = mode === 'trace';
  const lineOption = { value: LINE_LABEL, label: 'Line' };
  const faceOptions = [...faces.map(face => ({ value: face.label, label: face.label })), lineOption];
  const scaleReady = pxPerFt != null;
  // Without walls in Auto-detect there is nothing for a scale to measure
  const lineAvailable = trace || faces.length > 0;
  // The trace editor draws in natural pixels, the auto drawing in the detection's
  const lineView = trace ? 1 : workScale;
  const scaleLine: ScaleLineState = {
    points: line.map(p => scalePoint(p, lineView)),
    placing: placingLine,
    pxPerFt: trace ? tracePxPerFt : pxPerFt,
    selected: (trace ? traceSelected : formLabel) === LINE_LABEL,
    snapPoints: trace ? tracePoints : autoSnapPoints,
    onPlace: (a, b) => placeLine(scalePoint(a, 1 / lineView), scalePoint(b, 1 / lineView)),
    onMove: (index, p) => moveLineEnd(index, scalePoint(p, 1 / lineView)),
    onSelect: () => (trace ? pickSegment(LINE_LABEL) : pickFace(LINE_LABEL)),
  };

  return (
    <div className="rd-page">
      {header}
      <div className="rd-layout">
        <div>
          <div className="rd-modebar">
            <Segmented
              value={mode}
              onChange={value => {
                setMode(value as Mode);
                setHovered(null);
                setTraceHovered(null);
                setPlacingLine(false);
              }}
              options={[
                { label: 'Auto-detect', value: 'auto' },
                { label: 'Trace walls', value: 'trace' },
              ]}
            />
          </div>
          <div className="rd-toolbar">
            {trace && (
              <div className="rd-trace-actions" role="group" aria-label="Trace">
                <Button size="small" icon={<UndoOutlined />} onClick={undoTrace} disabled={!tracePoints.length}>
                  {traceClosed ? 'Reopen' : 'Undo'}
                </Button>
                <Button
                  size="small"
                  onClick={() => setTraceClosed(true)}
                  disabled={traceClosed || tracePoints.length < 3}
                >
                  Close loop
                </Button>
                <Button size="small" icon={<ClearOutlined />} onClick={resetTrace} disabled={!tracePoints.length}>
                  Clear
                </Button>
              </div>
            )}
            {!trace && view?.outline && (
              <Button size="small" icon={<EditOutlined />} onClick={editCorners}>
                Edit corners
              </Button>
            )}
            {lineAvailable && (
              <div className="rd-line-actions" role="group" aria-label="Scale line">
                <Button
                  size="small"
                  icon={<ColumnWidthOutlined />}
                  type={placingLine ? 'primary' : 'default'}
                  aria-pressed={placingLine}
                  onClick={() => setPlacingLine(on => !on)}
                >
                  {line.length ? 'Redraw line' : 'Draw line'}
                </Button>
                {line.length > 0 && (
                  <Button
                    type="text"
                    size="small"
                    className="ui-icon-btn"
                    icon={<CloseOutlined />}
                    aria-label="Remove line"
                    onClick={removeLine}
                  />
                )}
              </div>
            )}
            <div className="rd-zoom" role="group" aria-label="Zoom">
              <Button
                type="text"
                className="ui-icon-btn"
                icon={<ZoomOutOutlined />}
                aria-label="Zoom out"
                disabled={zoom === ZOOM_STEPS[0]}
                onClick={() => setZoom(ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(zoom) - 1)])}
              />
              <Button type="text" size="small" className="rd-zoom-value" onClick={() => setZoom(1)}>
                {zoom === 1 ? 'Fit' : `${zoom * 100}%`}
              </Button>
              <Button
                type="text"
                className="ui-icon-btn"
                icon={<ZoomInOutlined />}
                aria-label="Zoom in"
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(zoom) + 1)])}
              />
            </div>
          </div>
          <div className="rd-stage">
            {trace ? (
              <RoomTraceEditor
                imageUrl={capture.url}
                width={naturalSize.w}
                height={naturalSize.h}
                points={tracePoints}
                metrics={metrics}
                closed={traceClosed}
                pxPerFt={tracePxPerFt}
                zoom={zoom}
                selectedLabel={traceSelected}
                hoveredLabel={traceHovered}
                onAddPoint={addPoint}
                onMoveVertex={moveVertex}
                onRemoveVertex={removeVertex}
                onInsertVertex={insertVertex}
                onCloseLoop={() => setTraceClosed(true)}
                onSelectSegment={pickSegment}
                onHoverSegment={setTraceHovered}
                scaleLine={scaleLine}
              />
            ) : (
              detection &&
              view && (
                <RoomDimensionsDrawing
                  imageUrl={capture.url}
                  detection={view}
                  rooms={detection.rooms}
                  roomIndex={roomIndex}
                  onRoomPick={pickRoom}
                  pxPerFt={pxPerFt}
                  zoom={zoom}
                  selectedLabel={formLabel}
                  hoveredLabel={hovered}
                  onFaceClick={pickFace}
                  onFaceHover={setHovered}
                  scaleLine={lineAvailable ? scaleLine : undefined}
                />
              )
            )}
            {processing && (
              <div className="rd-processing">
                <Spin tip="Measuring walls…" />
              </div>
            )}
          </div>
        </div>

        <aside>
          {trace ? (
            <>
              <section className="ui-section">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Trace the room</h2>
                </div>
                <p className="rd-hint">
                  {placingLine
                    ? LINE_HINT
                    : traceClosed
                      ? 'Drag a corner to move it. Double-click a corner to remove it, or a wall to add a corner there. Pick any wall below, or draw a line between two points you know the distance of, and enter its real length to set the scale.'
                      : 'Click each corner of the room in order. Drag a corner to nudge it, and click the first corner (or Close loop) to join the outline. Then pick any wall below, or draw a line between two points you know the distance of, and enter its real length to set the scale.'}
                </p>
                <div className="rd-scale-form">
                  <Select
                    aria-label="Wall"
                    placeholder="Wall"
                    value={traceSelected ?? undefined}
                    onChange={pickSegment}
                    options={[...metrics.segments.map(s => ({ value: s.label, label: s.label })), lineOption]}
                  />
                  <InputNumber
                    ref={feetInputRef}
                    aria-label="Feet"
                    min={0}
                    precision={0}
                    inputMode="numeric"
                    addonAfter="ft"
                    value={formFt}
                    onChange={v => setFormFt(v)}
                    onPressEnter={applyScale}
                  />
                  <InputNumber
                    aria-label="Inches"
                    min={0}
                    max={11.99}
                    step={1}
                    inputMode="decimal"
                    addonAfter="in"
                    value={formIn}
                    onChange={v => setFormIn(v)}
                    onPressEnter={applyScale}
                  />
                  <Button type="primary" className="rd-scale-apply" onClick={applyScale}>
                    {tracePxPerFt ? 'Update scale' : 'Set scale'}
                  </Button>
                </div>
                {traceRef && traceReferencePx && tracePxPerFt && (
                  <div className="rd-scale-current">
                    {referenceName(traceRef)} = {lengthText(traceReferencePx, tracePxPerFt)}
                  </div>
                )}
              </section>

              {metrics.segments.length > 0 && (
                <section className="ui-section">
                  <div className="ui-section-head">
                    <h2 className="ui-section-title">Walls &amp; corners</h2>
                  </div>
                  <ul className="rd-faces">
                    {metrics.segments.map(seg => (
                      <li key={seg.label}>
                        <button
                          type="button"
                          className={`rd-face-row${seg.label === traceSelected ? ' is-selected' : ''}${
                            seg.label === traceHovered ? ' is-hovered' : ''
                          }`}
                          onClick={() => pickSegment(seg.label)}
                          onMouseEnter={() => setTraceHovered(seg.label)}
                          onMouseLeave={() => setTraceHovered(null)}
                        >
                          <span className="rd-face-letter">{seg.label}</span>
                          <span className="rd-face-length">{lengthText(seg.lengthPx, tracePxPerFt) ?? '—'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {metrics.vertices.some(v => v.angleDeg != null) && (
                    <ul className="rd-angles">
                      {metrics.vertices
                        .filter(v => v.angleDeg != null)
                        .map(v => (
                          <li
                            key={`ang-${v.index}`}
                            className={`rd-angle-row${v.isRightAngle ? '' : ' is-off'}`}
                          >
                            <span className="rd-angle-corner">
                              {v.fromLabel && v.toLabel ? `${v.fromLabel}–${v.toLabel}` : `#${v.index + 1}`}
                            </span>
                            <span className="rd-angle-value">{angleText(v.angleDeg)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
              )}

              {traceTotals && (
                <section className="ui-section">
                  <div className="ui-section-head">
                    <h2 className="ui-section-title">Room</h2>
                  </div>
                  <PropertyList
                    labelWidth={136}
                    items={[
                      { key: 'perimeter', label: 'Perimeter', value: traceTotals.perimeter },
                      { key: 'area', label: 'Floor area', value: traceTotals.area, hideEmpty: true },
                    ]}
                  />
                </section>
              )}
            </>
          ) : faces.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="No walls found in this image"
              description="Use a capture of one room with the walls as filled bands on a white background, or switch to Trace walls and click the corners by hand."
            />
          ) : (
            <>
              <section className="ui-section">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Scale</h2>
                </div>
                <p className="rd-hint">
                  {placingLine
                    ? LINE_HINT
                    : scaleReady
                      ? 'To correct the scale, pick any wall or draw a line, and enter its real length.'
                      : 'A capture has no scale. Pick a wall on the drawing or here, or draw a line between two points you know the distance of, and enter its real length; every other wall follows from it.'}
                </p>
                <div className="rd-scale-form">
                  <Select aria-label="Wall" value={formLabel ?? undefined} onChange={pickFace} options={faceOptions} />
                  <InputNumber
                    ref={feetInputRef}
                    aria-label="Feet"
                    min={0}
                    precision={0}
                    inputMode="numeric"
                    addonAfter="ft"
                    value={formFt}
                    onChange={v => setFormFt(v)}
                    onPressEnter={applyScale}
                  />
                  <InputNumber
                    aria-label="Inches"
                    min={0}
                    max={11.99}
                    step={1}
                    inputMode="decimal"
                    addonAfter="in"
                    value={formIn}
                    onChange={v => setFormIn(v)}
                    onPressEnter={applyScale}
                  />
                  <Button type="primary" className="rd-scale-apply" onClick={applyScale}>
                    {pxPerFt ? 'Update scale' : 'Set scale'}
                  </Button>
                </div>
                {reference && referencePx && pxPerFt && (
                  <div className="rd-scale-current">
                    {referenceName(reference, roomIndex)} = {lengthText(referencePx, pxPerFt)}
                  </div>
                )}
              </section>

              <section className="ui-section">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Walls</h2>
                </div>
                <p className="rd-hint">
                  {detection && detection.rooms.length > 1 && (
                    <>
                      Room {roomIndex + 1} of {detection.rooms.length}
                      {roomIndex === 0 ? ', the largest' : ''}. Click another room on the drawing to measure it.{' '}
                    </>
                  )}
                  If a wall is wrong, Edit corners lets you fix the outline by hand.
                </p>
                <ul className="rd-faces">
                  {faces.map(face => (
                    <li key={face.label}>
                      <button
                        type="button"
                        className={`rd-face-row${face.label === formLabel ? ' is-selected' : ''}${
                          face.label === hovered ? ' is-hovered' : ''
                        }`}
                        onClick={() => pickFace(face.label)}
                        onMouseEnter={() => setHovered(face.label)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        <span className="rd-face-letter">{face.label}</span>
                        <span className="rd-face-length">{lengthText(face.lengthPx, pxPerFt)}</span>
                      </button>
                    </li>
                  ))}
                  {view?.openings.map((opening, i) => (
                    <li key={`opening-${i}`}>
                      <div className="rd-face-row rd-face-row--static">
                        <span className="rd-face-name">Opening</span>
                        <span className="rd-face-length">{lengthText(opening.lengthPx, pxPerFt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {autoTotals && (
                <section className="ui-section">
                  <div className="ui-section-head">
                    <h2 className="ui-section-title">Room</h2>
                  </div>
                  <PropertyList
                    labelWidth={136}
                    items={[
                      { key: 'walls', label: 'Wall length', value: autoTotals.walls },
                      { key: 'openings', label: 'Openings', value: autoTotals.openings, hideEmpty: true },
                      { key: 'perimeter', label: 'Perimeter', value: autoTotals.perimeter },
                      { key: 'area', label: 'Floor area', value: autoTotals.area, hideEmpty: true },
                    ]}
                  />
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
};

export default RoomDimensions;
