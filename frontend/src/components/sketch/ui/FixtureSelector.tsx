/**
 * Fixture Selector Component
 * UI for selecting and configuring fixtures to place on walls or in rooms
 */

import React, { useState } from 'react';
import { Card, Tabs, Row, Col, Button, Input, InputNumber, Typography, Space, Tooltip } from 'antd';
import {
  WALL_FIXTURE_VARIANTS,
  ROOM_FIXTURE_VARIANTS,
  getFixtureVariantsByCategory
} from '../../../constants/fixtures';
import {
  FixtureVariant,
  WallFixtureCategory,
  RoomFixtureCategory,
  Dimensions
} from '../../../types/sketch';

const { Title, Text } = Typography;

interface FixtureSelectorProps {
  onSelectFixture: (variant: FixtureVariant, dimensions: Dimensions) => void;
  selectedFixture?: FixtureVariant;
  className?: string;
}

interface FixtureCardProps {
  variant: FixtureVariant;
  isSelected: boolean;
  onClick: () => void;
}

const FixtureCard: React.FC<FixtureCardProps> = ({ variant, isSelected, onClick }) => {
  return (
    <Card
      size="small"
      hoverable
      className={`fixture-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      style={{
        marginBottom: 8,
        border: isSelected ? '2px solid #1890ff' : '1px solid #d9d9d9',
        backgroundColor: isSelected ? '#f6ffed' : '#ffffff'
      }}
    >
      <div style={{ textAlign: 'center' }}>
        {/* Icon or SVG Preview */}
        <div style={{ fontSize: 24, marginBottom: 8 }}>
          {variant.svgPath ? (
            <svg
              width="40"
              height="40"
              viewBox="0 0 60 60"
              style={{ border: '1px solid #f0f0f0', borderRadius: 4 }}
            >
              <path
                d={variant.svgPath}
                fill="none"
                stroke="#333"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <span>{variant.icon}</span>
          )}
        </div>

        {/* Fixture Name */}
        <Text strong style={{ fontSize: 12 }}>
          {variant.name}
        </Text>

        {/* Default Dimensions */}
        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
          {variant.defaultDimensions.width}' × {variant.defaultDimensions.height}'
        </div>
      </div>
    </Card>
  );
};

const FixtureSelector: React.FC<FixtureSelectorProps> = ({
  onSelectFixture,
  selectedFixture,
  className
}) => {
  const [activeTab, setActiveTab] = useState<'wall' | 'room'>('wall');
  const [customDimensions, setCustomDimensions] = useState<Dimensions>({
    width: 3,
    height: 3
  });

  const handleFixtureSelect = (variant: FixtureVariant) => {
    // Use custom dimensions if they're different from default
    const dimensions = {
      width: customDimensions.width || variant.defaultDimensions.width,
      height: customDimensions.height || variant.defaultDimensions.height
    };

    onSelectFixture(variant, dimensions);

    // Update custom dimensions to match selected fixture defaults
    setCustomDimensions(variant.defaultDimensions);
  };

  const handleDimensionChange = () => {
    if (selectedFixture) {
      onSelectFixture(selectedFixture, customDimensions);
    }
  };

  // Group wall fixtures by category
  const doorVariants = getFixtureVariantsByCategory('door');
  const windowVariants = getFixtureVariantsByCategory('window');

  // Group room fixtures by category
  const cabinetVariants = getFixtureVariantsByCategory('cabinet');
  const vanityVariants = getFixtureVariantsByCategory('vanity');
  const applianceVariants = getFixtureVariantsByCategory('appliance');

  const tabItems = [
    {
      key: 'wall',
      label: 'Wall Fixtures',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* Doors Section */}
          <div>
            <Title level={5} style={{ margin: '8px 0', fontSize: 14 }}>
              Doors
            </Title>
            <Row gutter={[8, 8]}>
              {doorVariants.map((variant) => (
                <Col span={12} key={variant.id}>
                  <FixtureCard
                    variant={variant}
                    isSelected={selectedFixture?.id === variant.id}
                    onClick={() => handleFixtureSelect(variant)}
                  />
                </Col>
              ))}
            </Row>
          </div>

          {/* Windows Section */}
          <div>
            <Title level={5} style={{ margin: '8px 0', fontSize: 14 }}>
              Windows
            </Title>
            <Row gutter={[8, 8]}>
              {windowVariants.map((variant) => (
                <Col span={12} key={variant.id}>
                  <FixtureCard
                    variant={variant}
                    isSelected={selectedFixture?.id === variant.id}
                    onClick={() => handleFixtureSelect(variant)}
                  />
                </Col>
              ))}
            </Row>
          </div>
        </Space>
      )
    },
    {
      key: 'room',
      label: 'Room Fixtures',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* Cabinets Section */}
          <div>
            <Title level={5} style={{ margin: '8px 0', fontSize: 14 }}>
              Cabinets
            </Title>
            <Row gutter={[8, 8]}>
              {cabinetVariants.map((variant) => (
                <Col span={12} key={variant.id}>
                  <FixtureCard
                    variant={variant}
                    isSelected={selectedFixture?.id === variant.id}
                    onClick={() => handleFixtureSelect(variant)}
                  />
                </Col>
              ))}
            </Row>
          </div>

          {/* Vanities Section */}
          <div>
            <Title level={5} style={{ margin: '8px 0', fontSize: 14 }}>
              Vanities
            </Title>
            <Row gutter={[8, 8]}>
              {vanityVariants.map((variant) => (
                <Col span={12} key={variant.id}>
                  <FixtureCard
                    variant={variant}
                    isSelected={selectedFixture?.id === variant.id}
                    onClick={() => handleFixtureSelect(variant)}
                  />
                </Col>
              ))}
            </Row>
          </div>

          {/* Appliances Section */}
          <div>
            <Title level={5} style={{ margin: '8px 0', fontSize: 14 }}>
              Appliances
            </Title>
            <Row gutter={[8, 8]}>
              {applianceVariants.map((variant) => (
                <Col span={12} key={variant.id}>
                  <FixtureCard
                    variant={variant}
                    isSelected={selectedFixture?.id === variant.id}
                    onClick={() => handleFixtureSelect(variant)}
                  />
                </Col>
              ))}
            </Row>
          </div>
        </Space>
      )
    }
  ];

  return (
    <div className={className}>
      <Card title="Fixture Selector" size="small">
        {/* Scrollable content container */}
        <div style={{
          maxHeight: '400px',
          overflowY: 'auto',
          paddingRight: '4px' // Space for scrollbar
        }}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'wall' | 'room')}
            size="small"
            items={tabItems}
          />

          {/* Custom Dimensions Section */}
          {selectedFixture && (
            <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f9f9f9', borderRadius: 4 }}>
              <Title level={5} style={{ margin: '0 0 8px 0', fontSize: 14 }}>
                Dimensions
              </Title>
              <Row gutter={8}>
                <Col span={12}>
                  <Text style={{ fontSize: 12 }}>Width (ft)</Text>
                  <InputNumber
                    size="small"
                    min={0.5}
                    max={20}
                    step={0.25}
                    value={customDimensions.width}
                    onChange={(value) => {
                      const newDimensions = { ...customDimensions, width: value || 1 };
                      setCustomDimensions(newDimensions);
                    }}
                    onBlur={handleDimensionChange}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={12}>
                  <Text style={{ fontSize: 12 }}>
                    {activeTab === 'wall' ? 'Height (ft)' : 'Depth (ft)'}
                  </Text>
                  <InputNumber
                    size="small"
                    min={0.5}
                    max={20}
                    step={0.25}
                    value={customDimensions.height}
                    onChange={(value) => {
                      const newDimensions = { ...customDimensions, height: value || 1 };
                      setCustomDimensions(newDimensions);
                    }}
                    onBlur={handleDimensionChange}
                    style={{ width: '100%' }}
                  />
                </Col>
              </Row>

              <div style={{ marginTop: 8, textAlign: 'center' }}>
                <Button
                  size="small"
                  type="primary"
                  onClick={handleDimensionChange}
                  style={{ fontSize: 12 }}
                >
                  Apply Dimensions
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* CSS Styles - Use regular style tag instead of styled-jsx */}
      <style>{`
        .fixture-card {
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .fixture-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .fixture-card.selected {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(24, 144, 255, 0.2);
        }

        /* Custom scrollbar styles */
        .ant-card-body > div:first-child::-webkit-scrollbar {
          width: 6px;
        }

        .ant-card-body > div:first-child::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 3px;
        }

        .ant-card-body > div:first-child::-webkit-scrollbar-thumb {
          background: #c1c1c1;
          border-radius: 3px;
        }

        .ant-card-body > div:first-child::-webkit-scrollbar-thumb:hover {
          background: #a8a8a8;
        }

        /* For Firefox */
        .ant-card-body > div:first-child {
          scrollbar-width: thin;
          scrollbar-color: #c1c1c1 #f1f1f1;
        }
      `}</style>
    </div>
  );
};

export default FixtureSelector;