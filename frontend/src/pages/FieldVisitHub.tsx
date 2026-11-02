/**
 * One field visit: the address, the owner when there is one, signing, and the
 * rooms photographed so far by floor. Everything can wait or be done in any order,
 * and any room can be picked back up.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, ConfigProvider, Skeleton, message } from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  CheckCircleFilled,
  EditOutlined,
  FilePdfOutlined,
  RightOutlined,
  SignatureOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Pill } from '../components/common/ui';
import { AddressSheet, OwnerSheet, namedAfterAddress } from '../components/field-visit/FieldForms';
import { retryShot, wallsDone } from '../components/field-visit/fieldStore';
import { WallTicks } from '../components/field-visit/guides';
import { askForMotionAccess } from '../components/field-visit/useFieldSensors';
import { useFieldVisit } from '../components/field-visit/useFieldVisit';
import '../components/field-visit/field.css';
import '../components/onsite-signing/onsite.css';
import { useAuth } from '../contexts/AuthContext';
import { apiUrl } from '../services/fieldVisitService';
import { comfortTheme } from '../styles/antTheme';
import { FLOORS } from '../types/fieldVisit';

const POLL_MS = 15000;

const FieldVisitHub: React.FC = () => {
  const { visitId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { canAccessPath } = useAuth();
  const visit = useFieldVisit(visitId, POLL_MS);
  const [editing, setEditing] = useState<'owner' | 'address' | null>(null);

  const { header, rooms, shots, counts } = visit;
  const client = header?.client;

  useEffect(() => {
    if ((location.state as any)?.existing) {
      message.info('Already a client here');
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const floors = useMemo(() => FLOORS
    .map(floor => ({
      ...floor,
      rooms: rooms.filter(room => room.floor === floor.key && shots.some(shot => shot.roomId === room.id)),
    }))
    .filter(floor => floor.rooms.length > 0), [rooms, shots]);

  const videoCount = shots.filter(shot => shot.isVideo).length;
  const photoCount = shots.length - videoCount;
  const lastShot = shots[shots.length - 1];
  const lastRoom = lastShot ? rooms.find(room => room.id === lastShot.roomId) : undefined;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['field-visit', visitId] });

  const openCamera = (roomId?: string) => {
    // Has to happen in the tap, before the camera page takes over
    askForMotionAccess();
    navigate(`/field/${visitId}/camera${roomId ? `?room=${roomId}` : ''}`);
  };

  const retryAll = () => {
    shots.filter(shot => shot.status === 'failed').forEach(shot => retryShot(visitId, shot.id));
  };

  const back = (
    <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Field visits" onClick={() => navigate('/field')} />
  );

  if (visit.notFound && !client) {
    return (
      <div className="os-page">
        <PageHeader leading={back} title="Visit not found" />
      </div>
    );
  }
  if (!client) {
    return (
      <div className="os-page">
        <PageHeader leading={back} title="Field visit" />
        {visit.server.isError
          ? (
            <div className="os-error" role="alert">
              Couldn&apos;t load this visit.
              <Button size="small" onClick={() => visit.server.refetch()}>Try again</Button>
            </div>
          )
          : <Skeleton active paragraph={{ rows: 4 }} />}
      </div>
    );
  }

  const noOwner = namedAfterAddress(client);
  const place = [client.city, client.state, client.zipcode].filter(Boolean).join(', ');
  const signing = canAccessPath('/onsite-signing');
  const signPath = `/onsite-signing?client=${client.id}&visit=${visitId}`;

  return (
    <ConfigProvider theme={comfortTheme} componentSize="large">
      <div className="os-page fv-page">
        <PageHeader
          leading={back}
          title={client.address || client.display_name}
          meta={(
            <span className="fv-hub-place">
              {place}
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                aria-label="Edit address"
                onClick={() => setEditing('address')}
              />
            </span>
          )}
        />

        <Button
          type="primary"
          block
          className="fv-main-btn"
          icon={<CameraOutlined />}
          onClick={() => openCamera(lastRoom?.id)}
        >
          {lastRoom ? `Continue · ${lastRoom.name}` : 'Take photos'}
        </Button>

        {(shots.length > 0 || counts.failed > 0) && (
          <div className="fv-hub-counts" aria-live="polite">
            <span>{[
              `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`,
              `${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`,
            ].join(' · ')}</span>
            {counts.waiting > 0 && <Pill tone="blue">{counts.waiting} sending</Pill>}
            {counts.failed > 0 && (
              <button type="button" className="fv-hub-retry" onClick={retryAll}>
                <Pill tone="red">{counts.failed} not sent · Retry</Pill>
              </button>
            )}
          </div>
        )}

        <ul className="os-rows fv-rows">
          <li>
            <button type="button" className="os-row" onClick={() => setEditing('owner')}>
              <UserOutlined className="fv-row-icon" aria-hidden="true" />
              <span className="os-row-body">
                <span className="os-row-title">{noOwner ? 'Add owner' : client.display_name}</span>
                {!noOwner && (client.phone || client.email) && (
                  <span className="os-row-meta">{[client.phone, client.email].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              <RightOutlined className="os-row-go" aria-hidden="true" />
            </button>
          </li>
          {signing && (
            <li>
              <button type="button" className="os-row" onClick={() => navigate(signPath)}>
                <SignatureOutlined className="fv-row-icon" aria-hidden="true" />
                <span className="os-row-body">
                  <span className="os-row-title">Sign contract</span>
                </span>
                <RightOutlined className="os-row-go" aria-hidden="true" />
              </button>
            </li>
          )}
          {header.contracts.map(contract => (
            <li key={contract.id}>
              <a className="os-row" href={apiUrl(contract.pdf_url)} target="_blank" rel="noopener noreferrer">
                <FilePdfOutlined className="fv-row-icon" aria-hidden="true" />
                <span className="os-row-body">
                  <span className="os-row-title">{contract.title || contract.contract_number}</span>
                </span>
                {contract.status === 'signed'
                  ? <CheckCircleFilled className="fv-row-signed" aria-label="Signed" />
                  : <Pill tone="gray">{contract.status}</Pill>}
              </a>
            </li>
          ))}
        </ul>

        {floors.map(floor => (
          <section key={floor.key} className="ui-section fv-floor">
            <div className="ui-section-head">
              <h2 className="ui-section-title">{floor.label}</h2>
            </div>
            <ul className="os-rows fv-rows">
              {floor.rooms.map((room) => {
                const inRoom = shots.filter(shot => shot.roomId === room.id);
                const demo = inRoom.filter(shot => shot.kind === 'demo').length;
                const videos = inRoom.filter(shot => shot.isVideo).length;
                return (
                  <li key={room.id}>
                    <button type="button" className="os-row" onClick={() => openCamera(room.id)}>
                      <span className="os-row-body">
                        <span className="os-row-title">{room.name}</span>
                        <span className="os-row-meta fv-room-meta">
                          <WallTicks done={wallsDone(shots, room.id)} />
                          {demo > 0 && <span>Demo {demo}</span>}
                          {videos > 0 ? <span>Video {videos}</span> : <Pill tone="yellow">No video</Pill>}
                        </span>
                      </span>
                      <RightOutlined className="os-row-go" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <OwnerSheet open={editing === 'owner'} client={client} onClose={() => setEditing(null)} onSaved={refresh} />
        <AddressSheet open={editing === 'address'} client={client} onClose={() => setEditing(null)} onSaved={refresh} />
      </div>
    </ConfigProvider>
  );
};

export default FieldVisitHub;
