/**
 * The estimates brought into a rebuild estimate: each with its total, the
 * room it is in (a bathroom, the kitchen), and whether the original has been
 * recalculated since (Refresh takes it again). Import adds another from the
 * claim or the address.
 */

import React, { useState } from 'react';
import { Alert, Button, Card, Empty, List, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { ImportOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import rebuildEstimateService from '../../services/rebuildEstimateService';
import type { ImportedSource, RebuildRoom, SourceKind } from '../../types/rebuildEstimate';
import { money } from './lineEdit';

const { Text } = Typography;

const STATE_TAG: Record<ImportedSource['state'], { color: string; text: string }> = {
  current: { color: 'green', text: 'Up to date' },
  changed: { color: 'orange', text: 'Changed since it was brought in' },
  missing: { color: 'red', text: 'Original deleted' },
};

interface Props {
  estimateId: string;
  sources: ImportedSource[];
  rooms: RebuildRoom[];
  busy: boolean;
  onImport: (kind: SourceKind, estimateId: string) => Promise<unknown>;
  onRefresh: (sourceId: string) => void;
  onMove: (sourceId: string, roomId: string) => void;
  onRemove: (sourceId: string) => void;
}

const SourcesCard: React.FC<Props> = ({ estimateId, sources, rooms, busy, onImport, onRefresh, onMove, onRemove }) => {
  const [open, setOpen] = useState(false);
  const { data: offered, isFetching } = useQuery({
    queryKey: ['rebuild-importable', estimateId, sources.length],
    queryFn: () => rebuildEstimateService.importable(estimateId),
    enabled: open,
  });

  return (
    <Card
      size="small"
      title="Estimates brought in"
      extra={(
        <Button size="small" type="primary" icon={<ImportOutlined />} onClick={() => setOpen(true)} data-testid="import-estimate">
          Import an estimate
        </Button>
      )}
      style={{ marginBottom: 12 }}
    >
      {sources.length === 0 ? (
        <Text type="secondary">
          None yet. Import the flooring, bathroom and kitchen estimates on this claim: every line comes in, in its room.
        </Text>
      ) : (
        <List
          dataSource={sources}
          renderItem={(src) => {
            const tag = STATE_TAG[src.state];
            const oneRoom = src.rooms.length === 1 ? src.room_map[src.rooms[0].key] : undefined;
            return (
              <List.Item data-testid={`source-${src.kind}`}
                actions={[
                  src.state === 'changed' && (
                    <Button key="refresh" size="small" icon={<ReloadOutlined />} loading={busy} onClick={() => onRefresh(src.id)}>
                      Refresh
                    </Button>
                  ),
                  <Popconfirm key="remove" title="Take its lines out of this estimate?" okText="Remove"
                    okButtonProps={{ danger: true }} onConfirm={() => onRemove(src.id)}>
                    <Button size="small" type="text" danger>Remove</Button>
                  </Popconfirm>,
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={(
                    <Space size={6} wrap>
                      <Link to={src.path}>{src.label}</Link>
                      <Tag color={tag.color}>{tag.text}</Tag>
                      {src.op_included && <Tag>O&amp;P in its prices</Tag>}
                    </Space>
                  )}
                  description={(
                    <Space size={8} wrap>
                      <Text strong>{money(src.total)}</Text>
                      <Text type="secondary">{src.line_count} lines</Text>
                      {oneRoom !== undefined && (
                        <Space size={4}>
                          <Text type="secondary">in</Text>
                          <Select size="small" value={oneRoom} style={{ width: 180 }} aria-label={`Room for ${src.label}`}
                            options={rooms.map((r) => ({ value: r.id, label: r.name }))}
                            onChange={(roomId: string) => onMove(src.id, roomId)} />
                        </Space>
                      )}
                      {src.rooms.length > 1 && <Text type="secondary">{src.rooms.length} rooms</Text>}
                    </Space>
                  )}
                />
              </List.Item>
            );
          }}
        />
      )}

      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title="Import an estimate" width={680}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          The flooring, bathroom and kitchen cabinet estimates on this estimate&apos;s claim, or at its address.
          Every line comes in as it was priced.
        </Text>
        <List
          loading={isFetching}
          dataSource={offered || []}
          locale={{ emptyText: <Empty description="None found: pick the claim (or the address) on the project first" /> }}
          renderItem={(o) => (
            <List.Item
              data-testid={`importable-${o.kind}`}
              actions={[
                o.imported ? <Tag key="in">Already in</Tag>
                  : !o.calculated ? <Link key="calc" to={o.path}>Calculate it first</Link>
                    : (
                      <Button key="import" size="small" type="primary" loading={busy}
                        onClick={() => onImport(o.kind, o.estimate_id).then(() => setOpen(false))}>
                        Import
                      </Button>
                    ),
              ]}
            >
              <List.Item.Meta
                title={o.label}
                description={(
                  <Space size={8} wrap>
                    {o.calculated && <Text strong>{money(o.total)}</Text>}
                    {o.calculated && <Text type="secondary">{o.line_count} lines</Text>}
                    <Tag>{o.status}</Tag>
                    {o.property_address && <Text type="secondary">{o.property_address}</Text>}
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
        {sources.some((s) => s.op_included) && (
          <Alert type="info" showIcon style={{ marginTop: 12 }}
            message="An estimate brought in keeps the O&P and material tax it was priced with." />
        )}
      </Modal>
    </Card>
  );
};

export default SourcesCard;
