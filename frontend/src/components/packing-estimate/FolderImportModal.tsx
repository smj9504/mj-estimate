/**
 * FolderImportModal - Import rooms from a local folder
 * Each subfolder becomes a room. Photos inside become that room's photos.
 * Based on reference/packing_tool_export/frontend/FolderImportModal.tsx
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Modal, Button, Checkbox, message, Tooltip, Progress,
} from 'antd';
import {
  FolderOpenOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { PhotoRoom } from '../../types/packing-estimate';
import { useSheetModal } from '../common/ui';
import { photoFilesToBase64 } from './photoFiles';
import './packing.css';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.tiff', '.tif',
]);

const MAX_PHOTOS_PER_ROOM = 6;

interface FolderRoom {
  name: string;
  files: File[];
  selected: boolean;
}

function generateId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Parse a FileList from webkitdirectory input into grouped room folders.
 * Path format: "ParentFolder/SubFolder/image.jpg"
 * - Index 0 = parent folder (ignored)
 * - Index 1 = subfolder = room name
 * - Files at root level (no subfolder) are skipped
 */
function groupFilesBySubfolder(files: FileList): FolderRoom[] {
  const groups = new Map<string, File[]>();

  for (const file of Array.from(files)) {
    if (!isImageFile(file)) continue;
    const path = (file as any).webkitRelativePath as string;
    if (!path) continue;

    const parts = path.split('/');
    if (parts.length < 3) continue;

    const roomName = parts[1];
    if (!roomName) continue;

    const existing = groups.get(roomName) || [];
    existing.push(file);
    groups.set(roomName, existing);
  }

  return Array.from(groups.entries())
    .map(([name, files]) => ({ name, files, selected: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultPhotoRoom(roomName: string): PhotoRoom {
  return {
    id: generateId(),
    room_name: roomName,
    floor: '1st',
    density: 'normal',
    contamination: 'clean',
    photos: [],
    items: [],
    analyzed: false,
    analyzing: false,
    field_notes: [],
    special_items: [],
    custom_special_items: [],
  };
}

function resolveNameCollisions(names: string[], existing: string[]): string[] {
  const used = new Set(existing.map(n => n.toLowerCase()));
  return names.map(name => {
    let resolved = name;
    let counter = 2;
    while (used.has(resolved.toLowerCase())) {
      resolved = `${name} (${counter})`;
      counter++;
    }
    used.add(resolved.toLowerCase());
    return resolved;
  });
}

interface FolderImportModalProps {
  open: boolean;
  onClose: () => void;
  onRoomsCreated: (rooms: PhotoRoom[]) => void;
  existingRoomNames: string[];
}

const FolderImportModal: React.FC<FolderImportModalProps> = ({
  open, onClose, onRoomsCreated, existingRoomNames,
}) => {
  const { sheetProps } = useSheetModal();
  const [folderRooms, setFolderRooms] = useState<FolderRoom[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [rootFileCount, setRootFileCount] = useState(0);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const selectedRooms = useMemo(() => folderRooms.filter(r => r.selected), [folderRooms]);
  const totalPhotos = useMemo(
    () => selectedRooms.reduce((sum, r) => sum + r.files.length, 0),
    [selectedRooms],
  );
  const oversizedRooms = useMemo(
    () => selectedRooms.filter(r => r.files.length > MAX_PHOTOS_PER_ROOM),
    [selectedRooms],
  );

  const handleReset = useCallback(() => {
    setFolderRooms([]);
    setRootFileCount(0);
    setImportProgress({ current: 0, total: 0 });
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleFolderSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const rooms = groupFilesBySubfolder(files);

      let rootCount = 0;
      for (const file of Array.from(files)) {
        if (!isImageFile(file)) continue;
        const path = (file as any).webkitRelativePath as string;
        if (path && path.split('/').length < 3) rootCount++;
      }

      setRootFileCount(rootCount);
      setFolderRooms(rooms);
      e.target.value = '';
    },
    [],
  );

  const toggleRoom = useCallback((name: string) => {
    setFolderRooms(prev =>
      prev.map(r => (r.name === name ? { ...r, selected: !r.selected } : r)),
    );
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedRooms.length === 0) return;
    setImporting(true);
    setImportProgress({ current: 0, total: selectedRooms.length });

    try {
      const resolvedNames = resolveNameCollisions(
        selectedRooms.map(r => r.name),
        existingRoomNames,
      );

      const newRooms: PhotoRoom[] = [];

      for (let i = 0; i < selectedRooms.length; i++) {
        const folderRoom = selectedRooms[i];
        setImportProgress({ current: i + 1, total: selectedRooms.length });

        const filesToConvert = folderRoom.files.slice(0, MAX_PHOTOS_PER_ROOM);
        const base64List = await photoFilesToBase64(filesToConvert);

        if (base64List.length === 0) continue;

        const room = defaultPhotoRoom(resolvedNames[i]);
        room.photos = base64List;
        newRooms.push(room);
      }

      if (newRooms.length === 0) {
        message.warning('No photos could be imported.');
        return;
      }

      onRoomsCreated(newRooms);
      message.success(`Imported ${newRooms.length} room${newRooms.length !== 1 ? 's' : ''} from folder`);
      handleClose();
    } catch {
      message.error('Failed to process folder. Please try again.');
    } finally {
      setImporting(false);
    }
  }, [selectedRooms, existingRoomNames, onRoomsCreated, handleClose]);

  const hasWebkitDirectory = useMemo(
    () => 'webkitdirectory' in document.createElement('input'),
    [],
  );

  const hasFolderPreview = folderRooms.length > 0 || rootFileCount > 0;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="Import Rooms from Folder"
      width={520}
      className="pk-folder-modal"
      {...sheetProps}
      footer={hasFolderPreview ? [
        <span key="count" className="pk-folder-count">
          {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''} · {totalPhotos} photos
        </span>,
        <Button key="cancel" onClick={handleClose}>Cancel</Button>,
        <Button
          key="import"
          type="primary"
          onClick={handleImport}
          disabled={selectedRooms.length === 0 || importing}
          loading={importing}
        >
          {importing
            ? `Importing... (${importProgress.current}/${importProgress.total})`
            : `Import ${selectedRooms.length} room${selectedRooms.length !== 1 ? 's' : ''}`}
        </Button>,
      ] : null}
      destroyOnHidden
    >
      <p className="pk-folder-intro">
        Each subfolder becomes a room. Photos inside become that room's photos.
      </p>

      {!hasFolderPreview ? (
        /* Source selector */
        <Tooltip title={!hasWebkitDirectory ? 'Folder upload not supported in this browser' : ''}>
          <button
            type="button"
            className="pk-drop"
            onClick={() => folderInputRef.current?.click()}
            disabled={!hasWebkitDirectory}
          >
            <FolderOpenOutlined className="pk-drop-icon" aria-hidden="true" />
            <span className="pk-drop-title">Select Folder from Computer</span>
            <span className="pk-drop-hint">Choose a folder with subfolders named by room</span>
          </button>
        </Tooltip>
      ) : (
        /* Folder preview */
        <div>
          <div className="pk-folder-list">
            {folderRooms.map(room => (
              <div
                key={room.name}
                className={`pk-folder-row${room.selected ? '' : ' is-off'}`}
              >
                <Checkbox
                  checked={room.selected}
                  onChange={() => toggleRoom(room.name)}
                />
                <FolderOpenOutlined className="pk-folder-icon" aria-hidden="true" />
                <span className="pk-folder-name">{room.name}</span>
                <span className="pk-folder-photos">
                  {room.files.length} photo{room.files.length !== 1 ? 's' : ''}
                </span>
                {room.files.length > MAX_PHOTOS_PER_ROOM && (
                  <Tooltip title={`Only first ${MAX_PHOTOS_PER_ROOM} photos will be used`}>
                    <ExclamationCircleOutlined className="pk-folder-warn" aria-label={`Only first ${MAX_PHOTOS_PER_ROOM} photos will be used`} />
                  </Tooltip>
                )}
              </div>
            ))}
            {folderRooms.length === 0 && (
              <div className="pk-folder-empty">No subfolders with images found.</div>
            )}
          </div>

          {rootFileCount > 0 && (
            <div className="pk-note pk-note--warn">
              <ExclamationCircleOutlined aria-hidden="true" />
              <span>
                {rootFileCount} photo{rootFileCount !== 1 ? 's' : ''} at root level will be skipped.
                Move them into a subfolder to include them.
              </span>
            </div>
          )}

          {oversizedRooms.length > 0 && (
            <div className="pk-note">
              <ExclamationCircleOutlined aria-hidden="true" />
              <span>
                {oversizedRooms.length} room{oversizedRooms.length !== 1 ? 's have' : ' has'} more than {MAX_PHOTOS_PER_ROOM} photos.
                Only the first {MAX_PHOTOS_PER_ROOM} will be used.
              </span>
            </div>
          )}

          {importing && (
            <Progress
              percent={Math.round((importProgress.current / importProgress.total) * 100)}
              size="small"
              strokeColor="var(--color-neutral-900)"
              style={{ marginTop: 10 }}
            />
          )}

          <div className="pk-folder-reset">
            <Button type="text" size="small" onClick={handleReset}>
              Choose different folder
            </Button>
          </div>
        </div>
      )}

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderSelected}
      />
    </Modal>
  );
};

export default FolderImportModal;
