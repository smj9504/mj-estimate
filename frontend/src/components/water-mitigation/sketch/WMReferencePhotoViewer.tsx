/**
 * WMReferencePhotoViewer
 *
 * Draggable, resizable floating mini-window that shows the job's photos
 * (e.g. CompanyCam demolition photos) while the user draws on the sketch
 * canvas. Deliberately NOT part of the canvas itself — the sketch stays
 * clean and print/export-ready; this is a transient on-screen aid only.
 *
 * Usage:
 *   <WMReferencePhotoViewer jobId={jobId} onClose={() => setShowPhotos(false)} />
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Spin, Empty, Select, Typography, Tooltip } from 'antd';
import {
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  PictureOutlined,
  DragOutlined,
} from '@ant-design/icons';
import { useWaterMitigationPhotos, type WMPhoto } from '../../../hooks/useWaterMitigationPhotos';
import wmSketchService from '../../../services/wmSketchService';

const { Text } = Typography;

export interface WMReferencePhotoViewerProps {
  jobId: string;
  onClose: () => void;
}

const DEFAULT_SIZE = { width: 320, height: 380 };
const MIN_SIZE = { width: 220, height: 220 };
const HEADER_HEIGHT = 32;
const FILMSTRIP_HEIGHT = 56;

const WMReferencePhotoViewer: React.FC<WMReferencePhotoViewerProps> = ({ jobId, onClose }) => {
  const { data: photos = [], isLoading } = useWaterMitigationPhotos(jobId);

  const categories = useMemo(() => {
    const set = new Set<string>();
    photos.forEach((p) => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [photos]);

  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);

  // Level list sourced from the job's floor sketches, so it always matches
  // the same floor names used when sketching (not an independent list).
  const [levelOptions, setLevelOptions] = useState<string[]>([]);
  useEffect(() => {
    wmSketchService.getFloorSketches(jobId)
      .then((floors) => {
        const sorted = [...floors].sort((a, b) => a.floor_order - b.floor_order);
        setLevelOptions(sorted.map((f) => f.floor_label));
      })
      .catch(() => {});
  }, [jobId]);

  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [roomFilter, setRoomFilter] = useState<string | undefined>(undefined);

  // Room options are scoped to the currently-selected level (progressive
  // disclosure - narrows as the user picks a level first).
  const roomOptions = useMemo(() => {
    const scoped = levelFilter
      ? photos.filter((p) => p.location_level === levelFilter)
      : photos;
    const set = new Set<string>();
    scoped.forEach((p) => { if (p.location_room) set.add(p.location_room); });
    return Array.from(set).sort();
  }, [photos, levelFilter]);

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (categoryFilter) result = result.filter((p) => p.category === categoryFilter);
    if (levelFilter) result = result.filter((p) => p.location_level === levelFilter);
    if (roomFilter) result = result.filter((p) => p.location_room === roomFilter);
    return result;
  }, [photos, categoryFilter, levelFilter, roomFilter]);

  const [activeIndex, setActiveIndex] = useState(0);
  const activePhoto: WMPhoto | undefined = filteredPhotos[activeIndex];

  // ------------------------------------------------------------------
  // Drag (move) + resize — plain pointer-event math, no canvas library
  // needed here since this window floats above the Konva stage in the DOM.
  // ------------------------------------------------------------------
  const [pos, setPos] = useState({ x: 24, y: 64 });
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }, [pos]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { startX, startY, origX, origY } = dragRef.current;
    setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
  }, []);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height };
  }, [size]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const { startX, startY, origW, origH } = resizeRef.current;
    setSize({
      width: Math.max(MIN_SIZE.width, origW + (e.clientX - startX)),
      height: Math.max(MIN_SIZE.height, origH + (e.clientY - startY)),
    });
  }, []);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    resizeRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i <= 0 ? filteredPhotos.length - 1 : i - 1));
  }, [filteredPhotos.length]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i >= filteredPhotos.length - 1 ? 0 : i + 1));
  }, [filteredPhotos.length]);

  const imageAreaHeight = size.height - HEADER_HEIGHT - FILMSTRIP_HEIGHT;

  return (
    <div
      data-testid="wm-reference-photo-viewer"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height,
        zIndex: 50,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        border: '1px solid #d9d9d9',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        style={{
          height: HEADER_HEIGHT,
          flexShrink: 0,
          background: '#1677ff',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <DragOutlined style={{ fontSize: 12, opacity: 0.85 }} />
        <PictureOutlined style={{ fontSize: 13 }} />
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 600, flex: 1 }}>
          Reference Photos {filteredPhotos.length > 0 ? `(${activeIndex + 1}/${filteredPhotos.length})` : ''}
        </Text>
        {levelOptions.length > 0 && (
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Select
              size="small"
              value={levelFilter}
              onChange={(v) => { setLevelFilter(v); setRoomFilter(undefined); setActiveIndex(0); }}
              placeholder="Level"
              allowClear
              style={{ width: 70 }}
              options={levelOptions.map((lvl) => ({ value: lvl, label: lvl }))}
            />
          </div>
        )}
        {levelFilter && roomOptions.length > 0 && (
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Select
              size="small"
              value={roomFilter}
              onChange={(v) => { setRoomFilter(v); setActiveIndex(0); }}
              placeholder="Room"
              allowClear
              style={{ width: 70 }}
              options={roomOptions.map((r) => ({ value: r, label: r }))}
            />
          </div>
        )}
        {categories.length > 0 && (
          <div onPointerDown={(e) => e.stopPropagation()}>
            <Select
              size="small"
              value={categoryFilter}
              onChange={(v) => { setCategoryFilter(v); setActiveIndex(0); }}
              placeholder="All"
              allowClear
              style={{ width: 80 }}
              options={categories.map((c) => ({ value: c, label: c }))}
            />
          </div>
        )}
        <CloseOutlined
          style={{ fontSize: 13, cursor: 'pointer', padding: 4 }}
          onClick={onClose}
        />
      </div>

      {/* Main image area */}
      <div
        style={{
          height: imageAreaHeight,
          flexShrink: 0,
          position: 'relative',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {isLoading ? (
          <Spin />
        ) : !activePhoto ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text style={{ color: '#bfbfbf', fontSize: 12 }}>No photos found</Text>}
          />
        ) : (
          <>
            <img
              src={activePhoto.preview_url || activePhoto.thumbnail_url}
              alt={activePhoto.caption || 'Reference photo'}
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                userSelect: 'none',
              }}
            />
            {filteredPhotos.length > 1 && (
              <>
                <Tooltip title="Previous photo">
                  <div
                    onClick={goPrev}
                    style={{
                      position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                      width: 26, height: 26, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.5)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <LeftOutlined style={{ fontSize: 12 }} />
                  </div>
                </Tooltip>
                <Tooltip title="Next photo">
                  <div
                    onClick={goNext}
                    style={{
                      position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                      width: 26, height: 26, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.5)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <RightOutlined style={{ fontSize: 12 }} />
                  </div>
                </Tooltip>
              </>
            )}
          </>
        )}
      </div>

      {/* Filmstrip */}
      <div
        style={{
          height: FILMSTRIP_HEIGHT,
          flexShrink: 0,
          display: 'flex',
          gap: 4,
          padding: 4,
          overflowX: 'auto',
          overflowY: 'hidden',
          background: '#fafafa',
          borderTop: '1px solid #f0f0f0',
        }}
      >
        {filteredPhotos.map((p, i) => (
          <img
            key={p.id}
            src={p.thumbnail_url || p.preview_url}
            alt=""
            draggable={false}
            onClick={() => setActiveIndex(i)}
            style={{
              height: '100%',
              aspectRatio: '1',
              objectFit: 'cover',
              borderRadius: 4,
              cursor: 'pointer',
              flexShrink: 0,
              border: i === activeIndex ? '2px solid #1677ff' : '2px solid transparent',
            }}
          />
        ))}
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          touchAction: 'none',
          background: 'linear-gradient(135deg, transparent 50%, #bfbfbf 50%)',
        }}
      />
    </div>
  );
};

export default WMReferencePhotoViewer;
