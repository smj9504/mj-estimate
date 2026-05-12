/**
 * Photo Upload Manager Component
 *
 * Main component for multi-room photo upload and analysis system.
 * Provides room-based photo grouping, drag-and-drop upload, and AI analysis.
 *
 * Features:
 * - Room type selector (select FIRST)
 * - Multiple photo upload for SAME room (1-10 photos from different angles)
 * - Drag-and-drop photo upload with preview
 * - Multiple room groups management
 * - Photo preview with thumbnails
 * - Per-room or bulk analysis
 * - Aggregate results display
 *
 * Upload Flow:
 * 1. Select room type (e.g., "Kitchen")
 * 2. Select 1-10 photos of that room from different angles
 * 3. Click "Upload Photos" button to create ONE room with all photos
 * 4. Repeat for additional rooms
 */

import React, { useState, useCallback } from 'react';
import {
  Card,
  Upload,
  Button,
  Select,
  Space,
  Typography,
  Alert,
  message,
  Row,
  Col,
  Statistic,
  Divider,
  Empty,
} from 'antd';
import {
  InboxOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  CameraOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { RoomType, DensityLevel } from '../../../types/pack-calculation';
import {
  PhotoGroup,
  PhotoFile,
  PhotoUploadStatus,
  AnalysisStatus,
  AggregateAnalysisSummary,
} from '../../../types/photoAnalysis';
import {
  validatePhotoFile,
  createPhotoPreview,
  revokePhotoPreview,
  uploadAndAnalyzeRoom,
  analyzeAllRooms,
  type AnalysisProvider,
} from '../../../services/photoAnalysisService';
import { RoomPhotoGroup } from './RoomPhotoGroup';
import { getRoomTypeLabel, getAllRoomTypeOptions } from '../../../services/packTemplateService';

const { Dragger } = Upload;
const { Title, Text, Paragraph } = Typography;

// ============================================================================
// Component Props
// ============================================================================

interface PhotoAnalyzedItem {
  item_name: string;
  item_category: string;
  quantity: number;
  size_category: string;
  floor_level: string;
  pack_size?: number;
  source: string;
  room_name: string;
}

interface PhotoUploadManagerProps {
  /** Callback when photos are analyzed and ready to apply */
  onPhotosAnalyzed: (
    items: PhotoAnalyzedItem[],
    options?: { replaceRoom?: string }
  ) => void;
  /** Optional callback when rooms change (for parent state sync) */
  onRoomsChange?: (rooms: PhotoGroup[]) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export const PhotoUploadManager: React.FC<PhotoUploadManagerProps> = ({
  onPhotosAnalyzed,
  onRoomsChange,
}) => {
  // ============================================================================
  // State Management
  // ============================================================================

  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(null);
  const [rooms, setRooms] = useState<PhotoGroup[]>([]);
  const [uploadingRoomId, setUploadingRoomId] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<UploadFile[]>([]);
  const [analysisProvider] = useState<AnalysisProvider>('openai'); // Use OpenAI GPT-4 Vision for real analysis
  const [appliedRoomIds, setAppliedRoomIds] = useState<Set<string>>(new Set());

  // ============================================================================
  // Derived State
  // ============================================================================

  const aggregateStats: AggregateAnalysisSummary = {
    totalRooms: rooms.length,
    totalPhotos: rooms.reduce((sum, room) => sum + room.photos.length, 0),
    analyzedRooms: rooms.filter((r) => r.analysisStatus === AnalysisStatus.COMPLETED).length,
    averageConfidence:
      rooms.filter((r) => r.result).length > 0
        ? Math.round(
            rooms.reduce((sum, r) => sum + (r.result?.confidence_score || 0), 0) /
              rooms.filter((r) => r.result).length
          )
        : 0,
    totalBoxes: rooms.reduce((sum, r) => sum + (r.result?.total_boxes || 0), 0),
    totalItems: rooms.reduce(
      (sum, r) => sum + (r.result?.estimated_items.length || 0),
      0
    ),
  };

  const canAnalyzeAll =
    rooms.length > 0 &&
    rooms.some((r) => r.photos.length > 0 && r.analysisStatus !== AnalysisStatus.ANALYZING);

  const canApplyResults = rooms.some((r) => r.analysisStatus === AnalysisStatus.COMPLETED);

  // ============================================================================
  // Room Management
  // ============================================================================

  const createNewRoom = (roomType: RoomType, photos: PhotoFile[]): PhotoGroup => {
    const newRoom: PhotoGroup = {
      id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomType,
      photos,
      analysisStatus: AnalysisStatus.PENDING,
      createdAt: new Date(),
    };
    return newRoom;
  };

  const updateRooms = useCallback(
    (updater: (prevRooms: PhotoGroup[]) => PhotoGroup[]) => {
      setRooms((prev) => {
        const updated = updater(prev);
        onRoomsChange?.(updated);
        return updated;
      });
    },
    [onRoomsChange]
  );

  const findOrCreateRoom = (roomType: RoomType): PhotoGroup | null => {
    // Try to find existing room with same type and not yet analyzed
    const existingRoom = rooms.find(
      (r) => r.roomType === roomType && r.analysisStatus === AnalysisStatus.PENDING
    );

    return existingRoom || null;
  };

  // ============================================================================
  // Photo Upload Handling
  // ============================================================================

  const handlePhotosSelected = useCallback(
    async (fileList: UploadFile[]) => {
      if (!selectedRoomType) {
        message.warning('Please select a room type first');
        return;
      }

      if (fileList.length === 0) {
        return;
      }

      // Validate file count (1-10 photos per room)
      if (fileList.length > 10) {
        message.error('Maximum 10 photos per room');
        return;
      }

      // Convert UploadFile to PhotoFile
      const photoFiles: PhotoFile[] = [];
      const invalidFiles: string[] = [];

      for (const uploadFile of fileList) {
        const file = uploadFile.originFileObj as File;
        if (!file) continue;

        // Validate file
        const validation = validatePhotoFile(file);
        if (!validation.valid) {
          invalidFiles.push(`${file.name}: ${validation.error}`);
          continue;
        }

        // Create PhotoFile
        const photoFile: PhotoFile = {
          id: `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          file,
          preview: createPhotoPreview(file),
          status: PhotoUploadStatus.UPLOADED,
          size: file.size,
          type: file.type,
        };

        photoFiles.push(photoFile);
      }

      // Show validation errors
      if (invalidFiles.length > 0) {
        message.error({
          content: (
            <div>
              <div>Some files were rejected:</div>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {invalidFiles.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          ),
          duration: 5,
        });
      }

      if (photoFiles.length === 0) {
        return;
      }

      // Find or create room for this room type
      const existingRoom = findOrCreateRoom(selectedRoomType);

      if (existingRoom) {
        // Add photos to existing room
        updateRooms((prev) =>
          prev.map((room) =>
            room.id === existingRoom.id
              ? { ...room, photos: [...room.photos, ...photoFiles] }
              : room
          )
        );
        message.success(`Added ${photoFiles.length} photo(s) to ${getRoomTypeLabel(selectedRoomType)}`);
      } else {
        // Create new room
        const newRoom = createNewRoom(selectedRoomType, photoFiles);
        updateRooms((prev) => [...prev, newRoom]);
        message.success(
          `Created new ${getRoomTypeLabel(selectedRoomType)} with ${photoFiles.length} photo(s)`
        );
      }

      // Reset selection
      setSelectedRoomType(null);
    },
    [selectedRoomType, rooms, updateRooms]
  );

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: true,
    accept: 'image/jpeg,image/jpg,image/png',
    beforeUpload: () => false, // Prevent auto upload
    onChange: (info) => {
      // Only update the pending file list, don't process yet
      setPendingFiles(info.fileList);
    },
    fileList: pendingFiles,
    onRemove: (file) => {
      setPendingFiles((prev) => prev.filter((f) => f.uid !== file.uid));
    },
  };

  const handleUploadPhotos = () => {
    if (pendingFiles.length === 0) {
      message.warning('Please select photos first');
      return;
    }

    // Process all selected files at once
    handlePhotosSelected(pendingFiles);

    // Clear the pending files after successful processing
    setPendingFiles([]);
  };

  // ============================================================================
  // Analysis Handling
  // ============================================================================

  const handleAnalyzeRoom = async (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room || room.photos.length === 0) {
      message.warning('No photos to analyze');
      return;
    }

    // Update status to analyzing
    updateRooms((prev) =>
      prev.map((r) =>
        r.id === roomId ? { ...r, analysisStatus: AnalysisStatus.ANALYZING, error: undefined } : r
      )
    );

    try {
      // Upload photos and analyze (combined operation)
      const photoFiles = room.photos.map((p) => p.file);
      const response = await uploadAndAnalyzeRoom(room.roomType, photoFiles, analysisProvider);

      // Update with results
      updateRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
                ...r,
                analysisStatus: AnalysisStatus.COMPLETED,
                result: response.result,
                analyzedAt: new Date(),
                error: undefined,
              }
            : r
        )
      );

      const confidencePercent = Math.round(response.result.confidence_score * 100);
      message.success(
        `${getRoomTypeLabel(room.roomType)} analyzed successfully (${confidencePercent}% confidence)`
      );
    } catch (error: any) {
      console.error('[PhotoUploadManager] Analysis failed:', error);

      // Update status to failed
      updateRooms((prev) =>
        prev.map((r) =>
          r.id === roomId
            ? {
                ...r,
                analysisStatus: AnalysisStatus.FAILED,
                error: error.message || 'Analysis failed',
              }
            : r
        )
      );

      message.error(`Analysis failed: ${error.message || 'Unknown error'}`);
    }
  };

  const handleAnalyzeAll = async () => {
    const roomsToAnalyze = rooms.filter(
      (r) => r.photos.length > 0 && r.analysisStatus !== AnalysisStatus.ANALYZING
    );

    if (roomsToAnalyze.length === 0) {
      message.warning('No rooms with photos to analyze');
      return;
    }

    setAnalyzingAll(true);

    // Update all rooms to analyzing status
    updateRooms((prev) =>
      prev.map((r) =>
        roomsToAnalyze.some((rt) => rt.id === r.id)
          ? { ...r, analysisStatus: AnalysisStatus.ANALYZING, error: undefined }
          : r
      )
    );

    try {
      const response = await analyzeAllRooms(roomsToAnalyze, analysisProvider);

      // Update all rooms with results
      updateRooms((prev) =>
        prev.map((room) => {
          const result = response.results.find((res) => res.room_id === room.id);
          if (result) {
            return {
              ...room,
              analysisStatus: AnalysisStatus.COMPLETED,
              result: result.result,
              analyzedAt: new Date(),
              error: undefined,
            };
          }
          return room;
        })
      );

      message.success({
        content: `Analyzed ${roomsToAnalyze.length} room(s) successfully! Average confidence: ${response.overall_confidence}%`,
        duration: 5,
      });
    } catch (error: any) {
      console.error('[PhotoUploadManager] Bulk analysis failed:', error);

      // Revert to previous status
      updateRooms((prev) =>
        prev.map((r) =>
          roomsToAnalyze.some((rt) => rt.id === r.id)
            ? {
                ...r,
                analysisStatus: AnalysisStatus.FAILED,
                error: error.message || 'Analysis failed',
              }
            : r
        )
      );

      message.error(`Bulk analysis failed: ${error.message || 'Unknown error'}`);
    } finally {
      setAnalyzingAll(false);
    }
  };

  const handleEditDensity = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room || !room.result) return;

    // TODO: Open modal to edit density level and re-analyze
    message.info('Density editing will be available in the next update');
  };

  const handleApplyResults = () => {
    const analyzedRooms = rooms.filter((r) => r.result);

    if (analyzedRooms.length === 0) {
      message.warning('No analyzed results to apply');
      return;
    }

    // Aggregate all items from all analyzed rooms with room_name preserved
    const allItems = analyzedRooms.flatMap((room) => {
      const roomLabel = getRoomTypeLabel(room.roomType);
      return room.result!.estimated_items.map((item) => ({
        item_name: item.subcategory || item.category,
        item_category: item.category,
        quantity: item.quantity,
        size_category: 'medium',
        floor_level: 'MAIN_LEVEL',
        pack_size: item.pack_size,
        source: 'photo' as const,
        room_name: roomLabel,
      }));
    });

    // Track which rooms have been applied
    setAppliedRoomIds((prev) => {
      const next = new Set(prev);
      analyzedRooms.forEach((r) => next.add(r.id));
      return next;
    });

    onPhotosAnalyzed(allItems);
    message.success(`Applied ${allItems.length} items from ${analyzedRooms.length} room(s)`);
  };

  /** Replace only the items for a single re-analyzed room in the parent estimate */
  const handleReapplyRoom = useCallback(
    (roomId: string) => {
      const room = rooms.find((r) => r.id === roomId);
      if (!room?.result) return;

      const roomLabel = getRoomTypeLabel(room.roomType);
      const newItems: PhotoAnalyzedItem[] = room.result.estimated_items.map((item) => ({
        item_name: item.subcategory || item.category,
        item_category: item.category,
        quantity: item.quantity,
        size_category: 'medium',
        floor_level: 'MAIN_LEVEL',
        pack_size: item.pack_size,
        source: 'photo' as const,
        room_name: roomLabel,
      }));

      onPhotosAnalyzed(newItems, { replaceRoom: roomLabel });
      message.success(`Updated ${newItems.length} items for ${roomLabel}`);
    },
    [rooms, onPhotosAnalyzed]
  );

  // ============================================================================
  // Room Actions
  // ============================================================================

  const handleDeleteRoom = (roomId: string) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    // Revoke all preview URLs to free memory
    room.photos.forEach((photo) => {
      revokePhotoPreview(photo.preview);
    });

    // Remove room
    updateRooms((prev) => prev.filter((r) => r.id !== roomId));

    message.success(`Deleted ${getRoomTypeLabel(room.roomType)}`);
  };

  const handleRemovePhoto = (roomId: string, photoId: string) => {
    updateRooms((prev) =>
      prev.map((room) => {
        if (room.id === roomId) {
          const photo = room.photos.find((p) => p.id === photoId);
          if (photo) {
            revokePhotoPreview(photo.preview);
          }

          const updatedPhotos = room.photos.filter((p) => p.id !== photoId);

          // If no photos left, reset analysis
          if (updatedPhotos.length === 0) {
            return {
              ...room,
              photos: updatedPhotos,
              analysisStatus: AnalysisStatus.PENDING,
              result: undefined,
              error: undefined,
            };
          }

          return { ...room, photos: updatedPhotos };
        }
        return room;
      })
    );

    message.success('Photo removed');
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderUploadSection = () => {
    return (
      <Card
        title={
          <Space>
            <CameraOutlined />
            <Text strong>Upload Photos</Text>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {/* Room Type Selector */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>Step 1: Select Room Type</Text>
          <Select
            style={{ width: '100%', marginTop: 8 }}
            placeholder="Choose a room type..."
            value={selectedRoomType}
            onChange={(value) => {
              setSelectedRoomType(value);
              setPendingFiles([]); // Clear pending files when room type changes
            }}
            size="large"
            options={getAllRoomTypeOptions()}
          />
        </div>

        {/* Upload Zone */}
        <div style={{ marginBottom: 16 }}>
          <Text strong>Step 2: Select Photos (1-10 photos of the same room)</Text>
          <Dragger
            {...uploadProps}
            disabled={!selectedRoomType}
            style={{
              backgroundColor: selectedRoomType ? '#fafafa' : '#f5f5f5',
              marginTop: 8,
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              {selectedRoomType
                ? `Click or drag photos for ${getRoomTypeLabel(selectedRoomType)}`
                : 'Please select a room type first'}
            </p>
            <p className="ant-upload-hint">
              Upload 1-10 photos of the SAME room from different angles. Supports JPG and PNG (max 5MB each)
            </p>
          </Dragger>
        </div>

        {/* Upload Button */}
        {pendingFiles.length > 0 && (
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              icon={<CameraOutlined />}
              onClick={handleUploadPhotos}
              disabled={!selectedRoomType}
            >
              Upload {pendingFiles.length} Photo{pendingFiles.length > 1 ? 's' : ''} to{' '}
              {selectedRoomType ? getRoomTypeLabel(selectedRoomType) : 'Room'}
            </Button>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                All photos will be added to the same {selectedRoomType ? getRoomTypeLabel(selectedRoomType) : 'room'}
              </Text>
            </div>
          </div>
        )}

        {/* Info Alert */}
        <Alert
          type="info"
          message="Photo Upload Tips"
          description={
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              <li><strong>Multiple angles:</strong> Take photos from different sides of the SAME room</li>
              <li><strong>Good lighting:</strong> Ensure clear visibility of items and furniture</li>
              <li><strong>Storage areas:</strong> Include closets, cabinets, and shelves</li>
              <li><strong>Optimal count:</strong> Upload 3-5 photos per room for best results</li>
              <li><strong>Add more rooms:</strong> After uploading, select a new room type to add another room</li>
            </ul>
          }
          showIcon
          style={{ marginTop: 16 }}
        />
      </Card>
    );
  };

  const renderAggregateStats = () => {
    if (rooms.length === 0) return null;

    return (
      <Card
        title={
          <Space>
            <CheckCircleOutlined />
            <Text strong>Summary</Text>
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={handleAnalyzeAll}
              disabled={!canAnalyzeAll}
              loading={analyzingAll}
            >
              Analyze All Rooms
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleApplyResults}
              disabled={!canApplyResults}
            >
              Apply to Estimate
            </Button>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Row gutter={16}>
          <Col xs={12} sm={6}>
            <Statistic title="Total Rooms" value={aggregateStats.totalRooms} prefix="🏠" />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="Total Photos" value={aggregateStats.totalPhotos} prefix="📸" />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="Analyzed"
              value={aggregateStats.analyzedRooms}
              suffix={`/ ${aggregateStats.totalRooms}`}
              prefix="✅"
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="Total Boxes"
              value={aggregateStats.totalBoxes}
              prefix="📦"
              valueStyle={{ color: aggregateStats.totalBoxes > 0 ? '#1890ff' : undefined }}
            />
          </Col>
        </Row>

        {aggregateStats.analyzedRooms > 0 && (
          <>
            <Divider />
            <Row gutter={16}>
              <Col xs={12}>
                <Statistic
                  title="Avg. Confidence"
                  value={aggregateStats.averageConfidence}
                  suffix="%"
                  valueStyle={{
                    color:
                      aggregateStats.averageConfidence >= 80
                        ? '#52c41a'
                        : aggregateStats.averageConfidence >= 60
                        ? '#faad14'
                        : '#ff4d4f',
                  }}
                />
              </Col>
              <Col xs={12}>
                <Statistic
                  title="Total Items"
                  value={aggregateStats.totalItems}
                  prefix="📋"
                />
              </Col>
            </Row>
          </>
        )}
      </Card>
    );
  };

  const renderRoomList = () => {
    if (rooms.length === 0) {
      return (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No rooms added yet. Upload photos to get started."
          />
        </Card>
      );
    }

    return (
      <div>
        {rooms.map((room) => (
          <RoomPhotoGroup
            key={room.id}
            group={room}
            onAnalyze={handleAnalyzeRoom}
            onEditDensity={handleEditDensity}
            onDelete={handleDeleteRoom}
            onRemovePhoto={handleRemovePhoto}
            wasApplied={appliedRoomIds.has(room.id)}
            onReapply={handleReapplyRoom}
          />
        ))}
      </div>
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <Title level={3}>
        <CameraOutlined /> Photo-Based Estimation
      </Title>
      <Paragraph type="secondary">
        Upload photos of each room to get AI-powered packing estimates. Our system analyzes room
        density and detects items automatically.
      </Paragraph>

      <Divider />

      {/* Upload Section */}
      {renderUploadSection()}

      {/* Aggregate Stats */}
      {renderAggregateStats()}

      {/* Room List */}
      {renderRoomList()}
    </div>
  );
};

export default PhotoUploadManager;
