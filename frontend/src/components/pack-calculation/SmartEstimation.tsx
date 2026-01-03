/**
 * Smart Estimation Component (SMART Mode)
 *
 * AI-powered density-based room estimation with two-step wizard:
 * Step 1: Select room type with visual icons
 * Step 2: Adjust density level with visual guide and custom adjustments
 *
 * Features:
 * - Visual density slider with reference images/emojis
 * - Custom adjustment controls (cabinets, closets, special features)
 * - Real-time estimation preview with breakdown
 * - Confidence scoring and assumptions display
 * - "From photos" indicator for AI analysis
 */

import React, { useState, useEffect } from 'react';
import {
  Steps,
  Card,
  Row,
  Col,
  Slider,
  InputNumber,
  Checkbox,
  Button,
  Space,
  Typography,
  Tag,
  Alert,
  Divider,
  Statistic,
  Progress,
  Spin,
  message,
  Tooltip,
  Collapse,
} from 'antd';
import {
  HomeOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  CameraOutlined,
  WarningOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  RoomType,
  DensityLevel,
  DensityEstimationResponse,
  DensityEstimationRequest,
} from '../../types/pack-calculation';
import {
  estimateByDensity,
  getRoomTypeLabel,
  getDensityLevelInfo,
} from '../../services/packTemplateService';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

// ============================================================================
// Types & Interfaces
// ============================================================================

interface SmartEstimationProps {
  onApplyEstimate: (estimation: DensityEstimationResponse, config: EstimationConfig) => void;
  initialRoomType?: RoomType;
  initialDensity?: DensityLevel;
  fromPhotoAnalysis?: boolean; // Indicates if estimation comes from photo AI
}

interface EstimationConfig {
  room_type: RoomType;
  density_level: DensityLevel;
  custom_adjustments: CustomAdjustments;
}

interface CustomAdjustments {
  cabinet_count?: number;
  closet_count?: number;
  has_walk_in_closet?: boolean;
  has_pantry?: boolean;
  has_built_in_shelves?: boolean;
  additional_storage?: number;
}

// ============================================================================
// Room Type Configuration
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
// Density Level Visual Guide
// ============================================================================

const DENSITY_VISUALS: Record<DensityLevel, { emoji: string; description: string; tips: string }> = {
  [DensityLevel.MINIMAL]: {
    emoji: '😌',
    description: 'Sparse furnishings, few belongings',
    tips: 'Minimal furniture, mostly empty spaces, recent move-in or minimalist lifestyle',
  },
  [DensityLevel.MODERATE]: {
    emoji: '🏠',
    description: 'Average furnishings, typical household',
    tips: 'Standard furniture set, normal amount of belongings, lived-in but organized',
  },
  [DensityLevel.FULL]: {
    emoji: '📚',
    description: 'Well-furnished, many belongings',
    tips: 'Full furniture set, collections, decorations, established household',
  },
  [DensityLevel.PACKED]: {
    emoji: '🎁',
    description: 'Heavily furnished, maximum storage utilization',
    tips: 'Every space utilized, multiple storage units, long-term residence, collector',
  },
};

const DENSITY_SLIDER_MARKS = {
  0: { label: <div style={{ fontSize: '24px' }}>😌</div> },
  1: { label: <div style={{ fontSize: '24px' }}>🏠</div> },
  2: { label: <div style={{ fontSize: '24px' }}>📚</div> },
  3: { label: <div style={{ fontSize: '24px' }}>🎁</div> },
};

const DENSITY_VALUES: DensityLevel[] = [
  DensityLevel.MINIMAL,
  DensityLevel.MODERATE,
  DensityLevel.FULL,
  DensityLevel.PACKED,
];

// ============================================================================
// Storage Type Icons
// ============================================================================

const STORAGE_TYPE_ICONS: Record<string, string> = {
  visible: '👁️',
  cabinet: '🗄️',
  closet: '🚪',
  drawer: '🗃️',
  shelves: '📚',
  general: '📦',
};

// ============================================================================
// Main Component
// ============================================================================

