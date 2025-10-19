import React, { useState, useMemo, useCallback } from 'react';
import { Card, List, Button, Space, Typography, Divider, Collapse, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons';
import { useSketchContext } from '../context/SketchProvider';
import FixtureSelector from '../ui/FixtureSelector';
import { FixtureVariant, Dimensions, WallFixtureCategory, RoomFixtureCategory, DoorType, WindowType, CabinetType, BathroomType } from '../../../types/sketch';

const { Title, Text } = Typography;
const { Panel } = Collapse;

interface SketchSidebarProps {
  width?: number;
}

const SketchSidebar: React.FC<SketchSidebarProps> = ({
  width = 300,
}) => {
  const {
    sketch,
    addWallFixture,
    addRoomFixture,
    setCurrentTool,
    selectedFixture,
    fixtureDimensions,
    placementMode,
    setFixturePlacement
  } = useSketchContext();
  const [showFixtureSelector, setShowFixtureSelector] = useState(false);

  // Get current sketch data
  const rooms = sketch?.rooms || [];
  const wallFixtures = sketch?.wallFixtures || [];
  const roomFixtures = sketch?.roomFixtures || [];

  // Memoize allFixtures array to prevent unnecessary re-creation
  const allFixtures = useMemo(() => {
    return [...wallFixtures, ...roomFixtures];
  }, [wallFixtures, roomFixtures]);

  const handleAddFixture = useCallback(() => {
    setShowFixtureSelector(true);
  }, []);

  const handleFixtureSelect = useCallback((variant: FixtureVariant, dimensions: Dimensions) => {
    console.log('🎨 FixtureSelector - Fixture selected:', {
      name: variant.name,
      category: variant.category,
      type: variant.type,
      dimensions
    });

    // Determine placement mode based on fixture category
    if (variant.category === 'door' || variant.category === 'window') {
      console.log('   → Setting Wall placement mode');
      setFixturePlacement(variant, dimensions, 'wall');
      setCurrentTool('fixture');
      message.info('Click on a wall to place the ' + variant.name);
    } else {
      console.log('   → Setting Room placement mode');
      setFixturePlacement(variant, dimensions, 'room');
      setCurrentTool('fixture');
      message.info('Click in a room to place the ' + variant.name);
    }
  }, [setFixturePlacement, setCurrentTool]);

  const cancelFixturePlacement = useCallback(() => {
    setShowFixtureSelector(false);
    setFixturePlacement(null, null, null);
    setCurrentTool('select');
  }, [setFixturePlacement, setCurrentTool]);
  return (
    <div
      style={{
        width,
        backgroundColor: '#f5f5f5',
        borderLeft: '1px solid #e8e8e8',
        padding: '16px',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Rooms Section */}
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Title level={5} style={{ margin: 0 }}>Rooms ({rooms.length})</Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => message.info('Room creation not yet implemented')}
              >
                Add
              </Button>
            </div>
          }
          size="small"
        >
          {rooms.length === 0 ? (
            <Text type="secondary">No rooms added yet</Text>
          ) : (
            <List
              dataSource={rooms}
              renderItem={(room) => (
                <List.Item
                  actions={[
                    <Button
                      key="edit"
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => message.info('Room editing not yet implemented')}
                    />,
                    <Button
                      key="delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => message.info('Room deletion not yet implemented')}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={room.name}
                    description={
                      <div>
                        <div>{room.type}</div>
                        <div>{room.areas.floorArea.toFixed(1)} sq ft</div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </Card>

        {/* Fixtures Section */}
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Title level={5} style={{ margin: 0 }}>Fixtures ({allFixtures.length})</Title>
              {!showFixtureSelector ? (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={handleAddFixture}
                >
                  Add
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={cancelFixturePlacement}
                >
                  Cancel
                </Button>
              )}
            </div>
          }
          size="small"
        >
          {showFixtureSelector ? (
            <FixtureSelector
              onSelectFixture={handleFixtureSelect}
              selectedFixture={selectedFixture || undefined}
            />
          ) : (
            <>
              {allFixtures.length === 0 ? (
                <Text type="secondary">No fixtures added yet</Text>
              ) : (
                <List
                  dataSource={allFixtures}
                  renderItem={(fixture) => (
                    <List.Item
                      actions={[
                        <Button
                          key="delete"
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => {
                            // TODO: Implement fixture deletion
                            message.info('Fixture deletion not yet implemented');
                          }}
                        />,
                      ]}
                    >
                      <List.Item.Meta
                        title={fixture.category || 'Unknown'}
                        description={`${Math.floor(fixture.dimensions.width)}' ${Math.round((fixture.dimensions.width % 1) * 12)}" × ${Math.floor(fixture.dimensions.height)}' ${Math.round((fixture.dimensions.height % 1) * 12)}"`}
                      />
                    </List.Item>
                  )}
                />
              )}
            </>
          )}
        </Card>

        {/* Placement Instructions */}
        {placementMode && selectedFixture && (
          <Card size="small" style={{ backgroundColor: '#e6f7ff', borderColor: '#91d5ff' }}>
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text strong>Placing: {selectedFixture.name}</Text>
              <Text>
                {placementMode === 'wall'
                  ? 'Click on a wall to place this fixture'
                  : 'Click in a room to place this fixture'
                }
              </Text>
              <Text type="secondary">
                Size: {fixtureDimensions && `${Math.floor(fixtureDimensions.width / 12)}' ${fixtureDimensions.width % 12}" × ${Math.floor(fixtureDimensions.height / 12)}' ${fixtureDimensions.height % 12}"`}
              </Text>
              <Button size="small" block onClick={cancelFixturePlacement}>
                Cancel Placement
              </Button>
            </Space>
          </Card>
        )}

        {/* Properties Section */}
        <Card title="Properties" size="small">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div>
              <Text strong>Scale:</Text>
              <br />
              <Text>1" = 1'</Text>
            </div>
            <Divider />
            <div>
              <Text strong>Units:</Text>
              <br />
              <Text>Feet & Inches</Text>
            </div>
            <Divider />
            <div>
              <Text strong>Total Area:</Text>
              <br />
              <Text>{rooms.reduce((sum, room) => sum + room.areas.floorArea, 0).toFixed(1)} sq ft</Text>
            </div>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default SketchSidebar;