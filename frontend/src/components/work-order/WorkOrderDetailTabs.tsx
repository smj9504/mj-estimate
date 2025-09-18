import React from 'react';
import { Tabs } from 'antd';
import {
  InfoCircleOutlined,
  PictureOutlined,
  FileTextOutlined
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import WorkOrderInfoTab from './WorkOrderInfoTab';
import WorkOrderImagesTab from './WorkOrderImagesTab';
import WorkOrderDocumentsTab from './WorkOrderDocumentsTab';
import { workOrderService } from '../../services/workOrderService';

interface WorkOrderDetailTabsProps {
  workOrderId: string;
}

const WorkOrderDetailTabs: React.FC<WorkOrderDetailTabsProps> = ({ workOrderId }) => {
  // Fetch file counts for tab badges
  const { data: imageCount = 0 } = useQuery({
    queryKey: ['work-order-images-count', workOrderId],
    queryFn: () => workOrderService.getFileCount(workOrderId, 'image'),
    enabled: !!workOrderId,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: documentCount = 0 } = useQuery({
    queryKey: ['work-order-documents-count', workOrderId],
    queryFn: () => workOrderService.getFileCount(workOrderId, 'document'),
    enabled: !!workOrderId,
    staleTime: 0,
    gcTime: 0,
  });

  const tabItems = [
    {
      key: 'info',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <InfoCircleOutlined />
          <span>Info</span>
        </span>
      ),
      children: <WorkOrderInfoTab workOrderId={workOrderId} />
    },
    {
      key: 'images',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PictureOutlined />
          <span>Images {imageCount > 0 && `(${imageCount})`}</span>
        </span>
      ),
      children: <WorkOrderImagesTab workOrderId={workOrderId} />
    },
    {
      key: 'documents',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileTextOutlined />
          <span>Documents {documentCount > 0 && `(${documentCount})`}</span>
        </span>
      ),
      children: <WorkOrderDocumentsTab workOrderId={workOrderId} />
    }
  ];

  return (
    <div className="work-order-detail-tabs">
      <Tabs
        defaultActiveKey="info"
        items={tabItems}
        size="large"
        className="work-order-tabs"
        tabBarStyle={{
          marginBottom: 0,
          paddingLeft: 16,
          paddingRight: 16
        }}
        style={{ height: '100%' }}
      />
    </div>
  );
};

export default WorkOrderDetailTabs;