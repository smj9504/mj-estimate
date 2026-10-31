import React from 'react';
import FileGallery from '../common/FileGallery/FileGallery';
import type { FileGalleryProps } from '../common/FileGallery/types';

export const CLAIM_PHOTO_CATEGORIES = ['before', 'during', 'after', 'completion', 'damage', 'general'];

interface ClaimPhotosSectionProps {
  claimId: string;
  /** An extra action for the selected photos (Use for packing) */
  renderBulkExtraAction?: FileGalleryProps['renderBulkExtraAction'];
}

const ClaimPhotosSection: React.FC<ClaimPhotosSectionProps> = ({ claimId, renderBulkExtraAction }) => {
  return (
    <div style={{ minHeight: 300 }}>
      <FileGallery
        context="claim"
        mode="upload"
        contextId={claimId}
        fileCategory="image"
        categories={CLAIM_PHOTO_CATEGORIES}
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
        renderBulkExtraAction={renderBulkExtraAction}
      />
    </div>
  );
};

export default ClaimPhotosSection;
