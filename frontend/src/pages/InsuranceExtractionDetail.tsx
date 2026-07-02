import React, { useState } from 'react';
import { Button, Card, Grid, Result, Space, Spin, Tabs, Typography } from 'antd';
import { ArrowLeftOutlined, BarChartOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import {
  ExtractionAnalysisView,
  ExtractionHierarchyView,
  ExtractionSummaryCard,
} from '../components/insurance-extraction';
import { insuranceExtractionService } from '../services/insuranceExtractionService';
import { InsuranceExtraction } from '../types/insuranceExtraction';

const { Title } = Typography;
const { useBreakpoint } = Grid;

const InsuranceExtractionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [activeTab, setActiveTab] = useState('items');

  const { data: extraction, isLoading, error } = useQuery<InsuranceExtraction>({
    queryKey: ['insurance-extraction', id],
    queryFn: () => insuranceExtractionService.getExtraction(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !extraction) {
    return (
      <Result
        status="404"
        title="Extraction not found"
        extra={
          <Button type="primary" onClick={() => navigate('/insurance-extractions')}>
            Back to List
          </Button>
        }
      />
    );
  }

  const header = extraction.parser_metadata?.header;
  const label = header?.estimate_id
    ? String(header.estimate_id)
    : header?.insured
      ? String(header.insured)
      : extraction.id.slice(0, 8);

  return (
    <div>
      <Space
        style={{
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/insurance-extractions')}
          size={isMobile ? 'small' : 'middle'}
        >
          {isMobile ? '' : 'Back'}
        </Button>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
          {label}
        </Title>
      </Space>

      <Card
        size={isMobile ? 'small' : 'default'}
        styles={{ body: { padding: isMobile ? 8 : undefined } }}
      >
        <ExtractionSummaryCard extraction={extraction} />
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size={isMobile ? 'small' : 'middle'}
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'items',
              label: (
                <span>
                  <UnorderedListOutlined /> Items
                </span>
              ),
              children: (
                <ExtractionHierarchyView
                  items={extraction.items}
                  hierarchy={extraction.parser_metadata?.hierarchy}
                />
              ),
            },
            {
              key: 'analysis',
              label: (
                <span>
                  <BarChartOutlined /> Analysis
                </span>
              ),
              children: activeTab === 'analysis' ? (
                <ExtractionAnalysisView extractionId={extraction.id} />
              ) : null,
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default InsuranceExtractionDetail;
