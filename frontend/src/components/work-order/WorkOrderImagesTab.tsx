import React from 'react';
import FileGallery from '../common/FileGallery/FileGallery';

interface WorkOrderImagesTabProps {
  workOrderId: string;
}

const WorkOrderImagesTab: React.FC<WorkOrderImagesTabProps> = ({ workOrderId }) => {
  return (
    <div className="work-order-images-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      <FileGallery
        context="work-order"
        mode="upload"
        contextId={workOrderId}

        // Image-specific settings
        allowedTypes={['image/*']}
        fileCategory="image"

        // Full screen utilization
        height="100%"
        allowUpload={true}
        allowCategoryCreate={true}

        // Multi-select support
        allowMultiSelect={true}

        // Image gallery specific features
        categories={['before', 'during', 'after', 'reference', 'result', 'general']}
        defaultViewMode="grid"
        allowViewModeChange={true}

        // Image-specific functionality
        showImagePreview={true}
        enableImageZoom={true}
        showImageInfo={true}
        allowBulkUpload={true}

        // Large image handling
        maxFileSize={20 * 1024 * 1024} // 20MB
        maxFiles={200}

        // UI customization for images
        gridColumns={{ xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }}
        showThumbnails={true}
        enableLazyLoading={true}

        // Upload configuration
        uploadConfig={{
          multiple: true,
          showUploadList: false,
          listType: 'picture-card',
          accept: 'image/*'
        }}
      />
    </div>
  );
};

export default WorkOrderImagesTab;