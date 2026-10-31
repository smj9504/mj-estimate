/**
 * PhotoAIRooms - Photo AI mode for packing estimation
 * Upload room photos → Claude Vision AI analysis → item detection → estimate
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  Button, Select, Input, Tooltip, message, Upload,
  Popconfirm, Image,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ScanOutlined, LoadingOutlined,
  CheckOutlined, CloseOutlined, ThunderboltOutlined, InboxOutlined,
  FolderOpenOutlined, StopOutlined, RightOutlined, PictureOutlined,
} from '@ant-design/icons';
import * as packingService from '../../services/packingEstimateService';
import type {
  PhotoRoom, DetectedContentItem, RoomPreset,
} from '../../types/packing-estimate';
import {
  DENSITY_OPTIONS, FLOOR_OPTIONS, CONTAMINATION_OPTIONS,
} from './constants';
import DetectedItemRow from './DetectedItemRow';
import FolderImportModal from './FolderImportModal';
import { Pill, type TagTone } from '../common/ui';
import {
  confirmItem, countedHours, editItem, mergePlan, needsPlan, newItem, planSignature, reviewCount, withUids,
} from './itemEdits';
import { contaminationSelectLabel, plainLabel } from './packingUi';
import { PHOTO_ACCEPT, photoFilesToBase64 } from './photoFiles';
import './packing.css';

const { Option } = Select;
const { Dragger } = Upload;

/**
 * Rooms Analyze All runs at once. Claude's limits leave plenty of room, but each
 * analysis can hold one of the server's 10 DB connections until it finishes.
 */
const PARALLEL_ANALYSES = 3;

interface PhotoAIRoomsProps {
  rooms: PhotoRoom[];
  setRooms: (rooms: PhotoRoom[]) => void;
  /** A claim's packing photos still loading into rooms */
  loading?: { done: number; total: number } | null;
  /** Runs Analyze All once each time it changes (rooms just loaded from a claim) */
  autoAnalyzeKey?: number;
  /** Opens Load from a claim: the photos picked for packing on a claim */
  onLoadFromClaim?: () => void;
}

function generateId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function toDataUri(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

/** Why an analysis failed, with what to do about it */
function analysisErrorText(err: any): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (err?.code === 'ECONNABORTED') return 'The analysis took too long. Try again.';
  if (!err?.response) return "Couldn't reach the server. Check the connection and try again.";
  return 'The analysis failed. Try again.';
}

