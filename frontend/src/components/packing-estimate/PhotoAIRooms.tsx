/**
 * PhotoAIRooms - Photo AI mode for packing estimation
 * Upload room photos → Claude Vision AI analysis → item detection → estimate
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  Button, Select, Input, Tooltip, message, Upload, InputNumber,
  Popconfirm, Image, Table, Grid,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ScanOutlined, LoadingOutlined,
  CheckOutlined, CloseOutlined, ThunderboltOutlined, InboxOutlined,
  FolderOpenOutlined, StopOutlined, RightOutlined,
} from '@ant-design/icons';
import * as packingService from '../../services/packingEstimateService';
import type {
  PhotoRoom, DetectedContentItem, RoomPreset,
} from '../../types/packing-estimate';
import { ITEM_CATEGORIES } from '../../types/packing-estimate';
import {
  DENSITY_OPTIONS, FLOOR_OPTIONS, CONTAMINATION_OPTIONS,
} from './constants';
import FolderImportModal from './FolderImportModal';
import { Pill, type TagTone } from '../common/ui';
import { contaminationSelectLabel, multiplierSelectLabel } from './packingUi';
import './packing.css';

const { Option } = Select;
const { Dragger } = Upload;

interface PhotoAIRoomsProps {
  rooms: PhotoRoom[];
  setRooms: (rooms: PhotoRoom[]) => void;
}

function generateId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toDataUri(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/jpeg;base64,${base64}`;
}

const PhotoAIRooms: React.FC<PhotoAIRoomsProps> = ({ rooms, setRooms }) => {
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
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArr.length === 0) return;
    const base64List = await Promise.all(fileArr.map(fileToBase64));
    setPendingPhotos(prev => [...prev, ...base64List]);
  }, []);

  // ── Single Room Analysis ───────────────────

  const handleAnalyzeRoom = useCallback(async (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room || room.photos.length === 0) return;

    updateRoom(roomId, { analyzing: true });
    try {
      const result = await packingService.analyzeRoom(
        room.room_name,
        room.photos,
        room.items.length > 0
          ? room.items.map(i => ({ name: i.name, quantity: i.quantity }))
          : undefined,
      );
      setRooms(roomsRef.current.map(r => r.id === roomId ? {
        ...r,
        items: result.items,
        density: (result.density as PhotoRoom['density']) ?? room.density,
        room_size: result.room_size,
        confidence_score: result.confidence_score,
        field_notes: result.field_notes,
        analyzed: true,
        analyzing: false,
      } : r));
      message.success(`${room.room_name}: ${result.items.length} items detected`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      message.error(detail || 'Failed to analyze room');
      setRooms(roomsRef.current.map(r => r.id === roomId ? { ...r, analyzing: false } : r));
    }
  }, [rooms, updateRoom, setRooms]);

  // ── Batch Analysis ─────────────────────────

  const unanalyzedRooms = rooms.filter(r => !r.analyzed && r.photos.length > 0 && !r.analyzing);

  const handleStopBatch = useCallback(() => {
    cancelBatchRef.current = true;
    message.info('Stopping after current room completes...');
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
      unanalyzedRooms.some(u => u.id === r.id) ? { ...r, analyzing: true } : r
    ));

    for (const room of unanalyzedRooms) {
      if (cancelBatchRef.current) {
        // Reset all remaining rooms still in analyzing state
        setRooms(roomsRef.current.map(r =>
          r.analyzing && !r.analyzed ? { ...r, analyzing: false } : r
        ));
        break;
      }

      try {
        const result = await packingService.analyzeRoom(
          room.room_name,
          room.photos,
        );
        setRooms(roomsRef.current.map(r => r.id === room.id ? {
          ...r,
          items: result.items,
          density: (result.density as PhotoRoom['density']) ?? r.density,
          room_size: result.room_size,
          confidence_score: result.confidence_score,
          field_notes: result.field_notes,
          analyzed: true,
          analyzing: false,
        } : r));
      } catch {
        setRooms(roomsRef.current.map(r => r.id === room.id ? {
          ...r, analyzing: false,
        } : r));
      }
    }

    setBatchAnalyzing(false);
    if (cancelBatchRef.current) {
      message.warning('Analysis stopped');
    } else {
      message.success('Batch analysis complete');
    }
  }, [unanalyzedRooms, rooms, setRooms]);

  // ── Add more photos to existing room ───────

  const handleAddPhotosToRoom = useCallback(async (roomId: string, files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArr.length === 0) return;
    const base64List = await Promise.all(fileArr.map(fileToBase64));
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      updateRoom(roomId, {
        photos: [...room.photos, ...base64List],
        analyzed: false,
      });
    }
  }, [rooms, updateRoom]);

  // ── Item editing ───────────────────────────

  const updateItem = useCallback((roomId: string, idx: number, patch: Partial<DetectedContentItem>) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    const newItems = [...room.items];
    newItems[idx] = { ...newItems[idx], ...patch };
    updateRoom(roomId, { items: newItems });
  }, [rooms, updateRoom]);

  const removeItem = useCallback((roomId: string, idx: number) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    const newItems = room.items.filter((_, i) => i !== idx);
    updateRoom(roomId, { items: newItems });
  }, [rooms, updateRoom]);

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

      {rooms.length === 0 && !showAddRoom && (
        <p className="pk-empty-line">Add rooms with photos to start AI analysis.</p>
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
            onUpdateItem={(idx, patch) => updateItem(room.id, idx, patch)}
            onRemoveItem={(idx) => removeItem(room.id, idx)}
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
              accept="image/*"
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
                  multiple accept="image/*" showUploadList={false}
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
  onUpdateItem: (idx: number, patch: Partial<DetectedContentItem>) => void;
  onRemoveItem: (idx: number) => void;
}

/** How sure the AI is about the room, as a tone: sure is green, unsure is red */
const confidenceTone = (s: number): TagTone => {
  if (s >= 0.8) return 'green';
  if (s >= 0.6) return 'yellow';
  return 'red';
};

