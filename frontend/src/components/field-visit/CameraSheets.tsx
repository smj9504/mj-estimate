/**
 * The panels that come up over the camera: which room this is, what's been taken
 * so far, and one shot up close. The camera keeps running underneath, so closing
 * them goes straight back to shooting.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  LeftOutlined,
  PlayCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { FLOORS, floorLabel } from '../../types/fieldVisit';
import type { FloorKey } from '../../types/fieldVisit';
import { deleteShot, dropKeptThumb, retryShot, shotFullUrl, shotThumbUrl, updateShot, wallsDone } from './fieldStore';
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
// Rooms come in as Room 1, Room 2… (or what the AI saw); renaming is a typed name, any time.

export const RoomSheet: React.FC<{
  room: LocalRoom;
  rooms: LocalRoom[];
  shots: LocalShot[];
  floorGuess: FloorKey | null;
  onFloor: (floor: FloorKey) => void;
  onName: (name: string) => void;
  onSwitch: (room: LocalRoom) => void;
  onNew: () => void;
  onStairs: () => void;
  onClose: () => void;
}> = ({ room, rooms, shots, floorGuess, onFloor, onName, onSwitch, onNew, onStairs, onClose }) => {
  const [typed, setTyped] = useState('');
  // Rooms nobody has taken anything in yet aren't worth going back to
  const others = useMemo(() => rooms.filter(
    other => other.id !== room.id && shots.some(shot => shot.roomId === other.id),
  ), [rooms, room.id, shots]);

  const saveTyped = () => {
    const name = typed.trim();
    if (name) onName(uniqueRoomName(rooms, name, room.id));
  };

  return (
    <Sheet label="Room" onClose={onClose} tall>
      <span className="fv-field-label" aria-hidden="true">Floor</span>
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

      <div className="fv-btn-row">
        <button type="button" className="fv-wide-btn" onClick={onNew}>
          <PlusOutlined /> New room
        </button>
        {/* Stairs go between floors: filed on the one they start from, and climbing them doesn't ask about the floor */}
        <button type="button" className="fv-wide-btn is-quiet" onClick={onStairs}>
          Stairs
        </button>
      </div>

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

/** A shot's small picture, with nothing broken on show: an empty space if there's none to be had */
export const ShotThumb: React.FC<{ shot: LocalShot; emptyClass: string; lazy?: boolean }> = ({ shot, emptyClass, lazy }) => {
  const [failed, setFailed] = useState(false);
  const thumb = shotThumbUrl(shot);
  if (!thumb || failed) return <span className={emptyClass} />;
  return (
    <img
      src={thumb}
      alt=""
      loading={lazy ? 'lazy' : undefined}
      draggable={false}
      onError={() => {
        if (!dropKeptThumb(shot)) setFailed(true);
      }}
    />
  );
};

