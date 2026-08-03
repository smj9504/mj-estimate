/**
 * Packing Estimate - Main Page
 * 3-step wizard: Details -> Rooms -> Review
 * Supports Quick Estimate and Photo AI modes
 * Supports recalculation from existing estimate via navigation state
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Card, Steps, Button, Space, Typography, Radio, message, Result,
} from 'antd';
import {
  ThunderboltOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  CheckCircleOutlined, CameraOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import DetailsStep from '../components/packing-estimate/DetailsStep';
import PhotoAIRooms from '../components/packing-estimate/PhotoAIRooms';
import { DEFAULT_SETTINGS } from '../components/packing-estimate/constants';
import * as packingService from '../services/packingEstimateService';
import type {
  PackingSettings, PackingRoom, PhotoRoom,
  RoomInput, EstimateResponse, PackingMode,
  ContentRoomInput,
} from '../types/packing-estimate';

const { Title, Text, Paragraph } = Typography;

const PackCalculatorNew: React.FC = () => {
  const location = useLocation();
  const recalcState = (location.state as any) || null;

  const [currentStep, setCurrentStep] = useState(0);
  const [mode, setMode] = useState<PackingMode>(() => {
    if (recalcState?.mode === 'quick' || recalcState?.initialMode === 'quick') return 'quick';
    if (recalcState?.mode === 'photo_ai' || recalcState?.initialMode === 'photo_ai') return 'photo_ai';
    return 'photo_ai';
  });

  // Details state
  const [settings, setSettings] = useState<PackingSettings>(() => {
    if (recalcState?.settings) {
      return { ...DEFAULT_SETTINGS, ...recalcState.settings };
    }
    return {
      ...DEFAULT_SETTINGS,
      include_contingency: false,
      contingency_rate: 0,
    };
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    recalcState?.companyId || null
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    recalcState?.clientId || null
  );
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    recalcState?.claimId || null
  );
  const [projectAddress, setProjectAddress] = useState(
    recalcState?.projectAddress || ''
  );
  const [calculationName, setCalculationName] = useState(
    recalcState?.calculationName || ''
  );

  // Room state
  const [rooms, setRooms] = useState<PackingRoom[]>([]);
  const [photoRooms, setPhotoRooms] = useState<PhotoRoom[]>([]);

  // Result state
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Show recalculation notice
  useEffect(() => {
    if (recalcState?.recalculateFrom) {
      message.info('Settings loaded from previous estimate. Add rooms and recalculate.');
    }
  }, []);

  const handleCalculate = useCallback(async () => {
    setCalculating(true);
    try {
      let response: EstimateResponse;

      if (mode === 'quick') {
        const roomInputs: RoomInput[] = rooms.map(r => ({
          preset: r.preset,
          floor: r.floor,
          density: r.density,
          hints: r.hints,
          contamination: r.contamination,
          hint_volume: r.hint_volume,
          hint_qty: r.hint_qty,
          special_items: r.special_items,
          custom_special_items: r.custom_special_items,
        }));

        response = await packingService.quickEstimate({
          client_id: selectedClientId || undefined,
          company_id: selectedCompanyId || undefined,
          claim_id: selectedClaimId || undefined,
          calculation_name: calculationName || undefined,
          project_address: projectAddress || undefined,
          rooms: roomInputs,
          crew_size: settings.crew_size,
          storage_months: settings.storage_months,
          staging_type: settings.staging_type,
          include_packback: settings.include_packback,
          include_op: settings.include_op,
          op_rate: settings.op_rate,
          include_contingency: settings.include_contingency,
          contingency_rate: settings.contingency_rate,
          region: settings.region,
          special_items: settings.special_items,
          custom_special_items: settings.custom_special_items,
        });
      } else {
        const contentRooms: ContentRoomInput[] = photoRooms.map(r => ({
          room_name: r.room_name,
          preset_id: r.preset_id,
          items: r.items,
          density: r.density,
          floor: r.floor,
          contamination: r.contamination,
          special_items: r.special_items,
          custom_special_items: r.custom_special_items,
        }));

        response = await packingService.contentEstimate({
          client_id: selectedClientId || undefined,
          company_id: selectedCompanyId || undefined,
          claim_id: selectedClaimId || undefined,
          calculation_name: calculationName || undefined,
          project_address: projectAddress || undefined,
          rooms: contentRooms,
          crew_size: settings.crew_size,
          storage_months: settings.storage_months,
          staging_type: settings.staging_type,
          include_packback: settings.include_packback,
          include_op: settings.include_op,
          op_rate: settings.op_rate,
          include_contingency: settings.include_contingency,
          contingency_rate: settings.contingency_rate,
          region: settings.region,
          special_items: settings.special_items,
          custom_special_items: settings.custom_special_items,
        });
      }

      setResult(response);
      setCurrentStep(2);
      message.success('Estimate calculated successfully');
    } catch (err: any) {
      message.error(err.response?.data?.detail || 'Failed to calculate estimate');
    } finally {
      setCalculating(false);
    }
  }, [mode, rooms, photoRooms, settings, selectedClientId, selectedCompanyId, selectedClaimId, calculationName, projectAddress]);

  const canProceedStep0 = true; // Details is always valid
  const canProceedStep1 = mode === 'quick'
    ? rooms.length > 0
    : photoRooms.length > 0;

  const steps = [
    { title: 'Details', description: 'Client & settings' },
    { title: 'Rooms', description: mode === 'quick' ? 'Select rooms' : 'Photos & analysis' },
    { title: 'Review', description: 'Review & export' },
  ];

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Header */}
        <Card>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                <ThunderboltOutlined /> Packing Estimate
              </Title>
              <Text type="secondary">
                Calculate materials and labor for pack-out/pack-in operations
              </Text>
            </div>
            <Radio.Group
              value={mode}
              onChange={e => { setMode(e.target.value); setCurrentStep(0); }}
              buttonStyle="solid"
            >
              <Radio.Button value="quick">
                <AppstoreOutlined /> Quick Estimate
              </Radio.Button>
              <Radio.Button value="photo_ai">
                <CameraOutlined /> Photo AI
              </Radio.Button>
            </Radio.Group>
          </Space>
        </Card>

        {/* Steps */}
        <Steps
          current={currentStep}
          items={steps}
          style={{ maxWidth: 600, margin: '0 auto' }}
        />

        {/* Step Content */}
        {currentStep === 0 && (
          <DetailsStep
            settings={settings}
            setSettings={setSettings}
            selectedCompanyId={selectedCompanyId}
            setSelectedCompanyId={setSelectedCompanyId}
            selectedClientId={selectedClientId}
            setSelectedClientId={setSelectedClientId}
            selectedClaimId={selectedClaimId}
            setSelectedClaimId={setSelectedClaimId}
            projectAddress={projectAddress}
            setProjectAddress={setProjectAddress}
            calculationName={calculationName}
            setCalculationName={setCalculationName}
          />
        )}

        {currentStep === 1 && mode === 'quick' && (
          <Card>
            <QuickEstimateRooms rooms={rooms} setRooms={setRooms} />
          </Card>
        )}

        {currentStep === 1 && mode === 'photo_ai' && (
          <Card>
            <PhotoAIRooms rooms={photoRooms} setRooms={setPhotoRooms} />
          </Card>
        )}

        {currentStep === 2 && result && (
          <EstimateReview result={result} />
        )}

        {/* Navigation */}
        <Card>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={currentStep === 0}
            >
              Back
            </Button>
            <div>
              {currentStep < 1 && (
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  onClick={() => setCurrentStep(1)}
                  disabled={!canProceedStep0}
                >
                  Next: Rooms
                </Button>
              )}
              {currentStep === 1 && (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={handleCalculate}
                  loading={calculating}
                  disabled={!canProceedStep1}
                >
                  Calculate Estimate
                </Button>
              )}
            </div>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