const RoomCard: React.FC<RoomCardProps> = ({
  room, presets, onAnalyze, onRemove, onUpdate, onAddPhotos,
  onUpdateItem, onRemoveItem,
}) => {
  const [showItems, setShowItems] = useState(room.analyzed);
  const fileRef = useRef<HTMLInputElement>(null);
  // Phones stack each detected item instead of clipping a four-column table
  const screens = Grid.useBreakpoint();
  const stackItems = !screens.sm;

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
            {!room.analyzing && !room.analyzed && room.photos.length > 0 && <Pill tone="gray">Not analyzed</Pill>}
            {room.confidence_score ? (
              <Pill tone={confidenceTone(room.confidence_score)} title="AI confidence">
                {Math.round(room.confidence_score * 100)}%
              </Pill>
            ) : null}
          </span>
          <span className="pk-room-meta">
            {room.photos.length} photo{room.photos.length !== 1 ? 's' : ''}
          </span>
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
          {room.analyzed && (
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
          ref={fileRef} type="file" accept="image/*" multiple hidden
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
          <Select size="small" value={room.density} onChange={v => onUpdate({ density: v })} labelRender={multiplierSelectLabel} popupMatchSelectWidth={false}>
            {DENSITY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
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
      {room.analyzed && room.items.length > 0 && (
        <>
          <button
            type="button"
            className="pk-items-toggle"
            onClick={() => setShowItems(v => !v)}
            aria-expanded={showItems}
          >
            <RightOutlined className={`pk-items-caret${showItems ? ' is-open' : ''}`} aria-hidden="true" />
            Detected Items ({room.items.length})
          </button>
          {showItems && stackItems && (
            <ul className="pk-item-rows">
              {room.items.map((item, idx) => (
                <li className="pk-item-row" key={`${room.id}_m_${idx}`}>
                  <div className="pk-item-row-main">
                    <span className="pk-item-name">
                      {item.name}
                      {item.is_fragile && <Pill tone="orange">Fragile</Pill>}
                      {item.is_high_value && <Pill tone="yellow">High Value</Pill>}
                    </span>
                    <Button
                      size="small" type="text"
                      className="ui-icon-btn ui-icon-btn--danger"
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveItem(idx)}
                      aria-label={`Remove ${item.name}`}
                    />
                  </div>
                  <div className="pk-item-row-controls">
                    <Select
                      size="small" value={item.category}
                      onChange={v => onUpdateItem(idx, { category: v })}
                      aria-label={`${item.name} category`}
                    >
                      {ITEM_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
                    </Select>
                    <InputNumber
                      size="small" min={1} value={item.quantity}
                      onChange={v => onUpdateItem(idx, { quantity: v || 1 })}
                      addonBefore="Qty"
                      aria-label={`${item.name} quantity`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showItems && !stackItems && (
            <Table
              className="pk-quiet-table pk-items-table"
              dataSource={room.items.map((item, i) => ({ ...item, _idx: i }))}
              rowKey={(_, i) => `${room.id}_${i}`}
              size="small"
              pagination={false}
              scroll={{ x: 460 }}
              columns={[
                {
                  title: 'Item', dataIndex: 'name', key: 'name',
                  render: (name: string, record: any) => (
                    <span className="pk-item-name">
                      {name}
                      {record.is_fragile && <Pill tone="orange">Fragile</Pill>}
                      {record.is_high_value && <Pill tone="yellow">High Value</Pill>}
                    </span>
                  ),
                },
                {
                  title: 'Category', dataIndex: 'category', key: 'category', width: 128,
                  render: (cat: string, record: any) => (
                    <Select
                      size="small" value={cat} style={{ width: '100%' }} variant="borderless"
                      onChange={v => onUpdateItem(record._idx, { category: v })}
                    >
                      {ITEM_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
                    </Select>
                  ),
                },
                {
                  title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 72,
                  render: (qty: number, record: any) => (
                    <InputNumber
                      size="small" min={1} value={qty}
                      onChange={v => onUpdateItem(record._idx, { quantity: v || 1 })}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: <span className="ui-sr-only">Remove</span>, key: 'actions', width: 40,
                  render: (_: any, record: any) => (
                    <Button
                      size="small" type="text"
                      className="ui-icon-btn ui-icon-btn--danger"
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveItem(record._idx)}
                      aria-label={`Remove ${record.name}`}
                    />
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </article>
  );
};

export default PhotoAIRooms;