/** `selected` is left out unless shots are being picked, when it shows a tick in the corner */
export const ShotTile: React.FC<{ shot: LocalShot; onOpen: () => void; selected?: boolean }> = ({
  shot,
  onOpen,
  selected,
}) => {
  const picking = selected !== undefined;
  return (
    <button
      type="button"
      className={`fv-tile${selected ? ' is-selected' : ''}`}
      aria-label={shotLabel(shot)}
      aria-pressed={picking ? selected : undefined}
      onClick={onOpen}
    >
      <ShotThumb shot={shot} emptyClass="fv-tile-empty" lazy />
      {picking && <span className="fv-tile-check" aria-hidden="true">{selected && <CheckOutlined />}</span>}
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

/** The camera's Photos sheet, by room: the room being shot first, then the newest room back */
export const shotGroups = (rooms: LocalRoom[], shots: LocalShot[], currentRoomId: string | null) => rooms
  .filter(room => shots.some(shot => shot.roomId === room.id))
  .sort((a, b) => {
    if (a.id === currentRoomId) return -1;
    if (b.id === currentRoomId) return 1;
    return b.position - a.position;
  })
  .map(room => ({ room, shots: shots.filter(shot => shot.roomId === room.id) }));

export const ShotsSheet: React.FC<{
  rooms: LocalRoom[];
  shots: LocalShot[];
  currentRoomId: string | null;
  onOpen: (shot: LocalShot) => void;
  onClose: () => void;
}> = ({ rooms, shots, currentRoomId, onOpen, onClose }) => {
  const groups = useMemo(() => shotGroups(rooms, shots, currentRoomId), [rooms, shots, currentRoomId]);

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

/** How far a finger has to go, or how fast, to turn to the next one */
const SWIPE_PX = 70;
const FLICK_PX = 30;
const FLICK_MS = 250;
/** Along the bottom of a video its own controls scrub sideways: a drag there isn't a swipe */
const VIDEO_CONTROLS_PX = 64;

interface Drag {
  x: number;
  y: number;
  at: number;
  axis: 'x' | 'y' | null;
}

/**
 * One shot up close, and the ones either side of it a swipe away (arrow keys, or the
 * arrows at the sides, with a mouse). `sequence` is the order they're in on screen.
 */
export const ShotViewer: React.FC<{
  visitId: string;
  shot: LocalShot;
  rooms: LocalRoom[];
  sequence?: LocalShot[];
  onShow?: (shot: LocalShot) => void;
  onClose: () => void;
}> = ({ visitId, shot, rooms, sequence, onShow, onClose }) => {
  const [moving, setMoving] = useState(false);
  const [offset, setOffset] = useState(0);
  const [entering, setEntering] = useState<'from-left' | 'from-right' | null>(null);
  const drag = useRef<Drag | null>(null);
  const url = shotFullUrl(shot);
  const thumb = shotThumbUrl(shot);

  const index = sequence ? sequence.findIndex(s => s.id === shot.id) : -1;
  const prev = index > 0 ? sequence?.[index - 1] : undefined;
  const next = index >= 0 ? sequence?.[index + 1] : undefined;
  const room = rooms.find(r => r.id === shot.roomId);

  useEffect(() => {
    setMoving(false);
  }, [shot.id]);

  // The neighbours' photos fetched ahead, so a swipe lands on a picture rather than a wait
  useEffect(() => {
    [prev, next].forEach((near) => {
      if (!near || near.isVideo) return;
      const ahead = shotFullUrl(near);
      if (ahead) new Image().src = ahead;
    });
  }, [prev, next]);

  const show = useCallback((target: LocalShot | undefined, from: 'from-left' | 'from-right') => {
    if (!target || !onShow) return;
    setEntering(from);
    onShow(target);
  }, [onShow]);
  const showPrev = useCallback(() => show(prev, 'from-left'), [show, prev]);
  const showNext = useCallback(() => show(next, 'from-right'), [show, next]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') showPrev();
      else if (event.key === 'ArrowRight') showNext();
      else if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPrev, showNext, onClose]);

  const onTouchStart = (event: React.TouchEvent) => {
    drag.current = null;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const video = (event.target as HTMLElement).closest('video');
    if (video && touch.clientY > video.getBoundingClientRect().bottom - VIDEO_CONTROLS_PX) return;
    drag.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), axis: null };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const current = drag.current;
    if (!current || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - current.x;
    const dy = event.touches[0].clientY - current.y;
    if (!current.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (current.axis !== 'x') return;
    // Past the first or the last it gives a little and springs back
    const nothingThere = (dx > 0 && !prev) || (dx < 0 && !next);
    setOffset(nothingThere ? dx / 4 : dx);
  };
  const onTouchEnd = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.axis === 'x') {
      const flick = Math.abs(offset) > FLICK_PX && Date.now() - current.at < FLICK_MS;
      if ((offset < -SWIPE_PX || (flick && offset < 0)) && next) showNext();
      else if ((offset > SWIPE_PX || (flick && offset > 0)) && prev) showPrev();
    }
    setOffset(0);
  };

  // Gone from here: the one after it takes its place, as in a phone's photos
  const remove = () => {
    const after = next ?? prev;
    if (after && onShow) show(after, next ? 'from-right' : 'from-left');
    else onClose();
    deleteShot(visitId, shot.id);
  };
  const toggleDemo = () => {
    updateShot(visitId, shot.id, { kind: shot.kind === 'demo' ? 'wall' : 'demo', wall: null });
  };

  return (
    <div className="fv-viewer" role="dialog" aria-modal="true" aria-label={shotLabel(shot)}>
      <div
        className="fv-viewer-stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          key={shot.id}
          className={`fv-viewer-media${entering ? ` is-${entering}` : ''}${offset ? ' is-dragging' : ''}`}
          style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        >
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
        {sequence && sequence.length > 1 && index >= 0 && (
          <div className="fv-viewer-count" aria-live="polite">
            {room ? `${room.name} · ` : ''}{index + 1} / {sequence.length}
          </div>
        )}
        {prev && onShow && (
          <button type="button" className="fv-viewer-nav is-prev" aria-label="Previous" onClick={showPrev}>
            <LeftOutlined />
          </button>
        )}
        {next && onShow && (
          <button type="button" className="fv-viewer-nav is-next" aria-label="Next" onClick={showNext}>
            <RightOutlined />
          </button>
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
          {rooms.filter(other => other.id !== shot.roomId).map(other => (
            <li key={other.id}>
              <button
                type="button"
                className="fv-room-row"
                onClick={() => {
                  updateShot(visitId, shot.id, { roomId: other.id, wall: null });
                  setMoving(false);
                }}
              >
                <span className="fv-room-row-name">{other.name}</span>
                <span className="fv-room-row-floor">{floorLabel(other.floor)}</span>
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
          <button
            type="button"
            className={`fv-text-btn${shot.kind === 'demo' ? ' is-on' : ''}`}
            aria-pressed={shot.kind === 'demo'}
            onClick={toggleDemo}
          >
            <ToolOutlined /> Demo
          </button>
        )}
        <button type="button" className="fv-text-btn is-danger" onClick={remove}><DeleteOutlined /> Delete</button>
      </div>
    </div>
  );
};
