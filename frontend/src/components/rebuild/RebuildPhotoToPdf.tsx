/**
 * Photos to PDF: one photo per page, in the order listed. Photos come from
 * this device or from the client (the claim's photo sets, CompanyCam imports
 * included); the server reads the client's photos where they are stored.
 */

import React, { useCallback, useState } from 'react';
import {
  Modal, Upload, Button, Select, Input, message, Typography, Tooltip,
} from 'antd';
import {
  UploadOutlined, RotateRightOutlined, DeleteOutlined, ArrowUpOutlined,
  ArrowDownOutlined, FilePdfOutlined, PictureOutlined,
} from '@ant-design/icons';
import { rebuildService } from '../../services/rebuildService';
import { useSheetModal } from '../common/ui';
import RebuildClaimPhotoPicker, { type ClaimPhotoPick } from './RebuildClaimPhotoPicker';
import type { RebuildProject, RebuildCompletionDoc } from '../../types/rebuild';

const { Text } = Typography;

interface Props {
  open: boolean;
  project: RebuildProject;
  onClose: () => void;
  onSuccess: (doc: RebuildCompletionDoc) => void;
}

type PhotoItem = {
  key: string;
  name: string;
  preview: string;
  /** Where it came from, shown under its name */
  origin: string;
  rotation: number; // 0, 90, 180, 270
} & (
  | { kind: 'upload'; file: File }
  | { kind: 'claim'; source: ClaimPhotoPick['source']; id: string }
);

const DOC_TYPE_OPTIONS = [
  { value: 'completion_photo', label: 'Completion Photos' },
  { value: 'coc', label: 'Certificate of Completion' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'permit', label: 'Permit' },
  { value: 'lien_waiver', label: 'Lien Waiver' },
  { value: 'other', label: 'Other' },
];

/** The server's limit for one PDF */
const MAX_PHOTOS = 100;

let idCounter = 0;

