import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, message } from 'antd';
import { estimateService, EstimateResponse } from '../services/EstimateService';
import EstimateCreation from './EstimateCreation';
import InsuranceEstimateCreation from './InsuranceEstimateCreation';

const EstimateEditWrapper: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);

  useEffect(() => {
    const fetchEstimate = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const estimateData = await estimateService.getEstimate(id);
        setEstimate(estimateData);
      } catch (error) {
        console.error('Failed to fetch estimate:', error);
        message.error('Failed to load estimate');
      } finally {
        setLoading(false);
      }
    };

    fetchEstimate();
  }, [id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="Loading estimate..." />
      </div>
    );
  }

  if (!estimate) {
    return <div>Estimate not found</div>;
  }

  // Render appropriate component based on estimate type
  if (estimate.estimate_type === 'insurance') {
    return <InsuranceEstimateCreation initialEstimate={estimate} />;
  } else {
    return <EstimateCreation initialEstimate={estimate} />;
  }
};

export default EstimateEditWrapper;