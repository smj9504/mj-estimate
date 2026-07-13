import React from 'react';
import {
  Button,
  Checkbox,
  Col,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { CabinetBoxCreate, CabinetLocation, CabType, SpecialtyType } from '../../types/cabinetEstimate';

const { Text } = Typography;

// Common cabinet codes with default dimensions
const CABINET_PRESETS: Record<string, { cab_type: CabType; width: number; height: number; specialty?: SpecialtyType; label: string }> = {
  // Base
  'B9':  { cab_type: 'base', width: 9,  height: 34.5, label: 'Base 9"' },
  'B12': { cab_type: 'base', width: 12, height: 34.5, label: 'Base 12"' },
  'B15': { cab_type: 'base', width: 15, height: 34.5, label: 'Base 15"' },
  'B18': { cab_type: 'base', width: 18, height: 34.5, label: 'Base 18"' },
  'B21': { cab_type: 'base', width: 21, height: 34.5, label: 'Base 21"' },
  'B24': { cab_type: 'base', width: 24, height: 34.5, label: 'Base 24"' },
  'B27': { cab_type: 'base', width: 27, height: 34.5, label: 'Base 27"' },
  'B30': { cab_type: 'base', width: 30, height: 34.5, label: 'Base 30"' },
  'B33': { cab_type: 'base', width: 33, height: 34.5, label: 'Base 33"' },
  'B36': { cab_type: 'base', width: 36, height: 34.5, label: 'Base 36"' },
  // Base - Sink Base
  'SB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'sink_base', label: 'Sink Base 30"' },
  'SB33': { cab_type: 'base', width: 33, height: 34.5, specialty: 'sink_base', label: 'Sink Base 33"' },
  'SB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'sink_base', label: 'Sink Base 36"' },
  'SB42': { cab_type: 'base', width: 42, height: 34.5, specialty: 'sink_base', label: 'Sink Base 42"' },
  // Base - Blind Corner
  'BBC36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner 36"' },
  'BBC39': { cab_type: 'base', width: 39, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner 39"' },
  'BBC42': { cab_type: 'base', width: 42, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner 42"' },
  'BBC45': { cab_type: 'base', width: 45, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner 45"' },
  // Base - Drawer Base
  'DB12': { cab_type: 'base', width: 12, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 12"' },
  'DB15': { cab_type: 'base', width: 15, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 15"' },
  'DB18': { cab_type: 'base', width: 18, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 18"' },
  'DB21': { cab_type: 'base', width: 21, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 21"' },
  'DB24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 24"' },
  'DB27': { cab_type: 'base', width: 27, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 27"' },
  'DB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 30"' },
  'DB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 36"' },
  // Base - Lazy Susan
  'LS33': { cab_type: 'base', width: 33, height: 34.5, specialty: 'lazy_susan', label: 'Lazy Susan 33"' },
  'LS36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'lazy_susan', label: 'Lazy Susan 36"' },
  // Wall - Standard (30"H)
  'W0930': { cab_type: 'wall', width: 9,  height: 30, label: '9"W x 30"H' },
  'W1230': { cab_type: 'wall', width: 12, height: 30, label: '12"W x 30"H' },
  'W1530': { cab_type: 'wall', width: 15, height: 30, label: '15"W x 30"H' },
  'W1630': { cab_type: 'wall', width: 16, height: 30, label: '16"W x 30"H' },
  'W1830': { cab_type: 'wall', width: 18, height: 30, label: '18"W x 30"H' },
  'W2130': { cab_type: 'wall', width: 21, height: 30, label: '21"W x 30"H' },
  'W2430': { cab_type: 'wall', width: 24, height: 30, label: '24"W x 30"H' },
  'W2730': { cab_type: 'wall', width: 27, height: 30, label: '27"W x 30"H' },
  'W3030': { cab_type: 'wall', width: 30, height: 30, label: '30"W x 30"H' },
  'W3330': { cab_type: 'wall', width: 33, height: 30, label: '33"W x 30"H' },
  'W3630': { cab_type: 'wall', width: 36, height: 30, label: '36"W x 30"H' },
  // Wall - Tall (36"H)
  'W0936': { cab_type: 'wall', width: 9,  height: 36, label: '9"W x 36"H' },
  'W1236': { cab_type: 'wall', width: 12, height: 36, label: '12"W x 36"H' },
  'W1536': { cab_type: 'wall', width: 15, height: 36, label: '15"W x 36"H' },
  'W1836': { cab_type: 'wall', width: 18, height: 36, label: '18"W x 36"H' },
  'W2136': { cab_type: 'wall', width: 21, height: 36, label: '21"W x 36"H' },
  'W2436': { cab_type: 'wall', width: 24, height: 36, label: '24"W x 36"H' },
  'W2736': { cab_type: 'wall', width: 27, height: 36, label: '27"W x 36"H' },
  'W3036': { cab_type: 'wall', width: 30, height: 36, label: '30"W x 36"H' },
  'W3336': { cab_type: 'wall', width: 33, height: 36, label: '33"W x 36"H' },
  'W3636': { cab_type: 'wall', width: 36, height: 36, label: '36"W x 36"H' },
  // Wall - Tall (42"H)
  'W0942': { cab_type: 'wall', width: 9,  height: 42, label: '9"W x 42"H' },
  'W1242': { cab_type: 'wall', width: 12, height: 42, label: '12"W x 42"H' },
  'W1542': { cab_type: 'wall', width: 15, height: 42, label: '15"W x 42"H' },
  'W1842': { cab_type: 'wall', width: 18, height: 42, label: '18"W x 42"H' },
  'W2142': { cab_type: 'wall', width: 21, height: 42, label: '21"W x 42"H' },
  'W2442': { cab_type: 'wall', width: 24, height: 42, label: '24"W x 42"H' },
  'W2742': { cab_type: 'wall', width: 27, height: 42, label: '27"W x 42"H' },
  'W3042': { cab_type: 'wall', width: 30, height: 42, label: '30"W x 42"H' },
  'W3342': { cab_type: 'wall', width: 33, height: 42, label: '33"W x 42"H' },
  'W3642': { cab_type: 'wall', width: 36, height: 42, label: '36"W x 42"H' },
  // Wall - Short (above microwave / fridge: 12"~27"H)
  'W2412': { cab_type: 'wall', width: 24, height: 12, label: '24"W x 12"H' },
  'W3012': { cab_type: 'wall', width: 30, height: 12, label: '30"W x 12"H' },
  'W3312': { cab_type: 'wall', width: 33, height: 12, label: '33"W x 12"H' },
  'W3612': { cab_type: 'wall', width: 36, height: 12, label: '36"W x 12"H' },
  'W2415': { cab_type: 'wall', width: 24, height: 15, label: '24"W x 15"H' },
  'W3015': { cab_type: 'wall', width: 30, height: 15, label: '30"W x 15"H' },
  'W3315': { cab_type: 'wall', width: 33, height: 15, label: '33"W x 15"H' },
  'W3615': { cab_type: 'wall', width: 36, height: 15, label: '36"W x 15"H' },
  'W2418': { cab_type: 'wall', width: 24, height: 18, label: '24"W x 18"H' },
  'W3018': { cab_type: 'wall', width: 30, height: 18, label: '30"W x 18"H' },
  'W3618': { cab_type: 'wall', width: 36, height: 18, label: '36"W x 18"H' },
  'W2424': { cab_type: 'wall', width: 24, height: 24, label: '24"W x 24"H' },
  'W3024': { cab_type: 'wall', width: 30, height: 24, label: '30"W x 24"H' },
  'W3324': { cab_type: 'wall', width: 33, height: 24, label: '33"W x 24"H' },
  'W3624': { cab_type: 'wall', width: 36, height: 24, label: '36"W x 24"H' },
  'W3627': { cab_type: 'wall', width: 36, height: 27, label: '36"W x 27"H' },
  // Wall - Specialty
  'WDC24': { cab_type: 'wall', width: 24, height: 30, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 24"' },
  'WDC27': { cab_type: 'wall', width: 27, height: 30, specialty: 'diagonal_corner_wall', label: 'Diagonal Corner 27"' },
  // Tall - Pantry
  'T1884': { cab_type: 'tall', width: 18, height: 84, label: 'Tall 18"x84"' },
  'T2484': { cab_type: 'tall', width: 24, height: 84, label: 'Tall 24"x84"' },
  'T3084': { cab_type: 'tall', width: 30, height: 84, label: 'Tall 30"x84"' },
  'T3684': { cab_type: 'tall', width: 36, height: 84, label: 'Tall 36"x84"' },
  'T1890': { cab_type: 'tall', width: 18, height: 90, label: 'Tall 18"x90"' },
  'T2490': { cab_type: 'tall', width: 24, height: 90, label: 'Tall 24"x90"' },
  'T3096': { cab_type: 'tall', width: 30, height: 96, label: 'Tall 30"x96"' },
  'T3696': { cab_type: 'tall', width: 36, height: 96, label: 'Tall 36"x96"' },
  // Tall - Oven
  'OC3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'oven_cabinet', label: 'Oven Cabinet 33"x84"' },
  'OC3396': { cab_type: 'tall', width: 33, height: 96, specialty: 'oven_cabinet', label: 'Oven Cabinet 33"x96"' },
  'OC3084': { cab_type: 'tall', width: 30, height: 84, specialty: 'oven_cabinet', label: 'Oven Cabinet 30"x84"' },
  // Tall - Refrigerator
  'RC3684': { cab_type: 'tall', width: 36, height: 84, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 36"x84"' },
  'RC3696': { cab_type: 'tall', width: 36, height: 96, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 36"x96"' },
  'RC3384': { cab_type: 'tall', width: 33, height: 84, specialty: 'refrigerator_cabinet', label: 'Fridge Cabinet 33"x84"' },
};

const CUSTOM_VALUE = '__custom__';

type SectionType = 'base' | 'wall' | 'tall';

const SECTION_CONFIG: { type: SectionType; label: string; color: string; unit: string }[] = [
  { type: 'base', label: 'Base Cabinets', color: 'blue', unit: 'LF' },
  { type: 'wall', label: 'Wall Cabinets', color: 'green', unit: 'LF' },
  { type: 'tall', label: 'Tall Cabinets', color: 'orange', unit: 'EA' },
];

function getOptionsForType(cabType: SectionType) {
  const entries = Object.entries(CABINET_PRESETS).filter(([, v]) => v.cab_type === cabType);

  if (cabType === 'base') {
    return [
      {
        label: 'Base',
        options: entries
          .filter(([, v]) => !v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Specialty',
        options: entries
          .filter(([, v]) => v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
    ];
  }

  if (cabType === 'tall') {
    return [
      {
        label: 'Pantry',
        options: entries
          .filter(([, v]) => !v.specialty)
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Oven',
        options: entries
          .filter(([, v]) => v.specialty === 'oven_cabinet')
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      {
        label: 'Refrigerator',
        options: entries
          .filter(([, v]) => v.specialty === 'refrigerator_cabinet')
          .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
      },
      { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
    ];
  }

  // wall
  return [
    {
      label: 'Standard (30"H)',
      options: entries
        .filter(([, v]) => v.height === 30 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Tall (36"H)',
      options: entries
        .filter(([, v]) => v.height === 36 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Extra Tall (42"H)',
      options: entries
        .filter(([, v]) => v.height === 42 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Short — Above Microwave/Fridge (12"-27"H)',
      options: entries
        .filter(([, v]) => v.height < 30 && !v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    {
      label: 'Specialty',
      options: entries
        .filter(([, v]) => v.specialty)
        .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
    },
    { label: 'Other', options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }] },
  ];
}

interface CabinetBoxEditorProps {
  boxes: CabinetBoxCreate[];
  onChange: (boxes: CabinetBoxCreate[]) => void;
  location: CabinetLocation;
}

const CabinetBoxEditor: React.FC<CabinetBoxEditorProps> = ({ boxes, onChange, location }) => {
  const addBox = (cabType: SectionType, codeOrCustom: string) => {
    if (codeOrCustom === CUSTOM_VALUE) {
      const defaults: Record<SectionType, { width: number; height: number }> = {
        base: { width: 24, height: 34.5 },
        wall: { width: 24, height: 30 },
        tall: { width: 24, height: 84 },
      };
      const newBox: CabinetBoxCreate = {
        code: 'CUSTOM',
        cab_type: cabType,
        location,
        width_inches: defaults[cabType].width,
        height_inches: defaults[cabType].height,
        is_specialty: false,
        specialty_type: null,
        has_glass_door: false,
        qty: 1,
        display_order: boxes.length,
      };
      onChange([...boxes, newBox]);
      return;
    }
    const preset = CABINET_PRESETS[codeOrCustom];
    if (!preset) return;
    const newBox: CabinetBoxCreate = {
      code: codeOrCustom,
      cab_type: preset.cab_type,
      location,
      width_inches: preset.width,
      height_inches: preset.height,
      is_specialty: !!preset.specialty,
      specialty_type: preset.specialty || null,
      has_glass_door: false,
      qty: 1,
      display_order: boxes.length,
    };
    onChange([...boxes, newBox]);
  };

  // Get the global index in boxes array for a given type-filtered item
  const getGlobalIndex = (cabType: SectionType, localIndex: number): number => {
    let count = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].cab_type === cabType) {
        if (count === localIndex) return i;
        count++;
      }
    }
    return -1;
  };

  const updateBox = (globalIndex: number, updates: Partial<CabinetBoxCreate>) => {
    const updated = [...boxes];
    updated[globalIndex] = { ...updated[globalIndex], ...updates };
    onChange(updated);
  };

  const handleCodeChange = (globalIndex: number, value: string, cabType: SectionType) => {
    if (value === CUSTOM_VALUE) {
      const defaults: Record<SectionType, { width: number; height: number }> = {
        base: { width: 24, height: 34.5 },
        wall: { width: 24, height: 30 },
        tall: { width: 24, height: 84 },
      };
      updateBox(globalIndex, {
        code: 'CUSTOM',
        cab_type: cabType,
        width_inches: defaults[cabType].width,
        height_inches: defaults[cabType].height,
        is_specialty: false,
        specialty_type: null,
        has_glass_door: false,
      });
      return;
    }
    const preset = CABINET_PRESETS[value];
    if (preset) {
      updateBox(globalIndex, {
        code: value,
        cab_type: preset.cab_type,
        width_inches: preset.width,
        height_inches: preset.height,
        is_specialty: !!preset.specialty,
        specialty_type: preset.specialty || null,
      });
    }
  };

  const removeBox = (globalIndex: number) => {
    onChange(boxes.filter((_, i) => i !== globalIndex));
  };

  const isCustom = (record: CabinetBoxCreate) => !CABINET_PRESETS[record.code];

  // Summary
  const baseLF = boxes.filter(b => b.cab_type === 'base').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const wallLF = boxes.filter(b => b.cab_type === 'wall').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const tallCount = boxes.filter(b => b.cab_type === 'tall').reduce((sum, b) => sum + b.qty, 0);
  const totalBoxes = boxes.reduce((sum, b) => sum + b.qty, 0);

  const makeColumns = (cabType: SectionType, options: any[]) => [
    {
      title: 'Cabinet',
      dataIndex: 'code',
      width: 220,
      render: (_: string, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Select
            showSearch
            value={CABINET_PRESETS[record.code] ? record.code : CUSTOM_VALUE}
            style={{ width: 200 }}
            onChange={(val) => handleCodeChange(gi, val, cabType)}
            options={options}
            filterOption={(input, option) =>
              (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={280}
          />
        );
      },
    },
    {
      title: 'W"',
      dataIndex: 'width_inches',
      width: 70,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return isCustom(record) ? (
          <InputNumber
            value={record.width_inches}
            min={6} max={60}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(gi, { width_inches: val })}
          />
        ) : (
          <Text>{record.width_inches}"</Text>
        );
      },
    },
    {
      title: 'H"',
      dataIndex: 'height_inches',
      width: 70,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return isCustom(record) ? (
          <InputNumber
            value={record.height_inches}
            min={6} max={120} step={0.5}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(gi, { height_inches: val })}
          />
        ) : (
          <Text>{record.height_inches}"</Text>
        );
      },
    },
    ...(cabType !== 'wall' ? [{
      title: 'Specialty',
      dataIndex: 'specialty_type',
      width: 130,
      render: (_: string, record: CabinetBoxCreate) => (
        record.is_specialty && record.specialty_type ? (
          <Tag color="orange">{record.specialty_type.replace(/_/g, ' ')}</Tag>
        ) : <Text type="secondary">—</Text>
      ),
    }] : []),
    ...((cabType === 'wall' || cabType === 'base') ? [{
      title: 'Glass',
      dataIndex: 'has_glass_door',
      width: 60,
      render: (_: boolean, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Tooltip title="Glass door insert">
            <Checkbox
              checked={record.has_glass_door}
              onChange={(e) => updateBox(gi, { has_glass_door: e.target.checked })}
            />
          </Tooltip>
        );
      },
    }] : []),
    {
      title: 'Qty',
      dataIndex: 'qty',
      width: 80,
      render: (_: number, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <InputNumber
            value={record.qty}
            min={1} max={50}
            size="small"
            style={{ width: 65 }}
            onChange={(val) => val && updateBox(gi, { qty: val })}
          />
        );
      },
    },
    {
      title: '',
      key: 'action',
      width: 45,
      render: (_: any, record: CabinetBoxCreate & { _localIdx: number }) => {
        const gi = getGlobalIndex(cabType, record._localIdx);
        return (
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => removeBox(gi)}
          />
        );
      },
    },
  ];

  const renderSection = (config: typeof SECTION_CONFIG[number]) => {
    const { type, label, color, unit } = config;
    const sectionBoxes = boxes
      .filter(b => b.cab_type === type)
      .map((b, i) => ({ ...b, _localIdx: i, key: i }));
    const options = getOptionsForType(type);

    const summary = type === 'tall'
      ? `${sectionBoxes.reduce((s, b) => s + b.qty, 0)} EA`
      : `${sectionBoxes.reduce((s, b) => s + (b.width_inches * b.qty) / 12, 0).toFixed(1)} LF`;

    return (
      <div key={type} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Tag color={color} style={{ fontSize: 12, margin: 0 }}>{label}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{summary}</Text>
        </div>

        {sectionBoxes.length > 0 && (
          <Table
            dataSource={sectionBoxes}
            columns={makeColumns(type, options)}
            pagination={false}
            size="small"
            scroll={{ x: 500 }}
          />
        )}

        <Select
          placeholder={`+ Add ${label.replace(' Cabinets', '')}...`}
          style={{ width: 260, marginTop: sectionBoxes.length > 0 ? 8 : 0 }}
          showSearch
          value={undefined}
          onChange={(val: string) => addBox(type, val)}
          options={options}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          popupMatchSelectWidth={300}
        />
      </div>
    );
  };

  const isIsland = location === 'island';
  const sections = isIsland
    ? SECTION_CONFIG.filter(s => s.type === 'base')
    : SECTION_CONFIG;

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Tag color="blue">Base: {baseLF.toFixed(1)} LF</Tag>
        {!isIsland && <Tag color="green">Wall: {wallLF.toFixed(1)} LF</Tag>}
        {!isIsland && <Tag color="orange">Tall: {tallCount} EA</Tag>}
        <Tag>Total: {totalBoxes} boxes</Tag>
      </Space>

      {sections.map(renderSection)}
    </div>
  );
};

export default CabinetBoxEditor;
