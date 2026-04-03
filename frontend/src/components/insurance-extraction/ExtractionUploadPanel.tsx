import React from 'react';
import { Button, Card, Space, Upload } from 'antd';
import { ScanOutlined, UploadOutlined } from '@ant-design/icons';

interface ExtractionUploadPanelProps {
  selectedFile: File | null;
  isExtracting: boolean;
  onFileSelect: (file: File | null) => void;
  onRunExtraction: () => void;
}

const ExtractionUploadPanel: React.FC<ExtractionUploadPanelProps> = ({
  selectedFile,
  isExtracting,
  onFileSelect,
  onRunExtraction,
}) => {
  return (
    <Card title="Insurance PDF Extraction" style={{ marginBottom: 24 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Upload
          maxCount={1}
          accept=".pdf,application/pdf"
          beforeUpload={(file) => {
            onFileSelect(file);
            return false;
          }}
          onRemove={() => {
            onFileSelect(null);
            return true;
          }}
        >
          <Button icon={<UploadOutlined />}>Select Insurance PDF</Button>
        </Upload>

        <Button
          type="primary"
          icon={<ScanOutlined />}
          loading={isExtracting}
          onClick={onRunExtraction}
          disabled={!selectedFile}
          data-testid="insurance-extraction-run"
        >
          Run Extraction
        </Button>
      </Space>
    </Card>
  );
};

export default ExtractionUploadPanel;
