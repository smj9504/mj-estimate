/**
 * FolderImportModal - Import rooms from a local folder
 * Each subfolder becomes a room. Photos inside become that room's photos.
 * Based on reference/packing_tool_export/frontend/FolderImportModal.tsx
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Modal, Button, Checkbox, message, Tooltip, Typography, Progress,
} from 'antd';
import {
  FolderOpenOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { PhotoRoom } from '../../types/packing-estimate';

const { Text } = Typography;

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

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
        const base64List = await Promise.all(filesToConvert.map(fileToBase64));

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
      footer={hasFolderPreview ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {selectedRooms.length} room{selectedRooms.length !== 1 ? 's' : ''} · {totalPhotos} photos
          </Text>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              type="primary"
              onClick={handleImport}
              disabled={selectedRooms.length === 0 || importing}
              loading={importing}
            >
              {importing
                ? `Importing... (${importProgress.current}/${importProgress.total})`
                : `Import ${selectedRooms.length} room${selectedRooms.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      ) : null}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Each subfolder becomes a room. Photos inside become that room's photos.
        </Text>
      </div>

      {!hasFolderPreview ? (
        /* Source selector */
        <Tooltip title={!hasWebkitDirectory ? 'Folder upload not supported in this browser' : ''}>
          <div
            onClick={() => hasWebkitDirectory && folderInputRef.current?.click()}
            style={{
              padding: '32px 16px',
              border: '1.5px dashed #d9d9d9',
              borderRadius: 8,
              textAlign: 'center',
              cursor: hasWebkitDirectory ? 'pointer' : 'not-allowed',
              opacity: hasWebkitDirectory ? 1 : 0.5,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              if (!hasWebkitDirectory) return;
              (e.currentTarget as HTMLDivElement).style.borderColor = '#1890ff';
              (e.currentTarget as HTMLDivElement).style.background = '#f0f5ff';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#d9d9d9';
              (e.currentTarget as HTMLDivElement).style.background = '';
            }}
          >
            <FolderOpenOutlined style={{ fontSize: 32, color: '#999', display: 'block', marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Select Folder from Computer</div>
            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
              Choose a folder with subfolders named by room
            </div>
          </div>
        </Tooltip>
      ) : (
        /* Folder preview */
        <div>
          <div style={{
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            overflow: 'hidden',
            maxHeight: 320,
            overflowY: 'auto',
          }}>
            {folderRooms.map(room => (
              <div
                key={room.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderBottom: '1px solid #f0f0f0',
                  background: room.selected ? '#fff' : '#fafafa',
                  opacity: room.selected ? 1 : 0.6,
                  transition: 'all 0.15s ease',
                }}
              >
                <Checkbox
                  checked={room.selected}
                  onChange={() => toggleRoom(room.name)}
                />
                <FolderOpenOutlined style={{ fontSize: 16, color: '#999', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {room.name}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>
                  {room.files.length} photo{room.files.length !== 1 ? 's' : ''}
                </span>
                {room.files.length > MAX_PHOTOS_PER_ROOM && (
                  <Tooltip title={`Only first ${MAX_PHOTOS_PER_ROOM} photos will be used`}>
                    <ExclamationCircleOutlined style={{ fontSize: 13, color: '#faad14', flexShrink: 0 }} />
                  </Tooltip>
                )}
              </div>
            ))}
            {folderRooms.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#999', fontSize: 13 }}>
                No subfolders with images found.
              </div>
            )}
          </div>

          {rootFileCount > 0 && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4,
              fontSize: 12, color: '#92400e',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <ExclamationCircleOutlined style={{ flexShrink: 0 }} />
              {rootFileCount} photo{rootFileCount !== 1 ? 's' : ''} at root level will be skipped.
              Move them into a subfolder to include them.
            </div>
          )}

          {oversizedRooms.length > 0 && (
            <div style={{
              marginTop: 8, padding: '8px 12px',
              background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4,
              fontSize: 12, color: '#666',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <ExclamationCircleOutlined style={{ flexShrink: 0 }} />
              {oversizedRooms.length} room{oversizedRooms.length !== 1 ? 's have' : ' has'} more than {MAX_PHOTOS_PER_ROOM} photos.
              Only the first {MAX_PHOTOS_PER_ROOM} will be used.
            </div>
          )}

          {importing && (
            <Progress
              percent={Math.round((importProgress.current / importProgress.total) * 100)}
              size="small"
              style={{ marginTop: 10 }}
            />
          )}

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="link" size="small" onClick={handleReset} style={{ fontSize: 12, color: '#999', padding: 0 }}>
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
