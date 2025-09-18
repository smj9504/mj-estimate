import React from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Alert, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import WorkOrderDetailTabs from '../components/work-order/WorkOrderDetailTabs';


const WorkOrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) {
    return (
      <Alert
        message="Error"
        description="Work order ID is required."
        type="error"
        showIcon
        action={
          <Button onClick={() => navigate('/work-orders')}>
            Back to List
          </Button>
        }
      />
    );
  }

  return (
    <div className="work-order-detail-container" style={{ height: '100vh', overflow: 'hidden' }}>
      <WorkOrderDetailTabs workOrderId={id} />
    </div>
  );
};

export default WorkOrderDetail;