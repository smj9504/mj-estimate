/**
 * Pick photos already on the project's claim for a completion PDF: the same
 * photo sets as the client page (each water mitigation job's photos and the
 * claim's Completion photos), with CompanyCam importing into the open set.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import FileGallery from '../common/FileGallery/FileGallery';
import type { FileContext, FileItem } from '../common/FileGallery/types';
import { useSheetModal } from '../common/ui';
import { CLAIM_PHOTO_CATEGORIES } from '../client/ClaimPhotosSection';
import { WM_PHOTO_CATEGORIES, wmPhotoSetLabel } from '../client/ClaimWMPhotos';
import { useCompanyCamImport, type CompanyCamImportTarget } from '../water-mitigation/useCompanyCamImport';
import api from '../../services/api';
import { fileService } from '../../services/fileService';
import type { RebuildProject } from '../../types/rebuild';

export type ClaimPhotoSource = 'wm' | 'claim';

/** A photo of the claim's, as the PDF page list shows it */
export interface ClaimPhotoPick {
  source: ClaimPhotoSource;
  id: string;
  name: string;
  thumbUrl: string;
  setLabel: string;
}

interface PhotoSet {
  key: string;
  label: string;
  source: ClaimPhotoSource;
  context: FileContext;
  contextId: string;
  categories: string[];
  importTarget?: CompanyCamImportTarget;
}

const COMPLETION = 'completion';

const thumbFor = (source: ClaimPhotoSource, id: string) => (source === 'wm'
  ? `${api.defaults.baseURL || ''}/api/water-mitigation/photos/${id}/preview?size=thumbnail`
  : fileService.getPreviewUrl(id));

interface Props {
  open: boolean;
  project: RebuildProject;
  onClose: () => void;
  onAdd: (photos: ClaimPhotoPick[]) => void;
}

