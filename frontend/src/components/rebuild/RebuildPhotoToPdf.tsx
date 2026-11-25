/**
 * Photos to PDF, in the order listed: completion photos two to a page, other
 * kinds (a photo of a paper COC, invoice...) one. Every page carries the
 * property's address at the top, and the file is named by it. Photos come from
 * this device or from the client (the claim's photo sets, CompanyCam imports
 * included); the server reads the client's photos where they are stored.
 *
 * While the document is Completion Photos, a photo uploaded here is saved to
 * the client's Completion photos as it is added (the client page shows it), and
 * the PDF takes that copy. Other kinds - a photo of a paper COC or invoice -
 * stay in their PDF only.
 *
 * Completion photos go room by room (photoRooms.ts): the rooms are the scope
 * of work's, a water mitigation photo comes in under the room it was tagged
 * with, and photos added while a room is chosen go under it. In the PDF each
 * room starts a page under its name and every photo is labelled
 * "Kitchen · 2 of 4", with its caption when it has one.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal, Upload, Button, Select, Input, message, Typography, Tooltip,
} from 'antd';
import {
  UploadOutlined, RotateRightOutlined, DeleteOutlined, ArrowUpOutlined,
  ArrowDownOutlined, FilePdfOutlined, PictureOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { rebuildService } from '../../services/rebuildService';
import { fileService } from '../../services/fileService';
import { useSheetModal } from '../common/ui';
import RebuildClaimPhotoPicker, { type ClaimPhotoPick } from './RebuildClaimPhotoPicker';
import RoomSelect from './RoomSelect';
import { matchRoom, orderByRoom, pdfPageCount, roomOptions, roomsFromScope, sameRoom } from './photoRooms';
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
  /** The room it prints under ('' for none) and the line under it */
  room: string;
  caption: string;
} & (
  // saving: on its way to the client's Completion photos
  | { kind: 'upload'; file: File; saving?: boolean }
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

/** As the server lays them out (RebuildService.PHOTOS_PER_PAGE); other kinds one */
const PHOTOS_PER_PAGE: Record<string, number> = { completion_photo: 2 };

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

/** The document kind laid out room by room, with a line under each photo */
const BY_ROOM = 'completion_photo';

/** The document kind whose uploads go to the client's photos, and their category there */
const SAVES_TO_CLIENT = 'completion_photo';
const CLIENT_PHOTO_CATEGORY = 'completion';
/** Photos sent to the client at once */
const SAVE_CONCURRENCY = 3;

const revokePreview = (p: PhotoItem) => {
  if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview);
};

let idCounter = 0;

