/**
 * The panels that come up over the camera: which room this is, what's been taken
 * so far, and one shot up close. The camera keeps running underneath, so closing
 * them goes straight back to shooting.
 */

import React, { useMemo, useState } from 'react';
import {
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  PlayCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { FLOORS, ROOM_PRESETS, floorLabel } from '../../types/fieldVisit';
import type { FloorKey } from '../../types/fieldVisit';
import { deleteShot, retryShot, shotFullUrl, shotThumbUrl, updateShot, wallsDone } from './fieldStore';
import type { LocalRoom, LocalShot } from './fieldStore';
import { WallTicks } from './guides';

export const uniqueRoomName = (rooms: LocalRoom[], wanted: string, exceptId?: string) => {
  const taken = new Set(rooms.filter(room => room.id !== exceptId).map(room => room.name));
  if (!taken.has(wanted)) return wanted;
  let number = 2;
  while (taken.has(`${wanted} ${number}`)) number += 1;
  return `${wanted} ${number}`;
};

const Sheet: React.FC<{ label: string; onClose: () => void; children: React.ReactNode; tall?: boolean }> = ({
  label,
  onClose,
  children,
  tall,
}) => (
  <div className="fv-sheet-wrap" role="dialog" aria-modal="true" aria-label={label}>
    <button type="button" className="fv-sheet-back" aria-label="Close" onClick={onClose} />
    <div className={`fv-sheet${tall ? ' fv-sheet--tall' : ''}`}>
      <div className="fv-sheet-head">
        <h2>{label}</h2>
        <button type="button" className="fv-icon-btn" aria-label="Close" onClick={onClose}>
          <CloseOutlined />
        </button>
      </div>
      <div className="fv-sheet-body">{children}</div>
    </div>
  </div>
);

// ── Which room ──────────────────────────────────────

export const RoomSheet: React.FC<{
  room: LocalRoom;
  rooms: LocalRoom[];
  shots: LocalShot[];
  floorGuess: FloorKey | null;
  onFloor: (floor: FloorKey) => void;
  onName: (name: string, roomType: string | null) => void;
  onSwitch: (room: LocalRoom) => void;
  onNew: () => void;
  onClose: () => void;
}> = ({ room, rooms, shots, floorGuess, onFloor, onName, onSwitch, onNew, onClose }) => {
  const [typed, setTyped] = useState('');
  // Rooms nobody has taken anything in yet aren't worth going back to
  const others = useMemo(() => rooms.filter(
    other => other.id !== room.id && shots.some(shot => shot.roomId === other.id),
  ), [rooms, room.id, shots]);

  const saveTyped = () => {
    const name = typed.trim();
    if (name) onName(uniqueRoomName(rooms, name, room.id), null);
  };

  return (
    <Sheet label="Room" onClose={onClose} tall>
      <div className="fv-chip-row" role="radiogroup" aria-label="Floor">
        {FLOORS.map(floor => (
          <button
            key={floor.key}
            type="button"
            role="radio"
            aria-checked={room.floor === floor.key}
            aria-label={floor.label}
            className={`fv-floor-btn${room.floor === floor.key ? ' is-on' : ''}${floorGuess === floor.key ? ' is-guess' : ''}`}
            onClick={() => onFloor(floor.key)}
          >
            {floor.short}
          </button>
        ))}
      </div>

      <div className="fv-chip-grid">
        {ROOM_PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            className={`fv-chip${room.roomType === preset.key ? ' is-on' : ''}`}
            onClick={() => onName(uniqueRoomName(rooms, preset.title, room.id), preset.key)}
          >
            {preset.title}
          </button>
        ))}
      </div>

      <form
        className="fv-name-row"
        onSubmit={(event) => {
          event.preventDefault();
          saveTyped();
        }}
      >
        <input
          className="fv-input"
          value={typed}
          maxLength={60}
          placeholder={room.name}
          aria-label="Room name"
          enterKeyHint="done"
          onChange={event => setTyped(event.target.value)}
        />
        <button type="submit" className="fv-icon-btn" aria-label="Save name" disabled={!typed.trim()}>
          <CheckOutlined />
        </button>
      </form>

      <button type="button" className="fv-wide-btn" onClick={onNew}>
        <PlusOutlined /> New room
      </button>

      {others.length > 0 && (
        <ul className="fv-room-list">
          {others.map(other => (
            <li key={other.id}>
              <button type="button" className="fv-room-row" onClick={() => onSwitch(other)}>
                <span className="fv-room-row-name">{other.name}</span>
                <span className="fv-room-row-floor">{floorLabel(other.floor)}</span>
                <WallTicks done={wallsDone(shots, other.id)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
};

// ── What's been taken ───────────────────────────────

const ShotTile: React.FC<{ shot: LocalShot; onOpen: () => void }> = ({ shot, onOpen }) => {
  const thumb = shotThumbUrl(shot);
  return (
    <button type="button" className="fv-tile" aria-label={shotLabel(shot)} onClick={onOpen}>
      {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <span className="fv-tile-empty" />}
      {shot.isVideo && <PlayCircleFilled className="fv-tile-play" />}
      {shot.kind === 'demo' && <span className="fv-tile-tag"><ToolOutlined /></span>}
      {shot.kind === 'wall' && shot.wall != null && <span className="fv-tile-tag">{shot.wall}</span>}
      {shot.status === 'failed' && <ExclamationCircleFilled className="fv-tile-state is-failed" />}
      {(shot.status === 'queued' || shot.status === 'sending') && (
        <CloudUploadOutlined className="fv-tile-state is-waiting" />
      )}
    </button>
  );
};

export const shotLabel = (shot: LocalShot) => {
  if (shot.isVideo) return 'Video';
  return shot.kind === 'demo' ? 'Demo' : `Wall ${shot.wall ?? ''}`.trim();
};

export const ShotsSheet: React.FC<{
  rooms: LocalRoom[];
  shots: LocalShot[];
  currentRoomId: string | null;
  onOpen: (shot: LocalShot) => void;
  onClose: () => void;
}> = ({ rooms, shots, currentRoomId, onOpen, onClose }) => {
  // The room being shot first, then the newest room back
  const groups = useMemo(() => {
    const withShots = rooms.filter(room => shots.some(shot => shot.roomId === room.id));
    return withShots
      .sort((a, b) => {
        if (a.id === currentRoomId) return -1;
        if (b.id === currentRoomId) return 1;
        return b.position - a.position;
      })
      .map(room => ({ room, shots: shots.filter(shot => shot.roomId === room.id) }));
  }, [rooms, shots, currentRoomId]);

  return (
    <Sheet label={`Photos · ${shots.length}`} onClose={onClose} tall>
      {groups.length === 0 && <div className="fv-sheet-empty">Nothing yet</div>}
      {groups.map(group => (
        <section key={group.room.id} className="fv-shot-group">
          <h3>
            {group.room.name}
            <span>{floorLabel(group.room.floor)}</span>
          </h3>
          <div className="fv-tiles">
            {group.shots.map(shot => (
              <ShotTile key={shot.id} shot={shot} onOpen={() => onOpen(shot)} />
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
};

// ── One shot ────────────────────────────────────────

export const ShotViewer: React.FC<{
  visitId: string;
  shot: LocalShot;
  rooms: LocalRoom[];
  onClose: () => void;
}> = ({ visitId, shot, rooms, onClose }) => {
  const [moving, setMoving] = useState(false);
  const url = shotFullUrl(shot);
  const thumb = shotThumbUrl(shot);

  const remove = () => {
    deleteShot(visitId, shot.id);
    onClose();
  };
  const toggleDemo = () => {
    updateShot(visitId, shot.id, { kind: shot.kind === 'demo' ? 'wall' : 'demo', wall: null });
    onClose();
  };

  return (
    <div className="fv-viewer" role="dialog" aria-modal="true" aria-label={shotLabel(shot)}>
      <div className="fv-viewer-stage">
        {shot.isVideo
          ? <video src={url} controls playsInline preload="auto" poster={thumb} />
          : (
            <img
              src={url}
              alt={shotLabel(shot)}
              draggable={false}
              style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
            />
          )}
      </div>
      {shot.status === 'failed' && (
        <div className="fv-viewer-error" role="alert">
          <span>{shot.error || 'Could not send'}</span>
          <button type="button" className="fv-text-btn" onClick={() => retryShot(visitId, shot.id)}>
            <ReloadOutlined /> Retry
          </button>
        </div>
      )}
      {moving ? (
        <ul className="fv-room-list fv-viewer-rooms">
          {rooms.filter(room => room.id !== shot.roomId).map(room => (
            <li key={room.id}>
              <button
                type="button"
                className="fv-room-row"
                onClick={() => {
                  updateShot(visitId, shot.id, { roomId: room.id, wall: null });
                  onClose();
                }}
              >
                <span className="fv-room-row-name">{room.name}</span>
                <span className="fv-room-row-floor">{floorLabel(room.floor)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="fv-viewer-bar">
        <button type="button" className="fv-text-btn" onClick={onClose}><CloseOutlined /> Close</button>
        {rooms.length > 1 && (
          <button type="button" className="fv-text-btn" aria-expanded={moving} onClick={() => setMoving(!moving)}>
            Move
          </button>
        )}
        {!shot.isVideo && (
          <button type="button" className={`fv-text-btn${shot.kind === 'demo' ? ' is-on' : ''}`} onClick={toggleDemo}>
            <ToolOutlined /> Demo
          </button>
        )}
        <button type="button" className="fv-text-btn is-danger" onClick={remove}><DeleteOutlined /> Delete</button>
      </div>
    </div>
  );
};
