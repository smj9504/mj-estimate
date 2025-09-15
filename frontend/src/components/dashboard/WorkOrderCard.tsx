import React from 'react';
import { Card, Tag, Space, Typography, Button, Tooltip } from 'antd';
import { 
  ClockCircleOutlined, 
  UserOutlined, 
  FileTextOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { WorkOrderSummary } from '../../services/dashboardService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

interface WorkOrderCardProps {
  workOrder: WorkOrderSummary;
  onEdit?: (workOrder: WorkOrderSummary) => void;
  onComplete?: (workOrder: WorkOrderSummary) => void;
  onRevision?: (workOrder: WorkOrderSummary) => void;
}

const priorityColors = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a'
};

const statusColors = {
  draft: 'default',
  pending: 'warning',
  in_progress: 'processing',
  completed: 'success',
  cancelled: 'error',
  on_hold: 'default'
};

const WorkOrderCard: React.FC<WorkOrderCardProps> = ({ 
  workOrder, 
  onEdit, 
  onComplete,
  onRevision 
}) => {
  const getPriorityIcon = () => {
    if (workOrder.is_overdue) {
      return <ExclamationCircleOutlined style={{ color: '#dc2626' }} />;
    }
    return null;
  };

  return (
    <Card 
      size="small"
      style={{ marginBottom: 8 }}
      hoverable
      extra={
        <Space>
          {onRevision && workOrder.revision_requested && (
            <Tooltip title="Revision Requested">
              <Button 
                type="link" 
                danger 
                icon={<EditOutlined />}
                onClick={() => onRevision(workOrder)}
              />
            </Tooltip>
          )}
          {onComplete && workOrder.status !== 'completed' && (
            <Tooltip title="Mark Complete">
              <Button 
                type="link" 
                icon={<CheckCircleOutlined />}
                onClick={() => onComplete(workOrder)}
              />
            </Tooltip>
          )}
          {onEdit && (
            <Tooltip title="Edit">
              <Button 
                type="link" 
                icon={<EditOutlined />}
                onClick={() => onEdit(workOrder)}
              />
            </Tooltip>
          )}
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Text strong>{workOrder.work_order_number}</Text>
            <Tag color={priorityColors[workOrder.priority]}>
              {workOrder.priority.toUpperCase()}
            </Tag>
            <Tag color={statusColors[workOrder.status as keyof typeof statusColors]}>
              {workOrder.status.replace('_', ' ').toUpperCase()}
            </Tag>
            {workOrder.is_overdue && (
              <Tag color="error" icon={<ExclamationCircleOutlined />}>
                OVERDUE
              </Tag>
            )}
          </Space>
          {getPriorityIcon()}
        </Space>

        <Space>
          <FileTextOutlined />
          <Text>{workOrder.document_type.replace('_', ' ')}</Text>
          <Text type="secondary">•</Text>
          <Text>{workOrder.client_name}</Text>
        </Space>

        <Space>
          <ClockCircleOutlined />
          <Text type="secondary">
            Created {dayjs(workOrder.created_at).fromNow()}
          </Text>
          {workOrder.scheduled_end_date && (
            <>
              <Text type="secondary">•</Text>
              <Text type="secondary">
                Due {dayjs(workOrder.scheduled_end_date).format('MMM DD, YYYY')}
              </Text>
            </>
          )}
        </Space>

        {workOrder.assigned_staff.length > 0 && (
          <Space>
            <UserOutlined />
            {workOrder.assigned_staff.map((staff, index) => (
              <Text key={staff.id} type="secondary">
                {staff.name}{index < workOrder.assigned_staff.length - 1 ? ', ' : ''}
              </Text>
            ))}
          </Space>
        )}

        {workOrder.revision_requested && (
          <Space>
            <ExclamationCircleOutlined style={{ color: '#dc2626' }} />
            <Text type="danger">
              Revision requested ({workOrder.revision_count} revision{workOrder.revision_count !== 1 ? 's' : ''})
            </Text>
          </Space>
        )}
      </Space>
    </Card>
  );
};

export default WorkOrderCard;