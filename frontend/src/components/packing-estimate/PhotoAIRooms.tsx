/**
 * PhotoAIRooms - Photo AI mode for packing estimation
 * Upload room photos → Claude Vision AI analysis → item detection → estimate
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  Card, Button, Select, Input, Space, Tag, Tooltip, message,
  Typography, Row, Col, Upload, Badge, Collapse, InputNumber,
  Popconfirm, Progress, Image, Table, Empty, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CameraOutlined, ScanOutlined,
  StarOutlined, WarningOutlined, LoadingOutlined, EditOutlined,
  CheckOutlined, CloseOutlined, ThunderboltOutlined, InboxOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import * as packingService from '../../services/packingEstimateService';
import type {
  PhotoRoom, DetectedContentItem, RoomPreset,
} from '../../types/packing-estimate';
import { ITEM_CATEGORIES } from '../../types/packing-estimate';
import {
  DENSITY_OPTIONS, FLOOR_OPTIONS, CONTAMINATION_OPTIONS,
} from './constants';

const { Text, Title } = Typography;
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
  const [editingItem, setEditingItem] = useState<{
    roomId: string; idx: number; field: string;
  } | null>(null);

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
      updateRoom(roomId, {
        items: result.items,
        density: (result.density as PhotoRoom['density']) ?? room.density,
        room_size: result.room_size,
        confidence_score: result.confidence_score,
        field_notes: result.field_notes,
        analyzed: true,
        analyzing: false,
      });
      message.success(`${room.room_name}: ${result.items.length} items detected`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      message.error(detail || 'Failed to analyze room');
      updateRoom(roomId, { analyzing: false });
    }
  }, [rooms, updateRoom]);

  // ── Batch Analysis ─────────────────────────

  const unanalyzedRooms = rooms.filter(r => !r.analyzed && r.photos.length > 0 && !r.analyzing);

  const handleBatchAnalyze = useCallback(async () => {
    if (unanalyzedRooms.length === 0) {
      message.warning('No unanalyzed rooms with photos');
      return;
    }

    setBatchAnalyzing(true);
    // Mark all as analyzing
    setRooms(rooms.map(r =>
      unanalyzedRooms.some(u => u.id === r.id) ? { ...r, analyzing: true } : r
    ));

    for (const room of unanalyzedRooms) {
      try {
        const result = await packingService.analyzeRoom(
          room.room_name,
          room.photos,
        );
        setRooms(prev => prev.map(r => r.id === room.id ? {
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
        setRooms(prev => prev.map(r => r.id === room.id ? {
          ...r, analyzing: false,
        } : r));
      }
    }
    setBatchAnalyzing(false);
    message.success('Batch analysis complete');
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

  // ── Render ─────────────────────────────────

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* Header */}
      <Row justify="space-between" align="middle">
        <Col>
          <Title level={5} style={{ margin: 0 }}>
            <CameraOutlined /> Photo AI Rooms ({rooms.length})
          </Title>
        </Col>
        <Col>
          <Space>
            {unanalyzedRooms.length > 0 && (
              <Button
                icon={<ThunderboltOutlined />}
                onClick={handleBatchAnalyze}
                loading={batchAnalyzing}
                type="primary"
                ghost
              >
                Analyze All ({unanalyzedRooms.length})
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      {/* Add Room Panel */}
      {!showAddRoom ? (
        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={() => setShowAddRoom(true)}
          style={{ height: 48 }}
        >
          Add a room with photos...
        </Button>
      ) : (
        <Card size="small" title="Add Room" extra={
          <Button size="small" icon={<CloseOutlined />} type="text"
            onClick={() => { setShowAddRoom(false); setPendingPhotos([]); }}
          />
        }>
          {/* Room name selection */}
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col flex="auto">
              {useCustomName ? (
                <Input
                  placeholder="Room name (e.g. Master Bedroom)"
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  onPressEnter={handleAddRoom}
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
            </Col>
            <Col>
              <Button size="middle" onClick={() => setUseCustomName(v => !v)}>
                {useCustomName ? 'Preset' : 'Custom'}
              </Button>
            </Col>
          </Row>

          {/* Photo upload */}
          {pendingPhotos.length === 0 ? (
            <Dragger
              multiple
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file, fileList) => {
                handlePhotoFiles(fileList);
                return false;
              }}
              style={{ padding: '16px 0' }}
            >
              <p><InboxOutlined style={{ fontSize: 32, color: '#1890ff' }} /></p>
              <p>Click or drag photos here</p>
            </Dragger>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {pendingPhotos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                    <Image
                      src={toDataUri(p)}
                      width={80} height={80}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                      preview={false}
                    />
                    <Button
                      size="small" type="text" danger
                      icon={<CloseOutlined />}
                      style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(255,255,255,0.8)' }}
                      onClick={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                    />
                  </div>
                ))}
                <Upload
                  multiple accept="image/*" showUploadList={false}
                  beforeUpload={(file, fileList) => { handlePhotoFiles(fileList); return false; }}
                >
                  <div style={{
                    width: 80, height: 80, border: '1px dashed #d9d9d9', borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}>
                    <PlusOutlined />
                  </div>
                </Upload>
              </div>
              <Button type="primary" onClick={handleAddRoom} block>
                Add Room ({pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''})
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Room Cards */}
      {rooms.length === 0 && !showAddRoom && (
        <Empty description="Add rooms with photos to start AI analysis" />
      )}

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
    </Space>
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

const RoomCard: React.FC<RoomCardProps> = ({
  room, presets, onAnalyze, onRemove, onUpdate, onAddPhotos,
  onUpdateItem, onRemoveItem,
}) => {
  const [showItems, setShowItems] = useState(room.analyzed);
  const fileRef = useRef<HTMLInputElement>(null);

  const confidenceColor = (s?: number) => {
    if (!s) return '#999';
    if (s >= 0.8) return '#52c41a';
    if (s >= 0.6) return '#faad14';
    return '#f5222d';
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <CameraOutlined />
          <Text strong>{room.room_name}</Text>
          <Tag>{room.photos.length} photo{room.photos.length !== 1 ? 's' : ''}</Tag>
          {room.analyzed && (
            <Tag color="success" icon={<CheckOutlined />}>
              {room.items.length} items
            </Tag>
          )}
          {room.confidence_score && (
            <Tag color={confidenceColor(room.confidence_score)}>
              {Math.round(room.confidence_score * 100)}%
            </Tag>
          )}
          {room.analyzing && <Tag color="processing" icon={<LoadingOutlined />}>Analyzing...</Tag>}
        </Space>
      }
      extra={
        <Space size="small">
          {!room.analyzed && room.photos.length > 0 && (
            <Button
              type="primary" size="small"
              icon={room.analyzing ? <LoadingOutlined /> : <ScanOutlined />}
              onClick={onAnalyze}
              loading={room.analyzing}
            >
              Analyze
            </Button>
          )}
          {room.analyzed && (
            <Button size="small" icon={<ScanOutlined />} onClick={onAnalyze}>
              Re-analyze
            </Button>
          )}
          <Popconfirm title="Remove this room?" onConfirm={onRemove}>
            <Button danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      }
    >
      {/* Photos strip */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {room.photos.map((p, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <Image
              src={toDataUri(p)}
              width={72} height={72}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
            <Button
              size="small" type="text" danger
              icon={<CloseOutlined style={{ fontSize: 10 }} />}
              style={{
                position: 'absolute', top: -4, right: -4,
                width: 18, height: 18, padding: 0,
                background: 'rgba(255,255,255,0.9)', borderRadius: '50%',
              }}
              onClick={() => {
                const newPhotos = room.photos.filter((_, idx) => idx !== i);
                onUpdate({ photos: newPhotos, analyzed: false });
              }}
            />
          </div>
        ))}
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            width: 72, height: 72, border: '1px dashed #d9d9d9', borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#999',
          }}
        >
          <PlusOutlined />
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={e => { if (e.target.files) onAddPhotos(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Room settings */}
      <Row gutter={8} style={{ marginBottom: 8 }}>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>Floor</Text>
          <Select
            size="small" value={room.floor} style={{ width: '100%' }}
            onChange={v => onUpdate({ floor: v })}
          >
            {FLOOR_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </Col>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>Density</Text>
          <Select
            size="small" value={room.density} style={{ width: '100%' }}
            onChange={v => onUpdate({ density: v })}
          >
            {DENSITY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </Col>
        <Col span={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>Contamination</Text>
          <Select
            size="small" value={room.contamination} style={{ width: '100%' }}
            onChange={v => onUpdate({ contamination: v })}
          >
            {CONTAMINATION_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
          </Select>
        </Col>
      </Row>

      {/* Field notes */}
      {room.field_notes && room.field_notes.length > 0 && (
        <Alert
          type="info" showIcon
          message={
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {room.field_notes.map((n, i) => <li key={i} style={{ fontSize: 12 }}>{n}</li>)}
            </ul>
          }
          style={{ marginBottom: 8 }}
        />
      )}

      {/* Detected items */}
      {room.analyzed && room.items.length > 0 && (
        <>
          <div
            style={{ cursor: 'pointer', padding: '4px 0', marginBottom: 4 }}
            onClick={() => setShowItems(v => !v)}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {showItems ? '▼' : '▶'} Detected Items ({room.items.length})
            </Text>
          </div>
          {showItems && (
            <Table
              dataSource={room.items.map((item, i) => ({ ...item, _idx: i }))}
              rowKey={(_, i) => `${room.id}_${i}`}
              size="small"
              pagination={false}
              scroll={{ x: 600 }}
              columns={[
                {
                  title: 'Item', dataIndex: 'name', key: 'name',
                  render: (name: string, record: any) => (
                    <Space size={4}>
                      <Text style={{ fontSize: 12 }}>{name}</Text>
                      {record.is_fragile && <Tag color="orange" style={{ fontSize: 10, padding: '0 4px' }}>Fragile</Tag>}
                      {record.is_high_value && <Tag color="gold" style={{ fontSize: 10, padding: '0 4px' }}>High Value</Tag>}
                    </Space>
                  ),
                },
                {
                  title: 'Category', dataIndex: 'category', key: 'category', width: 110,
                  render: (cat: string, record: any) => (
                    <Select
                      size="small" value={cat} style={{ width: '100%' }}
                      onChange={v => onUpdateItem(record._idx, { category: v })}
                    >
                      {ITEM_CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
                    </Select>
                  ),
                },
                {
                  title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 65,
                  render: (qty: number, record: any) => (
                    <InputNumber
                      size="small" min={1} value={qty}
                      onChange={v => onUpdateItem(record._idx, { quantity: v || 1 })}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                {
                  title: '', key: 'actions', width: 40,
                  render: (_: any, record: any) => (
                    <Button
                      size="small" type="text" danger
                      icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      onClick={() => onRemoveItem(record._idx)}
                    />
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
};

export default PhotoAIRooms;
