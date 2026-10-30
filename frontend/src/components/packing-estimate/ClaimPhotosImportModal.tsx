/**
 * ClaimPhotosImportModal - load a claim's packing photos into the builder.
 * Photos picked for packing on a claim (Use for packing in the claim's
 * Photos) are filed by room; pick the claim, then the rooms to load. The
 * estimate's own claim opens straight to its rooms.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal, Spin } from 'antd';
import { ExclamationCircleOutlined, PictureOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useSheetModal } from '../common/ui';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import * as packingService from '../../services/packingEstimateService';
import type { PackingPhotoClaim } from '../../types/packing-estimate';
import { AI_PHOTOS_PER_ROOM, apiUrl, claimPackingPhotosKey, groupPackingRooms } from './claimPhotos';
import './packing.css';

/** Thumbnails shown per room, enough to tell the rooms apart */
const ROOM_THUMBS = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface ClaimPhotosImportModalProps {
  open: boolean;
  onClose: () => void;
  /** The estimate's claim: opens on its rooms when it has packing photos */
  currentClaimId: string | null;
  /** Rooms already in the builder; a room of the same name starts unticked */
  existingRoomNames: string[];
  onLoad: (claim: PackingPhotoClaim, roomNames: string[], analyze: boolean) => void;
}

const ClaimPhotosImportModal: React.FC<ClaimPhotosImportModalProps> = ({
  open, onClose, currentClaimId, existingRoomNames, onLoad,
}) => {
  const { sheetProps } = useSheetModal('tall');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  // undefined until the list first loads: the estimate's claim, or none
  const [picked, setPicked] = useState<PackingPhotoClaim | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [analyze, setAnalyze] = useState(true);
  const selectionFor = useRef<string | null>(null);

  // Start over each time it opens
  useEffect(() => {
    if (open) return;
    setSearch('');
    setPicked(undefined);
    setSelected(new Set());
    setAnalyze(true);
    selectionFor.current = null;
  }, [open]);

  const claimsQuery = useQuery({
    queryKey: ['packing-photo-claims', debouncedSearch],
    queryFn: () => packingService.listClaimsWithPhotos(debouncedSearch || undefined),
    enabled: open,
    staleTime: 0,
  });
  const claims = useMemo(() => claimsQuery.data ?? [], [claimsQuery.data]);

  useEffect(() => {
    if (!open || picked !== undefined || !claimsQuery.isSuccess || debouncedSearch) return;
    setPicked(claims.find(c => c.claim_id === currentClaimId) ?? null);
  }, [open, picked, claimsQuery.isSuccess, claims, currentClaimId, debouncedSearch]);

  const photosQuery = useQuery({
    queryKey: claimPackingPhotosKey(picked?.claim_id ?? ''),
    queryFn: () => packingService.listClaimPhotos(picked!.claim_id),
    enabled: open && !!picked,
    staleTime: 0,
  });
  const rooms = useMemo(() => groupPackingRooms(photosQuery.data ?? []), [photosQuery.data]);

  const existing = useMemo(
    () => new Set(existingRoomNames.map(n => n.trim().toLowerCase())),
    [existingRoomNames],
  );
  const inEstimate = (name: string) => existing.has(name.trim().toLowerCase());

  // Tick the rooms not in the estimate yet, once per claim each time it opens
  useEffect(() => {
    if (!open || !picked || !photosQuery.isSuccess || selectionFor.current === picked.claim_id) return;
    selectionFor.current = picked.claim_id;
    setSelected(new Set(rooms.filter(r => !inEstimate(r.room_name)).map(r => r.room_name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picked, photosQuery.isSuccess, rooms]);

  const toggleRoom = (name: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const chosenRooms = rooms.filter(r => selected.has(r.room_name));
  const chosenPhotos = chosenRooms.reduce((sum, r) => sum + r.photos.length, 0);

  const pickClaim = (claim: PackingPhotoClaim | null) => {
    selectionFor.current = null;
    setSelected(new Set());
    setPicked(claim);
  };

  const handleLoad = () => {
    if (!picked || chosenRooms.length === 0) return;
    onLoad(picked, chosenRooms.map(r => r.room_name), analyze);
    onClose();
  };

  const currentHasNoPhotos = picked === null && !!currentClaimId && !debouncedSearch
    && claimsQuery.isSuccess && !claims.some(c => c.claim_id === currentClaimId);
  const switchesClaim = !!picked && !!currentClaimId && picked.claim_id !== currentClaimId;

  const claimPicker = (
    <div>
      <Input.Search
        placeholder="Search client, claim # or address"
        value={search}
        onChange={e => setSearch(e.target.value)}
        allowClear
        aria-label="Search claims"
        className="pk-claim-search"
      />
      {currentHasNoPhotos && (
        <div className="pk-note">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>
            This estimate's claim has no packing photos yet. On the claim, select photos in Photos and choose Use for packing.
          </span>
        </div>
      )}
      <div className="pk-folder-list pk-claim-list" aria-busy={claimsQuery.isFetching}>
        {claimsQuery.isLoading ? (
          <div className="pk-folder-empty"><Spin size="small" /></div>
        ) : claimsQuery.isError ? (
          <div className="pk-folder-empty">Couldn't load the claims. Close this and try again.</div>
        ) : claims.length === 0 ? (
          <div className="pk-folder-empty">
            {debouncedSearch
              ? 'No claims with packing photos match.'
              : 'No claims have packing photos yet. On a claim, select photos in Photos and choose Use for packing.'}
          </div>
        ) : claims.map(claim => (
          <button
            key={claim.claim_id}
            type="button"
            className="pk-claim-row"
            onClick={() => pickClaim(claim)}
          >
            <span className="pk-claim-main">
              <span className="pk-folder-name">{claim.client_name}</span>
              <span className="pk-claim-meta">
                {[claim.claim_number, claim.project_address].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="pk-folder-photos">
              {plural(claim.rooms.length, 'room')} · {plural(claim.photo_count, 'photo')}
            </span>
            <RightOutlined className="pk-folder-icon" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );

  const roomPicker = picked && (
    <div>
      <div className="pk-claim-picked">
        <span className="pk-claim-main">
          <span className="pk-folder-name">{picked.client_name}</span>
          <span className="pk-claim-meta">
            {[picked.claim_number, picked.insurance_company, picked.project_address].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>

      {switchesClaim && (
        <div className="pk-note pk-note--warn">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>This estimate is on another claim. Loading these photos moves it to this client and claim.</span>
        </div>
      )}

      <div className="pk-folder-list pk-claim-rooms">
        {photosQuery.isLoading ? (
          <div className="pk-folder-empty"><Spin size="small" /></div>
        ) : photosQuery.isError ? (
          <div className="pk-folder-empty">Couldn't load this claim's packing photos.</div>
        ) : rooms.length === 0 ? (
          <div className="pk-folder-empty">This claim has no packing photos left.</div>
        ) : rooms.map(room => {
          const on = selected.has(room.room_name);
          return (
            <div key={room.room_name} className={`pk-folder-row${on ? '' : ' is-off'}`}>
              {/* The whole row is the checkbox's label */}
              <Checkbox className="pk-claim-room" checked={on} onChange={() => toggleRoom(room.room_name)}>
                <span className="pk-claim-main">
                  <span className="pk-folder-name">{room.room_name}</span>
                  <span className="pk-claim-thumbs" aria-hidden="true">
                    {room.photos.slice(0, ROOM_THUMBS).map(photo => (
                      <img key={photo.id} src={apiUrl(photo.thumbnail_url)} alt="" loading="lazy" />
                    ))}
                    {room.photos.length > ROOM_THUMBS && (
                      <span className="pk-claim-more">+{room.photos.length - ROOM_THUMBS}</span>
                    )}
                  </span>
                </span>
                <span className="pk-claim-room-meta">
                  <span className="pk-folder-photos">{plural(room.photos.length, 'photo')}</span>
                  {inEstimate(room.room_name) && <span className="pk-claim-meta">In this estimate</span>}
                </span>
              </Checkbox>
            </div>
          );
        })}
      </div>

      {chosenRooms.some(r => r.photos.length > AI_PHOTOS_PER_ROOM) && (
        <div className="pk-note">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>Rooms with more than {AI_PHOTOS_PER_ROOM} photos: the AI reads the {AI_PHOTOS_PER_ROOM} most different.</span>
        </div>
      )}

      <Checkbox className="pk-claim-analyze" checked={analyze} onChange={e => setAnalyze(e.target.checked)}>
        Analyze with AI after loading
      </Checkbox>

      <div className="pk-folder-reset">
        <Button type="text" size="small" onClick={() => pickClaim(null)}>
          Choose a different claim
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Load Photos from a Claim"
      width={560}
      className="pk-folder-modal"
      {...sheetProps}
      footer={picked ? [
        <span key="count" className="pk-folder-count">
          {plural(chosenRooms.length, 'room')} · {plural(chosenPhotos, 'photo')}
        </span>,
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button
          key="load"
          type="primary"
          icon={<PictureOutlined />}
          onClick={handleLoad}
          disabled={chosenRooms.length === 0}
        >
          Load {plural(chosenRooms.length, 'room')}
        </Button>,
      ] : null}
      destroyOnHidden
    >
      <p className="pk-folder-intro">
        Photos picked for packing on a claim (Use for packing in the claim's Photos) load here room by room.
      </p>
      {picked === undefined && !claimsQuery.isError
        ? <div className="pk-folder-empty"><Spin size="small" /></div>
        : picked ? roomPicker : claimPicker}
    </Modal>
  );
};

export default ClaimPhotosImportModal;
