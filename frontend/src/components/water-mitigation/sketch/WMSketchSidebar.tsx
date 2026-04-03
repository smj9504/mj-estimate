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
import { Badge, Collapse, Space, Typography } from 'antd';
import {
  AppstoreOutlined,
  ToolOutlined,
  GoldOutlined,
  ColumnWidthOutlined,
  BarChartOutlined,
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
} from '../../../types/wmSketch';
import WMDemolitionPanel from './panels/WMDemolitionPanel';
import WMEquipmentPanel from './panels/WMEquipmentPanel';
import WMContainmentPanel from './panels/WMContainmentPanel';
import WMFloorProtectionPanel from './panels/WMFloorProtectionPanel';
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
