/**
 * QuickEstimateRooms - Quick Estimate mode: rooms from presets
 * Pick a preset to add a room, then set its floor, density and contamination.
 */
import React from 'react';
import { Button, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import * as packingService from '../../services/packingEstimateService';
import type { PackingRoom } from '../../types/packing-estimate';
import { CONTAMINATION_OPTIONS, DENSITY_OPTIONS, FLOOR_OPTIONS } from './constants';
import { contaminationSelectLabel, multiplierSelectLabel } from './packingUi';
import './packing.css';

interface QuickEstimateRoomsProps {
  rooms: PackingRoom[];
  setRooms: (rooms: PackingRoom[]) => void;
}

const QuickEstimateRooms: React.FC<QuickEstimateRoomsProps> = ({ rooms, setRooms }) => {
  const [presets, setPresets] = React.useState<Record<string, any[]>>({});

  React.useEffect(() => {
    packingService.getPresets().then(setPresets).catch(() => {});
  }, []);

  const addRoom = (presetKey: string, preset: any) => {
    const newRoom: PackingRoom = {
      id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      preset: presetKey,
      floor: '1st',
      density: 'normal',
      hints: preset.default_hints || [],
      hint_volume: {},
      hint_qty: {},
      contamination: 'clean',
      items: [],
      photos: [],
      special_items: [],
      custom_special_items: [],
    };
    setRooms([...rooms, newRoom]);
  };

  const removeRoom = (id: string) => {
    setRooms(rooms.filter(r => r.id !== id));
  };

  const updateRoom = (id: string, patch: Partial<PackingRoom>) => {
    setRooms(rooms.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const presetName = (key: string) =>
    Object.values(presets).flat().find((p: any) => p.key === key)?.name || key;

  // Two rooms from the same preset read as "Bedroom" and "Bedroom 2"
  const seen: Record<string, number> = {};
  const roomNames = rooms.map(r => {
    seen[r.preset] = (seen[r.preset] || 0) + 1;
    const base = presetName(r.preset);
    return seen[r.preset] > 1 ? `${base} ${seen[r.preset]}` : base;
  });

  return (
    <section className="ui-section pk-rooms" aria-label="Rooms">
      <div className="ui-section-head">
        <h2 className="ui-section-title">
          Select Rooms <span className="pk-count">{rooms.length}</span>
        </h2>
      </div>

      {/* Preset picker: one row per category */}
      <div className="pk-presets" role="group" aria-label="Add a room from a preset">
        {Object.entries(presets).map(([category, items]) => (
          <div className="pk-preset-row" key={category}>
            <span className="pk-preset-cat">{category}</span>
            <div className="pk-preset-chips">
              {items.map((p: any) => (
                <button type="button" key={p.key} className="pk-preset-chip" onClick={() => addRoom(p.key, p)}>
                  <PlusOutlined aria-hidden="true" />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {rooms.length === 0 && (
        <p className="pk-empty-line pk-rooms-empty">No rooms added. Click a room preset above to add rooms.</p>
      )}

      {/* Rooms as ledger rows: the labels once as a column header; a narrow
          column stacks each row and moves the labels into the selects */}
      {rooms.length > 0 && (
        <div className="pk-ledger">
          <div className="pk-ledger-head" aria-hidden="true">
            <span>Room</span>
            <span>Floor</span>
            <span>Density</span>
            <span>Contamination</span>
            <span />
          </div>
          {rooms.map((room, i) => (
            <div className="pk-ledger-row" key={room.id} role="group" aria-label={roomNames[i]}>
              <span className="pk-ledger-name">{roomNames[i]}</span>
              <Select
                size="small"
                prefix={<span className="pk-ledger-prefix">Floor</span>}
                aria-label={`${roomNames[i]} floor`}
                value={room.floor}
                onChange={v => updateRoom(room.id, { floor: v })}
                options={FLOOR_OPTIONS}
                popupMatchSelectWidth={false}
              />
              <Select
                size="small"
                prefix={<span className="pk-ledger-prefix">Density</span>}
                aria-label={`${roomNames[i]} density`}
                value={room.density}
                onChange={v => updateRoom(room.id, { density: v })}
                options={DENSITY_OPTIONS}
                labelRender={multiplierSelectLabel}
                popupMatchSelectWidth={false}
              />
              <Select
                size="small"
                prefix={<span className="pk-ledger-prefix">Contamination</span>}
                aria-label={`${roomNames[i]} contamination`}
                value={room.contamination}
                onChange={v => updateRoom(room.id, { contamination: v })}
                options={CONTAMINATION_OPTIONS}
                labelRender={contaminationSelectLabel}
                popupMatchSelectWidth={false}
              />
              <Button
                size="small"
                type="text"
                className="ui-icon-btn ui-icon-btn--danger pk-ledger-remove"
                icon={<DeleteOutlined />}
                onClick={() => removeRoom(room.id)}
                aria-label={`Remove ${roomNames[i]}`}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default QuickEstimateRooms;
