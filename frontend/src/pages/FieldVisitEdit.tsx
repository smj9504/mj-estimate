/**
 * Putting a visit right after the fact: a room made by mistake, photos in the wrong
 * room, a shot taken by accident. A room is only its photos, and one with none left
 * shows nowhere, so deleting a room deletes its photos and merging two moves them.
 * Every change goes through this phone's store like the camera's do: it works with
 * no signal and goes to the server when it can.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, ConfigProvider, Input, Modal, Segmented, Skeleton } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RightOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, useSheetModal } from '../components/common/ui';
import { ShotTile, ShotViewer, uniqueRoomName } from '../components/field-visit/CameraSheets';
import { addRoom, deleteShot, getVisitSnapshot, updateRoom, updateShot } from '../components/field-visit/fieldStore';
import type { LocalRoom, LocalShot } from '../components/field-visit/fieldStore';
import { useFieldVisit } from '../components/field-visit/useFieldVisit';
import '../components/field-visit/field.css';
import '../components/onsite-signing/onsite.css';
import { comfortTheme } from '../styles/antTheme';
import { FLOORS, floorLabel } from '../types/fieldVisit';
import type { FloorKey } from '../types/fieldVisit';

const POLL_MS = 15000;

/** "3 photos and 1 video" */
const describeShots = (shots: LocalShot[]) => {
  const videos = shots.filter(shot => shot.isVideo).length;
  const photos = shots.length - videos;
  return [
    photos > 0 ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : '',
    videos > 0 ? `${videos} ${videos === 1 ? 'video' : 'videos'}` : '',
  ].filter(Boolean).join(' and ') || 'nothing';
};

const RoomRows: React.FC<{ rooms: LocalRoom[]; onPick: (room: LocalRoom) => void }> = ({ rooms, onPick }) => (
  <ul className="os-rows fv-rows fv-edit-rooms">
    {rooms.map(room => (
      <li key={room.id}>
        <button type="button" className="os-row" onClick={() => onPick(room)}>
          <span className="os-row-body">
            <span className="os-row-title">{room.name}</span>
            <span className="os-row-meta">{floorLabel(room.floor)}</span>
          </span>
          <RightOutlined className="os-row-go" aria-hidden="true" />
        </button>
      </li>
    ))}
  </ul>
);

// ── One room: its name, its floor, merging it, deleting it ──

