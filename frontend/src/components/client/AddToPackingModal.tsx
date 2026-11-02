/**
 * AddToPackingModal - files the photos selected in a claim photo gallery for
 * the claim's packing estimate, under a room. Photos tagged with a room (water
 * mitigation location tags) can keep their own room. A photo already in the
 * packing set moves to the room picked here.
 */
import React, { useEffect, useState } from 'react';
import { AutoComplete, Button, Checkbox, Modal, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSheetModal } from '../common/ui';
import type { FileItem } from '../common/FileGallery';
import * as packingService from '../../services/packingEstimateService';
import type { PackingPhotoRef, PackingPhotoSource } from '../../types/packing-estimate';
import {
  COMMON_ROOMS, claimPackingPhotosKey, groupPackingRooms, roomNameOptions,
} from '../packing-estimate/claimPhotos';

interface AddToPackingModalProps {
  open: boolean;
  claimId: string;
  source: PackingPhotoSource;
  photos: FileItem[];
  onClose: () => void;
  /** After the photos are filed */
  onAdded: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const AddToPackingModal: React.FC<AddToPackingModalProps> = ({
  open, claimId, source, photos, onClose, onAdded,
}) => {
  const { sheetProps, isPhone } = useSheetModal();
  const queryClient = useQueryClient();
  const [roomName, setRoomName] = useState('');
  const [useTags, setUseTags] = useState(true);

  const { data: packingPhotos = [] } = useQuery({
    queryKey: claimPackingPhotosKey(claimId),
    queryFn: () => packingService.listClaimPhotos(claimId),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setRoomName('');
      setUseTags(true);
    }
  }, [open]);

  const tagged = photos.filter(p => p.locationRoom?.trim());
  const untaggedCount = photos.length - tagged.length;
  const tagCounts = new Map<string, number>();
  tagged.forEach(p => {
    const room = p.locationRoom!.trim();
    tagCounts.set(room, (tagCounts.get(room) ?? 0) + 1);
  });
  const tagRooms = Array.from(tagCounts);

  const keepTags = tagged.length > 0 && useTags;
  // Every photo already has its room when they all keep their tags
  const needsRoom = !keepTags || untaggedCount > 0;

  // The rooms in the packing set first, then the photos' tags, then common rooms
  const roomOptions = roomNameOptions([
    ...groupPackingRooms(packingPhotos).map(g => g.room_name),
    ...tagRooms.map(([room]) => room),
    ...COMMON_ROOMS,
  ], roomName);

  const addMutation = useMutation({
    mutationFn: () => {
      const refs: PackingPhotoRef[] = photos.map(p => ({
        source,
        photo_id: p.id,
        room_name: keepTags ? p.locationRoom?.trim() || undefined : undefined,
      }));
      return packingService.addClaimPhotos(claimId, refs, roomName.trim() || undefined);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(claimPackingPhotosKey(claimId), updated);
      message.success(`${plural(photos.length, 'photo')} added for packing`);
      onAdded();
      onClose();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to add photos');
    },
  });

  const canSave = photos.length > 0 && (!needsRoom || roomName.trim().length > 0);
  const size = isPhone ? 'large' : 'middle';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Use ${plural(photos.length, 'photo')} for packing`}
      width={480}
      {...sheetProps}
      footer={[
        <Button key="cancel" size={size} onClick={onClose}>Cancel</Button>,
        <Button
          key="add"
          type="primary"
          size={size}
          onClick={() => addMutation.mutate()}
          loading={addMutation.isPending}
          disabled={!canSave}
        >
          Add to room
        </Button>,
      ]}
      destroyOnHidden
    >
      <p className="cl-packing-intro">
        The estimate is made room by room. A photo already picked for packing moves to the room you pick.
      </p>

      <div className="cl-packing-field">
        <span className="cl-packing-label">Room</span>
        {tagged.length > 0 && (
          <Checkbox
            className="cl-packing-tags"
            checked={useTags}
            onChange={e => setUseTags(e.target.checked)}
          >
            Keep each photo's room tag
            <span className="cl-meta cl-packing-tag-list">
              {tagRooms.map(([room, n]) => `${room} ${n}`).join(' · ')}
            </span>
          </Checkbox>
        )}

        {needsRoom && (
          <label className="cl-packing-room-field">
            {keepTags && (
              <span className="cl-packing-label">
                {`Room for the ${plural(untaggedCount, 'untagged photo')}`}
              </span>
            )}
            <AutoComplete
              size={size}
              value={roomName}
              onChange={setRoomName}
              options={roomOptions}
              placeholder="e.g. Master Bedroom"
              style={{ width: '100%' }}
              aria-label="Room"
            />
          </label>
        )}
      </div>
    </Modal>
  );
};

export default AddToPackingModal;