// ── Placeholder components (to be fully built) ──

const QuickEstimateRooms: React.FC<{
  rooms: PackingRoom[];
  setRooms: (rooms: PackingRoom[]) => void;
}> = ({ rooms, setRooms }) => {
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

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Title level={5}>Select Rooms</Title>

      {/* Preset Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(presets).map(([category, items]) => (
          <div key={category} style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 12, color: '#8c8c8c' }}>{category}</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {items.map((p: any) => (
                <Button
                  key={p.key}
                  size="small"
                  onClick={() => addRoom(p.key, p)}
                >
                  + {p.name}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Room Cards */}
      {rooms.length === 0 && (
        <Result
          status="info"
          title="No rooms added"
          subTitle="Click a room preset above to add rooms"
        />
      )}

      {rooms.map(room => {
        const presetName = Object.values(presets).flat().find((p: any) => p.key === room.preset)?.name || room.preset;
        return (
          <Card
            key={room.id}
            size="small"
            title={presetName}
            extra={
              <Button danger size="small" onClick={() => removeRoom(room.id)}>
                Remove
              </Button>
            }
          >
            <Space wrap>
              <span>
                <Text type="secondary">Floor: </Text>
                <select
                  value={room.floor}
                  onChange={e => updateRoom(room.id, { floor: e.target.value as any })}
                  style={{ padding: '2px 4px' }}
                >
                  <option value="basement">Basement</option>
                  <option value="1st">1st Floor</option>
                  <option value="2nd">2nd Floor</option>
                  <option value="3rd">3rd Floor</option>
                  <option value="4th+">4th+ Floor</option>
                </select>
              </span>
              <span>
                <Text type="secondary">Density: </Text>
                <select
                  value={room.density}
                  onChange={e => updateRoom(room.id, { density: e.target.value as any })}
                  style={{ padding: '2px 4px' }}
                >
                  <option value="light">Light (0.7x)</option>
                  <option value="normal">Normal (1.0x)</option>
                  <option value="dense">Dense (1.3x)</option>
                  <option value="heavy">Heavy (1.6x)</option>
                  <option value="extreme">Extreme (2.5x)</option>
                </select>
              </span>
              <span>
                <Text type="secondary">Contamination: </Text>
                <select
                  value={room.contamination}
                  onChange={e => updateRoom(room.id, { contamination: e.target.value as any })}
                  style={{ padding: '2px 4px' }}
                >
                  <option value="clean">Clean</option>
                  <option value="gray_water">Gray Water (1.4x)</option>
                  <option value="black_water">Black Water (1.8x)</option>
                </select>
              </span>
            </Space>
          </Card>
        );
      })}
    </Space>
  );
};