const RebuildPhotoToPdf: React.FC<Props> = ({ open, project, onClose, onSuccess }) => {
  const { isPhone, sheetProps } = useSheetModal();
  // Touch gets 40px fields and photo actions
  const ctlSize = isPhone ? 'large' : 'middle';
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [docType, setDocType] = useState('completion_photo');
  const [title, setTitle] = useState('Completion Photos');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleClose = () => {
    photos.forEach(p => { if (p.kind === 'upload') URL.revokeObjectURL(p.preview); });
    setPhotos([]);
    setDocType('completion_photo');
    setTitle('Completion Photos');
    onClose();
  };

  const handleFilesAdd = useCallback((fileList: FileList | File[]) => {
    const added: PhotoItem[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/')) continue;
      added.push({
        kind: 'upload',
        key: `upload_${++idCounter}`,
        file,
        name: file.name,
        preview: URL.createObjectURL(file),
        origin: 'From this device',
        rotation: 0,
      });
    }
    setPhotos(prev => [...prev, ...added]);
  }, []);

  const addClaimPhotos = (picks: ClaimPhotoPick[]) => {
    // A photo already on the list stays where it is
    const have = new Set(photos.flatMap(p => (p.kind === 'claim' ? [`${p.source}:${p.id}`] : [])));
    const added: PhotoItem[] = picks
      .filter(p => !have.has(`${p.source}:${p.id}`))
      .map(p => ({
        kind: 'claim',
        key: `claim_${++idCounter}`,
        source: p.source,
        id: p.id,
        name: p.name,
        preview: p.thumbUrl,
        origin: `Client photos · ${p.setLabel}`,
        rotation: 0,
      }));
    if (added.length < picks.length) {
      message.info(`${picks.length - added.length} of them ${picks.length - added.length === 1 ? 'was' : 'were'} already on the list`);
    }
    setPhotos(prev => [...prev, ...added]);
  };

  const rotatePhoto = (key: string) => {
    setPhotos(prev => prev.map(p => (p.key === key ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const removePhoto = (key: string) => {
    setPhotos(prev => {
      const removed = prev.find(p => p.key === key);
      if (removed?.kind === 'upload') URL.revokeObjectURL(removed.preview);
      return prev.filter(p => p.key !== key);
    });
  };

  const movePhoto = (key: string, direction: -1 | 1) => {
    setPhotos(prev => {
      const arr = [...prev];
      const idx = arr.findIndex(p => p.key === key);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  const tooMany = photos.length > MAX_PHOTOS;

  const handleGenerate = async () => {
    if (photos.length === 0) {
      message.warning('Add at least one photo');
      return;
    }
    setGenerating(true);
    try {
      const formData = new FormData();
      const pages: Array<{ upload: number } | { source: string; id: string }> = [];
      const rotations: Record<number, number> = {};
      let uploads = 0;
      photos.forEach((p, idx) => {
        if (p.kind === 'upload') {
          formData.append('photos', p.file);
          pages.push({ upload: uploads++ });
        } else {
          pages.push({ source: p.source, id: p.id });
        }
        if (p.rotation !== 0) rotations[idx] = p.rotation;
      });
      formData.append('pages', JSON.stringify(pages));
      formData.append('rotations', JSON.stringify(rotations));
      formData.append('doc_type', docType);
      formData.append('title', title);

      const result = await rebuildService.photosToPdf(project.id, formData);
      message.success('PDF created');
      onSuccess(result);
      handleClose();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || 'Failed to create PDF');
    } finally {
      setGenerating(false);
    }
  };

  const pageCount = `${photos.length} page${photos.length !== 1 ? 's' : ''}`;

  return (
    <>
      <Modal
        title="Photos to PDF"
        open={open}
        width={680}
        onCancel={handleClose}
        {...sheetProps}
        footer={
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              loading={generating}
              disabled={photos.length === 0 || tooMany}
              onClick={handleGenerate}
            >
              {photos.length ? `Generate PDF (${pageCount})` : 'Generate PDF'}
            </Button>
          </>
        }
      >
        <div className="rb-photo-pdf">
          <div className="rb-photo-fields">
            <Select
              value={docType}
              onChange={v => {
                setDocType(v);
                const label = DOC_TYPE_OPTIONS.find(o => o.value === v)?.label || v;
                setTitle(label);
              }}
              options={DOC_TYPE_OPTIONS}
              size={ctlSize}
              aria-label="Document type"
            />
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Document title"
              size={ctlSize}
              aria-label="Document title"
            />
          </div>

          {/* Two ways in: the client's photos, or this device */}
          <div className="rb-photo-sources">
            <button type="button" className="rb-photo-source" onClick={() => setPickerOpen(true)}>
              <PictureOutlined className="rb-photo-source-icon" aria-hidden="true" />
              <span className="rb-photo-source-text">
                <span className="rb-photo-source-title">Choose from client photos</span>
                <span className="rb-photo-source-meta">Completion and water mitigation photos, or import from CompanyCam</span>
              </span>
            </button>
            <Upload.Dragger
              accept="image/*"
              multiple
              showUploadList={false}
              beforeUpload={(file, fileList) => {
                // Only handle the batch once (on last file)
                if (file === fileList[fileList.length - 1]) {
                  handleFilesAdd(fileList as unknown as File[]);
                }
                return false;
              }}
              className="rb-photo-drop"
            >
              <span className="rb-photo-source">
                <UploadOutlined className="rb-photo-source-icon" aria-hidden="true" />
                <span className="rb-photo-source-text">
                  <span className="rb-photo-source-title">{isPhone ? 'Add from this phone' : 'Upload from this computer'}</span>
                  <span className="rb-photo-source-meta">{isPhone ? 'Camera roll or files' : 'Click, or drop photos here'}</span>
                </span>
              </span>
            </Upload.Dragger>
          </div>

          {photos.length > 0 && (
            <div className="rb-photo-pages">
              <div className="rb-photo-pages-head">
                <span>Pages, in order</span>
                <span className="rb-num">{pageCount}</span>
              </div>
              {tooMany && (
                <p className="rb-photo-warn" role="alert">
                  A PDF takes up to {MAX_PHOTOS} photos. Remove {photos.length - MAX_PHOTOS}, or make two documents.
                </p>
              )}
              {/* Desktop scrolls the list inside the dialog; a phone sheet already scrolls its body */}
              <ol className="rb-photos" style={isPhone ? undefined : { maxHeight: 380, overflow: 'auto' }}>
                {photos.map((item, idx) => (
                  <li key={item.key} className="rb-photo">
                    <span className="rb-photo-index">{idx + 1}</span>
                    <div className="rb-photo-thumb">
                      <img
                        src={item.preview}
                        alt={item.name}
                        loading="lazy"
                        style={{ transform: `rotate(${item.rotation}deg)` }}
                      />
                    </div>
                    <div className="rb-photo-text">
                      <Text ellipsis className="rb-photo-name">{item.name}</Text>
                      <span className="rb-photo-meta">
                        {item.origin}
                        {item.rotation > 0 && ` · Rotated ${item.rotation}°`}
                      </span>
                    </div>
                    <div className="rb-photo-actions">
                      <Tooltip title={isPhone ? undefined : 'Move up'}>
                        <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<ArrowUpOutlined />}
                          disabled={idx === 0} aria-label="Move up" onClick={() => movePhoto(item.key, -1)} />
                      </Tooltip>
                      <Tooltip title={isPhone ? undefined : 'Move down'}>
                        <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<ArrowDownOutlined />}
                          disabled={idx === photos.length - 1} aria-label="Move down" onClick={() => movePhoto(item.key, 1)} />
                      </Tooltip>
                      <Tooltip title={isPhone ? undefined : `Rotate (${item.rotation}°)`}>
                        <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<RotateRightOutlined />}
                          aria-label="Rotate 90°" onClick={() => rotatePhoto(item.key)} />
                      </Tooltip>
                      <Tooltip title={isPhone ? undefined : 'Remove'}>
                        <Button type="text" size={ctlSize} className="ui-icon-btn ui-icon-btn--danger" icon={<DeleteOutlined />}
                          aria-label="Remove photo" onClick={() => removePhoto(item.key)} />
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </Modal>

      {/* Mounted only while open, so it checks CompanyCam imports only when it's in use */}
      {pickerOpen && (
        <RebuildClaimPhotoPicker
          open={pickerOpen}
          project={project}
          onClose={() => setPickerOpen(false)}
          onAdd={addClaimPhotos}
        />
      )}
    </>
  );
};

export default RebuildPhotoToPdf;
