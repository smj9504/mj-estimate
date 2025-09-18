import React from 'react';
import FileGallery from '../common/FileGallery/FileGallery';

interface WorkOrderDocumentsTabProps {
  workOrderId: string;
}

const WorkOrderDocumentsTab: React.FC<WorkOrderDocumentsTabProps> = ({ workOrderId }) => {
  return (
    <div className="work-order-documents-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      <FileGallery
        context="work-order"
        mode="upload"
        contextId={workOrderId}

        // Document-specific settings
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

        // Full screen utilization
        height="100%"
        allowUpload={true}
        allowCategoryCreate={true}

        // Document-specific categories
        categories={['contracts', 'invoices', 'reports', 'permits', 'insurance', 'estimates', 'receipts', 'other']}
        defaultViewMode="list"
        allowViewModeChange={true}

        // Document management features
        showDocumentPreview={true}
        enableDocumentSearch={true}
        showDocumentDetails={true}
        allowBulkUpload={true}

        // Document file handling
        maxFileSize={50 * 1024 * 1024} // 50MB
        maxFiles={100}

        // Document list layout
        listLayout="detailed" // filename, size, date, description etc
        showPreviewPanel={true}
        enableFullTextSearch={true}

        // Upload configuration
        uploadConfig={{
          multiple: true,
          showUploadList: false,
          listType: 'text',
          accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
        }}
      />
    </div>
  );
};

export default WorkOrderDocumentsTab;