const RebuildClaimPhotoPicker: React.FC<Props> = ({ open, project, onClose, onAdd }) => {
  const queryClient = useQueryClient();
  const { isPhone, sheetProps } = useSheetModal('tall');
  const wmJobs = useMemo(() => project.wm_jobs ?? [], [project.wm_jobs]);

  // Completion photos first: where a rebuild's own photos go
  const sets = useMemo<PhotoSet[]>(() => [
    {
      key: COMPLETION,
      label: 'Completion',
      source: 'claim',
      context: 'claim',
      contextId: project.claim_id,
      categories: CLAIM_PHOTO_CATEGORIES,
      // A claim keeps no CompanyCam project, so each import finds it by the client's address
      importTarget: project.client_id ? {
        context: 'claim',
        contextId: project.claim_id,
        basePath: `/api/clients/${project.client_id}/claims/${project.claim_id}`,
      } : undefined,
    },
    ...wmJobs.map((job, i) => ({
      key: job.id,
      label: wmPhotoSetLabel(job, i, wmJobs.length),
      source: 'wm' as const,
      context: 'water-mitigation' as const,
      contextId: job.id,
      categories: WM_PHOTO_CATEGORIES,
      importTarget: {
        context: 'water-mitigation' as const,
        contextId: job.id,
        basePath: `/api/water-mitigation/jobs/${job.id}`,
        projectId: job.companycam_project_id,
        onProjectLinked: () => queryClient.invalidateQueries({ queryKey: ['rebuild-project', project.id] }),
      },
    })),
  ], [project.claim_id, project.client_id, project.id, wmJobs, queryClient]);

  const [view, setView] = useState(COMPLETION);
  // Picked ids per set, so moving between sets keeps what was picked
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const current = sets.find(s => s.key === view) ?? sets[0];

  useEffect(() => {
    if (open) {
      setPicked({});
      setView(COMPLETION);
    }
  }, [open]);

  // The hook needs a target even when the open set can't import; its calls then go nowhere
  const importer = useCompanyCamImport(current.importTarget ?? sets[0].importTarget ?? {
    context: 'claim', contextId: project.claim_id, basePath: `/api/clients/_/claims/${project.claim_id}`,
  });

  const total = Object.values(picked).reduce((n, ids) => n + ids.length, 0);

  /** The gallery's own copy of a photo, for its name and the thumbnail it already loaded */
  const loadedFile = (set: PhotoSet, id: string): FileItem | undefined => {
    const cached = queryClient.getQueriesData<InfiniteData<{ items: FileItem[] }>>({
      queryKey: ['files-infinite', set.context, set.contextId],
    });
    for (const [, data] of cached) {
      const hit = data?.pages.flatMap(p => p.items).find(f => f.id === id);
      if (hit) return hit;
    }
    return undefined;
  };

  const add = () => {
    const photos: ClaimPhotoPick[] = sets.flatMap(set => (picked[set.key] ?? []).map(id => {
      const file = loadedFile(set, id);
      return {
        source: set.source,
        id,
        name: file?.originalName || file?.filename || 'Photo',
        thumbUrl: file?.thumbnailUrl || thumbFor(set.source, id),
        setLabel: set.label,
      };
    }));
    onAdd(photos);
    onClose();
  };

  const importButton = current.importTarget ? (
    <Button
      size="small"
      icon={<CloudDownloadOutlined />}
      disabled={importer.isSyncing}
      onClick={() => importer.start(current.importTarget)}
    >
      {isPhone ? 'CompanyCam' : `Import from CompanyCam`}
    </Button>
  ) : (
    <Tooltip title="This claim has no client to find a CompanyCam project by">
      <Button size="small" icon={<CloudDownloadOutlined />} disabled>CompanyCam</Button>
    </Tooltip>
  );

  return (
    <Modal
      title="Choose client photos"
      open={open}
      onCancel={onClose}
      width={1080}
      style={isPhone ? undefined : { top: 32 }}
      destroyOnClose
      {...sheetProps}
      footer={
        <div className="rb-picker-foot">
          {/* Phones: the Add button already says how many */}
          {!isPhone && (
            <span className="rb-picker-count">
              {total ? `${total} photo${total === 1 ? '' : 's'} picked` : 'Click photos to pick them, in page order'}
            </span>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!total} onClick={add}>
            {total ? `Add ${total} photo${total === 1 ? '' : 's'}` : 'Add photos'}
          </Button>
        </div>
      }
    >
      <div className="rb-picker-bar">
        <div className="rb-picker-sets" role="tablist" aria-label="Photo set">
          {sets.map(set => {
            const n = picked[set.key]?.length ?? 0;
            return (
              <Button
                key={set.key}
                type="text"
                size="small"
                role="tab"
                aria-selected={current.key === set.key}
                className={`ui-view-tab${current.key === set.key ? ' is-selected' : ''}`}
                onClick={() => setView(set.key)}
              >
                {set.label}
                {n > 0 && <span className="ui-tab-count">{n}</span>}
              </Button>
            );
          })}
        </div>
        <div className="rb-picker-actions">
          {importer.progress}
          {importButton}
        </div>
      </div>
      <p className="rb-picker-hint">
        {current.source === 'claim'
          ? 'Completion photos are the claim\'s own photos on the client page. Import from CompanyCam brings the job\'s photos in here.'
          : 'The water mitigation job\'s photos, as on its Photos tab.'}
      </p>

      {importer.modals}
      <div className="rb-picker-gallery">
        <FileGallery
          key={current.key}
          context={current.context}
          mode="select"
          contextId={current.contextId}
          fileCategory="image"
          allowedTypes={['image/*']}
          photosOnly
          allowUpload={false}
          allowMultiSelect
          selectedFiles={picked[current.key] ?? []}
          onFileSelect={ids => setPicked(prev => ({ ...prev, [current.key]: ids }))}
          // A tap on a photo picks it, in the order tapped (the gallery's own
          // click would open a preview, and its hover bar a download)
          onFileClick={file => setPicked(prev => {
            const ids = prev[current.key] ?? [];
            return {
              ...prev,
              [current.key]: ids.includes(file.id) ? ids.filter(id => id !== file.id) : [...ids, file.id],
            };
          })}
          categories={current.categories}
          showCategories
          allowCategoryCreate={false}
          showBulkActions={false}
          showBulkCategoryUpdate={false}
          defaultViewMode="grid"
          allowViewModeChange={false}
          showImagePreview={false}
          enableImageZoom={false}
          showImageInfo={false}
          enableDateGrouping={current.source === 'wm'}
          enableInfiniteScroll
          pageSize={30}
          height={isPhone ? 'auto' : '58vh'}
          gridColumns={{ xs: 3, sm: 4, md: 5, lg: 6, xl: 6 }}
        />
      </div>
    </Modal>
  );
};

export default RebuildClaimPhotoPicker;