// PhotoAIRooms is imported from components/packing-estimate/PhotoAIRooms

const EstimateReview: React.FC<{
  result: EstimateResponse;
}> = ({ result }) => {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* Summary */}
      <Card>
        <Space size="large">
          <div>
            <Text type="secondary">Total Rooms</Text>
            <Title level={3} style={{ margin: 0 }}>{result.total_rooms}</Title>
          </div>
          <div>
            <Text type="secondary">Total Hours</Text>
            <Title level={3} style={{ margin: 0 }}>{result.total_hours}</Title>
          </div>
          <div>
            <Text type="secondary">Crew Size</Text>
            <Title level={3} style={{ margin: 0 }}>{result.crew_size}</Title>
          </div>
          <div>
            <Text type="secondary">Grand Total</Text>
            <Title level={3} style={{ margin: 0, color: '#1890ff' }}>
              ${result.grand_total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Title>
          </div>
        </Space>
      </Card>

      {/* Section Breakdown */}
      {result.section_details && Object.entries(result.section_details).map(([section, detail]) => (
        <Card key={section} size="small" title={section}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Item</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#8c8c8c', fontSize: 12 }}>Detail</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Rate</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #fafafa' }}>
                  <td style={{ padding: '4px 8px' }}>{line.name}</td>
                  <td style={{ padding: '4px 8px', color: '#8c8c8c', fontSize: 12 }}>{line.detail}</td>
                  <td style={{ textAlign: 'right', padding: '4px 8px' }}>{line.qty} {line.unit}</td>
                  <td style={{ textAlign: 'right', padding: '4px 8px' }}>${line.rate?.toFixed(2)}</td>
                  <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500 }}>${line.amount?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e8e8e8' }}>
                <td colSpan={4} style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>
                  Section Total
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>
                  ${result.sections[section]?.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      ))}

      {/* Totals */}
      <Card>
        <div style={{ maxWidth: 400, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <Text>Subtotal</Text>
            <Text strong>${result.subtotal?.toFixed(2)}</Text>
          </div>
          {result.include_op && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <Text>O&P ({result.op_rate}%)</Text>
              <Text>${result.op_amount?.toFixed(2)}</Text>
            </div>
          )}
          {result.supplements?.filter(s => s.enabled).map(s => (
            <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <Text>{s.name}</Text>
              <Text>${s.amount?.toFixed(2)}</Text>
            </div>
          ))}
          {result.include_contingency && result.contingency_amount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <Text>Contingency ({result.contingency_rate}%)</Text>
              <Text>${result.contingency_amount?.toFixed(2)}</Text>
            </div>
          )}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '8px 0', borderTop: '2px solid #1890ff', marginTop: 8,
          }}>
            <Title level={4} style={{ margin: 0 }}>Grand Total</Title>
            <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
              ${result.grand_total?.toFixed(2)}
            </Title>
          </div>
        </div>
      </Card>
    </Space>
  );
};

export default PackCalculatorNew;
