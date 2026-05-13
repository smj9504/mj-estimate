/**
 * Pack Calculator New - Detail View Page
 * Shows detailed breakdown of packing estimates
 * Uses packing-estimate API (EstimateResponse structure)
 * Supports inline editing and re-analysis
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Row, Col, Typography, Space, Button, Descriptions, Table,
  Tag, Statistic, message, Spin, Divider, Tabs, Alert, Empty,
  Input, Select, Modal, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DownloadOutlined,
  ThunderboltOutlined, BoxPlotOutlined, TeamOutlined,
  SaveOutlined, CloseOutlined, LoadingOutlined,
  ReloadOutlined, FileTextOutlined, DollarOutlined,
  CameraOutlined, AppstoreOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import * as packingService from '../services/packingEstimateService';
import type {
  EstimateResponse, SectionDetailLine, MaterialItem,
  RoomItemSummary, SupplementItem, PackEstimateStatus,
} from '../types/packing-estimate';
import { formatDate } from '../utils/formatters';

const { Title, Text } = Typography;
const { Option } = Select;

/** Extended detail response from GET /api/packing-estimate/{id} */
interface EstimateDetail extends EstimateResponse {
  calculation_name: string | null;
  project_address: string | null;
  client_id: string | null;
  client_name: string | null;
  company_id: string | null;
  company_name: string | null;
  mode: string | null;
  status: string | null;
  notes: string | null;
  region: string | null;
  include_packback: boolean;
  storage_months: number;
  special_items: string[];
  custom_special_items: any[];
  claim_id: string | null;
}

