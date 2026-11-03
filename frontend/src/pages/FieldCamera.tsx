/**
 * Field Visit camera: walk the property shooting one room after another. Video is
 * the default: it starts with the camera and runs up to a minute in each room, and
 * the shutter takes photos out of it. Each shot and clip saves and sends itself,
 * and coming back picks up at the next wall of the room left off in.
 *
 * It runs in the page instead of the phone's camera app because only then can it
 * record and take photos at once, keep the guides on screen and read the motion
 * sensors. Without a camera it falls back to the system one, a shot at a time.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  CameraOutlined,
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  DisconnectOutlined,
  DownOutlined,
  ExclamationCircleFilled,
  PauseOutlined,
  RightOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
  ToolOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RoomSheet, ShotThumb, ShotViewer, ShotsSheet, uniqueRoomName } from '../components/field-visit/CameraSheets';
import {
  addRoom,
  addShot,
  getVisitSnapshot,
  liveShots,
  moveShotsFrom,
  updateRoom,
  wallsDone,
} from '../components/field-visit/fieldStore';
import type { LocalRoom, LocalShot } from '../components/field-visit/fieldStore';
import { FrameGuide, LevelBar, RoomMap } from '../components/field-visit/guides';
import { MOVED_STEPS, nextWall, pickWall } from '../components/field-visit/sensors';
import type { FloorAnchor } from '../components/field-visit/sensors';
import { MAX_CLIP_SECONDS, thumbFromFile, useCamera } from '../components/field-visit/useCamera';
import type { Taken } from '../components/field-visit/useCamera';
import { askForMotionAccess, useFieldSensors } from '../components/field-visit/useFieldSensors';
import { useFieldVisit } from '../components/field-visit/useFieldVisit';
import '../components/field-visit/field.css';
import { FLOORS, floorLabel, roomTitle } from '../types/fieldVisit';
import type { FloorKey } from '../types/fieldVisit';

const POLL_MS = 8000;

const lastRoomKey = (visitId: string) => `field-visit-room-${visitId}`;
const anchorKey = (visitId: string) => `field-visit-floor-anchor-${visitId}`;

const readSaved = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSaved = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage off: it just won't reopen in the same room
  }
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const useOnline = () => {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
};

const usePageVisible = () => {
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
};

const useWakeLock = () => {
  useEffect(() => {
    let lock: any = null;
    let gone = false;
    const request = async () => {
      try {
        const next = await (navigator as any).wakeLock?.request('screen');
        if (gone) next?.release();
        else lock = next;
      } catch {
        // Not offered, or low battery: the screen just dims as usual
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      gone = true;
      lock?.release();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
};

const FieldCamera: React.FC = () => {
  const { visitId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const visit = useFieldVisit(visitId, POLL_MS);
  const sensors = useFieldSensors();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef);
  const online = useOnline();
  const pageVisible = usePageVisible();
  useWakeLock();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [videoDone, setVideoDone] = useState(false);
  const [demo, setDemo] = useState(false);
  const [sheet, setSheet] = useState<'room' | 'shots' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Where wall 1 is in each room shot this session
  const anchors = useRef(new Map<string, number>());
  const floorAnchor = useRef<FloorAnchor | null>(null);
  // Which room the running clip belongs to
  const clipRoom = useRef<string | null>(null);

  const { rooms, shots, counts, header } = visit;
  const room = useMemo(() => rooms.find(r => r.id === roomId) ?? null, [rooms, roomId]);
  const roomShots = useMemo(() => shots.filter(shot => shot.roomId === roomId), [shots, roomId]);
  const done = useMemo(() => (roomId ? wallsDone(shots, roomId) : []), [shots, roomId]);
  const demoCount = roomShots.filter(shot => shot.kind === 'demo').length;
  const target = nextWall(done);
  const viewed = viewing ? shots.find(shot => shot.id === viewing) ?? null : null;

  // ── Which floor ──────────────────────────────────

  useEffect(() => {
    if (floorAnchor.current) return;
    try {
      const saved = readSaved(anchorKey(visitId));
      if (saved) {
        floorAnchor.current = JSON.parse(saved);
        return;
      }
    } catch {
      // Not readable: fall through to the door's
    }
    // Taken at the door when the visit started, which counts as the first floor
    if (header?.groundAltitude != null) floorAnchor.current = { altitude: header.groundAltitude, floor: '1' };
  }, [header?.groundAltitude, visitId]);

  // Re-read as altitude comes in
  const floorGuess = useMemo<FloorKey | null>(() => (
    room ? sensors.floorNow(floorAnchor.current) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [room, sensors.fixTick, sensors.floorNow]);

  const setFloor = (floor: FloorKey) => {
    if (!room) return;
    updateRoom(visitId, room.id, { floor, floorSource: 'user' });
    // Someone just said which floor this is, which beats where the visit started
    const altitude = sensors.altitudeNow();
    if (altitude != null && floor !== 'A') {
      floorAnchor.current = { altitude, floor };
      writeSaved(anchorKey(visitId), JSON.stringify(floorAnchor.current));
    }
  };

  // ── Which room ───────────────────────────────────

  const enterRoom = useCallback((next: LocalRoom) => {
    setRoomId(next.id);
    writeSaved(lastRoomKey(visitId), next.id);
    sensors.resetSteps();
    setDemo(false);
    setPaused(false);
    setVideoDone(false);
    camera.resetClock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, sensors.resetSteps, camera.resetClock]);

  const startRoom = useCallback(() => {
    const snapshot = getVisitSnapshot(visitId);
    const guess = sensors.floorNow(floorAnchor.current);
    const previous = snapshot.rooms.find(r => r.id === roomId);
    const created = addRoom(visitId, {
      name: uniqueRoomName(snapshot.rooms, `Room ${snapshot.rooms.length + 1}`),
      floor: guess ?? previous?.floor ?? '1',
      floorSource: guess ? 'altitude' : 'default',
    });
    enterRoom(created);
    return created;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterRoom, roomId, sensors.floorNow, visitId]);

  // Open where they left off, once it's known what there is to go back to
  const waitingOnServer = visit.server.isFetching && !visit.server.isFetched;
  useEffect(() => {
    if (roomId || !visit.loaded || waitingOnServer) return;
    const wanted = params.get('room') ?? readSaved(lastRoomKey(visitId));
    const found = rooms.find(r => r.id === wanted)
      ?? [...rooms].reverse().find(r => shots.some(shot => shot.roomId === r.id));
    if (found) enterRoom(found);
    else startRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.loaded, waitingOnServer, roomId]);

  const nextRoom = () => {
    askForMotionAccess();
    // Nothing shot here yet, so this room is still the next one: let them name it
    if (roomShots.length === 0 && camera.seconds < 3) setSheet('room');
    else startRoom();
  };

  // ── What the AI read off a photo after walking here ──

  const roomSuggestion = useMemo(() => {
    if (!room?.roomType) return null;
    const shot = [...roomShots].reverse().find(s => s.moved && s.aiRoomType && s.aiRoomType !== 'other');
    if (!shot || shot.aiRoomType === room.roomType || dismissed.includes(shot.id)) return null;
    return { shot, roomType: shot.aiRoomType as string };
  }, [dismissed, room?.roomType, roomShots]);

  const acceptSuggestion = (shot: LocalShot, roomType: string) => {
    if (!room) return;
    const snapshot = getVisitSnapshot(visitId);
    const created = addRoom(visitId, {
      name: uniqueRoomName(snapshot.rooms, roomTitle(roomType)),
      nameSource: 'ai',
      roomType,
      floor: room.floor,
      floorSource: room.floorSource,
    });
    moveShotsFrom(visitId, room.id, shot, created.id);
    enterRoom(created);
  };

  const floorOffer = room && floorGuess && floorGuess !== room.floor && room.floorSource !== 'user'
    && !dismissed.includes(`floor:${room.id}:${floorGuess}`)
    ? floorGuess
    : null;

  // ── Taking shots ─────────────────────────────────

  // The widest lens for the room, the normal one for close-ups (ultra wides often can't focus up close)
  const { canWiden, setWide } = camera;
  useEffect(() => {
    if (canWiden) setWide(!demo);
  }, [canWiden, demo, setWide]);

  const saveShot = useCallback((taken: Taken, details: {
    kind: LocalShot['kind'];
    forRoom: LocalRoom;
    heading: number | null;
    readings: LocalShot['readings'];
    moved: boolean;
    capturedAt?: string;
  }) => {
    const { kind, forRoom, heading, readings, moved, capturedAt } = details;
    // Read now: another shot may have landed while this one was being taken
    const all = liveShots(getVisitSnapshot(visitId));
    const firstPhoto = kind !== 'video' && !all.some(shot => shot.roomId === forRoom.id && !shot.isVideo);
    let wall: number | null = null;
    if (kind === 'wall') {
      const walls = wallsDone(all, forRoom.id);
      const picked = pickWall(walls, heading, anchors.current.get(forRoom.id) ?? null);
      wall = picked.wall;
      if (picked.anchor != null) anchors.current.set(forRoom.id, picked.anchor);
    }
    addShot(visitId, {
      roomId: forRoom.id,
      kind,
      wall,
      isVideo: kind === 'video',
      contentType: taken.contentType,
      name: taken.name,
      readings,
      moved,
      firstPhoto,
      capturedAt,
      blob: taken.blob,
      thumb: taken.thumb,
    });
  }, [visitId]);

  // Video runs whenever the camera does, a clip per room, and is started again by itself after
  // anything that ended the last one. A room's video ends at the limit, or a long stay is
  // minutes to send and watch; photos carry on, and tapping records some more.
  const canRecord = camera.canRecord();
  const { recording, startRecording, stopRecording, streamKey, seconds: roomSeconds } = camera;
  const isCameraReady = camera.status === 'ready';
  const currentRoomId = room?.id;
  useEffect(() => {
    if (!recording || clipRoom.current === currentRoomId) return;
    stopRecording();
  }, [currentRoomId, recording, stopRecording]);
  useEffect(() => {
    if (!recording || roomSeconds < MAX_CLIP_SECONDS) return;
    setPaused(true);
    setVideoDone(true);
    stopRecording();
  }, [recording, roomSeconds, stopRecording]);
  useEffect(() => {
    if (!isCameraReady || !room || paused || recording || !canRecord || !pageVisible) return;
    const forRoom = room;
    const capturedAt = new Date().toISOString();
    const readings = sensors.readings();
    clipRoom.current = forRoom.id;
    startRecording((taken) => {
      saveShot(taken, { kind: 'video', forRoom, heading: null, readings, moved: false, capturedAt });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraReady, currentRoomId, paused, recording, canRecord, pageVisible, streamKey]);

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      if (videoDone) {
        setVideoDone(false);
        camera.resetClock();
      }
    } else {
      setPaused(true);
      stopRecording();
    }
  };

  const shoot = async () => {
    askForMotionAccess();
    if (!room) return;
    const readings = sensors.readings();
    const moved = (readings.steps ?? 0) >= MOVED_STEPS && roomShots.length > 0;
    const heading = sensors.headingNow();
    const forRoom = room;

    setFlash(value => value + 1);
    (navigator as any).vibrate?.(15);
    sensors.resetSteps();
    const taken = await camera.capture();
    if (!taken) {
      message.error("Couldn't take that photo");
      return;
    }
    saveShot(taken, { kind: demo ? 'demo' : 'wall', forRoom, heading, readings, moved });
  };

  const fromSystemCamera = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!room) return;
    const readings = sensors.readings();
    const heading = sensors.headingNow();
    sensors.resetSteps();
    for (const file of files) {
      const video = file.type.startsWith('video/');
      const thumb = video ? undefined : await thumbFromFile(file);
      saveShot(
        { blob: file, thumb, contentType: file.type || 'image/jpeg', name: file.name },
        { kind: video ? 'video' : demo ? 'demo' : 'wall', forRoom: room, heading, readings, moved: false },
      );
    }
  };

  const leave = () => {
    camera.stopRecording();
    navigate(`/field/${visitId}`);
  };

  // ── What's on screen ─────────────────────────────

  const facing = sensors.heading != null && roomId && anchors.current.has(roomId)
    ? sensors.heading - (anchors.current.get(roomId) as number)
    : null;
  const lastShot = shots[shots.length - 1];
  const walked = sensors.steps >= MOVED_STEPS && roomShots.length > 0;
  // Four walls, then close-ups of any demo, then on to the next room
  const allWalls = target == null;
  const demoDue = allWalls && demoCount === 0 && !demo;
  const isReady = camera.status === 'ready';
  const useSystem = camera.status === 'unavailable';
  const shortFloor = room ? FLOORS.find(floor => floor.key === room.floor)?.short ?? room.floor : '';

  return (
    <div className="fv-cam" style={{ '--fv-ratio': camera.ratio } as React.CSSProperties}>
      <header className="fv-cam-top">
        <button type="button" className="fv-icon-btn" aria-label="Stop for now" onClick={leave}>
          <CloseOutlined />
        </button>

        <button
          type="button"
          className="fv-room-chip"
          aria-label={room ? `${floorLabel(room.floor)}, ${room.name}. Change room` : 'Room'}
          onClick={() => setSheet('room')}
        >
          <span className="fv-floor-badge">{shortFloor}</span>
          <span className="fv-room-chip-name">{room?.name ?? ''}</span>
          <DownOutlined aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`fv-upload-state${counts.failed ? ' is-failed' : ''}`}
          aria-label={
            counts.failed
              ? `${counts.failed} not sent`
              : counts.waiting ? `${counts.waiting} waiting to send` : 'All sent'
          }
          aria-live="polite"
          onClick={() => setSheet('shots')}
        >
          {counts.failed > 0 && <><ExclamationCircleFilled /> {counts.failed}</>}
          {counts.failed === 0 && counts.waiting > 0 && (
            <>{online ? <CloudUploadOutlined /> : <DisconnectOutlined />} {counts.waiting}</>
          )}
          {counts.failed === 0 && counts.waiting === 0 && <CheckOutlined />}
        </button>
      </header>

      <div className="fv-finder-wrap">
        <div className="fv-finder">
          {/* Muted and inline, or iPhones won't play it in the page */}
          <video
            ref={videoRef}
            className="fv-video"
            autoPlay
            muted
            playsInline
            onLoadedMetadata={camera.onMetadata}
            onResize={camera.onMetadata}
          />
          {isReady && <FrameGuide demo={demo} />}
          {isReady && !demo && <LevelBar pitch={sensors.pitch} />}
          {flash > 0 && <div key={flash} className="fv-flash" aria-hidden="true" />}

          {camera.status === 'starting' && <div className="fv-finder-note"><CameraOutlined /></div>}

          {useSystem && (
            <div className="fv-system-camera">
              <label className="fv-big-btn">
                <CameraOutlined /> Photo
                <input type="file" accept="image/*" capture="environment" onChange={fromSystemCamera} />
              </label>
              <label className="fv-big-btn">
                <VideoCameraOutlined /> Video
                <input type="file" accept="video/*" capture="environment" onChange={fromSystemCamera} />
              </label>
            </div>
          )}

          <div className="fv-offers" aria-live="polite">
            {roomSuggestion && (
              <div className="fv-offer">
                <button
                  type="button"
                  className="fv-offer-yes"
                  onClick={() => acceptSuggestion(roomSuggestion.shot, roomSuggestion.roomType)}
                >
                  {roomTitle(roomSuggestion.roomType)}?
                </button>
                <button
                  type="button"
                  className="fv-offer-no"
                  aria-label="Not a new room"
                  onClick={() => setDismissed(list => [...list, roomSuggestion.shot.id])}
                >
                  <CloseOutlined />
                </button>
              </div>
            )}
            {floorOffer && room && (
              <div className="fv-offer">
                <button type="button" className="fv-offer-yes" onClick={() => setFloor(floorOffer)}>
                  {floorLabel(floorOffer)}?
                </button>
                <button
                  type="button"
                  className="fv-offer-no"
                  aria-label="Not this floor"
                  onClick={() => setDismissed(list => [...list, `floor:${room.id}:${floorOffer}`])}
                >
                  <CloseOutlined />
                </button>
              </div>
            )}
          </div>

          {!demo && (
            <div className="fv-map-wrap">
              <RoomMap done={done} target={target} facing={facing} />
            </div>
          )}

          <div className="fv-lens">
            {camera.canWiden && (
              <button
                type="button"
                className={`fv-lens-btn${camera.wide ? ' is-on' : ''}`}
                aria-pressed={camera.wide}
                aria-label="Wide lens"
                onClick={() => camera.setWide(!camera.wide)}
              >
                .5
              </button>
            )}
            {camera.canTorch && (
              <button
                type="button"
                className={`fv-lens-btn${camera.torch ? ' is-on' : ''}`}
                aria-pressed={camera.torch}
                aria-label="Light"
                onClick={() => camera.setTorch(!camera.torch)}
              >
                {camera.torch ? <ThunderboltFilled /> : <ThunderboltOutlined />}
              </button>
            )}
          </div>
        </div>
      </div>

      <footer className="fv-cam-bottom">
        <div className="fv-cam-row">
          {useSystem || !canRecord ? <span /> : (
            <div className="fv-rec-controls">
              <button
                type="button"
                className={`fv-rec${camera.recording ? ' is-on' : ''}${paused && !videoDone ? ' is-paused' : ''}`}
                aria-pressed={paused}
                aria-label={
                  videoDone ? 'This room has its video. Record more'
                    : paused ? 'Video paused. Resume'
                      : `Recording video, ${clock(camera.seconds)}. Pause`
                }
                onClick={togglePause}
              >
                {videoDone ? <CheckOutlined /> : paused ? <PauseOutlined /> : <span className="fv-rec-dot" />}
                {videoDone ? 'Video' : paused ? 'Paused' : clock(camera.seconds)}
              </button>
              <button
                type="button"
                className={`fv-mic${camera.mic ? ' is-on' : ''}`}
                aria-pressed={camera.mic}
                aria-label="Record sound"
                onClick={() => camera.setMic(!camera.mic)}
              >
                {camera.mic ? <AudioOutlined /> : <AudioMutedOutlined />}
              </button>
            </div>
          )}

          <button
            type="button"
            className={`fv-next-room${walked || (allWalls && demoCount > 0) ? ' is-due' : ''}`}
            onClick={nextRoom}
          >
            Next room <RightOutlined aria-hidden="true" />
          </button>
        </div>

        <div className="fv-cam-row fv-cam-row--shutter">
          <button
            type="button"
            className="fv-thumb"
            aria-label={`Photos: ${shots.length}`}
            onClick={() => setSheet('shots')}
          >
            {lastShot
              ? <ShotThumb key={lastShot.id} shot={lastShot} emptyClass="fv-thumb-empty" />
              : <span className="fv-thumb-empty" />}
            {shots.length > 0 && <span className="fv-thumb-count">{shots.length}</span>}
          </button>

          {!useSystem && (
            <button
              type="button"
              className="fv-shutter"
              aria-label="Take photo"
              disabled={!isReady || !room}
              onClick={shoot}
            >
              <span />
            </button>
          )}

          <button
            type="button"
            className={`fv-demo${demo ? ' is-on' : ''}${demoDue ? ' is-due' : ''}`}
            aria-pressed={demo}
            aria-label={`Demo close-ups: ${demoCount}`}
            onClick={() => setDemo(!demo)}
          >
            <ToolOutlined />
            <span>Demo{demoCount > 0 ? ` ${demoCount}` : ''}</span>
          </button>
        </div>
      </footer>

      {sheet === 'room' && room && (
        <RoomSheet
          room={room}
          rooms={rooms}
          shots={shots}
          floorGuess={floorGuess}
          onFloor={setFloor}
          onName={(name, roomType) => {
            updateRoom(visitId, room.id, { name, nameSource: 'user', roomType });
            setSheet(null);
          }}
          onSwitch={(next) => {
            enterRoom(next);
            setSheet(null);
          }}
          onNew={() => {
            if (roomShots.length > 0) startRoom();
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'shots' && (
        <ShotsSheet
          rooms={rooms}
          shots={shots}
          currentRoomId={roomId}
          onOpen={shot => setViewing(shot.id)}
          onClose={() => setSheet(null)}
        />
      )}
      {viewed && (
        <ShotViewer
          key={viewed.id}
          visitId={visitId}
          shot={viewed}
          rooms={rooms}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
};

export default FieldCamera;
