/**
 * Room Dimensions — inside wall lengths from a room sketch capture.
 *
 * Drop, pick or paste a screenshot of one room (Xactimate, MagicPlan…). Two
 * ways to measure it:
 *
 *  • Auto-detect finds the walls from the pixels and letters every inside
 *    face. It wants a clean capture — one room, walls as filled bands.
 *  • Trace walls is for a busy, fully dimensioned plan the pixels can't be
 *    read from: click the corners and the tool gives each wall run's length
 *    and each corner's angle, flagging the ones that are not square.
 *
 * Either way a capture has no scale of its own, so the user gives one wall's
 * real length and every other length follows from it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Segmented, Select, Spin, Upload, message } from 'antd';
import {
  BorderOuterOutlined,
  ClearOutlined,
  DownloadOutlined,
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
import { lengthText, renderDrawingPng, renderTracePng } from '../components/room-dimensions/roomDrawing';
import { detectRoomFaces, type Point, type RoomDetection } from '../utils/roomDimensions';
import { angleText, traceMetrics } from '../utils/roomTrace';
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
}

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

const RoomDimensions: React.FC = () => {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [detection, setDetection] = useState<RoomDetection | null>(null);
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

  const urlRef = useRef<string | null>(null);
  const feetInputRef = useRef<InputNumberRef>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const resetTrace = () => {
    setTracePoints([]);
    setTraceClosed(false);
    setTraceSelected(null);
    setTraceRef(null);
    setTraceHovered(null);
  };

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
      setReference(null);
      setHovered(null);
      setZoom(1);
      resetTrace();
      // A busy, over-dimensioned plan yields a storm of spurious faces; trace it by hand instead
      setMode(result.faces.length === 0 || result.faces.length > AUTO_FACE_CEILING ? 'trace' : 'auto');
      // Suggest the longest wall: the one most likely to have a known length
      const longest = result.faces.reduce<RoomDetection['faces'][number] | null>(
        (best, face) => (!best || face.lengthPx > best.lengthPx ? face : best),
        null,
      );
      setFormLabel(longest?.label ?? null);
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
  const faces = useMemo(() => detection?.faces ?? [], [detection]);
  const referenceFace = reference ? faces.find(f => f.label === reference.label) : undefined;
  const pxPerFt = referenceFace && reference ? referenceFace.lengthPx / reference.feet : null;

  const pickFace = useCallback(
    (label: string) => {
      setFormLabel(label);
      const face = faces.find(f => f.label === label);
      if (face && pxPerFt) {
        const { ft, inches } = splitFeet(face.lengthPx / pxPerFt);
        setFormFt(ft);
        setFormIn(inches);
      } else {
        setFormFt(null);
        setFormIn(null);
      }
      feetInputRef.current?.focus();
    },
    [faces, pxPerFt],
  );

  // ── Trace walls scale ─────────────────────────────────────────────
  const naturalSize = capture ? { w: capture.image.naturalWidth, h: capture.image.naturalHeight } : { w: 1, h: 1 };
  const metrics = useMemo(() => traceMetrics(tracePoints, traceClosed), [tracePoints, traceClosed]);
  const traceReferenceSeg = traceRef ? metrics.segments.find(s => s.label === traceRef.label) : undefined;
  const tracePxPerFt = traceReferenceSeg && traceRef ? traceReferenceSeg.lengthPx / traceRef.feet : null;

  const pickSegment = useCallback(
    (label: string) => {
      setTraceSelected(label);
      const seg = metrics.segments.find(s => s.label === label);
      if (seg && tracePxPerFt) {
        const { ft, inches } = splitFeet(seg.lengthPx / tracePxPerFt);
        setFormFt(ft);
        setFormIn(inches);
      } else {
        setFormFt(null);
        setFormIn(null);
      }
      feetInputRef.current?.focus();
    },
    [metrics.segments, tracePxPerFt],
  );

  const addPoint = useCallback((p: Point) => setTracePoints(prev => [...prev, p]), []);
  const moveVertex = useCallback(
    (index: number, p: Point) => setTracePoints(prev => prev.map((q, i) => (i === index ? p : q))),
    [],
  );
  const undoTrace = () => {
    if (traceClosed) {
      setTraceClosed(false);
    } else {
      setTracePoints(prev => prev.slice(0, -1));
    }
    setTraceSelected(null);
    setTraceRef(null);
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
    setReference({ label: formLabel, feet });
  };

  const download = async () => {
    if (!capture) return;
    setDownloading(true);
    try {
      const blob =
        mode === 'trace'
          ? await renderTracePng(capture.image, naturalSize.w, naturalSize.h, metrics, tracePoints, tracePxPerFt)
          : detection
            ? await renderDrawingPng(capture.image, detection, pxPerFt)
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
    if (!detection || !pxPerFt) return null;
    const walls = detection.faces.reduce((sum, f) => sum + f.lengthPx, 0);
    const openings = detection.openings.reduce((sum, o) => sum + o.lengthPx, 0);
    return {
      walls: lengthText(walls, pxPerFt),
      openings: detection.openings.length ? lengthText(openings, pxPerFt) : null,
      perimeter: lengthText(walls + openings, pxPerFt),
      area:
        detection.areaPx != null
          ? `${(detection.areaPx / (pxPerFt * pxPerFt)).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} SF`
          : null,
    };
  }, [detection, pxPerFt]);

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
              You can also paste a screenshot with Ctrl+V. Auto-detect works best with one room, walls drawn as
              filled bands on a white background; for a busy, dimensioned plan, switch to Trace walls and click the
              corners.
            </p>
          </Upload.Dragger>
        </Spin>
      </div>
    );
  }

  const trace = mode === 'trace';
  const faceOptions = faces.map(face => ({ value: face.label, label: face.label }));
  const scaleReady = pxPerFt != null;

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
                onCloseLoop={() => setTraceClosed(true)}
                onSelectSegment={pickSegment}
                onHoverSegment={setTraceHovered}
              />
            ) : (
              detection && (
                <RoomDimensionsDrawing
                  imageUrl={capture.url}
                  detection={detection}
                  pxPerFt={pxPerFt}
                  zoom={zoom}
                  selectedLabel={formLabel}
                  hoveredLabel={hovered}
                  onFaceClick={pickFace}
                  onFaceHover={setHovered}
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
                  Click each corner of the room in order. Drag a corner to nudge it, and click the first corner (or
                  Close loop) to join the outline. Then pick any wall below and enter its real length to set the
                  scale.
                </p>
                <div className="rd-scale-form">
                  <Select
                    aria-label="Wall"
                    placeholder="Wall"
                    value={traceSelected ?? undefined}
                    onChange={pickSegment}
                    disabled={!metrics.segments.length}
                    options={metrics.segments.map(s => ({ value: s.label, label: s.label }))}
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
                {traceRef && traceReferenceSeg && tracePxPerFt && (
                  <div className="rd-scale-current">
                    Wall {traceRef.label} = {lengthText(traceReferenceSeg.lengthPx, tracePxPerFt)}
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
                  {scaleReady
                    ? 'To correct the scale, pick any wall and enter its real length.'
                    : 'A capture has no scale. Pick a wall on the drawing or here and enter its real length; every other wall follows from it.'}
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
                {reference && pxPerFt && (
                  <div className="rd-scale-current">
                    Wall {reference.label} = {lengthText(referenceFace!.lengthPx, pxPerFt)}
                  </div>
                )}
              </section>

              <section className="ui-section">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Walls</h2>
                </div>
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
                  {detection?.openings.map((opening, i) => (
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
