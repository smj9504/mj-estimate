/**
 * ClaimPackingSection - the claim's packing estimate: the claim photos picked
 * for it (Use for packing in the claim's photo galleries), category by
 * category (the stage of the job: water mitigation, work completion) and room
 * by room within each, and the claim's packing estimates. A category's
 * Pack-out/in estimate opens the packing estimate builder with the job filled
 * in; it loads that category's rooms and runs the AI item analysis on them.
 * A room's Move moves some of its photos to another room of its category or
 * to a new one (ClaimRoomPhotoMover); ⇄ moves the whole room to the other
 * category.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Image, Input, Popconfirm, Tooltip, message } from 'antd';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, DragOutlined, EditOutlined, PlusOutlined, SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import ClaimSection from './ClaimSection';
import * as packingService from '../../services/packingEstimateService';
import type { Claim, Client } from '../../types/client';
import type { ClaimPackingPhoto, PackingPhotoCategory } from '../../types/packing-estimate';
import {
  AI_PHOTOS_PER_ROOM, PACKING_CATEGORIES, apiUrl, claimPackingPhotosKey, groupPackingCategories,
  packingCategoryLabel, packingRoomKey,
} from '../packing-estimate/claimPhotos';
import ClaimRoomPhotoMover from '../packing-estimate/ClaimRoomPhotoMover';
import { PackStatusPill, formatMoney, modeLabel } from '../packing-estimate/packingUi';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The company a claim's pack-out goes under: its moving company, else its only company */
const packingCompanyId = (claim: Claim): string | undefined => {
  const companies = claim.companies ?? [];
  return companies.find(c => c.role === 'moving')?.id
    ?? (companies.length === 1 ? companies[0].id : undefined)
    ?? (companies.length === 0 ? claim.company_id : undefined);
};

// In-app link that still opens in a new tab on ctrl/cmd-click
const useInAppLink = () => {
  const navigate = useNavigate();
  return (to: string) => ({
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  });
};

interface ClaimPackingSectionProps {
  claim: Claim;
  client: Client;
}

