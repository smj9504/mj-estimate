/**
 * ClaimPackingSection - the claim's packing estimate: the claim photos picked
 * for it (Use for packing in the claim's photo galleries), room by room, and
 * the claim's packing estimates. Analyze with AI opens the packing estimate
 * builder with the job filled in; it loads these rooms and runs the AI item
 * analysis on them.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Image, Input, Popconfirm, Tooltip, message } from 'antd';
import {
  CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import ClaimSection from './ClaimSection';
import * as packingService from '../../services/packingEstimateService';
import type { Claim, Client } from '../../types/client';
import type { ClaimPackingPhoto } from '../../types/packing-estimate';
import { AI_PHOTOS_PER_ROOM, apiUrl, claimPackingPhotosKey, groupPackingRooms } from '../packing-estimate/claimPhotos';
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

  const { data: photos = [], isLoading } = useQuery({
    queryKey: photosKey,
    queryFn: () => packingService.listClaimPhotos(claim.id),
  });
  const { data: estimateData } = useQuery({
    queryKey: ['packing-estimates', 'claim', claim.id],
    queryFn: () => packingService.listEstimates({ claim_id: claim.id }),
  });
  const estimates = estimateData?.items ?? [];
  const rooms = groupPackingRooms(photos);

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

  const saveRename = (ids: string[]) => {
    const name = draftName.trim();
    if (!name) return;
    renameMutation.mutate({ ids, name });
  };

  const startEstimate = (withPhotos: boolean) => navigate('/reconstruction-estimate/pack-calculator-new', {
    state: {
      mode: 'photo_ai',
      clientId: client.id,
      claimId: claim.id,
      companyId: packingCompanyId(claim),
      projectAddress: [client.address, client.city, client.state, client.zipcode].filter(Boolean).join(', '),
      claimPhotos: withPhotos ? claim.id : undefined,
      returnTo: `/clients/${client.id}`,
    },
  });

  return (
    <ClaimSection
      title="Packing estimate"
      count={photos.length > 0 ? photos.length : undefined}
      actions={(
        <>
          {rooms.length > 0 && (
            <Button size="small" type="text" icon={<ThunderboltOutlined />} onClick={() => startEstimate(true)}>
              Analyze with AI
            </Button>
          )}
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => startEstimate(false)}>
            New estimate
          </Button>
        </>
      )}
    >
      {!isLoading && rooms.length === 0 && (
        <div className="cl-empty">
          No photos picked for packing yet. In Photos below, select the photos of the contents and choose Use for packing.
        </div>
      )}

      {rooms.length > 0 && (
        <ul className="cl-packing-rooms">
          {rooms.map(room => {
            const ids = room.photos.map(p => p.id);
            const isRenaming = renaming === room.room_name;
            return (
              <li key={room.room_name} className="cl-packing-room">
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
                        <Tooltip title="Rename room">
                          <Button type="text" size="small" className="ui-icon-btn cl-touch-icon"
                            aria-label={`Rename ${room.room_name}`} icon={<EditOutlined />}
                            onClick={() => { setRenaming(room.room_name); setDraftName(room.room_name); }} />
                        </Tooltip>
                        <Popconfirm
                          title={`Take ${room.room_name} out of packing?`}
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
              </li>
            );
          })}
        </ul>
      )}

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
