/**
 * The panel a right-click on a plan cabinet opens: the Edit tab's columns
 * for that one cabinet — which cabinet it is, its specialty, width and
 * height, glass and door pattern. Each pick changes the Edit tab's box at
 * once (a row of several splits this one off), so the panel only shows the
 * box and reports the change.
 */

import React from 'react';
import { Button, Checkbox, InputNumber, Select, Space, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { DoorPattern, SpecialtyType } from '../../../types/cabinetEstimate';
import {
  DOOR_PATTERN_OPTIONS,
  PLAIN_DOOR,
  TALL_DOOR_PATTERN_OPTIONS,
  boxChoices,
  hasDoors,
  specialtyName,
  takesGlass,
  type BoxChange,
  type BoxFields,
  type Catalog,
} from '../cabinetBoxChoices';

const { Text } = Typography;

export const EDIT_PANEL_WIDTH = 300;

export interface CabinetEditPanelProps {
  /** The box as it stands. */
  box: BoxFields;
  label: string;
  catalog: Catalog;
  /** The section's cabinet list, grouped as in the toolbar picker. */
  cabinetOptions: { label: string; options: { label: string; value: string }[] }[];
  /** How many cabinets the Edit tab's row for it holds; more than one splits this one off. */
  rowQty: number;
  onChange: (change: BoxChange) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const name: React.CSSProperties = { width: 64, flex: 'none', fontSize: 12, color: '#595959' };

const CabinetEditPanel: React.FC<CabinetEditPanelProps> = ({
  box,
  label,
  catalog,
  cabinetOptions,
  rowQty,
  onChange,
  onClose,
  style,
}) => {
  const choices = boxChoices(box.code, catalog);
  const custom = !choices;
  const doors = hasDoors(box.specialty_type);
  const glass = takesGlass(box.cab_type, box.specialty_type);
  const patternOptions = box.cab_type === 'tall' ? TALL_DOOR_PATTERN_OPTIONS : DOOR_PATTERN_OPTIONS;
  const fullWidth = { flex: 1, minWidth: 0 };

  return (
    <div
      role="dialog"
      aria-label={`Edit ${label}`}
      // Keep canvas shortcuts (Delete, R) and drags off while working in the panel; Escape closes it.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        zIndex: 10,
        width: EDIT_PANEL_WIDTH,
        background: '#fff',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
        padding: '10px 12px 4px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <Text strong style={{ flex: 1 }} ellipsis>
          {label}
        </Text>
        <Button size="small" type="text" icon={<CloseOutlined />} aria-label="Close" onClick={onClose} />
      </div>

      <div style={row}>
        <span style={name}>Cabinet</span>
        <Select
          size="small"
          style={fullWidth}
          popupMatchSelectWidth={300}
          showSearch
          value={catalog[box.code] ? box.code : undefined}
          placeholder={`Custom ${box.width_inches}"`}
          options={cabinetOptions}
          labelRender={(p) => catalog[String(p.value)]?.label ?? p.label}
          filterOption={(input, option: any) =>
            `${option?.label ?? ''} ${option?.value ?? ''}`.toLowerCase().includes(input.toLowerCase())
          }
          onChange={(code: string) => onChange({ code })}
        />
      </div>

      <div style={row}>
        <span style={name}>Specialty</span>
        {choices && choices.specialties.length > 1 ? (
          <Select<string>
            size="small"
            style={fullWidth}
            popupMatchSelectWidth={240}
            value={box.code}
            options={choices.specialties.map((s) => ({ label: s.label, value: s.code }))}
            onChange={(code) => onChange({ code })}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {box.specialty_type ? specialtyName(box.specialty_type as SpecialtyType) : 'None'}
            {custom ? ' (custom size)' : ' — none other at this size'}
          </Text>
        )}
      </div>

      <div style={row}>
        <span style={name}>Width</span>
        {custom ? (
          <InputNumber
            size="small"
            style={fullWidth}
            min={6}
            max={120}
            step={1.5}
            addonAfter='"'
            value={box.width_inches}
            onChange={(v) => v && onChange({ width: v })}
          />
        ) : (
          <Select<string>
            size="small"
            style={fullWidth}
            value={box.code}
            options={choices!.widths.map((c) => ({ label: c.label, value: c.code }))}
            onChange={(code) => onChange({ code })}
          />
        )}
        <span style={{ ...name, width: 'auto' }}>Height</span>
        {custom ? (
          <InputNumber
            size="small"
            style={fullWidth}
            min={6}
            max={120}
            step={1.5}
            addonAfter='"'
            value={box.height_inches}
            onChange={(v) => v && onChange({ height: v })}
          />
        ) : (
          <Select<string>
            size="small"
            style={fullWidth}
            value={box.code}
            options={choices!.heights.map((c) => ({ label: c.label, value: c.code }))}
            onChange={(code) => onChange({ code })}
          />
        )}
      </div>

      {doors && (
        <div style={row}>
          <span style={name}>Door</span>
          <Select<DoorPattern | typeof PLAIN_DOOR>
            size="small"
            style={fullWidth}
            popupMatchSelectWidth={200}
            value={box.door_pattern ?? PLAIN_DOOR}
            options={patternOptions}
            onChange={(v) => onChange({ door_pattern: v === PLAIN_DOOR ? null : v })}
          />
          {glass && (
            <Checkbox checked={box.has_glass_door} onChange={(e) => onChange({ has_glass_door: e.target.checked })}>
              Glass
            </Checkbox>
          )}
        </div>
      )}

      <Space style={{ marginBottom: 6 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {rowQty > 1
            ? `Changes this one of the Edit tab's ${rowQty} ${box.code} — it gets its own row.`
            : "Changes the Edit tab's row for it."}
        </Text>
      </Space>
    </div>
  );
};

export default CabinetEditPanel;