const RoomEditSheet: React.FC<{
  visitId: string;
  room: LocalRoom;
  rooms: LocalRoom[];
  shots: LocalShot[];
  onClose: () => void;
}> = ({ visitId, room, rooms, shots, onClose }) => {
  const { sheetProps } = useSheetModal('tall');
  const [name, setName] = useState(room.name);
  const [floor, setFloor] = useState<FloorKey>(room.floor);
  const inRoom = shots.filter(shot => shot.roomId === room.id);
  const others = rooms.filter(other => other.id !== room.id);

  const save = () => {
    const typed = name.trim();
    const renamed = typed && typed !== room.name;
    const refloored = floor !== room.floor;
    if (renamed || refloored) {
      updateRoom(visitId, room.id, {
        ...(renamed ? { name: uniqueRoomName(rooms, typed, room.id), nameSource: 'user' as const } : {}),
        ...(refloored ? { floor, floorSource: 'user' as const } : {}),
      });
    }
    onClose();
  };

  const mergeInto = (target: LocalRoom) => {
    Modal.confirm({
      title: `Move everything in ${room.name} to ${target.name}?`,
      content: `${describeShots(inRoom)} go to ${target.name} (${floorLabel(target.floor)}), and ${room.name} is gone.`,
      okText: 'Move',
      onOk: () => {
        inRoom.forEach(shot => updateShot(visitId, shot.id, { roomId: target.id, wall: null }));
        onClose();
      },
    });
  };

  const removeRoom = () => {
    Modal.confirm({
      title: `Delete ${room.name}?`,
      content: `Its ${describeShots(inRoom)} are deleted too.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        inRoom.forEach(shot => deleteShot(visitId, shot.id));
        onClose();
      },
    });
  };

  return (
    <Modal
      {...sheetProps}
      open
      title="Room"
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" disabled={!name.trim()} onClick={save}>Save</Button>,
      ]}
    >
      <div className="fv-edit-form">
        <label className="fv-edit-field">
          <span>Name</span>
          <Input value={name} maxLength={60} onChange={event => setName(event.target.value)} onPressEnter={save} />
        </label>
        <div className="fv-edit-field">
          <span id="fv-edit-floor">Floor</span>
          <Segmented
            block
            className="fv-edit-floors"
            aria-labelledby="fv-edit-floor"
            value={floor}
            options={FLOORS.map(option => ({ label: option.short, value: option.key }))}
            onChange={value => setFloor(value as FloorKey)}
          />
        </div>

        {others.length > 0 && (
          <div className="fv-edit-field">
            <span>Same room as one of these? Move everything there</span>
            <RoomRows rooms={others} onPick={mergeInto} />
          </div>
        )}

        <Button danger block icon={<DeleteOutlined />} onClick={removeRoom}>
          Delete room and its {describeShots(inRoom)}
        </Button>
      </div>
    </Modal>
  );
};

// ── Where picked shots go ───────────────────────────

const MoveSheet: React.FC<{
  count: string;
  rooms: LocalRoom[];
  onPick: (room: LocalRoom) => void;
  onNewRoom: () => void;
  onClose: () => void;
}> = ({ count, rooms, onPick, onNewRoom, onClose }) => {
  const { sheetProps } = useSheetModal('tall');
  return (
    <Modal {...sheetProps} open title={`Move ${count} to`} onCancel={onClose} footer={null}>
      <Button block icon={<PlusOutlined />} onClick={onNewRoom}>New room</Button>
      <RoomRows rooms={rooms} onPick={onPick} />
    </Modal>
  );
};

// ── The page ────────────────────────────────────────

const FieldVisitEdit: React.FC = () => {
  const { visitId = '' } = useParams();
  const navigate = useNavigate();
  const visit = useFieldVisit(visitId, POLL_MS);
  const { header, rooms, shots } = visit;

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // A room with nothing in it shows nowhere else either
  const shown = useMemo(() => rooms.filter(room => shots.some(shot => shot.roomId === room.id)), [rooms, shots]);
  const floors = useMemo(() => FLOORS
    .map(floor => ({ ...floor, rooms: shown.filter(room => room.floor === floor.key) }))
    .filter(floor => floor.rooms.length > 0), [shown]);

  const chosen = useMemo(() => shots.filter(shot => selected.has(shot.id)), [shots, selected]);
  const chosenPhotos = chosen.filter(shot => !shot.isVideo);
  const allDemo = chosenPhotos.length > 0 && chosenPhotos.every(shot => shot.kind === 'demo');
  const viewed = viewing ? shots.find(shot => shot.id === viewing) ?? null : null;
  const editedRoom = editing ? shown.find(room => room.id === editing) ?? null : null;

  // Gone from under the selection (deleted here or elsewhere): drop them from it
  useEffect(() => {
    if (chosen.length !== selected.size) setSelected(new Set(chosen.map(shot => shot.id)));
  }, [chosen, selected.size]);

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const tap = (shot: LocalShot) => {
    if (!selecting) {
      setViewing(shot.id);
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(shot.id)) next.delete(shot.id);
      else next.add(shot.id);
      return next;
    });
  };

  const moveChosen = (room: LocalRoom) => {
    chosen.forEach(shot => updateShot(visitId, shot.id, { roomId: room.id, wall: null }));
    setMoving(false);
    stopSelecting();
  };

  const moveChosenToNewRoom = () => {
    const snapshot = getVisitSnapshot(visitId);
    const from = snapshot.rooms.find(room => room.id === chosen[0]?.roomId);
    const created = addRoom(visitId, {
      name: uniqueRoomName(snapshot.rooms, `Room ${snapshot.rooms.length + 1}`),
      floor: from?.floor ?? '1',
      floorSource: 'user',
    });
    moveChosen(created);
  };

  const demoChosen = () => {
    chosenPhotos.forEach(shot => updateShot(visitId, shot.id, { kind: allDemo ? 'wall' : 'demo', wall: null }));
    stopSelecting();
  };

  const deleteChosen = () => {
    Modal.confirm({
      title: `Delete ${describeShots(chosen)}?`,
      content: `${chosen.length === 1 ? "It's" : "They're"} taken off the visit and the client's photos.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        chosen.forEach(shot => deleteShot(visitId, shot.id));
        stopSelecting();
      },
    });
  };

  const back = (
    <Button type="text" icon={<ArrowLeftOutlined />} aria-label="Back to the visit" onClick={() => navigate(`/field/${visitId}`)} />
  );
  const client = header?.client;
  // All in one room, so that one isn't somewhere to move them
  const fromOneRoom = chosen.length > 0 && chosen.every(shot => shot.roomId === chosen[0].roomId);
  const moveTargets = fromOneRoom ? shown.filter(room => room.id !== chosen[0].roomId) : shown;

  return (
    <ConfigProvider theme={comfortTheme} componentSize="large">
      <div className="os-page fv-page fv-edit">
        <PageHeader
          leading={back}
          title="Edit photos"
          meta={client ? client.address || client.display_name : undefined}
          actions={shots.length > 0 && (
            selecting
              ? <Button onClick={stopSelecting}>Done</Button>
              : <Button onClick={() => setSelecting(true)}>Select</Button>
          )}
        />

        {!visit.loaded && <Skeleton active paragraph={{ rows: 4 }} />}
        {visit.loaded && floors.length === 0 && <p className="fv-edit-empty">No photos yet</p>}
        {selecting && <p className="fv-edit-hint">Tap photos to pick them</p>}

        {floors.map(floor => (
          <section key={floor.key} className="ui-section fv-floor">
            <div className="ui-section-head">
              <h2 className="ui-section-title">{floor.label}</h2>
            </div>
            {floor.rooms.map((room) => {
              const inRoom = shots.filter(shot => shot.roomId === room.id);
              return (
                <div key={room.id} className="fv-edit-room">
                  <div className="fv-edit-room-head">
                    <span className="fv-edit-room-name">{room.name}</span>
                    <span className="fv-edit-room-count">{describeShots(inRoom)}</span>
                    <Button
                      type="text"
                      size="middle"
                      icon={<EditOutlined />}
                      aria-label={`Edit ${room.name}`}
                      onClick={() => setEditing(room.id)}
                    />
                  </div>
                  <div className="fv-tiles">
                    {inRoom.map(shot => (
                      <ShotTile
                        key={shot.id}
                        shot={shot}
                        selected={selecting ? selected.has(shot.id) : undefined}
                        onOpen={() => tap(shot)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        {selecting && (
          <div className="fv-edit-bar" role="toolbar" aria-label="Picked photos">
            <span className="fv-edit-bar-count" aria-live="polite">
              {chosen.length === 0 ? 'None picked' : `${chosen.length} picked`}
            </span>
            <Button disabled={chosen.length === 0} onClick={() => setMoving(true)}>Move</Button>
            <Button disabled={chosenPhotos.length === 0} icon={<ToolOutlined />} onClick={demoChosen}>
              {allDemo ? 'Not demo' : 'Demo'}
            </Button>
            <Button danger disabled={chosen.length === 0} icon={<DeleteOutlined />} aria-label="Delete" onClick={deleteChosen} />
          </div>
        )}

        {editedRoom && (
          <RoomEditSheet
            key={editedRoom.id}
            visitId={visitId}
            room={editedRoom}
            rooms={shown}
            shots={shots}
            onClose={() => setEditing(null)}
          />
        )}
        {moving && (
          <MoveSheet
            count={describeShots(chosen)}
            rooms={moveTargets}
            onPick={moveChosen}
            onNewRoom={moveChosenToNewRoom}
            onClose={() => setMoving(false)}
          />
        )}
        {viewed && (
          // The camera's viewer, on its dark stage
          <div className="fv-cam">
            <ShotViewer key={viewed.id} visitId={visitId} shot={viewed} rooms={shown} onClose={() => setViewing(null)} />
          </div>
        )}
      </div>
    </ConfigProvider>
  );
};

export default FieldVisitEdit;
