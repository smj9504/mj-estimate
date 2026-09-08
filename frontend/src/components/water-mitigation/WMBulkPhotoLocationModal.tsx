/**
 * Modal for tagging MULTIPLE water mitigation photos with a location
 * (Level + Room) in one pass.
 *
 * Two ways to work, in one modal:
 *  - "Apply to all": set one Level/Room and stamp it onto every selected photo.
 *  - Per-photo rows: review and edit each photo's own tag before saving,
 *    which is what makes this usable for *fixing* existing tags and not just
 *    setting blank ones.
 *
 * Only photos whose values actually changed are sent, so re-saving without
 * edits is a no-op rather than a pile of redundant writes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  AutoComplete,
  Button,
  Empty,
  Image,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ClearOutlined, ThunderboltOutlined } from '@ant-design/icons';
import waterMitigationService from '../../services/waterMitigationService';
import type { FileItem } from '../common/FileGallery/types';

const { Text } = Typography;

interface WMBulkPhotoLocationModalProps {
  open: boolean;
  photos: FileItem[];
  levelOptions: string[];
  roomSuggestions: string[];
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its gallery. */
  onSaved: (updatedCount: number) => void;
}

/** Per-photo draft state, keyed by photo id. */
type LocationDraft = Record<string, { level?: string; room?: string }>;

/** Treat empty string and undefined as the same "no value" state. */
const norm = (v?: string): string => (v ?? '').trim();

const autoCompleteFilter = (inputValue: string, option?: { value: string }) =>
  !!option?.value && option.value.toLowerCase().includes(inputValue.toLowerCase());

