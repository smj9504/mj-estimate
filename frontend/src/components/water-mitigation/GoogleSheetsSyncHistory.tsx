/**
 * Google Sheets Sync History Component
 * Displays recent synchronization history
 */

import React, { useState, useEffect } from 'react';
import { Table, Card, Tag, Typography, Space, Tooltip } from 'antd';
import { CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import googleSheetsService, { SyncLogEntry } from '../../services/googleSheetsService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ko';

dayjs.extend(relativeTime);
dayjs.locale('ko');

const { Text } = Typography;

const GoogleSheetsSyncHistory: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SyncLogEntry[]>([]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const data = await googleSheetsService.getSyncHistory(10);
      setHistory(data);
    } catch (error) {
      console.error('Failed to load sync history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const columns: ColumnsType<SyncLogEntry> = [
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        if (status === 'success') {
          return <Tag icon={<CheckCircleOutlined />} color="success">성공</Tag>;
        } else if (status === 'partial') {
          return <Tag icon={<ExclamationCircleOutlined />} color="warning">부분 성공</Tag>;
        } else {
          return <Tag icon={<CloseCircleOutlined />} color="error">실패</Tag>;
        }
      }
    },
    {
      title: '동기화 타입',
      dataIndex: 'sync_type',
      key: 'sync_type',
      width: 120,
      render: (type: string) => {
        return type === 'full' ? '전체 동기화' : '증분 동기화';
      }
    },
    {
      title: '처리 통계',
      key: 'stats',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>처리: {record.rows_processed}개</Text>
          <Space size={12}>
            <Text type="success">생성: {record.rows_created}</Text>
            <Text type="warning">업데이트: {record.rows_updated}</Text>
            {record.rows_failed > 0 && (
              <Text type="danger">실패: {record.rows_failed}</Text>
            )}
          </Space>
        </Space>
      )
    },
    {
      title: '시작 시간',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 180,
      render: (time: string) => (
        <Tooltip title={dayjs(time).format('YYYY-MM-DD HH:mm:ss')}>
          {dayjs(time).fromNow()}
        </Tooltip>
      )
    },
    {
      title: '소요 시간',
      key: 'duration',
      width: 100,
      render: (_, record) => {
        if (!record.completed_at) return '-';
        const start = dayjs(record.started_at);
        const end = dayjs(record.completed_at);
        const seconds = end.diff(start, 'second');
        return `${seconds}초`;
      }
    },
    {
      title: '오류 메시지',
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
      render: (error: string) => (
        error ? (
          <Tooltip title={error}>
            <Text type="danger" ellipsis>{error}</Text>
          </Tooltip>
        ) : '-'
      )
    }
  ];

  return (
    <Card
      title="동기화 이력"
      style={{ marginTop: 24 }}
      extra={
        <Text type="secondary">
          최근 10개 항목
        </Text>
      }
    >
      <Table
        columns={columns}
        dataSource={history}
        loading={loading}
        rowKey="id"
        pagination={false}
        size="small"
        scroll={{ x: 800 }}
      />
    </Card>
  );
};

export default GoogleSheetsSyncHistory;
