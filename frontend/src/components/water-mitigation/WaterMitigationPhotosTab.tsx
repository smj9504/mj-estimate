/**
 * Water Mitigation Photos Tab
 * Uses FileGallery component with date-based grouping option
 */

import React from 'react';
import FileGallery from '../common/FileGallery/FileGallery';

interface WaterMitigationPhotosTabProps {
  jobId: string;
}

const WaterMitigationPhotosTab: React.FC<WaterMitigationPhotosTabProps> = ({ jobId }) => {
  return (
    <div className="wm-photos-tab" style={{ height: 'calc(100vh - 180px)', padding: '16px' }}>
      <FileGallery
        context="water-mitigation"
        mode="upload"
        contextId={jobId}

        // Image-specific settings
        allowedTypes={['image/*']}
        fileCategory="image"

        // Full screen utilization
        height="100%"
        allowUpload={true}
        allowCategoryCreate={true}

        // Multi-select support
        allowMultiSelect={true}

        // Water mitigation specific categories
        categories={[
          'uncategorized',
          'damage-assessment',
          'before-mitigation',
          'during-mitigation',
          'after-mitigation',
          'equipment',
          'moisture-readings',
          'documentation',
          'insurance',
          'general'
        ]}
        defaultViewMode="grid"
        allowViewModeChange={true}

        // Image-specific functionality
        showImagePreview={true}
        enableImageZoom={true}
        showImageInfo={true}
        allowBulkUpload={true}

        // Large image handling
        maxFileSize={20 * 1024 * 1024} // 20MB
        maxFiles={500} // Water mitigation jobs can have many photos

        // UI customization for images
        gridColumns={{ xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }}
        showThumbnails={true}
        enableLazyLoading={true}

        // Performance optimization: Enable infinite scroll
        enableInfiniteScroll={true}
        pageSize={50}  // Load 50 photos at a time

        // Upload configuration
        uploadConfig={{
          multiple: true,
          showUploadList: false,
          listType: 'picture-card',
          accept: 'image/*'
        }}

        // Enable date grouping for water mitigation photos
        enableDateGrouping={true}
      />
    </div>
  );
};

export default WaterMitigationPhotosTab;
