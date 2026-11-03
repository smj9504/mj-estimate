/**
 * A client's field visits on the client page: what was shot, by floor and room,
 * and which claim it belongs to. Putting a visit on a claim moves its photos there,
 * so the office decides that here, the same way it does for contracts signed on site.
 */

import React, { useMemo, useState } from 'react';
import { Button, Image, Modal, Select, Skeleton, message } from 'antd';
import { PlayCircleFilled } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pill, useSheetModal } from '../common/ui';
import { useAuth } from '../../contexts/AuthContext';
import { apiUrl, fieldVisitService } from '../../services/fieldVisitService';
import { FLOORS } from '../../types/fieldVisit';
import type { FieldVisitDetail, FieldVisitSummary, ServerShot } from '../../types/fieldVisit';
import { WallTicks } from './guides';
import './field.css';

const shotTag = (shot: ServerShot) => {
  if (shot.kind === 'demo') return 'Demo';
  return shot.kind === 'wall' && shot.wall != null ? `Wall ${shot.wall}` : null;
};

const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

const fetchedAhead = new Set<string>();

/** Starts on a photo before it's opened. The browser keeps it: a file never changes under its id. */
const fetchAhead = (url: string) => {
  if (fetchedAhead.has(url)) return;
  fetchedAhead.add(url);
  document.createElement('img').src = url;
};

const VisitDetail: React.FC<{ summary: FieldVisitSummary }> = ({ summary }) => {
  const queryClient = useQueryClient();
  const { canAccessPath } = useAuth();
  const { sheetProps } = useSheetModal();
  const [playing, setPlaying] = useState<ServerShot | null>(null);
  const [linking, setLinking] = useState(false);

  const { data: visit, isLoading, isError, refetch } = useQuery<FieldVisitDetail>({
    queryKey: ['field-visit-office', summary.id],
    queryFn: () => fieldVisitService.get(summary.id),
  });

  const floors = useMemo(() => {
    if (!visit) return [];
    return FLOORS
      .map(floor => ({
        ...floor,
        rooms: visit.rooms
          .filter(room => room.floor === floor.key)
          .map(room => ({ room, shots: visit.shots.filter(shot => shot.room_id === room.id) }))
          .filter(entry => entry.shots.length > 0),
      }))
      .filter(floor => floor.rooms.length > 0);
  }, [visit]);

  // In the order the viewer steps through them
  const photos = useMemo(() => floors.flatMap(floor => floor.rooms.flatMap(
    ({ shots }) => shots.filter(shot => !shot.is_video),
  )), [floors]);
  const smallPictureOf = useMemo(() => new Map(
    photos.map(photo => [apiUrl(photo.url), apiUrl(photo.thumbnail_url)]),
  ), [photos]);
  const fetchAround = (index: number) => {
    [index, index + 1, index - 1].forEach((near) => {
      if (photos[near]) fetchAhead(apiUrl(photos[near].url));
    });
  };

  const linkClaim = async (claimId: string | null) => {
    setLinking(true);
    try {
      await fieldVisitService.linkClaim(summary.id, claimId);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['field-visits', summary.client_id] });
      message.success(claimId ? 'Photos moved to the claim' : 'Taken off the claim');
    } catch (err: any) {
      message.error(err.response?.data?.detail || "Couldn't change the claim");
    } finally {
      setLinking(false);
    }
  };

  if (isLoading) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (isError || !visit) {
    return (
      <div className="os-error" role="alert">
        Couldn&apos;t load this visit.
        <Button size="small" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <section className="ui-section fv-office-visit">
      <div className="ui-section-head">
        <h2 className="ui-section-title">{dateOf(visit.started_at)}</h2>
        <div className="fv-office-actions">
          {visit.claims.length > 0 && (
            <Select
              size="small"
              className="fv-office-claim"
              aria-label="Claim"
              placeholder="Put on a claim"
              allowClear
              loading={linking}
              value={visit.claim_id ?? undefined}
              options={visit.claims.map(claim => ({ value: claim.id, label: claim.claim_number }))}
              onChange={value => linkClaim(value ?? null)}
            />
          )}
          {canAccessPath('/field') && <Link className="ui-ink-link" to={`/field/${visit.id}`}>Open visit</Link>}
        </div>
      </div>

      {floors.length === 0 && <p className="os-note">No photos yet.</p>}
      <Image.PreviewGroup
        preview={{
          rootClassName: 'fv-office-preview',
          onVisibleChange: (open, _wasOpen, current) => {
            if (open) fetchAround(current);
          },
          onChange: fetchAround,
          imageRender: (photo, { image }) => React.cloneElement(photo, {
            style: { ...photo.props.style, backgroundImage: `url("${smallPictureOf.get(image.url)}")` },
          }),
        }}
      >
        {floors.map(floor => (
          <div key={floor.key} className="fv-office-floor">
            <h3 className="fv-office-floor-title">{floor.label}</h3>
            {floor.rooms.map(({ room, shots }) => (
              <div key={room.id} className="fv-office-room">
                <div className="fv-office-room-head">
                  <span className="fv-office-room-name">{room.name}</span>
                  <WallTicks
                    done={[...new Set(
                      shots.filter(shot => shot.kind === 'wall' && shot.wall != null).map(shot => shot.wall as number),
                    )]}
                  />
                  {room.name_source === 'ai' && <Pill tone="gray">AI named</Pill>}
                  {!shots.some(shot => shot.is_video) && <Pill tone="yellow">No video</Pill>}
                </div>
                <div className="fv-office-shots">
                  {shots.map(shot => (
                    <figure
                      key={shot.id}
                      className="fv-office-shot"
                      onPointerEnter={shot.is_video ? undefined : () => fetchAhead(apiUrl(shot.url))}
                    >
                      {shot.is_video ? (
                        <button
                          type="button"
                          className="fv-office-video"
                          aria-label="Play video"
                          onClick={() => setPlaying(shot)}
                        >
                          <img src={apiUrl(shot.thumbnail_url)} alt="" loading="lazy" />
                          <PlayCircleFilled />
                        </button>
                      ) : (
                        <Image
                          src={apiUrl(shot.thumbnail_url)}
                          preview={{ src: apiUrl(shot.url) }}
                          alt={`${room.name} ${shotTag(shot) ?? ''}`.trim()}
                          loading="lazy"
                        />
                      )}
                      {shotTag(shot) && <figcaption>{shotTag(shot)}</figcaption>}
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Image.PreviewGroup>

      <Modal
        {...sheetProps}
        open={!!playing}
        title="Video"
        footer={null}
        destroyOnClose
        onCancel={() => setPlaying(null)}
      >
        {playing && (
          <video
            className="fv-office-player"
            src={apiUrl(playing.url)}
            poster={apiUrl(playing.thumbnail_url)}
            controls
            playsInline
            autoPlay
            preload="auto"
          />
        )}
      </Modal>
    </section>
  );
};

export const useClientFieldVisits = (clientId?: string) => useQuery({
  queryKey: ['field-visits', clientId],
  queryFn: () => fieldVisitService.list({ client_id: clientId }),
  enabled: !!clientId,
});

const ClientFieldVisits: React.FC<{ visits: FieldVisitSummary[] }> = ({ visits }) => (
  <div className="fv-office">
    {visits.map(visit => <VisitDetail key={visit.id} summary={visit} />)}
  </div>
);

export default ClientFieldVisits;
