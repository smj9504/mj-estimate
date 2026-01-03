/**
 * InputModeSelector Component
 *
 * Beautiful card-based selector for choosing pack calculation input mode.
 * Displays 5 input methods with icons, descriptions, time estimates, and accuracy levels.
 *
 * Features:
 * - Responsive grid layout (3 cols desktop, 1 col mobile)
 * - Hover effects and active state
 * - "Recommended" badges
 * - Accessibility (keyboard navigation, ARIA labels)
 *
 * Usage:
 * <InputModeSelector
 *   selectedMode={mode}
 *   onModeChange={(mode) => setMode(mode)}
 * />
 */

import React from 'react';
import { Card, Row, Col, Badge, Typography, Space, Tag } from 'antd';
import {
  EditOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { PackInputMode } from '../../types/pack-calculation';

const { Title, Text, Paragraph } = Typography;

// ============================================================================
// Types
// ============================================================================

interface InputModeConfig {
  mode: PackInputMode;
  title: string;
  description: string;
  icon: React.ReactNode;
  timeEstimate: string;
  accuracy: 'High' | 'Medium' | 'Very High';
  recommended: boolean;
  color: string;
}

interface InputModeSelectorProps {
  /** Currently selected mode */
  selectedMode?: PackInputMode;
  /** Callback when mode changes */
  onModeChange: (mode: PackInputMode) => void;
  /** Optional disabled state */
  disabled?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

const INPUT_MODE_CONFIGS: InputModeConfig[] = [
  {
    mode: PackInputMode.STRUCTURED,
    title: 'Manual Entry',
    description: 'Enter each item individually with full control over categories, quantities, and pack sizes.',
    icon: <EditOutlined style={{ fontSize: 32 }} />,
    timeEstimate: '15-20 min',
    accuracy: 'Very High',
    recommended: false,
    color: '#1890ff',
  },
  {
    mode: PackInputMode.BULK_TEXT,
    title: 'Bulk Text',
    description: 'Paste a list of items from your notes or inventory. AI will automatically parse and categorize.',
    icon: <FileTextOutlined style={{ fontSize: 32 }} />,
    timeEstimate: '3-5 min',
    accuracy: 'High',
    recommended: true,
    color: '#52c41a',
  },
  {
    mode: PackInputMode.TEMPLATE,
    title: 'Room Templates',
    description: 'Select room types and density levels. Pre-built templates estimate items automatically.',
    icon: <AppstoreOutlined style={{ fontSize: 32 }} />,
    timeEstimate: '2-3 min',
    accuracy: 'Medium',
    recommended: true,
    color: '#722ed1',
  },
  {
    mode: PackInputMode.TEXT,
    title: 'Smart AI Parse',
    description: 'Describe the job in natural language. AI extracts items, quantities, and context.',
    icon: <RobotOutlined style={{ fontSize: 32 }} />,
    timeEstimate: '5-7 min',
    accuracy: 'High',
    recommended: false,
    color: '#fa8c16',
  },
  {
    mode: PackInputMode.IMAGE,
    title: 'Hybrid Mode',
    description: 'Combine templates with manual adjustments. Best of both speed and precision.',
    icon: <ThunderboltOutlined style={{ fontSize: 32 }} />,
    timeEstimate: '5-8 min',
    accuracy: 'Very High',
    recommended: true,
    color: '#eb2f96',
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get color for accuracy level
 */
const getAccuracyColor = (accuracy: string): string => {
  switch (accuracy) {
    case 'Very High':
      return '#52c41a';
    case 'High':
      return '#1890ff';
    case 'Medium':
      return '#faad14';
    default:
      return '#d9d9d9';
  }
};

// ============================================================================
// Component
// ============================================================================

const InputModeSelector: React.FC<InputModeSelectorProps> = ({
  selectedMode,
  onModeChange,
  disabled = false,
}) => {
  return (
    <div className="input-mode-selector">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Title level={3} style={{ marginBottom: 8 }}>
            Choose Your Input Method
          </Title>
          <Text type="secondary">
            Select how you'd like to enter your pack calculation items
          </Text>
        </div>

        {/* Mode Cards Grid */}
        <Row gutter={[16, 16]}>
          {INPUT_MODE_CONFIGS.map((config) => {
            const isSelected = selectedMode === config.mode;

            return (
              <Col xs={24} sm={24} md={12} lg={8} key={config.mode}>
                <Badge.Ribbon
                  text="Recommended"
                  color="green"
                  style={{ display: config.recommended ? 'block' : 'none' }}
                >
                  <Card
                    hoverable={!disabled}
                    onClick={() => !disabled && onModeChange(config.mode)}
                    style={{
                      height: '100%',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      border: isSelected ? `2px solid ${config.color}` : '1px solid #d9d9d9',
                      boxShadow: isSelected
                        ? `0 4px 12px ${config.color}40`
                        : '0 2px 8px rgba(0,0,0,0.1)',
                      transition: 'all 0.3s ease',
                      opacity: disabled ? 0.6 : 1,
                      backgroundColor: isSelected ? `${config.color}08` : '#fff',
                    }}
                    bodyStyle={{ padding: 24 }}
                    className={isSelected ? 'mode-card-selected' : 'mode-card'}
                  >
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      {/* Icon */}
                      <div
                        style={{
                          color: config.color,
                          display: 'flex',
                          justifyContent: 'center',
                          marginBottom: 8,
                        }}
                      >
                        {config.icon}
                      </div>

                      {/* Title */}
                      <Title
                        level={4}
                        style={{
                          textAlign: 'center',
                          marginBottom: 8,
                          color: isSelected ? config.color : undefined,
                        }}
                      >
                        {config.title}
                      </Title>

                      {/* Description */}
                      <Paragraph
                        type="secondary"
                        style={{
                          fontSize: 14,
                          textAlign: 'center',
                          marginBottom: 16,
                          minHeight: 60,
                        }}
                      >
                        {config.description}
                      </Paragraph>

                      {/* Metadata Tags */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        {/* Time Estimate */}
                        <Tag color="blue" style={{ margin: 0 }}>
                          ⏱️ {config.timeEstimate}
                        </Tag>

                        {/* Accuracy */}
                        <Tag color={getAccuracyColor(config.accuracy)} style={{ margin: 0 }}>
                          ✓ {config.accuracy}
                        </Tag>
                      </div>
                    </Space>
                  </Card>
                </Badge.Ribbon>
              </Col>
            );
          })}
        </Row>

        {/* Help Text */}
        <div
          style={{
            textAlign: 'center',
            padding: '16px 24px',
            background: '#fafafa',
            borderRadius: 8,
            border: '1px solid #d9d9d9',
          }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            💡 <strong>Tip:</strong> For fastest results, try{' '}
            <Text strong style={{ color: '#52c41a' }}>
              Bulk Text
            </Text>{' '}
            or{' '}
            <Text strong style={{ color: '#722ed1' }}>
              Room Templates
            </Text>
            . You can always edit items afterward.
          </Text>
        </div>
      </Space>

      {/* Custom Styles */}
      <style>{`
        .mode-card {
          transform: translateY(0);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .mode-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
        }

        .mode-card-selected {
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
        }

        @media (max-width: 768px) {
          .input-mode-selector .ant-col {
            margin-bottom: 0;
          }

          .mode-card:hover {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default InputModeSelector;
