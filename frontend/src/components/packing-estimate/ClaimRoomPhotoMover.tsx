/**
 * ClaimRoomPhotoMover - moves photos of one of a claim's packing rooms to
 * another room: of its own category or the other one (a room's photos can
 * be of more than one stage), a room already there or a new one by typing
 * its name. Tap the photos, pick the category, then pick or type the room.
 * Moving all of a room's photos to a new name renames the room. The chosen
 * photos can instead be taken out of packing: they leave the packing set and
 * stay in the claim's photos. Used on the claim page's Packing estimate and
 * in the builder's Load Photos from a Claim.
 */
import React, { useId, useState } from 'react';
import { AutoComplete, Button, Popconfirm, Segmented, message } from 'antd';
import { CheckCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import * as packingService from '../../services/packingEstimateService';
import type { ClaimPackingPhoto, PackingPhotoCategory } from '../../types/packing-estimate';
import {
  COMMON_ROOMS, PACKING_CATEGORIES, type PackingRoomGroup, apiUrl, packingCategoryLabel, roomNameOptions,
} from './claimPhotos';
import './packing.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface ClaimRoomPhotoMoverProps {
  claimId: string;
  room: PackingRoomGroup;
  /** The claim's rooms: those of the category moved to are offered first */
  rooms: { category: PackingPhotoCategory; room_name: string }[];
  /** The claim's packing photos after photos were moved or taken out, and which */
  onChanged: (updated: ClaimPackingPhoto[], ids: string[]) => void;
  onDone: () => void;
}

const ClaimRoomPhotoMover: React.FC<ClaimRoomPhotoMoverProps> = ({
  claimId, room, rooms, onChanged, onDone,
}) => {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [category, setCategory] = useState<PackingPhotoCategory>(room.category);
  const [target, setTarget] = useState('');
  const categoryLabelId = useId();

  // Photos moved away or taken out elsewhere drop out of the choice
  const chosenIds = room.photos.filter(p => chosen.has(p.id)).map(p => p.id);
  const allChosen = chosenIds.length === room.photos.length;
  const name = target.trim();
  const otherCategory = category !== room.category;
  const sameRoom = !otherCategory && name.toLowerCase() === room.room_name.toLowerCase();
  const inCategory = rooms.filter(r => r.category === category).map(r => r.room_name);
  const isNew = !!name && !sameRoom && !inCategory.some(r => r.toLowerCase() === name.toLowerCase());

  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const moveMutation = useMutation({
    mutationFn: ({ ids, to, toCategory }: { ids: string[]; to: string; toCategory: PackingPhotoCategory }) =>
      packingService.moveClaimPhotos(claimId, ids, to, toCategory),
    onSuccess: (updated, { ids }) => {
      setChosen(new Set());
      setTarget('');
      const dest = updated.find(p => p.id === ids[0]);
      if (dest) {
        const where = dest.category === room.category
          ? dest.room_name : `${dest.room_name} · ${packingCategoryLabel(dest.category)}`;
        message.success(`${plural(ids.length, 'photo')} moved to ${where}`);
      }
      onChanged(updated, ids);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to move the photos');
    },
  });

  // Out of the packing set only; the photos stay in the claim's photos
  const takeOutMutation = useMutation({
    mutationFn: (ids: string[]) => packingService.removeClaimPhotos(claimId, ids),
    onSuccess: (updated, ids) => {
      setChosen(new Set());
      message.success(`${plural(ids.length, 'photo')} taken out of packing`);
      onChanged(updated, ids);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.detail || 'Failed to take the photos out');
    },
  });

  const canMove = chosenIds.length > 0 && !!name && !sameRoom;
  const hint = sameRoom && name ? 'The photos are in this room already'
    : isNew ? `${name} will be a new room${otherCategory ? ` in ${packingCategoryLabel(category)}` : ''}`
      : '';

  return (
    <div className="pk-mover" role="group" aria-label={`Move photos of ${room.room_name}`}>
      <div className="pk-mover-head">
        <span className="pk-claim-meta">
          {chosenIds.length > 0 ? `${plural(chosenIds.length, 'photo')} selected` : 'Tap photos to move or take out'}
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

      <div className="pk-mover-to">
        <span className="pk-claim-meta" id={categoryLabelId}>Move to</span>
        <Segmented
          size="small"
          value={category}
          onChange={v => setCategory(v as PackingPhotoCategory)}
          options={PACKING_CATEGORIES}
          aria-labelledby={categoryLabelId}
        />
      </div>
      <div className="pk-mover-bar">
        <AutoComplete
          value={target}
          onChange={setTarget}
          options={roomNameOptions(
            [...inCategory, ...COMMON_ROOMS], target, otherCategory ? undefined : room.room_name,
          )}
          placeholder="Move to a room, or type a new one"
          aria-label="Room to move the photos to"
          className="pk-mover-target"
        />
        <Button
          type="primary"
          onClick={() => moveMutation.mutate({ ids: chosenIds, to: name, toCategory: category })}
          loading={moveMutation.isPending}
          disabled={!canMove}
        >
          {chosenIds.length > 0 ? `Move ${chosenIds.length}` : 'Move'}
        </Button>
      </div>
      {hint && <div className="pk-claim-meta pk-mover-hint">{hint}</div>}
      <div className="pk-mover-foot">
        <Popconfirm
          title={`Take ${plural(chosenIds.length, 'photo')} out of packing?`}
          description="They stay in the claim's photos."
          okText="Take out"
          onConfirm={() => takeOutMutation.mutate(chosenIds)}
          disabled={chosenIds.length === 0}
        >
          <Button
            type="text"
            size="small"
            icon={<MinusCircleOutlined />}
            className="pk-mover-takeout"
            loading={takeOutMutation.isPending}
            disabled={chosenIds.length === 0}
          >
            {chosenIds.length > 0 ? `Take ${chosenIds.length} out of packing` : 'Take out of packing'}
          </Button>
        </Popconfirm>
        <Button type="text" size="small" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
};

export default ClaimRoomPhotoMover;
