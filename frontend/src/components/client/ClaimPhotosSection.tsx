import React from 'react';
import FileGallery from '../common/FileGallery/FileGallery';

interface ClaimPhotosSectionProps {
  claimId: string;
}

const ClaimPhotosSection: React.FC<ClaimPhotosSectionProps> = ({ claimId }) => {
  return (
    <div style={{ minHeight: 300 }}>
      <FileGallery
        context="claim"
        mode="upload"
        contextId={claimId}
        fileCategory="image"
        categories={['before', 'during', 'after', 'completion', 'damage', 'general']}
        allowUpload={true}
        allowMultiSelect={true}
        allowCategoryCreate={true}
        allowViewModeChange={true}
        defaultViewMode="grid"
        maxFileSize={20 * 1024 * 1024}
        maxFiles={200}
        height="400px"
        gridColumns={{ xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }}
        uploadConfig={{
          multiple: true,
          showUploadList: false,
          accept: 'image/*',
        }}
      />
    </div>
  );
};

export default ClaimPhotosSection;
