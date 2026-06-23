/**
 * WMSketchSidebar - Main sidebar combining all WM sketch panels.
 *
 * Uses Ant Design Collapse to organize panels for:
 * - Demolition zones (with material type manager)
 * - Equipment placements
 * - Containment zones
 * - Floor protection strips
 * - Floor summary (read-only totals)
 *
 * Auto-expands the relevant panel when an element is selected.
 * Each panel header shows a badge with count or area.
 *
 * Usage:
 *   <WMSketchSidebar
 *     overlayData={overlayData}
 *     selection={selection}
 *     materialTypes={materialTypes}
 *     summary={calcFloorTotals(overlayData)}
 *     onUpdateDemolitionZone={...}
 *     onDeleteDemolitionZone={...}
 *     onUpdateEquipment={...}
 *     onDeleteEquipment={...}
 *     onUpdateContainment={...}
 *     onDeleteContainment={...}
 *     onUpdateProtection={...}
 *     onDeleteProtection={...}
 *     onSelectElement={...}
 *     onMaterialTypesChange={...}
 *   />
 */
import React, { useMemo, useEffect, useState } from 'react';
import { Badge, Button, Collapse, Input, InputNumber, Space, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import {
  AppstoreOutlined,
  ToolOutlined,
  GoldOutlined,
  ColumnWidthOutlined,
  SkinOutlined,
  BarChartOutlined,
  BorderOutlined,
  GatewayOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type {
  WMOverlayData,
  WMSketchSelection,
  DemoMaterialType,
  WMFloorSummary,
  WMDemolitionZone,
  WMEquipmentPlacement,
  WMContainmentZone,
  WMFloorProtection,
  WMContentProtection,
  WMContentManipulation,
  WMWall,
  WMRoom,
} from '../../../types/wmSketch';
import WMDemolitionPanel from './panels/WMDemolitionPanel';
import WMEquipmentPanel from './panels/WMEquipmentPanel';
import WMContainmentPanel from './panels/WMContainmentPanel';
import WMFloorProtectionPanel from './panels/WMFloorProtectionPanel';
import WMContentProtectionPanel from './panels/WMContentProtectionPanel';
import WMContentManipulationPanel from './panels/WMContentManipulationPanel';
import WMFloorSummaryPanel from './panels/WMFloorSummaryPanel';
import WMMaterialTypeManager from './panels/WMMaterialTypeManager';

const { Text } = Typography;

export interface WMSketchSidebarProps {
  overlayData: WMOverlayData;
  selection: WMSketchSelection | null;
  materialTypes: DemoMaterialType[];
  summary: WMFloorSummary;
  /** Floor sketch ID — required for creating list-only wall/baseboard zones */
  floorSketchId: string;
  onUpdateDemolitionZone: (id: string, updates: Partial<WMDemolitionZone>) => void;
  onDeleteDemolitionZone: (id: string) => void;
  onAddDemolitionZone: (zone: WMDemolitionZone) => void;
  onUpdateEquipment: (id: string, updates: Partial<WMEquipmentPlacement>) => void;
  onDeleteEquipment: (id: string) => void;
  onUpdateContainment: (id: string, updates: Partial<WMContainmentZone>) => void;
  onDeleteContainment: (id: string) => void;
  onUpdateProtection: (id: string, updates: Partial<WMFloorProtection>) => void;
  onDeleteProtection: (id: string) => void;
  onUpdateContentProtection: (id: string, updates: Partial<WMContentProtection>) => void;
  onDeleteContentProtection: (id: string) => void;
  onUpdateContentManipulation: (id: string, updates: Partial<WMContentManipulation>) => void;
  onDeleteContentManipulation: (id: string) => void;
  onUpdateWall?: (id: string, updates: Partial<WMWall>) => void;
  onDeleteWall?: (id: string) => void;
  onUpdateRoom?: (id: string, updates: Partial<WMRoom>) => void;
  onDeleteRoom?: (id: string) => void;
  /** Pixels per foot — needed for wall length recalculation */
  scalePixelsPerFoot?: number;
  onSelectElement: (id: string, type: string) => void;
  onMaterialTypesChange: (types: DemoMaterialType[]) => void;
  /** Optional width override, defaults to 280 */
  width?: number;
}

// Mapping from selection elementType to panel key
const SELECTION_PANEL_MAP: Record<string, string> = {
  demolition: 'demolition',
  equipment: 'equipment',
  containment: 'containment',
  floor_protection: 'floor_protection',
  content_protection: 'content_protection',
  content_manipulation: 'content_manipulation',
  wall: 'floor_plan',
  room: 'floor_plan',
};

/** Small pill badge for panel headers */
const CountBadge: React.FC<{ count: number; color?: string }> = ({
  count,
  color = '#1677ff',
}) => {
  if (count === 0) return null;
  return (
    <Badge
      count={count}
      size="small"
      style={{
        backgroundColor: color,
        boxShadow: 'none',
        fontSize: 10,
        lineHeight: '16px',
        height: 16,
        minWidth: 16,
        padding: '0 4px',
      }}
    />
  );
};

/** Area badge for panels that show sqft instead of count */
const AreaBadge: React.FC<{ sqft: number; unit?: string; color?: string }> = ({
  sqft,
  unit = 'SF',
  color = '#52c41a',
}) => {
  if (sqft === 0) return null;
  return (
    <span
      style={{
        fontSize: 10,
        color: '#fff',
        backgroundColor: color,
        borderRadius: 8,
        padding: '1px 5px',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: '16px',
      }}
    >
      {sqft.toFixed(0)} {unit}
    </span>
  );
};

const WMSketchSidebar: React.FC<WMSketchSidebarProps> = ({
  overlayData,
  selection,
  materialTypes,
  summary,
  floorSketchId,
  onUpdateDemolitionZone,
  onDeleteDemolitionZone,
  onAddDemolitionZone,
  onUpdateEquipment,
  onDeleteEquipment,
  onUpdateContainment,
  onDeleteContainment,
  onUpdateProtection,
  onDeleteProtection,
  onUpdateContentProtection,
  onDeleteContentProtection,
  onUpdateContentManipulation,
  onDeleteContentManipulation,
  onUpdateWall,
  onDeleteWall,
  onUpdateRoom,
  onDeleteRoom,
  scalePixelsPerFoot = 20,
  onSelectElement,
  onMaterialTypesChange,
  width = 280,
}) => {
  const [activeKeys, setActiveKeys] = useState<string[]>(['demolition', 'summary']);

  // Auto-expand the relevant panel when selection changes
  useEffect(() => {
    if (!selection) return;
    const panelKey = SELECTION_PANEL_MAP[selection.element_type];
    if (panelKey) {
      setActiveKeys((prev) =>
        prev.includes(panelKey) ? prev : [...prev, panelKey]
      );
    }
  }, [selection]);

  const demoCount = overlayData.demolition_zones.length;
  const equipCount = overlayData.equipment_placements.length;
  const containCount = overlayData.containment_zones.length;
  const protCount = overlayData.floor_protections.length;
  const contentProtCount = (overlayData.content_protections ?? []).length;
  const contentManipCount = (overlayData.content_manipulations ?? []).length;
  const demoTotalSqft = useMemo(
    () => summary.demolition_by_type.reduce((s, d) => s + d.total_sqft, 0),
    [summary.demolition_by_type]
  );

  // Derived selection IDs by type
  const selectedDemoId =
    selection?.element_type === 'demolition' ? selection.element_id : null;
  const selectedEquipId =
    selection?.element_type === 'equipment' ? selection.element_id : null;
  const selectedContainId =
    selection?.element_type === 'containment' ? selection.element_id : null;
  const selectedProtId =
    selection?.element_type === 'floor_protection' ? selection.element_id : null;
  const selectedContentProtId =
    selection?.element_type === 'content_protection' ? selection.element_id : null;
  const selectedContentManipId =
    selection?.element_type === 'content_manipulation' ? selection.element_id : null;
  const selectedWallId =
    selection?.element_type === 'wall' ? selection.element_id : null;
  const selectedRoomId =
    selection?.element_type === 'room' ? selection.element_id : null;

  const wallCount = (overlayData.walls ?? []).length;
  const roomCount = (overlayData.rooms ?? []).length;

  const panelItems = [
    {
      key: 'demolition',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AppstoreOutlined style={{ color: '#B8860B', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Tear Out</Text>
          <div style={{ flex: 1 }} />
          {demoTotalSqft > 0 ? (
            <AreaBadge sqft={demoTotalSqft} />
          ) : (
            <CountBadge count={demoCount} />
          )}
        </div>
      ),
      extra: (
        <div onClick={(e) => e.stopPropagation()}>
          <WMMaterialTypeManager
            materialTypes={materialTypes}
            onMaterialTypesChange={onMaterialTypesChange}
          />
        </div>
      ),
      children: (
        <WMDemolitionPanel
          zones={overlayData.demolition_zones}
          selectedZoneId={selectedDemoId}
          materialTypes={materialTypes}
          floorSketchId={floorSketchId}
          onUpdateZone={onUpdateDemolitionZone}
          onDeleteZone={onDeleteDemolitionZone}
          onSelectZone={(id) => onSelectElement(id, 'demolition')}
          onAddZone={onAddDemolitionZone}
        />
      ),
    },
    {
      key: 'equipment',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ToolOutlined style={{ color: '#4169E1', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Equipment</Text>
          <div style={{ flex: 1 }} />
          <CountBadge count={equipCount} color="#4169E1" />
        </div>
      ),
      children: (
        <WMEquipmentPanel
          placements={overlayData.equipment_placements}
          selectedPlacementId={selectedEquipId}
          onDeletePlacement={onDeleteEquipment}
          onSelectPlacement={(id) => onSelectElement(id, 'equipment')}
        />
      ),
    },
    {
      key: 'containment',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GoldOutlined style={{ color: '#0066FF', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Containment</Text>
          <div style={{ flex: 1 }} />
          {summary.containment.total_sqft > 0 ? (
            <AreaBadge sqft={summary.containment.total_sqft} color="#0066FF" />
          ) : (
            <CountBadge count={containCount} color="#0066FF" />
          )}
        </div>
      ),
      children: (
        <WMContainmentPanel
          zones={overlayData.containment_zones}
          selectedZoneId={selectedContainId}
          onUpdateZone={onUpdateContainment}
          onDeleteZone={onDeleteContainment}
          onSelectZone={(id) => onSelectElement(id, 'containment')}
        />
      ),
    },
    {
      key: 'floor_protection',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ColumnWidthOutlined style={{ color: '#D4A000', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Floor Protection</Text>
          <div style={{ flex: 1 }} />
          {summary.floor_protection.total_sqft > 0 ? (
            <AreaBadge sqft={summary.floor_protection.total_sqft} />
          ) : (
            <CountBadge count={protCount} color="#D4A000" />
          )}
        </div>
      ),
      children: (
        <WMFloorProtectionPanel
          protections={overlayData.floor_protections}
          selectedProtectionId={selectedProtId}
          onUpdateProtection={onUpdateProtection}
          onDeleteProtection={onDeleteProtection}
          onSelectProtection={(id) => onSelectElement(id, 'floor_protection')}
        />
      ),
    },
    {
      key: 'content_protection',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SkinOutlined style={{ color: '#8B5CF6', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Content Protection</Text>
          <div style={{ flex: 1 }} />
          {summary.content_protection.total_sqft > 0 ? (
            <AreaBadge sqft={summary.content_protection.total_sqft} color="#8B5CF6" />
          ) : (
            <CountBadge count={contentProtCount} color="#8B5CF6" />
          )}
        </div>
      ),
      children: (
        <WMContentProtectionPanel
          protections={overlayData.content_protections ?? []}
          selectedProtectionId={selectedContentProtId}
          onUpdateProtection={onUpdateContentProtection}
          onDeleteProtection={onDeleteContentProtection}
          onSelectProtection={(id) => onSelectElement(id, 'content_protection')}
        />
      ),
    },
    {
      key: 'content_manipulation',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SwapOutlined style={{ color: '#F97316', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Content Manipulation</Text>
          <div style={{ flex: 1 }} />
          {summary.content_manipulation.total_hours > 0 ? (
            <AreaBadge sqft={summary.content_manipulation.total_hours} unit="hr" color="#F97316" />
          ) : (
            <CountBadge count={contentManipCount} color="#F97316" />
          )}
        </div>
      ),
      children: (
        <WMContentManipulationPanel
          manipulations={overlayData.content_manipulations ?? []}
          selectedManipulationId={selectedContentManipId}
          onUpdateManipulation={onUpdateContentManipulation}
          onDeleteManipulation={onDeleteContentManipulation}
          onSelectManipulation={(id) => onSelectElement(id, 'content_manipulation')}
        />
      ),
    },
    {
      key: 'floor_plan',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BorderOutlined style={{ color: '#333', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Floor Plan</Text>
          <div style={{ flex: 1 }} />
          <CountBadge count={wallCount + roomCount} color="#333" />
        </div>
      ),
      children: (
        <div style={{ fontSize: 12 }}>
          {/* Walls list */}
          {(overlayData.walls ?? []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Text strong style={{ fontSize: 11, color: '#8c8c8c' }}>
                Walls ({(overlayData.walls ?? []).length})
              </Text>
              {(overlayData.walls ?? []).map((w, idx) => {
                const isSel = w.id === selectedWallId;
                return (
                  <div
                    key={w.id}
                    onClick={() => onSelectElement(w.id, 'wall')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 6px',
                      marginTop: 2,
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: isSel ? '#e6f7ff' : 'transparent',
                      border: isSel ? '1px solid #91d5ff' : '1px solid transparent',
                    }}
                  >
                    <span style={{ flex: 1, fontSize: 12 }}>Wall {idx + 1}</span>
                    <InputNumber
                      size="small"
                      value={w.length_ft}
                      min={0.1}
                      step={0.5}
                      style={{ width: 70 }}
                      addonAfter="ft"
                      onChange={(val) => {
                        if (val == null || !onUpdateWall) return;
                        const dx = w.end_x - w.start_x;
                        const dy = w.end_y - w.start_y;
                        const oldLenPx = Math.sqrt(dx * dx + dy * dy);
                        if (oldLenPx < 1) return;
                        // Recalculate end point: keep same angle, change length
                        const newLenPx = val * scalePixelsPerFoot;
                        const ratio = newLenPx / oldLenPx;
                        onUpdateWall(w.id, {
                          length_ft: val,
                          end_x: w.start_x + dx * ratio,
                          end_y: w.start_y + dy * ratio,
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {onDeleteWall && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteWall(w.id);
                        }}
                        style={{ padding: '0 4px' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Rooms list */}
          {(overlayData.rooms ?? []).length > 0 && (
            <div>
              <Text strong style={{ fontSize: 11, color: '#8c8c8c' }}>
                Rooms ({(overlayData.rooms ?? []).length})
              </Text>
              {(overlayData.rooms ?? []).map((r) => {
                const isSel = r.id === selectedRoomId;
                return (
                  <div
                    key={r.id}
                    onClick={() => onSelectElement(r.id, 'room')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 6px',
                      marginTop: 2,
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: isSel ? '#e6f7ff' : 'transparent',
                      border: isSel ? '1px solid #91d5ff' : '1px solid transparent',
                    }}
                  >
                    <Input
                      size="small"
                      value={r.name}
                      style={{ flex: 1 }}
                      onChange={(e) => onUpdateRoom?.(r.id, { name: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
                      {r.area_sqft.toFixed(0)} SF
                    </span>
                    <InputNumber
                      size="small"
                      value={r.height_ft}
                      min={1}
                      max={30}
                      step={0.5}
                      style={{ width: 65 }}
                      addonAfter="H"
                      onChange={(val) => {
                        if (val == null) return;
                        onUpdateRoom?.(r.id, { height_ft: val });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {onDeleteRoom && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRoom(r.id);
                        }}
                        style={{ padding: '0 4px' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {wallCount === 0 && roomCount === 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Use the Wall tool (W) to draw walls. Rooms are auto-detected when walls form a closed shape.
            </Text>
          )}
        </div>
      ),
    },
    {
      key: 'summary',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChartOutlined style={{ color: '#595959', fontSize: 13 }} />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Floor Summary</Text>
        </div>
      ),
      children: <WMFloorSummaryPanel summary={summary} />,
    },
  ];

  return (
    <div
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        height: '100%',
        backgroundColor: '#fafafa',
        borderLeft: '1px solid #e8e8e8',
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Space
        direction="vertical"
        size={0}
        style={{ width: '100%', flex: 1 }}
      >
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(typeof keys === 'string' ? [keys] : keys)}
          ghost={false}
          size="small"
          style={{ borderRadius: 0, border: 'none' }}
          items={panelItems.map((item) => ({
            key: item.key,
            label: item.label,
            extra: 'extra' in item ? item.extra : undefined,
            children: item.children,
            style: {
              borderBottom: '1px solid #e8e8e8',
              borderRadius: 0,
            },
          }))}
        />
      </Space>
    </div>
  );
};

export default WMSketchSidebar;
