/**
 * Room Template Selector Component
 *
 * Visual card-based room template selector with density slider for TEMPLATE input mode.
 * Features:
 * - Grid layout with room type cards (icons, descriptions, item counts)
 * - Density slider (MINIMAL to PACKED) with visual guides
 * - Real-time box count estimation
 * - Confidence indicators
 * - Add/edit/delete room list management
 */

import React, { useState, useEffect } from 'react';
import {
  Card,
  Slider,
  Button,
  List,
  Tag,
  Space,
  Row,
  Col,
  Typography,
  Alert,
  Spin,
  message,
  Empty,
  Tooltip,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import {
  RoomType,
  DensityLevel,
  RoomSize,
  ROOM_SIZE_INFO,
  TemplateSummary,
  DensityEstimationResponse,
} from '../../types/pack-calculation';
import {
  getTemplates,
  estimateByDensity,
  getRoomTypeLabel,
  getDensityLevelInfo,
} from '../../services/packTemplateService';

const { Title, Text, Paragraph } = Typography;

// ============================================================================
// Types
// ============================================================================

interface RoomSelection {
  id: string; // Unique ID for this selection
  room_type: RoomType;
  room_size: RoomSize;
  density_level: DensityLevel;
  estimated_boxes: number;
  confidence: number;
  estimated_items: DensityEstimationResponse['estimated_items'];
}

interface RoomTemplateSelectorProps {
  onRoomsChange: (rooms: RoomSelection[]) => void;
  initialRooms?: RoomSelection[];
}

// ============================================================================
// Room Type Icons & Metadata
// ============================================================================

const ROOM_ICONS: Record<RoomType, string> = {
  [RoomType.LIVING_ROOM]: '🛋️',
  [RoomType.BEDROOM]: '🛏️',
  [RoomType.KITCHEN]: '🍳',
  [RoomType.DINING_ROOM]: '🍽️',
  [RoomType.HOME_OFFICE]: '💼',
  [RoomType.BATHROOM]: '🚿',
  [RoomType.GARAGE]: '🚗',
  [RoomType.BASEMENT]: '📦',
  [RoomType.ATTIC]: '🏚️',
};

const ROOM_COLORS: Record<RoomType, string> = {
  [RoomType.LIVING_ROOM]: '#1890ff',
  [RoomType.BEDROOM]: '#52c41a',
  [RoomType.KITCHEN]: '#faad14',
  [RoomType.DINING_ROOM]: '#eb2f96',
  [RoomType.HOME_OFFICE]: '#722ed1',
  [RoomType.BATHROOM]: '#13c2c2',
  [RoomType.GARAGE]: '#8c8c8c',
  [RoomType.BASEMENT]: '#fa8c16',
  [RoomType.ATTIC]: '#a0d911',
};

// ============================================================================
// Density Slider Marks
// ============================================================================

const DENSITY_MARKS = {
  0: {
    label: (
      <div style={{ textAlign: 'center' }}>
        <div>😌</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>Minimal</div>
      </div>
    ),
  },
  1: {
    label: (
      <div style={{ textAlign: 'center' }}>
        <div>🏠</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>Moderate</div>
      </div>
    ),
  },
  2: {
    label: (
      <div style={{ textAlign: 'center' }}>
        <div>📚</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>Full</div>
      </div>
    ),
  },
  3: {
    label: (
      <div style={{ textAlign: 'center' }}>
        <div>🎁</div>
        <div style={{ fontSize: '10px', marginTop: '4px' }}>Packed</div>
      </div>
    ),
  },
};

const DENSITY_VALUES: DensityLevel[] = [
  DensityLevel.MINIMAL,
  DensityLevel.MODERATE,
  DensityLevel.FULL,
  DensityLevel.PACKED,
];

// ============================================================================
// Component
// ============================================================================

export const RoomTemplateSelector: React.FC<RoomTemplateSelectorProps> = ({
  onRoomsChange,
  initialRooms = [],
}) => {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);
  const [selectedRoomSize, setSelectedRoomSize] = useState<RoomSize>(RoomSize.MEDIUM);
  const [densityLevel, setDensityLevel] = useState<number>(1); // Index: 0=minimal, 1=moderate, 2=full, 3=packed
  const [estimating, setEstimating] = useState(false);
  const [estimation, setEstimation] = useState<DensityEstimationResponse | null>(null);
  const [addedRooms, setAddedRooms] = useState<RoomSelection[]>(initialRooms);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);

  // ============================================================================
  // Load Templates
  // ============================================================================

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await getTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Failed to load templates:', error);
      message.error('Failed to load room templates');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Estimate on Room Type, Size, or Density Change
  // ============================================================================

  useEffect(() => {
    if (selectedRoomType) {
      performEstimation();
    }
  }, [selectedRoomType, selectedRoomSize, densityLevel]);

  const performEstimation = async () => {
    if (!selectedRoomType) return;

    try {
      setEstimating(true);
      const result = await estimateByDensity({
        room_type: selectedRoomType,
        density_level: DENSITY_VALUES[densityLevel],
        room_size: selectedRoomSize,
        custom_adjustments: {
          room_size: selectedRoomSize,
        },
      });
      setEstimation(result);
    } catch (error) {
      console.error('Estimation failed:', error);
      message.error('Failed to estimate boxes for selected room');
    } finally {
      setEstimating(false);
    }
  };

  // ============================================================================
  // Room Selection Handlers
  // ============================================================================

  const handleRoomSelect = (roomType: RoomType) => {
    setSelectedRoomType(roomType);
    setSelectedRoomSize(RoomSize.MEDIUM); // Reset to medium
    setDensityLevel(1); // Reset to moderate
    setEstimation(null);
    setEditingRoomId(null);
  };

  const handleDensityChange = (value: number) => {
    setDensityLevel(value);
  };

  // ============================================================================
  // Add/Edit/Delete Rooms
  // ============================================================================

  const handleAddRoom = () => {
    if (!selectedRoomType || !estimation) return;

    const newRoom: RoomSelection = {
      id: editingRoomId || `room_${Date.now()}`,
      room_type: selectedRoomType,
      room_size: selectedRoomSize,
      density_level: DENSITY_VALUES[densityLevel],
      estimated_boxes: estimation.total_boxes,
      confidence: estimation.confidence,
      estimated_items: estimation.estimated_items,
    };

    let updatedRooms: RoomSelection[];
    if (editingRoomId) {
      // Update existing room
      updatedRooms = addedRooms.map((room) =>
        room.id === editingRoomId ? newRoom : room
      );
      message.success('Room updated successfully');
    } else {
      // Add new room
      updatedRooms = [...addedRooms, newRoom];
      message.success('Room added successfully');
    }

    setAddedRooms(updatedRooms);
    onRoomsChange(updatedRooms);

    // Reset selection
    setSelectedRoomType(null);
    setEstimation(null);
    setEditingRoomId(null);
  };

  const handleEditRoom = (room: RoomSelection) => {
    setSelectedRoomType(room.room_type);
    setSelectedRoomSize(room.room_size);
    setDensityLevel(DENSITY_VALUES.indexOf(room.density_level));
    setEditingRoomId(room.id);
  };

  const handleDeleteRoom = (roomId: string) => {
    const updatedRooms = addedRooms.filter((room) => room.id !== roomId);
    setAddedRooms(updatedRooms);
    onRoomsChange(updatedRooms);
    message.success('Room removed successfully');
  };

  const handleCancelEdit = () => {
    setSelectedRoomType(null);
    setEstimation(null);
    setEditingRoomId(null);
  };

  // ============================================================================
  // Calculate Total Boxes
  // ============================================================================

  const totalBoxes = addedRooms.reduce((sum, room) => sum + room.estimated_boxes, 0);
  const avgConfidence =
    addedRooms.length > 0
      ? addedRooms.reduce((sum, room) => sum + room.confidence, 0) / addedRooms.length
      : 0;

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spin size="large" />
        <div style={{ marginTop: '16px' }}>Loading room templates...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Room Type Cards Grid */}
      <Title level={4}>Select Room Type</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        {templates.map((template) => {
          const roomType = template.room_type as RoomType;
          const isSelected = selectedRoomType === roomType;

          return (
            <Col xs={12} sm={8} md={6} lg={4} key={template.id}>
              <Card
                hoverable
                onClick={() => handleRoomSelect(roomType)}
                style={{
                  borderColor: isSelected ? ROOM_COLORS[roomType] : undefined,
                  borderWidth: isSelected ? '2px' : '1px',
                  boxShadow: isSelected
                    ? `0 0 12px ${ROOM_COLORS[roomType]}40`
                    : undefined,
                }}
                bodyStyle={{ padding: '12px', textAlign: 'center' }}
              >
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>
                  {ROOM_ICONS[roomType]}
                </div>
                <Text strong style={{ fontSize: '12px', display: 'block' }}>
                  {getRoomTypeLabel(roomType)}
                </Text>
                <Text type="secondary" style={{ fontSize: '11px' }}>
                  ~{template.item_count} items
                </Text>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Room Size Selector (shows when room selected) */}
      {selectedRoomType && (
        <Card style={{ marginBottom: 24 }}>
          <Title level={5}>
            <HomeOutlined /> Room Size
          </Title>
          <Paragraph type="secondary">
            Select the approximate size of your {getRoomTypeLabel(selectedRoomType)}
          </Paragraph>

          <Segmented
            options={[
              {
                label: (
                  <div style={{ padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px' }}>📐</div>
                    <div><strong>Small</strong></div>
                    <div style={{ fontSize: '11px', color: '#8c8c8c' }}>100-200 sqft</div>
                  </div>
                ),
                value: RoomSize.SMALL,
              },
              {
                label: (
                  <div style={{ padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px' }}>📏</div>
                    <div><strong>Medium</strong></div>
                    <div style={{ fontSize: '11px', color: '#8c8c8c' }}>200-400 sqft</div>
                  </div>
                ),
                value: RoomSize.MEDIUM,
              },
              {
                label: (
                  <div style={{ padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '28px' }}>📐</div>
                    <div><strong>Large</strong></div>
                    <div style={{ fontSize: '11px', color: '#8c8c8c' }}>400+ sqft</div>
                  </div>
                ),
                value: RoomSize.LARGE,
              },
            ]}
            value={selectedRoomSize}
            onChange={(value) => setSelectedRoomSize(value as RoomSize)}
            block
            size="large"
          />

          <Alert
            message="Size Impact"
            description={
              <Space direction="vertical" size="small">
                <Text>
                  <strong>{ROOM_SIZE_INFO[selectedRoomSize].label}</strong>:{' '}
                  {ROOM_SIZE_INFO[selectedRoomSize].description}
                </Text>
                <Text type="secondary">
                  📐 Examples: {ROOM_SIZE_INFO[selectedRoomSize].example_dimensions.join(', ')}
                </Text>
                <Text type="secondary">
                  📊 Multiplier: <strong>{ROOM_SIZE_INFO[selectedRoomSize].multiplier}x</strong> baseline items
                </Text>
              </Space>
            }
            type="info"
            style={{ marginTop: 16 }}
            showIcon
          />
        </Card>
      )}

      {/* Density Slider (shows when room selected) */}
      {selectedRoomType && (
        <Card style={{ marginBottom: '24px' }}>
          <Title level={5}>
            Density Level for {getRoomTypeLabel(selectedRoomType)}
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: '24px' }}>
            {getDensityLevelInfo(DENSITY_VALUES[densityLevel]).description}
          </Paragraph>

          <Slider
            marks={DENSITY_MARKS}
            step={1}
            min={0}
            max={3}
            value={densityLevel}
            onChange={handleDensityChange}
            tooltip={{ formatter: null }}
          />

          {/* Estimation Result */}
          {estimating && (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <Spin />
              <div style={{ marginTop: '8px' }}>Estimating boxes...</div>
            </div>
          )}

          {!estimating && estimation && (
            <Alert
              message={
                <Space size="large">
                  <div>
                    <Text strong style={{ fontSize: '24px' }}>
                      {estimation.total_boxes}
                    </Text>
                    <div style={{ fontSize: '12px' }}>Estimated Boxes</div>
                  </div>
                  <div>
                    <Text strong style={{ fontSize: '20px', color: '#52c41a' }}>
                      {estimation.confidence}%
                    </Text>
                    <div style={{ fontSize: '12px' }}>Confidence</div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: '14px' }}>
                      {getDensityLevelInfo(DENSITY_VALUES[densityLevel]).multiplier}x
                    </Text>
                    <div style={{ fontSize: '12px' }}>Multiplier</div>
                  </div>
                </Space>
              }
              type="info"
              icon={<InfoCircleOutlined />}
              style={{ marginTop: '16px' }}
            />
          )}

          {/* Add/Update Button */}
          {estimation && (
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <Space>
                {editingRoomId && (
                  <Button onClick={handleCancelEdit}>Cancel</Button>
                )}
                <Button
                  type="primary"
                  icon={editingRoomId ? <CheckCircleOutlined /> : <PlusOutlined />}
                  onClick={handleAddRoom}
                >
                  {editingRoomId ? 'Update Room' : 'Add Room'}
                </Button>
              </Space>
            </div>
          )}
        </Card>
      )}

      {/* Added Rooms List */}
      {addedRooms.length > 0 && (
        <Card
          title={
            <Space>
              <span>Added Rooms</span>
              <Tag color="blue">{addedRooms.length} rooms</Tag>
              <Tag color="green">{totalBoxes} boxes total</Tag>
              <Tooltip title="Average confidence across all rooms">
                <Tag color="orange">{avgConfidence.toFixed(0)}% confidence</Tag>
              </Tooltip>
            </Space>
          }
        >
          <List
            dataSource={addedRooms}
            renderItem={(room) => {
              const densityInfo = getDensityLevelInfo(room.density_level);
              return (
                <List.Item
                  actions={[
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => handleEditRoom(room)}
                    >
                      Edit
                    </Button>,
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteRoom(room.id)}
                    >
                      Delete
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ fontSize: '32px' }}>
                        {ROOM_ICONS[room.room_type]}
                      </div>
                    }
                    title={
                      <Space>
                        <Text strong>{getRoomTypeLabel(room.room_type)}</Text>
                        <Tag color="blue">
                          {ROOM_SIZE_INFO[room.room_size].label}
                        </Tag>
                        <Tag color={ROOM_COLORS[room.room_type]}>
                          {densityInfo.label}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">{densityInfo.description}</Text>
                        <Space size="large" style={{ marginTop: '4px' }}>
                          <Text>
                            <strong>{room.estimated_boxes}</strong> boxes
                          </Text>
                          <Text type="secondary">
                            {room.confidence}% confidence
                          </Text>
                          <Text type="secondary">
                            {room.estimated_items.length} item types
                          </Text>
                        </Space>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Card>
      )}

      {/* Empty State */}
      {addedRooms.length === 0 && !selectedRoomType && (
        <Empty
          description="Select a room type above to start adding rooms"
          style={{ marginTop: '40px' }}
        />
      )}
    </div>
  );
};

export default RoomTemplateSelector;
