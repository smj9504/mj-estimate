import React, { useCallback } from 'react';
import { message } from 'antd';
import FileGallery from '../common/FileGallery/FileGallery';
import type { FileGalleryProps } from '../common/FileGallery/types';
import waterMitigationService from '../../services/waterMitigationService';

export const WM_PHOTO_CATEGORIES = [
  'uncategorized',
  'property-overview',
  'wet-area',
  'personal-properties',
  'pre-mitigation-moving',
  'demolition',
  'containment',
  'protection',
  'drying-process',
  'day-1',
  'day-2',
  'day-3',
  'documentation',
];

// What a job's photos are called next to the claim's other photo sets
export const wmPhotoSetLabel = (
  job: { company_name?: string; property_address?: string },
  index: number,
  jobCount: number,
): string => (jobCount > 1
  ? `WM · ${job.company_name || job.property_address || index + 1}`
  : 'Water mitigation');

interface ClaimWMPhotosProps {
  jobId: string;
  /** An extra action for the selected photos (Use for packing) */
  renderBulkExtraAction?: FileGalleryProps['renderBulkExtraAction'];
}

// A water mitigation job's photos on the claim: the same photos as the job's
// own Photos tab, so an upload or delete here shows there too. Deleting moves
// a photo to the job's trash, where it can still be restored.
const ClaimWMPhotos: React.FC<ClaimWMPhotosProps> = ({ jobId, renderBulkExtraAction }) => {
  const handleUpload = useCallback(async (files: File[], category?: string): Promise<void> => {
    const msgKey = `claim-wm-photo-upload-${jobId}`;
    message.loading({ content: `Uploading 0/${files.length} photos...`, key: msgKey, duration: 0 });
    try {
      const { results, failed } = await waterMitigationService.photos.uploadMultiple(
        jobId,
        files,
        category,
        (completed, total) => {
          message.loading({ content: `Uploading photos ${completed}/${total}...`, key: msgKey, duration: 0 });
        },
      );
      if (failed.length === 0) {
        message.success({ content: `Uploaded ${results.length} photo(s)`, key: msgKey, duration: 3 });
      } else {
        message.error({
          content: `${failed.length} of ${files.length} photos failed to upload. ${failed[0].error}`,
          key: msgKey,
          duration: 6,
        });
      }
    } catch (error: any) {
      message.error({ content: `Upload failed: ${error.message || 'Unknown error'}`, key: msgKey, duration: 5 });
    }
  }, [jobId]);

  return (
    <FileGallery
      context="water-mitigation"
      mode="upload"
      contextId={jobId}
      allowedTypes={['image/*']}
      fileCategory="image"
      categories={WM_PHOTO_CATEGORIES}
      allowUpload={true}
      onUpload={handleUpload}
      allowMultiSelect={true}
      allowViewModeChange={true}
      defaultViewMode="grid"
      enableDateGrouping={true}
      enableInfiniteScroll={true}
      pageSize={20}
      maxFileSize={20 * 1024 * 1024}
      maxFiles={500}
      height="520px"
      gridColumns={{ xs: 2, sm: 3, md: 4, lg: 5, xl: 6 }}
      uploadConfig={{
        multiple: true,
        showUploadList: false,
        accept: 'image/*',
      }}
      renderBulkExtraAction={renderBulkExtraAction}
    />
  );
};

export default ClaimWMPhotos;