export const SmartEstimation: React.FC<SmartEstimationProps> = ({
  onApplyEstimate,
  initialRoomType,
  initialDensity,
  fromPhotoAnalysis = false,
}) => {
  // ============================================================================
  // State Management
  // ============================================================================

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedRoomType, setSelectedRoomType] = useState<RoomType | null>(
    initialRoomType || null
  );
  const [densityLevel, setDensityLevel] = useState<number>(
    initialDensity ? DENSITY_VALUES.indexOf(initialDensity) : 1
  );
  const [customAdjustments, setCustomAdjustments] = useState<CustomAdjustments>({});
  const [estimation, setEstimation] = useState<DensityEstimationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ============================================================================
  // Effects
  // ============================================================================

  // Auto-estimate when density or custom adjustments change (Step 2)
  useEffect(() => {
    if (selectedRoomType && currentStep === 1) {
      performEstimation();
    }
  }, [densityLevel, customAdjustments, selectedRoomType, currentStep]);

  // ============================================================================
  // API Calls
  // ============================================================================

  const performEstimation = async () => {
    if (!selectedRoomType) return;

    setLoading(true);
    setError(null);

    try {
      const request: DensityEstimationRequest = {
        room_type: selectedRoomType,
        density_level: DENSITY_VALUES[densityLevel],
        custom_adjustments: Object.keys(customAdjustments).length > 0
          ? customAdjustments
          : null,
      };

      const result = await estimateByDensity(request);
      setEstimation(result);
    } catch (err: any) {
      console.error('[SmartEstimation] Estimation failed:', err);
      setError(err.message || 'Failed to estimate items. Please try again.');
      message.error('Failed to estimate items');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleRoomTypeSelect = (roomType: RoomType) => {
    setSelectedRoomType(roomType);
    setCustomAdjustments({}); // Reset adjustments on room change
    setEstimation(null);
  };

  const handleDensityChange = (value: number) => {
    setDensityLevel(value);
  };

  const handleCustomAdjustmentChange = (key: keyof CustomAdjustments, value: any) => {
    setCustomAdjustments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleNextStep = () => {
    if (currentStep === 0 && selectedRoomType) {
      setCurrentStep(1);
      // Trigger initial estimation
      setTimeout(() => performEstimation(), 100);
    }
  };

  const handlePrevStep = () => {
    if (currentStep === 1) {
      setCurrentStep(0);
    }
  };

  const handleApplyEstimate = () => {
    if (!estimation || !selectedRoomType) return;

    const config: EstimationConfig = {
      room_type: selectedRoomType,
      density_level: DENSITY_VALUES[densityLevel],
      custom_adjustments: customAdjustments,
    };

    onApplyEstimate(estimation, config);
    message.success('Estimation applied successfully');
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const renderRoomTypeSelection = () => {
    return (
      <div>
        <Title level={4}>Select Room Type</Title>
        <Paragraph type="secondary">
          Choose the type of room you want to estimate packing requirements for.
        </Paragraph>

        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          {Object.values(RoomType).map((roomType) => {
            const isSelected = selectedRoomType === roomType;
            return (
              <Col xs={12} sm={8} md={6} key={roomType}>
                <Card
                  hoverable
                  onClick={() => handleRoomTypeSelect(roomType)}
                  style={{
                    borderColor: isSelected ? ROOM_COLORS[roomType] : undefined,
                    borderWidth: isSelected ? '2px' : '1px',
                    boxShadow: isSelected
                      ? `0 0 12px ${ROOM_COLORS[roomType]}40`
                      : undefined,
                    cursor: 'pointer',
                  }}
                  bodyStyle={{ padding: '16px', textAlign: 'center' }}
                >
                  <div style={{ fontSize: '48px', marginBottom: 8 }}>
                    {ROOM_ICONS[roomType]}
                  </div>
                  <Text strong>{getRoomTypeLabel(roomType)}</Text>
                  {isSelected && (
                    <div style={{ marginTop: 8 }}>
                      <CheckCircleOutlined
                        style={{ color: ROOM_COLORS[roomType], fontSize: 20 }}
                      />
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>

        <div style={{ marginTop: 32, textAlign: 'right' }}>
          <Button
            type="primary"
            size="large"
            icon={<ArrowRightOutlined />}
            onClick={handleNextStep}
            disabled={!selectedRoomType}
          >
            Next: Adjust Density
          </Button>
        </div>
      </div>
    );
  };

  const renderDensityAdjustment = () => {
    const currentDensityLevel = DENSITY_VALUES[densityLevel];
    const densityInfo = getDensityLevelInfo(currentDensityLevel);
    const densityVisual = DENSITY_VISUALS[currentDensityLevel];

    return (
      <div>
        {/* Header */}
        <Space style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>
            {ROOM_ICONS[selectedRoomType!]} {getRoomTypeLabel(selectedRoomType!)}
          </Title>
          {fromPhotoAnalysis && (
            <Tooltip title="Density estimated from photo analysis">
              <Tag icon={<CameraOutlined />} color="blue">
                From Photos
              </Tag>
            </Tooltip>
          )}
        </Space>

        {/* Density Slider */}
        <Card style={{ marginBottom: 24 }}>
          <Title level={5}>Density Level</Title>

          {/* Visual Guide */}
          <Card
            size="small"
            style={{
              backgroundColor: '#fafafa',
              marginBottom: 24,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '64px', marginBottom: 8 }}>
              {densityVisual.emoji}
            </div>
            <Text strong style={{ fontSize: 16 }}>
              {densityInfo.label}
            </Text>
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {densityVisual.description}
            </Paragraph>
            <Paragraph
              type="secondary"
              italic
              style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
            >
              {densityVisual.tips}
            </Paragraph>
          </Card>

          {/* Slider */}
          <Slider
            marks={DENSITY_SLIDER_MARKS}
            step={1}
            min={0}
            max={3}
            value={densityLevel}
            onChange={handleDensityChange}
            tooltip={{ formatter: null }}
          />

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Tag color="blue">Multiplier: {densityInfo.multiplier}x</Tag>
          </div>
        </Card>

        {/* Custom Adjustments */}
        <Card title="Custom Adjustments (Optional)" style={{ marginBottom: 24 }}>
          <Row gutter={[16, 16]}>
            {/* Cabinet Count */}
            <Col xs={24} sm={12}>
              <Space>
                <Text>🗄️ Cabinets:</Text>
                <InputNumber
                  min={0}
                  max={50}
                  value={customAdjustments.cabinet_count || 0}
                  onChange={(value) =>
                    handleCustomAdjustmentChange('cabinet_count', value || 0)
                  }
                  placeholder="Auto"
                />
              </Space>
            </Col>

            {/* Closet Count */}
            <Col xs={24} sm={12}>
              <Space>
                <Text>🚪 Closets:</Text>
                <InputNumber
                  min={0}
                  max={20}
                  value={customAdjustments.closet_count || 0}
                  onChange={(value) =>
                    handleCustomAdjustmentChange('closet_count', value || 0)
                  }
                  placeholder="Auto"
                />
              </Space>
            </Col>

            {/* Special Features */}
            <Col xs={24}>
              <Divider style={{ margin: '12px 0' }} />
              <Space direction="vertical">
                <Checkbox
                  checked={customAdjustments.has_walk_in_closet || false}
                  onChange={(e) =>
                    handleCustomAdjustmentChange(
                      'has_walk_in_closet',
                      e.target.checked
                    )
                  }
                >
                  Walk-in Closet
                </Checkbox>
                <Checkbox
                  checked={customAdjustments.has_pantry || false}
                  onChange={(e) =>
                    handleCustomAdjustmentChange('has_pantry', e.target.checked)
                  }
                >
                  Pantry
                </Checkbox>
                <Checkbox
                  checked={customAdjustments.has_built_in_shelves || false}
                  onChange={(e) =>
                    handleCustomAdjustmentChange(
                      'has_built_in_shelves',
                      e.target.checked
                    )
                  }
                >
                  Built-in Shelves
                </Checkbox>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Estimation Results */}
        {loading && (
          <Card>
            <Space direction="vertical" align="center" style={{ width: '100%' }}>
              <Spin size="large" />
              <Text type="secondary">Calculating estimate...</Text>
            </Space>
          </Card>
        )}

        {!loading && error && (
          <Alert
            type="error"
            message="Estimation Failed"
            description={error}
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}

        {!loading && estimation && renderEstimationPreview()}

        {/* Action Buttons */}
        <div style={{ marginTop: 24 }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={handlePrevStep}>
              Back
            </Button>
            <Button
              type="primary"
              size="large"
              icon={<ThunderboltOutlined />}
              onClick={handleApplyEstimate}
              disabled={!estimation || loading}
            >
              Apply Estimate
            </Button>
          </Space>
        </div>
      </div>
    );
  };

  const renderEstimationPreview = () => {
    if (!estimation) return null;

    return (
      <Card
        title={
          <Space>
            <InfoCircleOutlined />
            <Text strong>Estimation Preview</Text>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {/* Summary Statistics */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={8}>
            <Statistic
              title="Total Items"
              value={estimation.estimated_items.reduce(
                (sum, item) => sum + item.quantity,
                0
              )}
              prefix="📦"
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="Total Boxes"
              value={estimation.total_boxes}
              prefix="📦"
              valueStyle={{ color: '#1890ff' }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Confidence
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text strong style={{ fontSize: 24, color: '#52c41a' }}>
                  {estimation.confidence}%
                </Text>
                <Progress
                  percent={estimation.confidence}
                  showInfo={false}
                  strokeColor={
                    estimation.confidence >= 80
                      ? '#52c41a'
                      : estimation.confidence >= 60
                      ? '#faad14'
                      : '#ff4d4f'
                  }
                  style={{ marginTop: 8 }}
                />
              </div>
            </Card>
          </Col>
        </Row>

        {/* Breakdown by Storage Type */}
        {Object.keys(estimation.breakdown).length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <Title level={5}>Breakdown by Storage Type</Title>
            <Row gutter={[8, 8]}>
              {Object.entries(estimation.breakdown).map(([storageType, count]) => (
                <Col xs={12} sm={8} md={6} key={storageType}>
                  <Card size="small" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24 }}>
                      {STORAGE_TYPE_ICONS[storageType] || '📦'}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {storageType}
                    </Text>
                    <div>
                      <Text strong>{count}</Text>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}

        {/* Assumptions */}
        {estimation.assumptions.length > 0 && (
          <Collapse
            ghost
            items={[
              {
                key: 'assumptions',
                label: (
                  <Space>
                    <InfoCircleOutlined />
                    <Text strong>Assumptions Made ({estimation.assumptions.length})</Text>
                  </Space>
                ),
                children: (
                  <Card size="small" style={{ backgroundColor: '#fafafa' }}>
                    <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                      {estimation.assumptions.map((assumption, index) => (
                        <li key={index}>
                          <Text type="secondary">{assumption}</Text>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ),
              },
            ]}
          />
        )}
      </Card>
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Photo Analysis Indicator */}
      {fromPhotoAnalysis && (
        <Alert
          message="AI Photo Analysis Detected"
          description="This estimation is initialized based on AI analysis of uploaded photos. You can adjust the density and custom settings below."
          type="info"
          icon={<CameraOutlined />}
          showIcon
          closable
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Steps Navigation */}
      <Steps
        current={currentStep}
        style={{ marginBottom: 32 }}
        items={[
          {
            title: 'Room Type',
            icon: <HomeOutlined />,
          },
          {
            title: 'Density & Adjustments',
            icon: <SettingOutlined />,
          },
        ]}
      />

      {/* Step Content */}
      {currentStep === 0 && renderRoomTypeSelection()}
      {currentStep === 1 && renderDensityAdjustment()}
    </div>
  );
};

export default SmartEstimation;