const RebuildPhotoToPdf: React.FC<Props> = ({ open, project, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const { isPhone, sheetProps } = useSheetModal();
  // Touch gets 40px fields and photo actions
  const ctlSize = isPhone ? 'large' : 'middle';
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [docType, setDocType] = useState('completion_photo');
  const [title, setTitle] = useState('Completion Photos');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Photos added now go under this room ('' for none)
  const [addTo, setAddTo] = useState('');
  // Rooms typed here that no photo is under yet
  const [typedRooms, setTypedRooms] = useState<string[]>([]);
  const savesToClient = docType === SAVES_TO_CLIENT;
  const byRoom = docType === BY_ROOM;

  const scopeRooms = useMemo(() => roomsFromScope(project.scope_of_work), [project.scope_of_work]);
  const rooms = useMemo(
    () => roomOptions(scopeRooms, [...photos.map(p => p.room), ...typedRooms]),
    [scopeRooms, photos, typedRooms],
  );
  // The page order: room by room for completion photos, else as listed
  const ordered = useMemo(() => (byRoom ? orderByRoom(photos, rooms) : photos), [byRoom, photos, rooms]);
  const unassigned = byRoom && rooms.length > 0 ? photos.filter(p => !p.room).length : 0;

  const newRoom = (room: string) => {
    if (room && !rooms.some(r => sameRoom(r, room))) setTypedRooms(prev => [...prev, room]);
  };

  const handleClose = () => {
    // A photo still on its way to the client gets there all the same
    photos.forEach(revokePreview);
    setPhotos([]);
    setDocType('completion_photo');
    setTitle('Completion Photos');
    setAddTo('');
    setTypedRooms([]);
    onClose();
  };

  /** Uploads go to the client's Completion photos; each, once there, is a claim photo of the list */
  const saveToClient = useCallback(async (items: Array<{ key: string; file: File }>) => {
    const queue = [...items];
    let saved = 0;
    let failed = 0;
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { key, file } = item;
        try {
          const [stored] = await fileService.uploadFiles([file], 'claim', project.claim_id, CLIENT_PHOTO_CATEGORY);
          saved++;
          setPhotos(prev => prev.map(p => {
            if (p.key !== key) return p;
            // Chrome can't draw an iPhone's HEIC; the server keeps it as a JPEG
            const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
            if (heic) revokePreview(p);
            return {
              kind: 'claim', key, source: 'claim', id: stored.id,
              name: p.name,
              preview: heic ? fileService.getPreviewUrl(stored.id) : p.preview,
              origin: "Uploaded · on the client's Completion photos",
              rotation: p.rotation,
              room: p.room,
              caption: p.caption,
            };
          }));
        } catch {
          failed++;
          // Still in this PDF, from this device
          setPhotos(prev => prev.map(p => (p.key === key && p.kind === 'upload'
            ? { ...p, saving: false, origin: 'From this device · not saved to the client' }
            : p)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, items.length) }, worker));
    if (saved) {
      // The client page and the photo picker show them without a reload
      queryClient.invalidateQueries({ queryKey: ['files-infinite', 'claim', project.claim_id] });
      queryClient.invalidateQueries({ queryKey: ['files', 'claim', project.claim_id] });
    }
    if (failed) {
      message.error(`${plural(failed, 'photo')} could not be saved to the client. They stay in this PDF only.`);
    } else if (saved) {
      message.success(`${plural(saved, 'photo')} saved to the client's Completion photos`);
    }
  }, [project.claim_id, queryClient]);

  const handleFilesAdd = useCallback((fileList: FileList | File[]) => {
    const added: Array<PhotoItem & { kind: 'upload' }> = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) continue;
      added.push({
        kind: 'upload',
        key: `upload_${++idCounter}`,
        file,
        name: file.name,
        preview: URL.createObjectURL(file),
        origin: savesToClient ? "Saving to the client's Completion photos…" : 'From this device',
        rotation: 0,
        room: byRoom ? addTo : '',
        caption: '',
        saving: savesToClient,
      });
    }
    setPhotos(prev => [...prev, ...added]);
    if (savesToClient && added.length) saveToClient(added);
  }, [savesToClient, saveToClient, byRoom, addTo]);

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
        // The room chosen to add to, else the one a WM photo was tagged with
        room: byRoom ? addTo || matchRoom(rooms, p.room) : '',
        caption: '',
      }));
    if (added.length < picks.length) {
      message.info(`${picks.length - added.length} of them ${picks.length - added.length === 1 ? 'was' : 'were'} already on the list`);
    }
    setPhotos(prev => [...prev, ...added]);
  };

  const rotatePhoto = (key: string) => {
    setPhotos(prev => prev.map(p => (p.key === key ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  // Out of this PDF only: a photo saved to the client stays there
  const removePhoto = (key: string) => {
    setPhotos(prev => {
      const removed = prev.find(p => p.key === key);
      if (removed) revokePreview(removed);
      return prev.filter(p => p.key !== key);
    });
  };

  /** Up or down the page order; by room, within its room */
  const movePhoto = (key: string, direction: -1 | 1) => {
    const at = ordered.findIndex(p => p.key === key);
    const other = ordered[at + direction];
    if (!other || (byRoom && other.room !== ordered[at].room)) return;
    setPhotos(prev => {
      const arr = [...prev];
      const a = arr.findIndex(p => p.key === key);
      const b = arr.findIndex(p => p.key === other.key);
      [arr[a], arr[b]] = [arr[b], arr[a]];
      return arr;
    });
  };

  const setRoom = (key: string, room: string) => {
    newRoom(room);
    setPhotos(prev => prev.map(p => (p.key === key ? { ...p, room } : p)));
  };

  const setCaption = (key: string, caption: string) => {
    setPhotos(prev => prev.map(p => (p.key === key ? { ...p, caption } : p)));
  };

  const tooMany = photos.length > MAX_PHOTOS;
  const saving = photos.some(p => p.kind === 'upload' && p.saving);

  const handleGenerate = async () => {
    if (photos.length === 0) {
      message.warning('Add at least one photo');
      return;
    }
    setGenerating(true);
    try {
      const formData = new FormData();
      const pages: Array<({ upload: number } | { source: string; id: string }) & { room?: string; caption?: string }> = [];
      const rotations: Record<number, number> = {};
      let uploads = 0;
      ordered.forEach((p, idx) => {
        // Only completion photos print a room and a caption
        const labels = byRoom ? {
          ...(p.room ? { room: p.room } : {}),
          ...(p.caption.trim() ? { caption: p.caption.trim() } : {}),
        } : {};
        if (p.kind === 'upload') {
          formData.append('photos', p.file);
          pages.push({ upload: uploads++, ...labels });
        } else {
          pages.push({ source: p.source, id: p.id, ...labels });
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

  const perPage = PHOTOS_PER_PAGE[docType] ?? 1;
  const pageCount = plural(
    byRoom ? pdfPageCount(ordered.map(p => p.room), perPage) : Math.ceil(photos.length / perPage),
    'page',
  );

  return (
    <>
      <Modal
        title="Photos to PDF"
        open={open}
        width={760}
        onCancel={handleClose}
        {...sheetProps}
        footer={
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              loading={generating}
              disabled={photos.length === 0 || tooMany || saving}
              onClick={handleGenerate}
            >
              {saving ? 'Saving photos…' : photos.length ? `Generate PDF (${pageCount})` : 'Generate PDF'}
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

          {byRoom && (
            <div className="rb-photo-addto">
              <span className="rb-photo-addto-label" id="rb-addto-label">Add photos to</span>
              <RoomSelect
                value={addTo}
                rooms={rooms}
                onChange={room => { newRoom(room); setAddTo(room); }}
                size={ctlSize}
                noRoomLabel="No room (or the WM photo's own room)"
                ariaLabelledBy="rb-addto-label"
                className="rb-photo-addto-select"
              />
            </div>
          )}

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
              accept="image/*,.heic,.heif"
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
                  <span className="rb-photo-source-meta">
                    {savesToClient ? "Also saved to the client's Completion photos" : 'Used in this PDF only'}
                  </span>
                </span>
              </span>
            </Upload.Dragger>
          </div>

          {photos.length > 0 && (
            <div className="rb-photo-pages">
              <div className="rb-photo-pages-head">
                <span>{byRoom && rooms.length ? 'Photos, room by room' : 'Photos, in order'}</span>
                <span className="rb-num">{plural(photos.length, 'photo')} · {pageCount}</span>
              </div>
              {tooMany && (
                <p className="rb-photo-warn" role="alert">
                  A PDF takes up to {MAX_PHOTOS} photos. Remove {photos.length - MAX_PHOTOS}, or make two documents.
                </p>
              )}
              {unassigned > 0 && (
                <p className="rb-photo-hint">
                  {plural(unassigned, 'photo')} {unassigned === 1 ? 'has' : 'have'} no room yet. Pick one on the photo, or leave it to print at the end.
                </p>
              )}
              {/* Desktop scrolls the list inside the dialog; a phone sheet already scrolls its body */}
              <ol className="rb-photos" style={isPhone ? undefined : { maxHeight: 420, overflow: 'auto' }}>
                {ordered.map((item, idx) => {
                  const prev = ordered[idx - 1];
                  const next = ordered[idx + 1];
                  // By room, a photo moves within its room
                  const canUp = !!prev && (!byRoom || prev.room === item.room);
                  const canDown = !!next && (!byRoom || next.room === item.room);
                  const roomStarts = byRoom && (!prev || prev.room !== item.room);
                  const inRoom = roomStarts ? ordered.filter(p => p.room === item.room).length : 0;
                  return (
                    <React.Fragment key={item.key}>
                      {roomStarts && (
                        <li className="rb-photo-room" aria-hidden="true">
                          <span>{item.room || 'No room'}</span>
                          <span className="rb-num">{plural(inRoom, 'photo')}</span>
                        </li>
                      )}
                      <li className="rb-photo">
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
                            {item.kind === 'upload' && item.saving && <><LoadingOutlined aria-hidden="true" /> </>}
                            {item.origin}
                            {item.rotation > 0 && ` · Rotated ${item.rotation}°`}
                          </span>
                        </div>
                        <div className="rb-photo-actions">
                          <Tooltip title={isPhone ? undefined : 'Move up'}>
                            <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<ArrowUpOutlined />}
                              disabled={!canUp} aria-label="Move up" onClick={() => movePhoto(item.key, -1)} />
                          </Tooltip>
                          <Tooltip title={isPhone ? undefined : 'Move down'}>
                            <Button type="text" size={ctlSize} className="ui-icon-btn" icon={<ArrowDownOutlined />}
                              disabled={!canDown} aria-label="Move down" onClick={() => movePhoto(item.key, 1)} />
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
                        {byRoom && (
                          <div className="rb-photo-labels">
                            <RoomSelect
                              value={item.room}
                              rooms={rooms}
                              onChange={room => setRoom(item.key, room)}
                              size={isPhone ? 'middle' : 'small'}
                              ariaLabel={`Room for photo ${idx + 1}`}
                              className="rb-photo-room-select"
                            />
                            <Input
                              value={item.caption}
                              onChange={e => setCaption(item.key, e.target.value)}
                              size={isPhone ? 'middle' : 'small'}
                              maxLength={160}
                              placeholder="Caption (optional), e.g. New vanity installed"
                              aria-label={`Caption for photo ${idx + 1}`}
                              className="rb-photo-caption"
                            />
                          </div>
                        )}
                      </li>
                    </React.Fragment>
                  );
                })}
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
