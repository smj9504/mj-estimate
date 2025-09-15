import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, message } from 'antd';
import { estimateService } from '../services/EstimateService';
import EstimateCreation from './EstimateCreation';
import InsuranceEstimateCreation from './InsuranceEstimateCreation';

const EstimateEditWrapper: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [estimateType, setEstimateType] = useState<string | null>(null);

  useEffect(() => {
    const fetchEstimate = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // Fetch estimate to determine its type
        const estimate = await estimateService.getEstimate(id);
        
        // Check estimate_type field first
        if (estimate.estimate_type) {
          setEstimateType(estimate.estimate_type);
        } 
        // Fallback: check if it has insurance fields
        else if (estimate.claim_number || estimate.policy_number) {
          setEstimateType('insurance');
        } else {
          setEstimateType('standard');
        }
      } catch (error) {
        console.error('Failed to fetch estimate:', error);
        message.error('Failed to load estimate');
        setEstimateType('standard'); // Default to standard if error
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

  // Render appropriate component based on estimate type
  if (estimateType === 'insurance') {
    return <InsuranceEstimateCreation />;
  } else {
    return <EstimateCreation />;
  }
};

export default EstimateEditWrapper;