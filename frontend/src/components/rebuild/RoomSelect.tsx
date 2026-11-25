/**
 * Pick a room from the list (the scope's rooms and any added here), or type
 * one that isn't there yet ("Add “Laundry”"). '' is no room.
 */

import React, { useState } from 'react';
import { Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { matchRoom, sameRoom } from './photoRooms';

interface Props {
  value: string;
  rooms: string[];
  onChange: (room: string) => void;
  size?: 'small' | 'middle' | 'large';
  noRoomLabel?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
}

const ADD_PREFIX = '\u0000add:';

const RoomSelect: React.FC<Props> = ({
  value, rooms, onChange, size, noRoomLabel = 'No room', ariaLabel, ariaLabelledBy, className,
}) => {
  const [search, setSearch] = useState('');
  const typed = search.replace(/\s+/g, ' ').trim();
  const isNew = !!typed && !rooms.some(r => sameRoom(r, typed));

  const options = [
    { value: '', label: <span className="rb-room-none">{noRoomLabel}</span>, search: '' },
    ...rooms.map(r => ({ value: r, label: r, search: r })),
    ...(isNew ? [{
      value: `${ADD_PREFIX}${typed}`,
      label: <span className="rb-room-add"><PlusOutlined aria-hidden="true" /> Add “{typed}”</span>,
      search: typed,
    }] : []),
  ];

  return (
    <Select
      value={value}
      size={size}
      showSearch
      searchValue={search}
      onSearch={setSearch}
      filterOption={(input, option) => {
        if (!input) return true;
        const v = String(option?.value ?? '');
        if (v.startsWith(ADD_PREFIX)) return true;
        return String(option?.search ?? '').toLowerCase().includes(input.trim().toLowerCase());
      }}
      options={options}
      onChange={(v: string) => {
        setSearch('');
        onChange(v.startsWith(ADD_PREFIX) ? matchRoom(rooms, v.slice(ADD_PREFIX.length)) : v);
      }}
      onBlur={() => setSearch('')}
      popupMatchSelectWidth={false}
      placeholder="Room"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={className}
    />
  );
};

export default RoomSelect;
