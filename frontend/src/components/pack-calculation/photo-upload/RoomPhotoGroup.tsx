/**
 * Room Photo Group Component
 *
 * Displays a collapsible card for a single room's photo group with:
 * - Room name and photo count
 * - Photo grid with thumbnails (4 per row)
 * - Analysis status indicator
 * - Action buttons (Analyze, Edit Density, Delete)
 * - Confidence score display when analyzed
 */

import React from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Space,
  Typography,
  Tag,
  Progress,
  Image,
  Tooltip,
  Popconfirm,
  Badge,
  Spin,
  Alert,
  List,
  Collapse,
} from 'antd';
import {
  DeleteOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  EditOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  WarningOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { PhotoGroup, AnalysisStatus } from '../../../types/photoAnalysis';
import { RoomType } from '../../../types/pack-calculation';
import { getRoomTypeLabel } from '../../../services/packTemplateService';

const { Text, Title } = Typography;

// ============================================================================
// Room Type Icons (matching SmartEstimation.tsx)
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
// Component Props
// ============================================================================

interface RoomPhotoGroupProps {
  /** Photo group data */
  group: PhotoGroup;
  /** Callback to analyze this room */
  onAnalyze: (groupId: string) => void;
  /** Callback to edit density level */
  onEditDensity: (groupId: string) => void;
  /** Callback to delete this room group */
  onDelete: (groupId: string) => void;
  /** Callback to remove a single photo */
  onRemovePhoto: (groupId: string, photoId: string) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export const RoomPhotoGroup: React.FC<RoomPhotoGroupProps> = ({
  group,
  onAnalyze,
  onEditDensity,
  onDelete,
  onRemovePhoto,
}) => {
  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderStatusBadge = () => {
    const statusConfig = {
      [AnalysisStatus.PENDING]: {
        color: 'default',
        text: 'Not Analyzed',
        icon: null,
      },
      [AnalysisStatus.ANALYZING]: {
        color: 'processing',
        text: 'Analyzing...',
        icon: <LoadingOutlined />,
      },
      [AnalysisStatus.COMPLETED]: {
        color: 'success',
        text: 'Analyzed',
        icon: <CheckCircleOutlined />,
      },
      [AnalysisStatus.FAILED]: {
        color: 'error',
        text: 'Failed',
        icon: <WarningOutlined />,
      },
    };

    const config = statusConfig[group.analysisStatus];

    return (
      <Tag color={config.color} icon={config.icon}>
        {config.text}
      </Tag>
    );
  };

  const renderCardTitle = () => {
    const roomIcon = ROOM_ICONS[group.roomType];
    const roomLabel = getRoomTypeLabel(group.roomType);
    const photoCount = group.photos.length;

    return (
      <Space>
        <span style={{ fontSize: '24px' }}>{roomIcon}</span>
        <Text strong>{roomLabel}</Text>
        <Badge count={photoCount} showZero style={{ backgroundColor: ROOM_COLORS[group.roomType] }}>
          <span style={{ fontSize: '14px', color: '#8c8c8c', marginLeft: 8 }}>photos</span>
        </Badge>
        {renderStatusBadge()}
      </Space>
    );
  };

  const renderCardExtra = () => {
    return (
      <Space>
        {/* Confidence Score (if analyzed) */}
        {group.result && (
          <Tooltip title="Analysis Confidence">
            <Tag color={group.result.confidence_score >= 80 ? 'green' : 'orange'}>
              {group.result.confidence_score}% confidence
            </Tag>
          </Tooltip>
        )}

        {/* Analyze Button */}
        {group.analysisStatus !== AnalysisStatus.ANALYZING && (
          <Button
            type={group.analysisStatus === AnalysisStatus.PENDING ? 'primary' : 'default'}
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => onAnalyze(group.id)}
            disabled={group.photos.length === 0}
          >
            {group.analysisStatus === AnalysisStatus.COMPLETED ? 'Re-analyze' : 'Analyze'}
          </Button>
        )}

        {/* Edit Density (if analyzed) */}
        {group.result && group.analysisStatus === AnalysisStatus.COMPLETED && (
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => onEditDensity(group.id)}
          >
            Edit Density
          </Button>
        )}

        {/* Delete Room */}
        <Popconfirm
          title="Delete this room group?"
          description="This will remove all photos in this room. This action cannot be undone."
          onConfirm={() => onDelete(group.id)}
          okText="Delete"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            Delete Room
          </Button>
        </Popconfirm>
      </Space>
    );
  };

  const renderPhotoGrid = () => {
    if (group.photos.length === 0) {
      return (
        <Alert
          type="info"
          message="No photos uploaded"
          description="Upload photos to analyze this room."
          showIcon
        />
      );
    }

    return (
      <Row gutter={[12, 12]}>
        {group.photos.map((photo) => (
          <Col xs={12} sm={6} key={photo.id}>
            <div
              style={{
                position: 'relative',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                overflow: 'hidden',
                aspectRatio: '1/1',
                backgroundColor: '#fafafa',
              }}
            >
              {/* Photo Preview */}
              <Image
                src={photo.preview}
                alt={`Photo ${photo.id}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                preview={{
                  mask: 'View',
                }}
              />

              {/* Remove Button Overlay */}
              <Tooltip title="Remove photo">
                <Button
                  type="primary"
                  danger
                  size="small"
                  shape="circle"
                  icon={<CloseCircleOutlined />}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                  }}
                  onClick={() => onRemovePhoto(group.id, photo.id)}
                />
              </Tooltip>

              {/* Upload Status Overlay (if uploading or failed) */}
              {photo.status === 'uploading' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <Spin tip="Uploading..." />
                </div>
              )}

              {photo.status === 'failed' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 77, 79, 0.1)',
                    padding: 8,
                  }}
                >
                  <WarningOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />
                  <Text type="danger" style={{ fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                    {photo.error || 'Upload failed'}
                  </Text>
                </div>
              )}
            </div>
          </Col>
        ))}
      </Row>
    );
  };

  // Helper function to format box type for display
  const formatBoxType = (boxType?: string): string => {
    if (!boxType || boxType === 'N/A') return 'N/A';
    return boxType.replace(/_/g, ' ').replace(/BOX$/, ' Box').trim();
  };

  // Helper function to get special handling color
  const getSpecialHandlingColor = (handling: string): string => {
    const colors: Record<string, string> = {
      FRAGILE: 'red',
      HEAVY: 'orange',
      TWO_PERSON_LIFT: 'purple',
      ELECTRICAL: 'blue',
      DISASSEMBLY: 'cyan',
      VALUABLE: 'gold',
      FABRIC_PROTECTION: 'green',
    };
    return colors[handling.toUpperCase()] || 'default';
  };

  const renderAnalysisResults = () => {
    if (!group.result) return null;

    const { density_level, total_boxes, estimated_items, confidence_score } = group.result;

    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* Summary Stats */}
          <Row gutter={16}>
            <Col xs={8}>
              <Card size="small" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Density Level
                </Text>
                <div>
                  <Text strong style={{ fontSize: 16, textTransform: 'capitalize' }}>
                    {density_level.replace('_', ' ')}
                  </Text>
                </div>
              </Card>
            </Col>
            <Col xs={8}>
              <Card size="small" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Total Boxes
                </Text>
                <div>
                  <Text strong style={{ fontSize: 16, color: '#1890ff' }}>
                    {total_boxes}
                  </Text>
                </div>
              </Card>
            </Col>
            <Col xs={8}>
              <Card size="small" style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Confidence
                </Text>
                <div>
                  <Text
                    strong
                    style={{
                      fontSize: 16,
                      color: confidence_score >= 80 ? '#52c41a' : '#faad14',
                    }}
                  >
                    {confidence_score}%
                  </Text>
                  <Progress
                    percent={confidence_score}
                    showInfo={false}
                    strokeColor={confidence_score >= 80 ? '#52c41a' : '#faad14'}
                    size="small"
                    style={{ marginTop: 4 }}
                  />
                </div>
              </Card>
            </Col>
          </Row>

          {/* Detected Items List */}
          <Collapse
            size="small"
            items={[
              {
                key: 'items',
                label: (
                  <Space>
                    <InboxOutlined />
                    <Text>Detected {estimated_items.length} item categories</Text>
                  </Space>
                ),
                children: (
                  <List
                    size="small"
                    dataSource={estimated_items}
                    renderItem={(item) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <Space size="small" wrap>
                              <Text strong>{item.category}</Text>
                              {item.subcategory && (
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  ({item.subcategory})
                                </Text>
                              )}
                              <Tag color="blue">×{item.quantity}</Tag>
                              {item.box_type && item.box_type !== 'N/A' && (
                                <Tooltip title="Recommended Box Type">
                                  <Tag icon={<InboxOutlined />} color="geekblue">
                                    {formatBoxType(item.box_type)}
                                  </Tag>
                                </Tooltip>
                              )}
                              {item.special_handling && item.special_handling.length > 0 && (
                                item.special_handling.map((handling, idx) => (
                                  <Tooltip key={idx} title="Special Handling Required">
                                    <Tag
                                      icon={<SafetyCertificateOutlined />}
                                      color={getSpecialHandlingColor(handling)}
                                    >
                                      {handling.replace(/_/g, ' ')}
                                    </Tag>
                                  </Tooltip>
                                ))
                              )}
                            </Space>
                          }
                          description={
                            item.packing_method && (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                📦 {item.packing_method}
                              </Text>
                            )
                          }
                        />
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
        </Space>
      </div>
    );
  };

  const renderAnalyzingState = () => {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <Space direction="vertical" size="large" align="center">
          <Spin size="large" tip="Analyzing photos..." />
          <Text type="secondary">
            Processing {group.photos.length} photo{group.photos.length !== 1 ? 's' : ''}...
          </Text>
        </Space>
      </div>
    );
  };

  const renderErrorState = () => {
    return (
      <Alert
        type="error"
        message="Analysis Failed"
        description={group.error || 'An error occurred while analyzing photos. Please try again.'}
        showIcon
        action={
          <Button size="small" type="primary" onClick={() => onAnalyze(group.id)}>
            Retry
          </Button>
        }
        style={{ marginTop: 16 }}
      />
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <Card
      title={renderCardTitle()}
      extra={renderCardExtra()}
      style={{
        borderColor: ROOM_COLORS[group.roomType],
        borderWidth: 2,
        marginBottom: 16,
      }}
      styles={{
        header: {
          borderBottom: `2px solid ${ROOM_COLORS[group.roomType]}`,
          backgroundColor: `${ROOM_COLORS[group.roomType]}10`,
        },
      }}
    >
      {/* Photo Grid */}
      {group.analysisStatus !== AnalysisStatus.ANALYZING && renderPhotoGrid()}

      {/* Analysis State */}
      {group.analysisStatus === AnalysisStatus.ANALYZING && renderAnalyzingState()}

      {/* Error State */}
      {group.analysisStatus === AnalysisStatus.FAILED && renderErrorState()}

      {/* Analysis Results */}
      {group.analysisStatus === AnalysisStatus.COMPLETED && renderAnalysisResults()}
    </Card>
  );
};

export default RoomPhotoGroup;
