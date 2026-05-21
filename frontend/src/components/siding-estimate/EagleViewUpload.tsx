import React, { useState } from 'react';
import {
  Upload, Button, Card, Descriptions, Table, Tag, Alert, Space, Statistic,
  Row, Col, message, Typography, Divider, Collapse,
} from 'antd';
import {
  UploadOutlined, FileTextOutlined, CheckCircleOutlined,
  HomeOutlined, ColumnWidthOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { sidingEstimateService } from '../../services/sidingEstimateService';
import type { EagleViewParseResponse, EagleViewWall } from '../../types/sidingEstimate';

const { Title, Text } = Typography;

interface EagleViewUploadProps {
  onParsed: (data: EagleViewParseResponse) => void;
  loading?: boolean;
}

const EagleViewUpload: React.FC<EagleViewUploadProps> = ({ onParsed, loading }) => {
  const [uploading, setUploading] = useState(false);
  const [parsedData, setParsedData] = useState<EagleViewParseResponse | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleUpload = async () => {
    if (fileList.length === 0) return;

    const file = fileList[0].originFileObj;
    if (!file) return;

    setUploading(true);
    try {
      const data = await sidingEstimateService.uploadEagleView(file);
      setParsedData(data);
      onParsed(data);
      message.success(`EagleView report ${data.report_id} parsed successfully`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to parse EagleView file');
    } finally {
      setUploading(false);
    }
  };

  const directionColor: Record<string, string> = {
    N: 'blue', S: 'red', E: 'green', W: 'orange',
    NE: 'cyan', NW: 'purple', SE: 'lime', SW: 'volcano',
  };

  const subTypeLabel: Record<string, string> = {
    WINDOW: 'Window', DOOR: 'Door', MAIN_DOOR: 'Main Door',
    GARAGE_DOOR: 'Garage Door', NONE: 'Other',
  };

  const wallColumns = [
    {
      title: 'Wall',
      dataIndex: 'designator',
      width: 60,
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: 'Direction',
      dataIndex: 'direction',
      width: 80,
      render: (v: string) => <Tag color={directionColor[v] || 'default'}>{v}</Tag>,
    },
    {
      title: 'Total Area (SF)',
      dataIndex: 'area',
      width: 100,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: 'Siding (SF)',
      dataIndex: 'siding_area_net',
      width: 100,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: 'Masonry (SF)',
      dataIndex: 'masonry_area',
      width: 100,
      align: 'right' as const,
      render: (v: number) => v > 0 ? v.toLocaleString() : '-',
    },
    {
      title: 'Windows',
      dataIndex: 'window_count',
      width: 80,
      align: 'center' as const,
      render: (v: number) => v > 0 ? v : '-',
    },
    {
      title: 'Doors',
      dataIndex: 'door_count',
      width: 70,
      align: 'center' as const,
      render: (v: number) => v > 0 ? v : '-',
    },
    {
      title: 'Openings',
      key: 'penetrations',
      render: (_: any, row: EagleViewWall) => (
        <Space size={[2, 2]} wrap>
          {row.penetrations.map((p, i) => (
            <Tag key={i} color={p.sub_type === 'GARAGE_DOOR' ? 'volcano' : p.sub_type.includes('DOOR') ? 'orange' : 'blue'}>
              {p.designator} ({p.dimension_raw})
            </Tag>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Upload Area */}
      {!parsedData && (
        <Card>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Title level={4}>
              <FileTextOutlined /> Upload EagleView Report
            </Title>
            <Text type="secondary">
              Upload the EagleView XML file to auto-populate measurements for the siding estimate.
            </Text>
            <Upload
              fileList={fileList}
              beforeUpload={(file) => {
                const isXml = file.name.toLowerCase().endsWith('.xml');
                if (!isXml) {
                  message.error('Please upload an XML file');
                  return false;
                }
                setFileList([{ ...file, uid: file.uid, originFileObj: file } as any]);
                return false; // prevent auto upload
              }}
              onRemove={() => setFileList([])}
              maxCount={1}
              accept=".xml"
            >
              <Button icon={<UploadOutlined />} size="large">
                Select EagleView XML File
              </Button>
            </Upload>
            {fileList.length > 0 && (
              <Button
                type="primary"
                size="large"
                onClick={handleUpload}
                loading={uploading}
                icon={<CheckCircleOutlined />}
              >
                Parse Report
              </Button>
            )}
          </Space>
        </Card>
      )}

      {/* Parsed Results */}
      {parsedData && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            message={`EagleView Report #${parsedData.report_id} parsed successfully`}
            description={`${parsedData.address}, ${parsedData.city}, ${parsedData.state} ${parsedData.zip_code}`}
            type="success"
            showIcon
            icon={<HomeOutlined />}
            action={
              <Button
                size="small"
                onClick={() => {
                  setParsedData(null);
                  setFileList([]);
                }}
              >
                Re-upload
              </Button>
            }
          />

          {/* Summary Statistics */}
          <Card title="Measurement Summary" size="small">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Siding Area (net)"
                  value={parsedData.total_siding_area_less_penetrations}
                  suffix="SF"
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Masonry Area"
                  value={parsedData.total_masonry_area_less_penetrations}
                  suffix="SF"
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Windows & Doors"
                  value={parsedData.total_windows_and_doors}
                  suffix={`(${parsedData.total_windows_and_doors_area} SF)`}
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="W&D Perimeter"
                  value={parsedData.total_windows_and_doors_perimeter}
                  suffix="LF"
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic title="Fascia" value={parsedData.fascia_lf} suffix="LF" />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Outside Corners"
                  value={parsedData.outside_corners_lf}
                  suffix="LF"
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Inside Corners"
                  value={parsedData.inside_corners_lf}
                  suffix="LF"
                />
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Statistic
                  title="Wall Facets"
                  value={parsedData.total_wall_facets}
                />
              </Col>
            </Row>
          </Card>

          {/* Wall Details */}
          <Collapse
            items={[{
              key: 'walls',
              label: `Wall Details (${parsedData.walls.length} walls)`,
              children: (
                <Table
                  columns={wallColumns}
                  dataSource={parsedData.walls}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  scroll={{ x: 800 }}
                />
              ),
            }, {
              key: 'corners',
              label: 'Corner & Length Details',
              children: (
                <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small" bordered>
                  <Descriptions.Item label="Outside Siding Corners">
                    {parsedData.outside_siding_corners_lf} LF
                  </Descriptions.Item>
                  <Descriptions.Item label="Inside Siding Corners">
                    {parsedData.inside_siding_corners_lf} LF
                  </Descriptions.Item>
                  <Descriptions.Item label="Obtuse Outside Corners">
                    {parsedData.obtuse_outside_corners_lf} LF
                  </Descriptions.Item>
                  <Descriptions.Item label="Top of Siding Walls">
                    {parsedData.top_siding_walls_lf} LF
                  </Descriptions.Item>
                  <Descriptions.Item label="Bottom of Siding Walls">
                    {parsedData.bottom_siding_walls_lf} LF
                  </Descriptions.Item>
                  <Descriptions.Item label="Fascia (Eaves + Rakes)">
                    {parsedData.fascia_lf} LF
                  </Descriptions.Item>
                </Descriptions>
              ),
            }]}
            defaultActiveKey={['walls']}
          />
        </Space>
      )}
    </div>
  );
};

export default EagleViewUpload;
