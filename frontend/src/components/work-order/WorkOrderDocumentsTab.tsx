import React, { useState } from 'react';
import { Button } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import FileGallery from '../common/FileGallery/FileGallery';
import CompletionReportModal from './CompletionReportModal';

interface WorkOrderDocumentsTabProps {
  workOrderId: string;
  claimId?: string;
}

const WorkOrderDocumentsTab: React.FC<WorkOrderDocumentsTabProps> = ({ workOrderId, claimId }) => {
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className="work-order-documents-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      <Button
        style={{ marginBottom: 12 }}
        type="primary"
        icon={<FilePdfOutlined />}
        onClick={() => setReportModalVisible(true)}
        disabled={!claimId}
        title={!claimId ? 'Link a claim to this work order to generate completion reports' : undefined}
      >
        Generate Completion Report
      </Button>

      <FileGallery
        context="work-order"
        mode="upload"
        contextId={workOrderId}
        allowedTypes={[
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'text/csv'
        ]}
        fileCategory="document"
        height="calc(100% - 48px)"
        allowUpload={true}
        allowCategoryCreate={true}
        allowMultiSelect={true}
        categories={['contracts', 'invoices', 'reports', 'permits', 'insurance', 'estimates', 'receipts', 'other']}
        defaultViewMode="list"
        allowViewModeChange={true}
        showDocumentPreview={true}
        enableDocumentSearch={true}
        showDocumentDetails={true}
        allowBulkUpload={true}
        maxFileSize={50 * 1024 * 1024}
        maxFiles={100}
        listLayout="detailed"
        showPreviewPanel={true}
        enableFullTextSearch={true}
        uploadConfig={{
          multiple: true,
          showUploadList: false,
          listType: 'text',
          accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
        }}
      />

      <CompletionReportModal
        visible={reportModalVisible}
        workOrderId={workOrderId}
        claimId={claimId}
        onClose={() => setReportModalVisible(false)}
        onGenerated={() => {
          setReportModalVisible(false);
          queryClient.invalidateQueries({ queryKey: ['work-order-documents-count', workOrderId] });
        }}
      />
    </div>
  );
};

export default WorkOrderDocumentsTab;
