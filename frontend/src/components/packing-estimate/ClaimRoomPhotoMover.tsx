/**
 * ClaimRoomPhotoMover - moves photos of one of a claim's packing rooms to
 * another room of its category: one already there, or a new one by typing
 * its name. Tap the photos to move, then pick or type the room. Moving all
 * of a room's photos to a new name renames the room. Used on the claim
 * page's Packing estimate and in the builder's Load Photos from a Claim.
 */
import React, { useState } from 'react';
import { AutoComplete, Button, message } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import * as packingService from '../../services/packingEstimateService';
import type { ClaimPackingPhoto } from '../../types/packing-estimate';
import { COMMON_ROOMS, type PackingRoomGroup, apiUrl, roomNameOptions } from './claimPhotos';
import './packing.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface ClaimRoomPhotoMoverProps {
  claimId: string;
  room: PackingRoomGroup;
  /** The other rooms of the room's category, offered first */
  otherRooms: string[];
  /** The claim's packing photos after the move, and the ones moved */
  onMoved: (updated: ClaimPackingPhoto[], movedIds: string[]) => void;
  onDone: () => void;
}

const ClaimRoomPhotoMover: React.FC<ClaimRoomPhotoMoverProps> = ({
  claimId, room, otherRooms, onMoved, onDone,
}) => {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [target, setTarget] = useState('');

  // Photos moved away or taken out elsewhere drop out of the choice
  const chosenIds = room.photos.filter(p => chosen.has(p.id)).map(p => p.id);
  const allChosen = chosenIds.length === room.photos.length;
  const name = target.trim();
  const sameRoom = name.toLowerCase() === room.room_name.toLowerCase();
  const isNew = !!name && !sameRoom && !otherRooms.some(r => r.toLowerCase() === name.toLowerCase());

  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const moveMutation = useMutation({
    mutationFn: ({ ids, to }: { ids: string[]; to: string }) => packingService.moveClaimPhotos(claimId, ids, to),
    onSuccess: (updated, { ids }) => {
      setChosen(new Set());
      setTarget('');
      const dest = updated.find(p => p.id === ids[0]);
      if (dest) message.success(`${plural(ids.length, 'photo')} moved to ${dest.room_name}`);
      onMoved(updated, ids);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to move the photos');
    },
  });

  const canMove = chosenIds.length > 0 && !!name && !sameRoom;

  return (
    <div className="pk-mover" role="group" aria-label={`Move photos of ${room.room_name}`}>
      <div className="pk-mover-head">
        <span className="pk-claim-meta">
          {chosenIds.length > 0 ? `${plural(chosenIds.length, 'photo')} selected` : 'Tap the photos to move'}
        </span>
        <Button
          type="text"
          size="small"
          onClick={() => setChosen(allChosen ? new Set() : new Set(room.photos.map(p => p.id)))}
        >
          {allChosen ? 'Clear' : 'Select all'}
        </Button>
      </div>

      <div className="pk-mover-photos">
        {room.photos.map((photo, i) => {
          const on = chosen.has(photo.id);
          return (
            <button
              key={photo.id}
              type="button"
              className={`pk-mover-photo${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={photo.file_name || `Photo ${i + 1}`}
              onClick={() => toggle(photo.id)}
            >
              <img src={apiUrl(photo.thumbnail_url)} alt="" loading="lazy" />
              {on && <CheckCircleFilled className="pk-mover-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="pk-mover-bar">
        <AutoComplete
          value={target}
          onChange={setTarget}
          options={roomNameOptions([...otherRooms, ...COMMON_ROOMS], target, room.room_name)}
          placeholder="Move to a room, or type a new one"
          aria-label="Room to move the photos to"
          className="pk-mover-target"
        />
        <Button
          type="primary"
          onClick={() => moveMutation.mutate({ ids: chosenIds, to: name })}
          loading={moveMutation.isPending}
          disabled={!canMove}
        >
          {chosenIds.length > 0 ? `Move ${chosenIds.length}` : 'Move'}
        </Button>
      </div>
      <div className="pk-mover-foot">
        <span className="pk-claim-meta">
          {sameRoom && name ? 'The photos are in this room already'
            : isNew ? `${name} will be a new room` : ''}
        </span>
        <Button type="text" size="small" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
};

export default ClaimRoomPhotoMover;
