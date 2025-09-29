import React from 'react';
import { Card, List, Button, Space, Typography, Divider } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface SketchSidebarProps {
  width?: number;
  rooms?: Array<{ id: string; name: string; area: number; type: string }>;
  fixtures?: Array<{ id: string; name: string; type: string }>;
  onAddRoom?: () => void;
  onEditRoom?: (id: string) => void;
  onDeleteRoom?: (id: string) => void;
  onAddFixture?: () => void;
}

const SketchSidebar: React.FC<SketchSidebarProps> = ({
  width = 300,
  rooms = [],
  fixtures = [],
  onAddRoom = () => {},
  onEditRoom = () => {},
  onDeleteRoom = () => {},
  onAddFixture = () => {},
}) => {
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
                onClick={onAddRoom}
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
                      onClick={() => onEditRoom(room.id)}
                    />,
                    <Button
                      key="delete"
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onDeleteRoom(room.id)}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={room.name}
                    description={
                      <div>
                        <div>{room.type}</div>
                        <div>{room.area.toFixed(1)} sq ft</div>
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
              <Title level={5} style={{ margin: 0 }}>Fixtures ({fixtures.length})</Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={onAddFixture}
              >
                Add
              </Button>
            </div>
          }
          size="small"
        >
          {fixtures.length === 0 ? (
            <Text type="secondary">No fixtures added yet</Text>
          ) : (
            <List
              dataSource={fixtures}
              renderItem={(fixture) => (
                <List.Item>
                  <List.Item.Meta
                    title={fixture.name}
                    description={fixture.type}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>

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
              <Text>{rooms.reduce((sum, room) => sum + room.area, 0).toFixed(1)} sq ft</Text>
            </div>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default SketchSidebar;