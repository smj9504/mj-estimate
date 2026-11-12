/**
 * Flooring estimate. For now its sketch: the rooms, drawn wall to wall,
 * that every quantity of the estimate is measured from. The rooms'
 * materials, the priced result and the PDF come next.
 */

import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Skeleton, Space, Tag, Typography } from 'antd';
import FlooringSketchEditor from '../components/flooring-estimate/sketch/FlooringSketchEditor';
import flooringEstimateService from '../services/flooringEstimateService';
import type { FlooringEstimate } from '../types/flooringEstimate';

const { Title, Text } = Typography;

const FlooringEstimateDetail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ['flooring-estimate', id],
    queryFn: () => flooringEstimateService.getById(id),
    enabled: !!id,
    // The editor holds the drawing while it is open; don't refetch it from under it
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton active />;
  if (error || !estimate) {
    return <Alert type="error" showIcon message="This flooring estimate couldn't be opened." />;
  }

  const address = [estimate.property_address, estimate.city, estimate.state].filter(Boolean).join(', ');

  return (
    <div style={{ padding: 16 }}>
      <Space align="baseline" wrap style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>Flooring Estimate</Title>
        {address && <Text type="secondary">{address}</Text>}
        <Tag>{estimate.status}</Tag>
      </Space>
      <Card size="small" title="Sketch" styles={{ body: { padding: 12 } }}>
        <FlooringSketchEditor
          key={estimate.id}
          estimateId={estimate.id}
          initialSketch={estimate.sketch_data}
          onSaved={(saved: FlooringEstimate) => queryClient.setQueryData(['flooring-estimate', id], saved)}
        />
      </Card>
    </div>
  );
};

export default FlooringEstimateDetail;