const PhotoAIRooms: React.FC<PhotoAIRoomsProps> = ({
  rooms, setRooms, loading, autoAnalyzeKey, onLoadFromClaim,
}) => {
  const [presets, setPresets] = useState<Record<string, (RoomPreset & { key: string })[]>>({});
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPreset, setNewRoomPreset] = useState<string | undefined>();
  const [useCustomName, setUseCustomName] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);

  // Keep a ref to latest rooms for batch analysis callbacks
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  // Cancel flag for batch analysis
  const cancelBatchRef = useRef(false);

  React.useEffect(() => {
    packingService.getPresets().then(setPresets).catch(() => {});
  }, []);

  const allPresets = Object.values(presets).flat();

  const updateRoom = useCallback((id: string, patch: Partial<PhotoRoom>) => {
    setRooms(rooms.map(r => r.id === id ? { ...r, ...patch } : r));
  }, [rooms, setRooms]);

  const removeRoom = useCallback((id: string) => {
    setRooms(rooms.filter(r => r.id !== id));
  }, [rooms, setRooms]);

  // Analyses finish at their own times: each result goes on top of the last one,
  // not on the last render, or a result landing between renders would be lost
  const applyToRoom = useCallback((id: string, change: (room: PhotoRoom) => PhotoRoom) => {
    roomsRef.current = roomsRef.current.map(r => r.id === id ? change(r) : r);
    setRooms(roomsRef.current);
  }, [setRooms]);

  // ── Add Room ───────────────────────────────

  const handleAddRoom = useCallback(() => {
    const name = useCustomName
      ? newRoomName.trim()
      : allPresets.find(p => p.key === newRoomPreset)?.name ?? '';

    if (!name) {
      message.warning('Please select or enter a room name');
      return;
    }
    if (pendingPhotos.length === 0) {
      message.warning('Please upload at least one photo');
      return;
    }

    const room: PhotoRoom = {
      id: generateId(),
      room_name: name,
      preset_id: useCustomName ? undefined : newRoomPreset,
      floor: '1st',
      density: 'normal',
      contamination: 'clean',
      photos: [...pendingPhotos],
      items: [],
      analyzed: false,
      analyzing: false,
      field_notes: [],
      special_items: [],
      custom_special_items: [],
    };
    setRooms([...rooms, room]);
    setNewRoomName('');
    setNewRoomPreset(undefined);
    setPendingPhotos([]);
    setShowAddRoom(false);
  }, [useCustomName, newRoomName, newRoomPreset, pendingPhotos, rooms, setRooms, allPresets]);

  const handlePhotoFiles = useCallback(async (files: FileList | File[]) => {
    const base64List = await photoFilesToBase64(Array.from(files));
    if (base64List.length === 0) return;
    setPendingPhotos(prev => [...prev, ...base64List]);
  }, []);

  // ── Single Room Analysis ───────────────────

  const handleAnalyzeRoom = useCallback(async (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room || room.photos.length === 0) return;

    updateRoom(roomId, { analyzing: true, analysis_error: undefined });
    try {
      const result = await packingService.analyzeRoom(
        room.room_name,
        room.photos,
        room.items.length > 0
          ? room.items.map(i => ({ name: i.name, quantity: i.quantity }))
          : undefined,
      );
      // Told to skip what's already listed, it reports only what's new, so the
      // items and the decisions made on them stay
      applyToRoom(roomId, r => ({
        ...r,
        items: [...r.items, ...withUids(result.items)],
        density: (result.density as PhotoRoom['density']) ?? room.density,
        room_size: result.room_size,
        confidence_score: result.confidence_score,
        field_notes: result.field_notes,
        analyzed: true,
        analyzing: false,
      }));
      message.success(room.items.length > 0
        ? `${room.room_name}: ${result.items.length} more items detected`
        : `${room.room_name}: ${result.items.length} items detected`);
    } catch (err: any) {
      const reason = analysisErrorText(err);
      message.error(`${room.room_name}: ${reason}`);
      applyToRoom(roomId, r => ({ ...r, analyzing: false, analysis_error: reason }));
    }
  }, [rooms, updateRoom, applyToRoom]);

  // ── Batch Analysis ─────────────────────────

  const unanalyzedRooms = rooms.filter(r => !r.analyzed && r.photos.length > 0 && !r.analyzing);

  const handleStopBatch = useCallback(() => {
    cancelBatchRef.current = true;
    message.info('Stopping after the rooms in progress finish...');
  }, []);

  const handleBatchAnalyze = useCallback(async () => {
    if (unanalyzedRooms.length === 0) {
      message.warning('No unanalyzed rooms with photos');
      return;
    }

    cancelBatchRef.current = false;
    setBatchAnalyzing(true);
    // Mark all as analyzing
    setRooms(rooms.map(r =>
      unanalyzedRooms.some(u => u.id === r.id) ? { ...r, analyzing: true, analysis_error: undefined } : r
    ));

    const failed: string[] = [];
    const waiting = [...unanalyzedRooms];

    const analyzeNext = async () => {
      while (waiting.length > 0 && !cancelBatchRef.current) {
        const room = waiting.shift() as PhotoRoom;
        try {
          const result = await packingService.analyzeRoom(
            room.room_name,
            room.photos,
            room.items.length > 0
              ? room.items.map(i => ({ name: i.name, quantity: i.quantity }))
              : undefined,
          );
          applyToRoom(room.id, r => ({
            ...r,
            items: [...r.items, ...withUids(result.items)],
            density: (result.density as PhotoRoom['density']) ?? r.density,
            room_size: result.room_size,
            confidence_score: result.confidence_score,
            field_notes: result.field_notes,
            analyzed: true,
            analyzing: false,
          }));
        } catch (err) {
          failed.push(room.room_name);
          applyToRoom(room.id, r => ({
            ...r, analyzing: false, analysis_error: analysisErrorText(err),
          }));
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_ANALYSES }, analyzeNext));

    // Stopped: the rooms that never started are back to not analyzed
    waiting.forEach(room => applyToRoom(room.id, r => ({ ...r, analyzing: false })));

    setBatchAnalyzing(false);
    if (failed.length > 0) {
      message.error({
        content: `Couldn't analyze ${failed.join(', ')}. Each room shows why.`,
        duration: 10,
      });
    } else if (cancelBatchRef.current) {
      message.warning('Analysis stopped');
    } else {
      message.success('Batch analysis complete');
    }
  }, [unanalyzedRooms, rooms, setRooms, applyToRoom]);

  // Rooms loaded from a claim go straight into the analysis, once per load
  const autoAnalyzedRef = useRef<number | undefined>();
  React.useEffect(() => {
    if (!autoAnalyzeKey || autoAnalyzedRef.current === autoAnalyzeKey) return;
    autoAnalyzedRef.current = autoAnalyzeKey;
    handleBatchAnalyze();
  }, [autoAnalyzeKey, handleBatchAnalyze]);

  // ── Add more photos to existing room ───────

  const handleAddPhotosToRoom = useCallback(async (roomId: string, files: FileList | File[]) => {
    const base64List = await photoFilesToBase64(Array.from(files));
    if (base64List.length === 0) return;
    // HEIC conversion awaits the server, so read the rooms as they are now
    setRooms(roomsRef.current.map(r => r.id === roomId ? {
      ...r, photos: [...r.photos, ...base64List], analyzed: false,
    } : r));
  }, [setRooms]);

  // ── Item editing ───────────────────────────

  const changeItem = useCallback((
    roomId: string,
    uid: string,
    change: (item: DetectedContentItem) => DetectedContentItem,
  ) => {
    applyToRoom(roomId, r => ({
      ...r,
      items: r.items.map(i => i.uid === uid ? change(i) : i),
    }));
  }, [applyToRoom]);

  // Works out the item's packing method and labor again; the price itself is
  // worked out at Calculate, so a failed request here only leaves the hours stale
  const planItem = useCallback((roomId: string, item: DetectedContentItem) => {
    const signature = planSignature(item);
    packingService.planItem(item)
      .then(planned => changeItem(roomId, item.uid as string, current => mergePlan(current, signature, planned)))
      .catch(() => {});
  }, [changeItem]);

  const updateItem = useCallback((roomId: string, uid: string, patch: Partial<DetectedContentItem>) => {
    const item = roomsRef.current.find(r => r.id === roomId)?.items.find(i => i.uid === uid);
    if (!item) return;
    const edited = editItem(item, patch);
    changeItem(roomId, uid, () => edited);
    if (needsPlan(patch)) planItem(roomId, edited);
  }, [changeItem, planItem]);

  const removeItem = useCallback((roomId: string, uid: string) => {
    applyToRoom(roomId, r => ({
      ...r,
      items: r.items.filter(i => i.uid !== uid),
    }));
  }, [applyToRoom]);

  const addItem = useCallback((roomId: string) => {
    const item = newItem();
    applyToRoom(roomId, r => ({
      ...r,
      items: [...r.items, item],
    }));
    planItem(roomId, item);
  }, [applyToRoom, planItem]);

  // ── Bulk Room Import (from folder) ─────────

  const handleBulkAddRooms = useCallback((newRooms: PhotoRoom[]) => {
    setRooms([...rooms, ...newRooms]);
  }, [rooms, setRooms]);

  const closeAddRoom = () => { setShowAddRoom(false); setPendingPhotos([]); };

  // ── Render ─────────────────────────────────

  return (
    <section className="ui-section pk-rooms" aria-label="Photo AI Rooms">
      <div className="ui-section-head">
        <h2 className="ui-section-title">
          Photo AI Rooms <span className="pk-count">{rooms.length}</span>
        </h2>
        <div className="pk-section-actions">
          {onLoadFromClaim && (
            <Tooltip title="Load the photos picked for packing on a claim, room by room">
              <Button
                type="text"
                size="small"
                icon={<PictureOutlined />}
                onClick={onLoadFromClaim}
                disabled={!!loading || batchAnalyzing}
              >
                From Claim
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Import rooms from folder (each subfolder = 1 room)">
            <Button
              type="text"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => setFolderModalOpen(true)}
            >
              Import Folder
            </Button>
          </Tooltip>
          {batchAnalyzing ? (
            <Button type="text" size="small" icon={<StopOutlined />} onClick={handleStopBatch} className="pk-stop">
              Stop Analysis
            </Button>
          ) : unanalyzedRooms.length > 0 ? (
            <Button size="small" icon={<ThunderboltOutlined />} onClick={handleBatchAnalyze}>
              Analyze All ({unanalyzedRooms.length})
            </Button>
          ) : null}
        </div>
      </div>

      {loading && (
        <p className="pk-empty-line pk-loading-line" role="status">
          <LoadingOutlined aria-hidden="true" />
          {loading.total > 0
            ? `Loading the claim's packing photos... ${loading.done} of ${loading.total}`
            : "Loading the claim's packing photos..."}
        </p>
      )}

      {rooms.length === 0 && !showAddRoom && !loading && (
        <p className="pk-empty-line">
          Add rooms with photos to start AI analysis
          {onLoadFromClaim && (
            <>
              , or{' '}
              <button type="button" className="pk-text-link" onClick={onLoadFromClaim}>
                load the photos picked on a claim
              </button>
            </>
          )}
          .
        </p>
      )}

      <div className="pk-room-list">
        {rooms.map(room => (
          <RoomCard
            key={room.id}
            room={room}
            presets={allPresets}
            onAnalyze={() => handleAnalyzeRoom(room.id)}
            onRemove={() => removeRoom(room.id)}
            onUpdate={(patch) => updateRoom(room.id, patch)}
            onAddPhotos={(files) => handleAddPhotosToRoom(room.id, files)}
            onUpdateItem={(uid, patch) => updateItem(room.id, uid, patch)}
            onConfirmItem={(uid) => changeItem(room.id, uid, confirmItem)}
            onRemoveItem={(uid) => removeItem(room.id, uid)}
            onAddItem={() => addItem(room.id)}
          />
        ))}
      </div>

      {/* Add Room Panel */}
      {!showAddRoom ? (
        <button type="button" className="pk-add-row" onClick={() => setShowAddRoom(true)}>
          <PlusOutlined aria-hidden="true" /> Add a room with photos...
        </button>
      ) : (
        <div className="pk-composer" role="group" aria-label="Add Room">
          <div className="pk-composer-head">
            <span className="pk-composer-title">Add Room</span>
            <Button size="small" type="text" className="ui-icon-btn" icon={<CloseOutlined />} onClick={closeAddRoom} aria-label="Close" />
          </div>
          <div className="pk-composer-name">
            {useCustomName ? (
              <Input
                placeholder="Room name (e.g. Master Bedroom)"
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onPressEnter={handleAddRoom}
                autoFocus
              />
            ) : (
              <Select
                placeholder="Select a room"
                value={newRoomPreset}
                onChange={setNewRoomPreset}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="label"
              >
                {Object.entries(presets).map(([cat, list]) => (
                  <Select.OptGroup key={cat} label={cat}>
                    {list.map(p => (
                      <Option key={p.key} value={p.key} label={p.name}>
                        {p.name}
                      </Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>
            )}
            <Button onClick={() => setUseCustomName(v => !v)}>
              {useCustomName ? 'Preset' : 'Custom'}
            </Button>
          </div>

          {pendingPhotos.length === 0 ? (
            <Dragger
              className="pk-dragger"
              multiple
              accept={PHOTO_ACCEPT}
              showUploadList={false}
              // Called once per selected file, so add just that file
              beforeUpload={(file) => {
                handlePhotoFiles([file]);
                return false;
              }}
            >
              <InboxOutlined className="pk-drop-icon" aria-hidden="true" />
              <span className="pk-drop-title">Click or drag photos here</span>
            </Dragger>
          ) : (
            <>
              <div className="pk-photos">
                {pendingPhotos.map((p, i) => (
                  <div key={i} className="pk-photo">
                    <Image src={toDataUri(p)} width={72} height={72} preview={false} />
                    <button
                      type="button"
                      className="pk-photo-remove"
                      onClick={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                      aria-label="Remove photo"
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                ))}
                <Upload
                  multiple accept={PHOTO_ACCEPT} showUploadList={false}
                  beforeUpload={(file) => { handlePhotoFiles([file]); return false; }}
                >
                  <button type="button" className="pk-photo-add" aria-label="Add photos">
                    <PlusOutlined />
                  </button>
                </Upload>
              </div>
              <Button type="primary" onClick={handleAddRoom} block>
                Add Room ({pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''})
              </Button>
            </>
          )}
        </div>
      )}

      {/* Folder Import Modal */}
      <FolderImportModal
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        onRoomsCreated={handleBulkAddRooms}
        existingRoomNames={rooms.map(r => r.room_name)}
      />
    </section>
  );
};

// ── Room Card Component ──────────────────────

interface RoomCardProps {
  room: PhotoRoom;
  presets: (RoomPreset & { key: string })[];
  onAnalyze: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<PhotoRoom>) => void;
  onAddPhotos: (files: FileList | File[]) => void;
  onUpdateItem: (uid: string, patch: Partial<DetectedContentItem>) => void;
  onConfirmItem: (uid: string) => void;
  onRemoveItem: (uid: string) => void;
  onAddItem: () => void;
}

/** How sure the AI is about the room, as a tone: sure is green, unsure is red */
const confidenceTone = (s: number): TagTone => {
  if (s >= 0.8) return 'green';
  if (s >= 0.6) return 'yellow';
  return 'red';
};

const RoomCard: React.FC<RoomCardProps> = ({
  room, presets, onAnalyze, onRemove, onUpdate, onAddPhotos,
  onUpdateItem, onConfirmItem, onRemoveItem, onAddItem,
}) => {
  const [showItems, setShowItems] = useState(room.analyzed);
  const fileRef = useRef<HTMLInputElement>(null);
  const toReview = reviewCount(room.items);

  // Open the items the first time an analysis lands
  React.useEffect(() => {
    if (room.analyzed) setShowItems(true);
  }, [room.analyzed]);

  return (
    <article className="pk-room" aria-label={room.room_name}>
      <div className="pk-room-bar">
        <div className="pk-room-head">
          <span className="pk-room-title">
            {room.room_name}
            {room.analyzing && <Pill tone="blue" icon={<LoadingOutlined />}>Analyzing...</Pill>}
            {!room.analyzing && room.analyzed && (
              <Pill tone="green" icon={<CheckOutlined />}>{room.items.length} items</Pill>
            )}
            {toReview > 0 && <Pill tone="yellow">{toReview} to review</Pill>}
            {!room.analyzing && !room.analyzed && room.analysis_error && (
              <Pill tone="red">Analysis failed</Pill>
            )}
            {!room.analyzing && !room.analyzed && !room.analysis_error && room.photos.length > 0 && <Pill tone="gray">Not analyzed</Pill>}
            {room.confidence_score ? (
              <Pill tone={confidenceTone(room.confidence_score)} title="AI confidence">
                {Math.round(room.confidence_score * 100)}%
              </Pill>
            ) : null}
          </span>
          <span className="pk-room-meta">
            {room.photos.length} photo{room.photos.length !== 1 ? 's' : ''}
          </span>
          {!room.analyzing && !room.analyzed && room.analysis_error && (
            <span className="pk-room-error">{room.analysis_error}</span>
          )}
        </div>
        <div className="pk-room-actions">
          {!room.analyzed && room.photos.length > 0 && (
            <Button
              size="small"
              icon={<ScanOutlined />}
              onClick={onAnalyze}
              loading={room.analyzing}
            >
              Analyze
            </Button>
          )}
          {room.analyzed && room.photos.length > 0 && (
            <Button size="small" type="text" icon={<ScanOutlined />} onClick={onAnalyze} loading={room.analyzing}>
              Re-analyze
            </Button>
          )}
          <Popconfirm title="Remove this room?" onConfirm={onRemove} okButtonProps={{ danger: true }} okText="Remove">
            <Button
              size="small"
              type="text"
              className="ui-icon-btn ui-icon-btn--danger"
              icon={<DeleteOutlined />}
              aria-label={`Remove ${room.room_name}`}
            />
          </Popconfirm>
        </div>
      </div>

      {/* Photos strip */}
      <div className="pk-photos">
        {room.photos.map((p, i) => (
          <div key={i} className="pk-photo">
            <Image src={toDataUri(p)} width={72} height={72} />
            <button
              type="button"
              className="pk-photo-remove"
              onClick={() => {
                const newPhotos = room.photos.filter((_, idx) => idx !== i);
                onUpdate({ photos: newPhotos, analyzed: false });
              }}
              aria-label="Remove photo"
            >
              <CloseOutlined />
            </button>
          </div>
        ))}
        <button type="button" className="pk-photo-add" onClick={() => fileRef.current?.click()} aria-label="Add photos">
          <PlusOutlined />
        </button>
        <input
          ref={fileRef} type="file" accept={PHOTO_ACCEPT} multiple hidden
          onChange={e => { if (e.target.files) onAddPhotos(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Room settings */}
      <div className="pk-room-settings">
        <label className="pk-field">
          <span className="pk-field-label">Floor</span>
          <Select size="small" value={room.floor} onChange={v => onUpdate({ floor: v })} popupMatchSelectWidth={false}>
            {FLOOR_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </label>
        <label className="pk-field">
          <span className="pk-field-label">Density</span>
          {/* Priced item by item, so density weighs only what the photos can't show */}
          <Select size="small" value={room.density} onChange={v => onUpdate({ density: v })} popupMatchSelectWidth={false}>
            {DENSITY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{plainLabel(o.label)}</Option>)}
          </Select>
        </label>
        <label className="pk-field">
          <span className="pk-field-label">Contamination</span>
          <Select size="small" value={room.contamination} onChange={v => onUpdate({ contamination: v })} labelRender={contaminationSelectLabel} popupMatchSelectWidth={false}>
            {CONTAMINATION_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </label>
      </div>

      {/* Field notes */}
      {room.field_notes && room.field_notes.length > 0 && (
        <ul className="pk-field-notes">
          {room.field_notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {/* Detected items */}
      {room.analyzed && (
        <>
          <button
            type="button"
            className="pk-items-toggle"
            onClick={() => setShowItems(v => !v)}
            aria-expanded={showItems}
          >
            <RightOutlined className={`pk-items-caret${showItems ? ' is-open' : ''}`} aria-hidden="true" />
            Detected Items ({room.items.length})
            {room.items.length > 0 && (
              <span className="pk-items-hours" title="Labor for these items, pack-out and pack-back">
                {countedHours(room.items).toFixed(1)} hr
              </span>
            )}
          </button>
          {showItems && (
            <>
              <ul className="pk-item-rows">
                {room.items.map(item => (
                  <DetectedItemRow
                    key={item.uid}
                    item={item}
                    onChange={patch => onUpdateItem(item.uid as string, patch)}
                    onConfirm={() => onConfirmItem(item.uid as string)}
                    onRemove={() => onRemoveItem(item.uid as string)}
                  />
                ))}
              </ul>
              <button type="button" className="pk-add-row pk-add-item" onClick={onAddItem}>
                <PlusOutlined aria-hidden="true" /> Add an item the photos missed...
              </button>
            </>
          )}
        </>
      )}
    </article>
  );
};

export default PhotoAIRooms;