const ClaimPackingSection: React.FC<ClaimPackingSectionProps> = ({ claim, client }) => {
  const navigate = useNavigate();
  const linkTo = useInAppLink();
  const queryClient = useQueryClient();
  const photosKey = claimPackingPhotosKey(claim.id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  // The room whose photos are being moved (packingRoomKey)
  const [moving, setMoving] = useState<string | null>(null);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: photosKey,
    queryFn: () => packingService.listClaimPhotos(claim.id),
  });
  const { data: estimateData } = useQuery({
    queryKey: ['packing-estimates', 'claim', claim.id],
    queryFn: () => packingService.listEstimates({ claim_id: claim.id }),
  });
  const estimates = estimateData?.items ?? [];
  const categories = groupPackingCategories(photos);

  const saved = (updated: ClaimPackingPhoto[]) => queryClient.setQueryData(photosKey, updated);
  const failed = (fallback: string) => (err: any) =>
    message.error(err?.response?.data?.detail || fallback);

  const removeMutation = useMutation({
    mutationFn: (ids: string[]) => packingService.removeClaimPhotos(claim.id, ids),
    onSuccess: saved,
    onError: failed('Failed to take the photos out'),
  });
  const renameMutation = useMutation({
    mutationFn: ({ ids, name }: { ids: string[]; name: string }) =>
      packingService.moveClaimPhotos(claim.id, ids, name),
    onSuccess: (updated) => {
      saved(updated);
      setRenaming(null);
    },
    onError: failed('Failed to rename the room'),
  });
  const moveMutation = useMutation({
    mutationFn: ({ ids, name, category }: { ids: string[]; name: string; category: PackingPhotoCategory }) =>
      packingService.moveClaimPhotos(claim.id, ids, name, category),
    onSuccess: (updated, { name, category }) => {
      saved(updated);
      message.success(`${name} moved to ${packingCategoryLabel(category)}`);
    },
    onError: failed('Failed to move the room'),
  });

  // A room left with no photos is gone, and so is its Move
  const photosMoved = (fromKey: string, updated: ClaimPackingPhoto[]) => {
    saved(updated);
    if (!updated.some(p => packingRoomKey(p) === fromKey)) setMoving(null);
  };

  const saveRename = (ids: string[]) => {
    const name = draftName.trim();
    if (!name) return;
    renameMutation.mutate({ ids, name });
  };

  // A category's estimate loads that category's rooms and analyzes them; the
  // estimate is named for the category so the claim can tell them apart
  const startEstimate = (category?: PackingPhotoCategory) => navigate('/reconstruction-estimate/pack-calculator-new', {
    state: {
      mode: 'photo_ai',
      clientId: client.id,
      claimId: claim.id,
      companyId: packingCompanyId(claim),
      projectAddress: [client.address, client.city, client.state, client.zipcode].filter(Boolean).join(', '),
      claimPhotos: category ? claim.id : undefined,
      claimPhotoCategory: category,
      calculationName: category ? packingCategoryLabel(category) : undefined,
      returnTo: `/clients/${client.id}`,
    },
  });

  return (
    <ClaimSection
      title="Packing estimate"
      count={photos.length > 0 ? photos.length : undefined}
      actions={(
        <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => startEstimate()}>
          New estimate
        </Button>
      )}
    >
      {!isLoading && categories.length === 0 && (
        <div className="cl-empty">
          No photos picked for packing yet. In Photos below, select the photos of the contents, choose Use for packing, then pick their category (Water mitigation or Work completion) and room.
        </div>
      )}

      {categories.map(group => (
        <section key={group.category} className="cl-group cl-packing-category" aria-label={group.label}>
          <div className="cl-group-head cl-packing-category-head">
            <span className="cl-group-name">{group.label}</span>
            <span className="cl-meta">
              {plural(group.rooms.length, 'room')} · {plural(group.photoCount, 'photo')}
            </span>
            <Button
              size="small"
              type="text"
              icon={<ThunderboltOutlined />}
              className="cl-packing-category-action"
              onClick={() => startEstimate(group.category)}
              aria-label={`Pack-out/in estimate for ${group.label}`}
            >
              Pack-out/in estimate
            </Button>
          </div>
          <ul className="cl-packing-rooms">
            {group.rooms.map(room => {
              const ids = room.photos.map(p => p.id);
              const key = packingRoomKey(room);
              const isRenaming = renaming === key;
              const isMoving = moving === key;
              const others = PACKING_CATEGORIES.filter(c => c.value !== room.category);
              return (
                <li key={key} className="cl-packing-room">
                  <div className="cl-packing-room-head">
                    {isRenaming ? (
                      <Input
                        size="small"
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        onPressEnter={() => saveRename(ids)}
                        onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }}
                        maxLength={100}
                        autoFocus
                        aria-label="Room name"
                        className="cl-packing-room-input"
                      />
                    ) : (
                      <span className="cl-packing-room-title">
                        <span className="cl-packing-room-name">{room.room_name}</span>
                        <span className="cl-meta">
                          {plural(room.photos.length, 'photo')}
                          {room.photos.length > AI_PHOTOS_PER_ROOM && ` · the AI reads the ${AI_PHOTOS_PER_ROOM} most different`}
                        </span>
                      </span>
                    )}
                    <div className="cl-row-actions">
                      {isRenaming ? (
                        <>
                          <Tooltip title="Save">
                            <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                              aria-label="Save room name" icon={<CheckOutlined />}
                              loading={renameMutation.isPending}
                              onClick={() => saveRename(ids)} />
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                              aria-label="Cancel renaming" icon={<CloseOutlined />}
                              onClick={() => setRenaming(null)} />
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Button
                            type="text"
                            size="small"
                            icon={<DragOutlined />}
                            className={`cl-packing-move${isMoving ? ' is-on' : ''}`}
                            aria-expanded={isMoving}
                            aria-label={`Move photos of ${room.room_name} to another room`}
                            onClick={() => setMoving(isMoving ? null : key)}
                          >
                            Move
                          </Button>
                          {others.map(other => (
                            <Tooltip key={other.value} title={`Move to ${other.label}`}>
                              <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                                aria-label={`Move ${room.room_name} to ${other.label}`} icon={<SwapOutlined />}
                                loading={moveMutation.isPending && moveMutation.variables?.ids[0] === ids[0]}
                                onClick={() => moveMutation.mutate({ ids, name: room.room_name, category: other.value })} />
                            </Tooltip>
                          ))}
                          <Tooltip title="Rename room">
                            <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                              aria-label={`Rename ${room.room_name}`} icon={<EditOutlined />}
                              onClick={() => { setRenaming(key); setDraftName(room.room_name); setMoving(null); }} />
                          </Tooltip>
                          <Popconfirm
                            title={`Take ${room.room_name} (${group.label}) out of packing?`}
                            description="Its photos stay in the claim's photos."
                            onConfirm={() => removeMutation.mutate(ids)}
                            okText="Take out"
                            okButtonProps={{ danger: true }}
                          >
                            <Button type="text" size="small" className="ui-icon-btn ui-icon-btn--danger cl-touch-icon"
                              aria-label={`Take ${room.room_name} out of packing`} icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </>
                      )}
                    </div>
                  </div>
                  {isMoving ? (
                    <ClaimRoomPhotoMover
                      claimId={claim.id}
                      room={room}
                      otherRooms={group.rooms.filter(r => r !== room).map(r => r.room_name)}
                      onMoved={updated => photosMoved(key, updated)}
                      onDone={() => setMoving(null)}
                    />
                  ) : (
                    <Image.PreviewGroup>
                      <div className="pk-photos cl-packing-photos">
                        {room.photos.map(photo => (
                          <div key={photo.id} className="pk-photo">
                            <Image
                              src={apiUrl(photo.thumbnail_url)}
                              preview={{ src: apiUrl(photo.preview_url) }}
                              width={72}
                              height={72}
                              alt={photo.file_name || room.room_name}
                            />
                            <button
                              type="button"
                              className="pk-photo-remove"
                              onClick={() => removeMutation.mutate([photo.id])}
                              aria-label="Take this photo out of packing"
                            >
                              <CloseOutlined />
                            </button>
                          </div>
                        ))}
                      </div>
                    </Image.PreviewGroup>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {estimates.length > 0 && (
        <ul className="cl-jobs cl-packing-estimates" aria-label="Packing estimates">
          {estimates.map(est => (
            <li key={est.id}>
              <a className="cl-job" {...linkTo(`/reconstruction-estimate/pack-calculator-new/${est.id}`)}>
                <span className="cl-job-top">
                  <PackStatusPill status={est.status} />
                  <span className="cl-job-title">{formatMoney(est.grand_total)}</span>
                </span>
                <span className="cl-meta cl-job-meta">
                  {est.calculation_name && <span>{est.calculation_name}</span>}
                  <span>{modeLabel(est.mode)}</span>
                  <span>{plural(est.total_rooms, 'room')}</span>
                  {est.created_at && <span>{dayjs(est.created_at).format('MMM D, YYYY')}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </ClaimSection>
  );
};

export default ClaimPackingSection;
