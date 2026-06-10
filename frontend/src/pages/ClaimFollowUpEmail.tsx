import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Typography, Spin, Button, Space, Descriptions, Tag, Row, Col } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { claimFollowUpService } from '../services/claimFollowUpService';
import { EmailComposer, CommunicationTimeline } from '../components/claim-followup';

const { Title, Text } = Typography;

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 576);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 575px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
};

const ClaimFollowUpEmail: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { data: task, isLoading } = useQuery({
    queryKey: ['followup-task', taskId],
    queryFn: () => claimFollowUpService.getTask(taskId!),
    enabled: !!taskId,
  });

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (!task) {
    return <div>Task not found</div>;
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/claim-followup')}
          size={isMobile ? 'small' : 'middle'}
        >
          {isMobile ? 'Back' : 'Back to Dashboard'}
        </Button>
        <Title level={isMobile ? 5 : 3} style={{ margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </Title>
      </div>

      {/* Task Summary */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Claim #">{task.claim_number || task.claim_id}</Descriptions.Item>
          <Descriptions.Item label="Type">
            <Tag>{task.task_type.replace('_', ' ')}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={
              task.status === 'resolved' ? 'green' :
              task.status === 'awaiting_response' ? 'orange' :
              task.status === 'pending' ? 'blue' : 'default'
            }>
              {task.status.replace('_', ' ').toUpperCase()}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Assigned To">
            {task.assigned_to_name || '-'} ({task.assigned_to_role})
          </Descriptions.Item>
          <Descriptions.Item label="Email">{task.assigned_to_email || '-'}</Descriptions.Item>
          <Descriptions.Item label="Due">
            {task.due_date ? dayjs(task.due_date).format('MM/DD/YYYY') : '-'}
          </Descriptions.Item>
          {!isMobile && (
            <>
              <Descriptions.Item label="Contacts Made">{task.contact_count}</Descriptions.Item>
              <Descriptions.Item label="Last Contacted">
                {task.last_contacted_at ? dayjs(task.last_contacted_at).format('MM/DD/YYYY h:mm A') : 'Never'}
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]}>
        {/* Email Composer */}
        <Col xs={24} lg={14}>
          <EmailComposer
            claimId={task.claim_id}
            followupTaskId={task.id}
            taskType={task.task_type}
            wmJobId={task.wm_job_id}
            contactCount={task.contact_count || 0}
            defaultTo={task.assigned_to_email || ''}
            onSent={() => navigate('/claim-followup')}
            onCancel={() => navigate('/claim-followup')}
          />
        </Col>

        {/* Communication Timeline */}
        <Col xs={24} lg={10}>
          <Card title="Communication History" size="small">
            <CommunicationTimeline claimId={task.claim_id} taskId={task.id} />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ClaimFollowUpEmail;
