/**
 * Room Dimensions — inside wall lengths from a room sketch capture.
 *
 * Drop, pick or paste a screenshot of one room (Xactimate, MagicPlan…). The
 * walls are found in the browser and every inside face is lettered. A capture
 * has no scale of its own, so the user gives the real length of one wall and
 * every other length follows from it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, InputNumber, Select, Spin, Upload, message } from 'antd';
import { BorderOuterOutlined, DownloadOutlined, UploadOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { saveAs } from 'file-saver';
import type { InputNumberRef } from 'rc-input-number';
import { PageHeader, PropertyList } from '../components/common/ui';
import RoomDimensionsDrawing from '../components/room-dimensions/RoomDimensionsDrawing';
import { lengthText, renderDrawingPng } from '../components/room-dimensions/roomDrawing';
import { detectRoomFaces, type RoomDetection } from '../utils/roomDimensions';
import '../components/room-dimensions/roomDimensions.css';

/** Larger captures are measured at this size; the scale is set on the same pixels, so lengths are unaffected */
const MAX_WORKING_SIZE = 2000;
/** Drawing sizes relative to fitting the stage; labels keep their size, so zooming in pulls crowded ones apart */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

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
  const [processing, setProcessing] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [formLabel, setFormLabel] = useState<string | null>(null);
  const [formFt, setFormFt] = useState<number | null>(null);
  const [formIn, setFormIn] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const urlRef = useRef<string | null>(null);
  const feetInputRef = useRef<InputNumberRef>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
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
      setReference(null);
      setHovered(null);
      setZoom(1);
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

  const applyScale = () => {
    const feet = (formFt ?? 0) + (formIn ?? 0) / 12;
    if (!formLabel || feet <= 0) {
      message.warning('Pick a wall and enter its length.');
      return;
    }
    setReference({ label: formLabel, feet });
  };

  const download = async () => {
    if (!capture || !detection) return;
    setDownloading(true);
    try {
      const blob = await renderDrawingPng(capture.image, detection, pxPerFt);
      const base = capture.name.replace(/\.[^.]+$/, '') || 'room';
      saveAs(blob, `${base}-dimensions.png`);
    } catch {
      message.error("Couldn't create the image.");
    } finally {
      setDownloading(false);
    }
  };

  const totals = useMemo(() => {
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

  const chooseFile = (file: File) => {
    loadCapture(file, file.name);
    return false; // measured here, never uploaded
  };

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
            <Button icon={<DownloadOutlined />} onClick={download} loading={downloading} disabled={!faces.length}>
              Download PNG
            </Button>
          </>
        )
      }
    />
  );

  if (!capture || !detection) {
    return (
      <div className="rd-page">
        {header}
        <Spin spinning={processing} tip="Measuring walls…">
          <Upload.Dragger className="rd-dropzone" accept="image/*" showUploadList={false} beforeUpload={chooseFile}>
            <BorderOuterOutlined className="rd-dropzone-icon" aria-hidden="true" />
            <p className="rd-dropzone-title">Drop a room capture here, or click to choose one</p>
            <p className="rd-dropzone-hint">
              You can also paste a screenshot with Ctrl+V. Works best with one room, walls drawn as filled bands on
              a white background, as in Xactimate or MagicPlan.
            </p>
          </Upload.Dragger>
        </Spin>
      </div>
    );
  }

  const faceOptions = faces.map(face => ({
    value: face.label,
    label: face.label,
  }));

  return (
    <div className="rd-page">
      {header}
      <div className="rd-layout">
        <div>
          <div className="rd-toolbar" role="group" aria-label="Zoom">
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
          <div className="rd-stage">
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
            {processing && (
              <div className="rd-processing">
                <Spin tip="Measuring walls…" />
              </div>
            )}
          </div>
        </div>

        <aside>
          {faces.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message="No walls found in this image"
              description="Use a capture of one room with the walls drawn as filled bands on a white background, and crop away toolbars and other rooms."
            />
          ) : (
            <>
              <section className="ui-section">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Scale</h2>
                </div>
                <p className="rd-hint">
                  {pxPerFt
                    ? 'To correct the scale, pick any wall and enter its real length.'
                    : 'A capture has no scale. Pick a wall on the drawing or here and enter its real length; every other wall follows from it.'}
                </p>
                <div className="rd-scale-form">
                  <Select
                    aria-label="Wall"
                    value={formLabel ?? undefined}
                    onChange={pickFace}
                    options={faceOptions}
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
                  {detection.openings.map((opening, i) => (
                    <li key={`opening-${i}`}>
                      <div className="rd-face-row rd-face-row--static">
                        <span className="rd-face-name">Opening</span>
                        <span className="rd-face-length">{lengthText(opening.lengthPx, pxPerFt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {totals && (
                <section className="ui-section">
                  <div className="ui-section-head">
                    <h2 className="ui-section-title">Room</h2>
                  </div>
                  <PropertyList
                    labelWidth={136}
                    items={[
                      { key: 'walls', label: 'Wall length', value: totals.walls },
                      { key: 'openings', label: 'Openings', value: totals.openings, hideEmpty: true },
                      { key: 'perimeter', label: 'Perimeter', value: totals.perimeter },
                      { key: 'area', label: 'Floor area', value: totals.area, hideEmpty: true },
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