const PackCalculatorNewDetail: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // PDF export state
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (id) loadEstimate(id);
  }, [id]);

  const loadEstimate = async (estimateId: string) => {
    setLoading(true);
    try {
      const data = await packingService.getEstimate(estimateId);
      setEstimate(data);
    } catch {
      message.error('Failed to load estimate details');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/reconstruction-estimate/pack-calculator-new/list');
  };

  // ── Edit ────────────────────────────────────

  const startEdit = useCallback(() => {
    if (!estimate) return;
    setEditName(estimate.calculation_name || '');
    setEditStatus(estimate.status || 'draft');
    setEditNotes(estimate.notes || '');
    setEditing(true);
  }, [estimate]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      await packingService.updateEstimate(id, {
        calculation_name: editName,
        status: editStatus,
        notes: editNotes,
      });
      message.success('Saved successfully');
      setEditing(false);
      await loadEstimate(id);
    } catch {
      message.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [id, editName, editStatus, editNotes]);

  // ── PDF Export ──────────────────────────────

  const handleDownload = useCallback(async () => {
    if (!id) return;
    setExporting(true);
    try {
      await packingService.exportPdf(id);
      message.success('PDF downloaded');
    } catch {
      message.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }, [id]);

  // ── Recalculate ─────────────────────────────

  const handleRecalculate = useCallback(() => {
    if (!id || !estimate) return;
    // Navigate to the create page with the estimate data loaded for re-analysis
    navigate('/reconstruction-estimate/pack-calculator-new', {
      state: {
        recalculateFrom: id,
        mode: estimate.mode,
        settings: {
          crew_size: estimate.crew_size,
          storage_months: estimate.storage_months,
          staging_type: estimate.staging_type,
          include_packback: estimate.include_packback,
          include_op: estimate.include_op,
          op_rate: estimate.op_rate,
          include_contingency: estimate.include_contingency,
          contingency_rate: estimate.contingency_rate,
          region: estimate.region,
          special_items: estimate.special_items || [],
          custom_special_items: estimate.custom_special_items || [],
        },
        calculationName: estimate.calculation_name,
        projectAddress: estimate.project_address,
        clientId: estimate.client_id,
        companyId: estimate.company_id,
        claimId: estimate.claim_id,
      },
    });
  }, [id, estimate, navigate]);

  // ── Loading / Empty ─────────────────────────

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" tip="Loading estimate details..." />
      </div>
    );
  }

  if (!estimate) {
    return (
      <Empty description="Estimate not found" image={Empty.PRESENTED_IMAGE_SIMPLE}>
        <Button type="primary" onClick={handleBack}>Back to List</Button>
      </Empty>
    );
  }

  // ── Helpers ─────────────────────────────────

  const modeLabel = estimate.mode === 'photo_ai' ? 'Photo AI' : 'Quick Estimate';
  const modeColor = estimate.mode === 'photo_ai' ? 'purple' : 'blue';
  const statusColorMap: Record<string, string> = {
    draft: 'default', completed: 'success', approved: 'blue',
  };

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <Card>
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>Back</Button>
                {editing ? (
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    style={{ fontSize: 20, fontWeight: 600, width: 400 }}
                    placeholder="Estimate Name"
                  />
                ) : (
                  <Title level={2} style={{ margin: 0 }}>
                    <ThunderboltOutlined /> {estimate.calculation_name || 'Untitled'}
                  </Title>
                )}
              </Space>
            </Col>
            <Col>
              <Space>
                {editing ? (
                  <>
                    <Button
                      icon={<CloseOutlined />}
                      onClick={cancelEdit}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="primary"
                      icon={saving ? <LoadingOutlined /> : <SaveOutlined />}
                      onClick={handleSave}
                      loading={saving}
                    >
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button icon={<EditOutlined />} onClick={startEdit}>Edit</Button>
                    <Tooltip title="Re-estimate with current settings">
                      <Button icon={<ReloadOutlined />} onClick={handleRecalculate}>
                        Recalculate
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={exporting ? <LoadingOutlined /> : <DownloadOutlined />}
                      onClick={handleDownload}
                      loading={exporting}
                    >
                      Export PDF
                    </Button>
                  </>
                )}
              </Space>
            </Col>
          </Row>

          <Divider />

          {/* Status and Info */}
          <Row gutter={16}>
            <Col span={12}>
              {editing ? (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Status</Text>
                    <Select
                      value={editStatus}
                      onChange={setEditStatus}
                      style={{ width: 200 }}
                    >
                      <Option value="draft">Draft</Option>
                      <Option value="completed">Completed</Option>
                      <Option value="approved">Approved</Option>
                    </Select>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Notes</Text>
                    <Input.TextArea
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      rows={3}
                      placeholder="Add notes..."
                    />
                  </div>
                </Space>
              ) : (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Created">
                    {formatDate(estimate.created_at || '')}
                  </Descriptions.Item>
                  {estimate.project_address && (
                    <Descriptions.Item label="Project Address">
                      {estimate.project_address}
                    </Descriptions.Item>
                  )}
                  {estimate.client_name && (
                    <Descriptions.Item label="Client">
                      {estimate.client_name}
                    </Descriptions.Item>
                  )}
                  {estimate.company_name && (
                    <Descriptions.Item label="Company">
                      {estimate.company_name}
                    </Descriptions.Item>
                  )}
                  {estimate.notes && (
                    <Descriptions.Item label="Notes">
                      {estimate.notes}
                    </Descriptions.Item>
                  )}
                </Descriptions>
              )}
            </Col>
            <Col span={12}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={modeColor} icon={estimate.mode === 'photo_ai' ? <CameraOutlined /> : <AppstoreOutlined />}>
                    {modeLabel}
                  </Tag>
                  <Tag color={statusColorMap[estimate.status || 'draft'] || 'default'}>
                    {estimate.status || 'draft'}
                  </Tag>
                </Space>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Crew Size">{estimate.crew_size}</Descriptions.Item>
                  {estimate.region && (
                    <Descriptions.Item label="Region">
                      {estimate.region.replace('_', ' ')}
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="Staging">
                    {estimate.staging_type === 'off_site' ? 'Off-site' : 'On-site'}
                  </Descriptions.Item>
                  {estimate.storage_months > 0 && (
                    <Descriptions.Item label="Storage">
                      {estimate.storage_months} months
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Summary Statistics */}
        <Card>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic
                title="Total Rooms"
                value={estimate.total_rooms || 0}
                prefix={<BoxPlotOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Total Items"
                value={estimate.total_items || 0}
                prefix={<FileTextOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Total Hours"
                value={(estimate.total_hours || 0).toFixed(1)}
                prefix={<TeamOutlined />}
                valueStyle={{ color: '#faad14' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title="Grand Total"
                value={estimate.grand_total || 0}
                prefix={<DollarOutlined />}
                precision={2}
                valueStyle={{ color: '#1890ff' }}
              />
            </Col>
          </Row>
        </Card>

        {/* Main Content Tabs */}
        <Card>
          <Tabs defaultActiveKey="sections">
            {/* Section Breakdown */}
            <Tabs.TabPane tab="Estimate Breakdown" key="sections">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {estimate.section_details && Object.keys(estimate.section_details).length > 0 ? (
                  Object.entries(estimate.section_details).map(([section, detail]) => (
                    <Card
                      key={section}
                      size="small"
                      title={
                        <Space>
                          <Text strong>{section}</Text>
                          <Tag color="blue">
                            ${(estimate.sections?.[section] || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </Tag>
                        </Space>
                      }
                    >
                      <Table
                        dataSource={detail.lines || []}
                        rowKey={(_, i) => `${section}-${i}`}
                        pagination={false}
                        size="small"
                        columns={[
                          {
                            title: 'Item',
                            dataIndex: 'name',
                            key: 'name',
                            width: '30%',
                          },
                          {
                            title: 'Detail',
                            dataIndex: 'detail',
                            key: 'detail',
                            width: '25%',
                            render: (v: string) => (
                              <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>
                            ),
                          },
                          {
                            title: 'Qty',
                            dataIndex: 'qty',
                            key: 'qty',
                            align: 'right' as const,
                            width: '10%',
                            render: (v: number, record: SectionDetailLine) => `${v} ${record.unit}`,
                          },
                          {
                            title: 'Rate',
                            dataIndex: 'rate',
                            key: 'rate',
                            align: 'right' as const,
                            width: '15%',
                            render: (v: number) => `$${(v || 0).toFixed(2)}`,
                          },
                          {
                            title: 'Amount',
                            dataIndex: 'amount',
                            key: 'amount',
                            align: 'right' as const,
                            width: '15%',
                            render: (v: number) => (
                              <Text strong>${(v || 0).toFixed(2)}</Text>
                            ),
                          },
                        ]}
                        summary={() => (
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={4}>
                              <Text strong>Section Total</Text>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              <Text strong>
                                ${(estimate.sections?.[section] || 0).toFixed(2)}
                              </Text>
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </Card>
                  ))
                ) : estimate.sections && Object.keys(estimate.sections).length > 0 ? (
                  <Descriptions bordered column={1}>
                    {Object.entries(estimate.sections).map(([section, amount]) => (
                      <Descriptions.Item key={section} label={section}>
                        <Text strong>${(amount as number).toFixed(2)}</Text>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ) : (
                  <Empty description="No section data available" />
                )}
              </Space>
            </Tabs.TabPane>

            {/* Materials */}
            <Tabs.TabPane tab="Materials" key="materials">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {estimate.material_details && estimate.material_details.length > 0 ? (
                  <Table
                    dataSource={estimate.material_details}
                    rowKey={(record, i) => `mat-${record.code}-${i}`}
                    pagination={false}
                    size="small"
                    columns={[
                      {
                        title: 'Code',
                        dataIndex: 'code',
                        key: 'code',
                        width: '15%',
                        render: (v: string) => <Tag color="blue">{v}</Tag>,
                      },
                      {
                        title: 'Name',
                        dataIndex: 'name',
                        key: 'name',
                        width: '30%',
                      },
                      {
                        title: 'Quantity',
                        dataIndex: 'quantity',
                        key: 'quantity',
                        align: 'right' as const,
                        width: '10%',
                      },
                      {
                        title: 'Unit',
                        dataIndex: 'unit',
                        key: 'unit',
                        align: 'center' as const,
                        width: '10%',
                      },
                      {
                        title: 'Unit Price',
                        dataIndex: 'unit_price',
                        key: 'unit_price',
                        align: 'right' as const,
                        width: '15%',
                        render: (v: number) => `$${(v || 0).toFixed(2)}`,
                      },
                      {
                        title: 'Total',
                        dataIndex: 'total',
                        key: 'total',
                        align: 'right' as const,
                        width: '15%',
                        render: (v: number) => <Text strong>${(v || 0).toFixed(2)}</Text>,
                      },
                    ]}
                  />
                ) : estimate.materials && Object.keys(estimate.materials).length > 0 ? (
                  <Descriptions bordered column={2}>
                    {Object.entries(estimate.materials).map(([code, qty]) => (
                      <Descriptions.Item key={code} label={<Tag color="blue">{code}</Tag>}>
                        {qty as number}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ) : (
                  <Empty description="No material data available" />
                )}
              </Space>
            </Tabs.TabPane>

            {/* Room Summaries */}
            <Tabs.TabPane tab="Rooms" key="rooms">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {estimate.room_summaries && estimate.room_summaries.length > 0 ? (
                  estimate.room_summaries.map((room, i) => (
                    <Card
                      key={`room-${i}`}
                      size="small"
                      title={
                        <Space>
                          <BoxPlotOutlined />
                          <Text strong>{room.room_name}</Text>
                          <Tag>{room.item_count} items</Tag>
                        </Space>
                      }
                    >
                      <Row gutter={16}>
                        {room.notable_items.length > 0 && (
                          <Col span={12}>
                            <Text type="secondary" style={{ fontSize: 12 }}>Notable Items</Text>
                            <div style={{ marginTop: 4 }}>
                              {room.notable_items.map((item, j) => (
                                <Tag key={j} style={{ marginBottom: 4 }}>{item}</Tag>
                              ))}
                            </div>
                          </Col>
                        )}
                        {room.high_value_items.length > 0 && (
                          <Col span={12}>
                            <Text type="secondary" style={{ fontSize: 12 }}>High Value Items</Text>
                            <div style={{ marginTop: 4 }}>
                              {room.high_value_items.map((item, j) => (
                                <Tag key={j} color="gold">{item}</Tag>
                              ))}
                            </div>
                          </Col>
                        )}
                      </Row>
                      {room.categories_present.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>Categories: </Text>
                          {room.categories_present.map((cat, j) => (
                            <Tag key={j} color="geekblue" style={{ marginBottom: 4 }}>{cat}</Tag>
                          ))}
                        </div>
                      )}
                      {room.packing_notes.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {room.packing_notes.map((note, j) => (
                            <Alert key={j} message={note} type="info" showIcon style={{ marginBottom: 4 }} />
                          ))}
                        </div>
                      )}
                    </Card>
                  ))
                ) : (
                  <Empty description="No room data available" />
                )}
              </Space>
            </Tabs.TabPane>

            {/* Supplements & Special Items */}
            {((estimate.supplements && estimate.supplements.length > 0) ||
              (estimate.special_items && estimate.special_items.length > 0)) && (
              <Tabs.TabPane tab="Supplements" key="supplements">
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {estimate.supplements && estimate.supplements.length > 0 && (
                    <Table
                      dataSource={estimate.supplements}
                      rowKey={(record) => record.key}
                      pagination={false}
                      size="small"
                      columns={[
                        {
                          title: 'Supplement',
                          dataIndex: 'name',
                          key: 'name',
                          width: '25%',
                        },
                        {
                          title: 'Description',
                          dataIndex: 'description',
                          key: 'description',
                          width: '35%',
                          render: (v: string) => <Text type="secondary">{v}</Text>,
                        },
                        {
                          title: 'Status',
                          key: 'status',
                          width: '15%',
                          align: 'center' as const,
                          render: (_: any, record: SupplementItem) => (
                            record.enabled
                              ? <Tag color="success">Enabled</Tag>
                              : <Tag color="default">Disabled</Tag>
                          ),
                        },
                        {
                          title: 'Amount',
                          dataIndex: 'amount',
                          key: 'amount',
                          align: 'right' as const,
                          width: '15%',
                          render: (v: number, record: SupplementItem) => (
                            record.enabled
                              ? <Text strong>${(v || 0).toFixed(2)}</Text>
                              : <Text type="secondary">-</Text>
                          ),
                        },
                      ]}
                    />
                  )}
                  {estimate.special_items && estimate.special_items.length > 0 && (
                    <Card size="small" title="Special Items">
                      <Space wrap>
                        {estimate.special_items.map((item, i) => (
                          <Tag key={i} color="orange">{item}</Tag>
                        ))}
                      </Space>
                    </Card>
                  )}
                </Space>
              </Tabs.TabPane>
            )}
          </Tabs>
        </Card>

        {/* Totals Card */}
        <Card title="Totals">
          <div style={{ maxWidth: 500, marginLeft: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <Text>Subtotal</Text>
              <Text strong>${(estimate.subtotal || 0).toFixed(2)}</Text>
            </div>
            {estimate.include_op && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <Text>O&P ({estimate.op_rate}%)</Text>
                <Text>${(estimate.op_amount || 0).toFixed(2)}</Text>
              </div>
            )}
            {estimate.supplements?.filter(s => s.enabled).map(s => (
              <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <Text>{s.name}</Text>
                <Text>${(s.amount || 0).toFixed(2)}</Text>
              </div>
            ))}
            {estimate.include_contingency && (estimate.contingency_amount || 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <Text>Contingency ({estimate.contingency_rate}%)</Text>
                <Text>${(estimate.contingency_amount || 0).toFixed(2)}</Text>
              </div>
            )}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '10px 0', borderTop: '2px solid #1890ff', marginTop: 8,
            }}>
              <Title level={4} style={{ margin: 0 }}>Grand Total</Title>
              <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
                ${(estimate.grand_total || 0).toFixed(2)}
              </Title>
            </div>
          </div>
        </Card>
      </Space>
    </div>
  );
};

export default PackCalculatorNewDetail;
