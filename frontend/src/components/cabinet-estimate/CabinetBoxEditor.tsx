import React from 'react';
import {
  Button,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { CabinetBoxCreate, CabType, SpecialtyType } from '../../types/cabinetEstimate';

const { Text } = Typography;

// Common cabinet codes with default dimensions
const CABINET_PRESETS: Record<string, { cab_type: CabType; width: number; height: number; specialty?: SpecialtyType; label: string }> = {
  // Base
  'B12': { cab_type: 'base', width: 12, height: 34.5, label: 'Base 12"' },
  'B15': { cab_type: 'base', width: 15, height: 34.5, label: 'Base 15"' },
  'B18': { cab_type: 'base', width: 18, height: 34.5, label: 'Base 18"' },
  'B21': { cab_type: 'base', width: 21, height: 34.5, label: 'Base 21"' },
  'B24': { cab_type: 'base', width: 24, height: 34.5, label: 'Base 24"' },
  'B27': { cab_type: 'base', width: 27, height: 34.5, label: 'Base 27"' },
  'B30': { cab_type: 'base', width: 30, height: 34.5, label: 'Base 30"' },
  'B33': { cab_type: 'base', width: 33, height: 34.5, label: 'Base 33"' },
  'B36': { cab_type: 'base', width: 36, height: 34.5, label: 'Base 36"' },
  // Base - Specialty
  'SB36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'sink_base', label: 'Sink Base 36"' },
  'BBC36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'blind_corner', label: 'Blind Corner 36"' },
  'DB24': { cab_type: 'base', width: 24, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 24"' },
  'DB30': { cab_type: 'base', width: 30, height: 34.5, specialty: 'drawer_base', label: 'Drawer Base 30"' },
  'LS36': { cab_type: 'base', width: 36, height: 34.5, specialty: 'lazy_susan', label: 'Lazy Susan 36"' },
  // Wall
  'W1230': { cab_type: 'wall', width: 12, height: 30, label: 'Wall 12"×30"' },
  'W1530': { cab_type: 'wall', width: 15, height: 30, label: 'Wall 15"×30"' },
  'W1830': { cab_type: 'wall', width: 18, height: 30, label: 'Wall 18"×30"' },
  'W2130': { cab_type: 'wall', width: 21, height: 30, label: 'Wall 21"×30"' },
  'W2430': { cab_type: 'wall', width: 24, height: 30, label: 'Wall 24"×30"' },
  'W3030': { cab_type: 'wall', width: 30, height: 30, label: 'Wall 30"×30"' },
  'W3630': { cab_type: 'wall', width: 36, height: 30, label: 'Wall 36"×30"' },
  'W3036': { cab_type: 'wall', width: 30, height: 36, label: 'Wall 30"×36"' },
  'W3636': { cab_type: 'wall', width: 36, height: 36, label: 'Wall 36"×36"' },
  'W3042': { cab_type: 'wall', width: 30, height: 42, label: 'Wall 30"×42"' },
  'WDC': { cab_type: 'wall', width: 24, height: 30, specialty: 'diagonal_corner_wall', label: 'Wall Diag Corner' },
  // Tall
  'T1884': { cab_type: 'tall', width: 18, height: 84, label: 'Tall 18"×84"' },
  'T2484': { cab_type: 'tall', width: 24, height: 84, label: 'Tall 24"×84"' },
  'T3084': { cab_type: 'tall', width: 30, height: 84, label: 'Tall 30"×84"' },
  'T1890': { cab_type: 'tall', width: 18, height: 90, label: 'Tall 18"×90"' },
  'T2490': { cab_type: 'tall', width: 24, height: 90, label: 'Tall 24"×90"' },
};

const CUSTOM_VALUE = '__custom__';

// Group options for the select dropdown
const groupedOptions = [
  {
    label: 'Base Cabinets',
    options: Object.entries(CABINET_PRESETS)
      .filter(([, v]) => v.cab_type === 'base' && !v.specialty)
      .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
  },
  {
    label: 'Base - Specialty',
    options: Object.entries(CABINET_PRESETS)
      .filter(([, v]) => v.cab_type === 'base' && v.specialty)
      .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
  },
  {
    label: 'Wall Cabinets',
    options: Object.entries(CABINET_PRESETS)
      .filter(([, v]) => v.cab_type === 'wall')
      .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
  },
  {
    label: 'Tall Cabinets',
    options: Object.entries(CABINET_PRESETS)
      .filter(([, v]) => v.cab_type === 'tall')
      .map(([code, v]) => ({ label: `${code} — ${v.label}`, value: code })),
  },
  {
    label: 'Other',
    options: [{ label: '+ Custom Size...', value: CUSTOM_VALUE }],
  },
];

const TYPE_COLORS: Record<string, string> = {
  base: 'blue',
  wall: 'green',
  tall: 'orange',
};

interface CabinetBoxEditorProps {
  boxes: CabinetBoxCreate[];
  onChange: (boxes: CabinetBoxCreate[]) => void;
}

const CabinetBoxEditor: React.FC<CabinetBoxEditorProps> = ({ boxes, onChange }) => {
  const addBox = (codeOrCustom: string) => {
    if (codeOrCustom === CUSTOM_VALUE) {
      // Custom box — user fills in dimensions manually
      const newBox: CabinetBoxCreate = {
        code: 'CUSTOM',
        cab_type: 'base',
        width_inches: 24,
        height_inches: 34.5,
        is_specialty: false,
        specialty_type: null,
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
      width_inches: preset.width,
      height_inches: preset.height,
      is_specialty: !!preset.specialty,
      specialty_type: preset.specialty || null,
      qty: 1,
      display_order: boxes.length,
    };
    onChange([...boxes, newBox]);
  };

  const updateBox = (index: number, updates: Partial<CabinetBoxCreate>) => {
    const updated = [...boxes];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const handleCodeChange = (index: number, value: string) => {
    if (value === CUSTOM_VALUE) {
      updateBox(index, {
        code: 'CUSTOM',
        cab_type: 'base',
        width_inches: 24,
        height_inches: 34.5,
        is_specialty: false,
        specialty_type: null,
      });
      return;
    }
    const preset = CABINET_PRESETS[value];
    if (preset) {
      updateBox(index, {
        code: value,
        cab_type: preset.cab_type,
        width_inches: preset.width,
        height_inches: preset.height,
        is_specialty: !!preset.specialty,
        specialty_type: preset.specialty || null,
      });
    }
  };

  const removeBox = (index: number) => {
    onChange(boxes.filter((_, i) => i !== index));
  };

  // Calculate live LF summary
  const baseLF = boxes.filter(b => b.cab_type === 'base').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const wallLF = boxes.filter(b => b.cab_type === 'wall').reduce((sum, b) => sum + (b.width_inches * b.qty) / 12, 0);
  const tallCount = boxes.filter(b => b.cab_type === 'tall').reduce((sum, b) => sum + b.qty, 0);
  const totalBoxes = boxes.reduce((sum, b) => sum + b.qty, 0);

  const isCustom = (record: CabinetBoxCreate) => !CABINET_PRESETS[record.code];

  const columns = [
    {
      title: 'Cabinet',
      dataIndex: 'code',
      width: 220,
      render: (_: string, record: CabinetBoxCreate, index: number) => (
        <Select
          showSearch
          value={CABINET_PRESETS[record.code] ? record.code : CUSTOM_VALUE}
          style={{ width: 200 }}
          onChange={(val) => handleCodeChange(index, val)}
          options={groupedOptions}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          popupMatchSelectWidth={280}
        />
      ),
    },
    {
      title: 'Type',
      dataIndex: 'cab_type',
      width: 90,
      render: (_: string, record: CabinetBoxCreate, index: number) => (
        isCustom(record) ? (
          <Select
            value={record.cab_type}
            style={{ width: 80 }}
            size="small"
            onChange={(val) => updateBox(index, { cab_type: val })}
            options={[
              { label: 'Base', value: 'base' },
              { label: 'Wall', value: 'wall' },
              { label: 'Tall', value: 'tall' },
            ]}
          />
        ) : (
          <Tag color={TYPE_COLORS[record.cab_type] || 'default'}>
            {record.cab_type}
          </Tag>
        )
      ),
    },
    {
      title: 'W"',
      dataIndex: 'width_inches',
      width: 70,
      render: (_: number, record: CabinetBoxCreate, index: number) => (
        isCustom(record) ? (
          <InputNumber
            value={record.width_inches}
            min={6} max={60}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(index, { width_inches: val })}
          />
        ) : (
          <Text>{record.width_inches}"</Text>
        )
      ),
    },
    {
      title: 'H"',
      dataIndex: 'height_inches',
      width: 70,
      render: (_: number, record: CabinetBoxCreate, index: number) => (
        isCustom(record) ? (
          <InputNumber
            value={record.height_inches}
            min={6} max={120} step={0.5}
            size="small"
            style={{ width: 60 }}
            onChange={(val) => val && updateBox(index, { height_inches: val })}
          />
        ) : (
          <Text>{record.height_inches}"</Text>
        )
      ),
    },
    {
      title: 'Specialty',
      dataIndex: 'specialty_type',
      width: 130,
      render: (_: string, record: CabinetBoxCreate) => (
        record.is_specialty && record.specialty_type ? (
          <Tag color="orange">{record.specialty_type.replace(/_/g, ' ')}</Tag>
        ) : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      width: 80,
      render: (_: number, record: CabinetBoxCreate, index: number) => (
        <InputNumber
          value={record.qty}
          min={1} max={50}
          size="small"
          style={{ width: 65 }}
          onChange={(val) => val && updateBox(index, { qty: val })}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      width: 45,
      render: (_: any, __: any, index: number) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeBox(index)}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Text strong>LF Summary:</Text>
        <Tag color="blue">Base: {baseLF.toFixed(1)} LF</Tag>
        <Tag color="green">Wall: {wallLF.toFixed(1)} LF</Tag>
        <Tag color="orange">Tall: {tallCount} EA</Tag>
        <Tag>Total: {totalBoxes} boxes</Tag>
      </Space>

      <Table
        dataSource={boxes.map((b, i) => ({ ...b, key: i }))}
        columns={columns}
        pagination={false}
        size="small"
        scroll={{ x: 700 }}
      />

      <div style={{ marginTop: 12 }}>
        <Select
          placeholder="+ Add Cabinet..."
          style={{ width: 280 }}
          showSearch
          value={undefined}
          onChange={(val: string) => addBox(val)}
          options={groupedOptions}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          popupMatchSelectWidth={320}
        />
      </div>
    </div>
  );
};

export default CabinetBoxEditor;
