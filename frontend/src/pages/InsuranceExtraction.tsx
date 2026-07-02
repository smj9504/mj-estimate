import React, { useState } from 'react';
import { Card, Grid, Space, Typography, message } from 'antd';

import { ExtractionHierarchyView, ExtractionSummaryCard, ExtractionUploadPanel } from '../components/insurance-extraction';
import { fileService } from '../services/fileService';
import { insuranceExtractionService } from '../services/insuranceExtractionService';
import { InsuranceExtraction } from '../types/insuranceExtraction';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const InsuranceExtractionPage: React.FC = () => {
  const [insurancePdfFile, setInsurancePdfFile] = useState<File | null>(null);
  const [isExtractingInsurancePdf, setIsExtractingInsurancePdf] = useState(false);
  const [extractionResult, setExtractionResult] = useState<InsuranceExtraction | null>(null);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const handleRunInsuranceExtraction = async () => {
    if (!insurancePdfFile) {
      message.warning('Please select a PDF first');
      return;
    }

    try {
      setIsExtractingInsurancePdf(true);
      const uploaded = await fileService.uploadFiles(
        [insurancePdfFile],
        'insurance_extraction',
        `manual-insurance-extraction-${Date.now()}`,
        'insurance-pdf'
      );
      if (!uploaded.length) {
        throw new Error('File upload returned empty response');
      }

      const extracted = await insuranceExtractionService.extractFromFile(uploaded[0].id);
      const latest = await insuranceExtractionService.getExtraction(extracted.id);
      setExtractionResult(latest);
      message.success(`Extraction completed: ${latest.items.length} item(s)`);
    } catch (error) {
      console.error(error);
      message.error('Failed to run insurance PDF extraction');
    } finally {
      setIsExtractingInsurancePdf(false);
    }
  };

  return (
    <div>
      <Space direction="vertical" size={4} style={{ marginBottom: 16 }}>
        <Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
          Insurance Extraction
        </Title>
        <Text type="secondary" style={{ fontSize: isMobile ? 12 : 14 }}>
          Upload insurance estimate PDF, extract line items, and review normalized results.
        </Text>
      </Space>

      <ExtractionUploadPanel
        selectedFile={insurancePdfFile}
        isExtracting={isExtractingInsurancePdf}
        onFileSelect={setInsurancePdfFile}
        onRunExtraction={handleRunInsuranceExtraction}
      />

      {extractionResult && (
        <Card
          size={isMobile ? 'small' : 'default'}
          styles={{ body: { padding: isMobile ? 8 : undefined } }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={isMobile ? 8 : 16}>
            <ExtractionSummaryCard extraction={extractionResult} />
            <ExtractionHierarchyView
              items={extractionResult.items}
              hierarchy={extractionResult.parser_metadata?.hierarchy}
            />
          </Space>
        </Card>
      )}
    </div>
  );
};

export default InsuranceExtractionPage;