const WMBulkPhotoLocationModal: React.FC<WMBulkPhotoLocationModalProps> = ({
  open,
  photos,
  levelOptions,
  roomSuggestions,
  onClose,
  onSaved,
}) => {
  const [drafts, setDrafts] = useState<LocationDraft>({});
  const [applyLevel, setApplyLevel] = useState<string | undefined>(undefined);
  const [applyRoom, setApplyRoom] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Seed drafts from the photos' current tags when the modal opens, so existing
  // values are visible and editable rather than silently overwritten.
  //
  // Keyed on `open` alone, deliberately: `photos` is a fresh array on every
  // parent render, so including it would re-seed mid-edit and discard whatever
  // the user had typed. photosRef keeps the effect reading current data without
  // making the array identity a trigger.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    if (!open) return;
    const seeded: LocationDraft = {};
    photosRef.current.forEach((p) => {
      seeded[p.id] = { level: p.locationLevel, room: p.locationRoom };
    });
    setDrafts(seeded);
    setApplyLevel(undefined);
    setApplyRoom(undefined);
  }, [open]);

  const updateDraft = useCallback(
    (photoId: string, patch: { level?: string; room?: string }) => {
      setDrafts((prev) => ({ ...prev, [photoId]: { ...prev[photoId], ...patch } }));
    },
    []
  );

  // Stamp the "apply to all" values onto every row. Only the fields that were
  // actually filled in are applied, so you can bulk-set just the Level and
  // leave each photo's own Room untouched.
  const handleApplyToAll = useCallback(() => {
    if (!norm(applyLevel) && !norm(applyRoom)) {
      message.warning('Enter a Level and/or Room to apply');
      return;
    }
    setDrafts((prev) => {
      const next: LocationDraft = { ...prev };
      photos.forEach((p) => {
        next[p.id] = {
          level: norm(applyLevel) ? applyLevel : prev[p.id]?.level,
          room: norm(applyRoom) ? applyRoom : prev[p.id]?.room,
        };
      });
      return next;
    });
  }, [applyLevel, applyRoom, photos]);

  // Clear every row's tag. Cleared values are sent as empty strings, which the
  // backend maps to NULL, so this genuinely removes existing tags.
  const handleClearAll = useCallback(() => {
    setDrafts(() => {
      const next: LocationDraft = {};
      photos.forEach((p) => {
        next[p.id] = { level: undefined, room: undefined };
      });
      return next;
    });
    setApplyLevel(undefined);
    setApplyRoom(undefined);
  }, [photos]);

  // Only photos whose level or room actually differs from what's stored.
  const changedPhotos = useMemo(
    () =>
      photos.filter((p) => {
        const d = drafts[p.id] ?? {};
        return (
          norm(d.level) !== norm(p.locationLevel) ||
          norm(d.room) !== norm(p.locationRoom)
        );
      }),
    [photos, drafts]
  );

  const handleSave = async () => {
    if (changedPhotos.length === 0) {
      message.info('No changes to save');
      return;
    }
    setSaving(true);
    try {
      const updates = changedPhotos.map((p) => {
        const d = drafts[p.id] ?? {};
        return {
          photo_id: p.id,
          // Send '' rather than omitting the key: the backend only touches
          // fields present in the payload, and '' is what clears a tag.
          location_level: norm(d.level),
          location_room: norm(d.room),
        };
      });

      const result = await waterMitigationService.photos.bulkSetLocations(updates);

      if (result.failed > 0) {
        message.warning(
          `Updated ${result.applied} photo(s), ${result.failed} failed`
        );
      } else {
        message.success(`Location updated for ${result.applied} photo(s)`);
      }
      onSaved(result.applied);
      onClose();
    } catch (error) {
      console.error('Failed to bulk update photo locations:', error);
      message.error('Failed to update locations');
    } finally {
      setSaving(false);
    }
  };

  const levelOpts = useMemo(
    () => levelOptions.map((lvl) => ({ value: lvl })),
    [levelOptions]
  );
  const roomOpts = useMemo(
    () => roomSuggestions.map((r) => ({ value: r })),
    [roomSuggestions]
  );

  return (
    <Modal
      title={`Set Location for ${photos.length} Photo${photos.length !== 1 ? 's' : ''}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText={
        changedPhotos.length > 0 ? `Save (${changedPhotos.length})` : 'Save'
      }
      okButtonProps={{ disabled: changedPhotos.length === 0 }}
      confirmLoading={saving}
      width={720}
      destroyOnHidden
    >
      {photos.length === 0 ? (
        <Empty description="No photos selected" />
      ) : (
        <>
          {/* Apply-to-all row */}
          <div
            style={{
              padding: 12,
              background: '#f0f5ff',
              border: '1px solid #d6e4ff',
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              Apply to all selected
            </Text>
            <Space.Compact style={{ width: '100%' }}>
              <AutoComplete
                value={applyLevel}
                onChange={setApplyLevel}
                options={levelOpts}
                placeholder="Level (e.g. Basement)"
                filterOption={autoCompleteFilter}
                style={{ width: '38%' }}
              />
              <AutoComplete
                value={applyRoom}
                onChange={setApplyRoom}
                options={roomOpts}
                placeholder="Room (e.g. Kitchen)"
                filterOption={autoCompleteFilter}
                style={{ width: '38%' }}
              />
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={handleApplyToAll}
                style={{ width: '24%' }}
              >
                Apply
              </Button>
            </Space.Compact>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Fill only the field you want to change - the other keeps each
                photo&apos;s own value. Edit individual rows below before saving.
              </Text>
              <Tooltip title="Clear the Level and Room on every selected photo">
                <Button
                  size="small"
                  icon={<ClearOutlined />}
                  onClick={handleClearAll}
                  style={{ float: 'right' }}
                >
                  Clear all
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Per-photo rows */}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {photos.map((p) => {
              const d = drafts[p.id] ?? {};
              const isChanged =
                norm(d.level) !== norm(p.locationLevel) ||
                norm(d.room) !== norm(p.locationRoom);
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 6px',
                    borderBottom: '1px solid #f0f0f0',
                    background: isChanged ? '#fffbe6' : 'transparent',
                  }}
                >
                  <Image
                    src={p.thumbnailUrl || p.url}
                    alt={p.originalName}
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                    preview={false}
                    fallback="data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=="
                  />
                  <AutoComplete
                    value={d.level}
                    onChange={(v) => updateDraft(p.id, { level: v })}
                    options={levelOpts}
                    placeholder="Level"
                    filterOption={autoCompleteFilter}
                    style={{ flex: 1, minWidth: 0 }}
                    allowClear
                  />
                  <AutoComplete
                    value={d.room}
                    onChange={(v) => updateDraft(p.id, { room: v })}
                    options={roomOpts}
                    placeholder="Room"
                    filterOption={autoCompleteFilter}
                    style={{ flex: 1, minWidth: 0 }}
                    allowClear
                  />
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {changedPhotos.length === 0
                ? 'No changes yet'
                : `${changedPhotos.length} photo(s) will be updated`}
            </Text>
          </div>
        </>
      )}
    </Modal>
  );
};

export default WMBulkPhotoLocationModal;
