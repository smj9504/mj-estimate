/**
 * BESketchTab - Bathroom Estimate Sketch main tab component
 *
 * Top-level component rendered inside BathroomEstimateDetail as the Sketch tab.
 * Composes: BESketchToolbar + BESketchCanvas + BESketchSidebar
 *
 * Usage:
 *   <BESketchTab
 *     estimateId="abc-123"
 *     estimateData={formValues}
 *     onSketchChange={handleSketchChange}
 *   />
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Layout, Button, Space, Typography, message, Spin, Tooltip, Grid, Drawer } from 'antd';
import {
  SaveOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import type { BESketchData } from '../../../types/bathroomSketch';
import { EMPTY_BE_SKETCH } from '../../../types/bathroomSketch';
import { useBESketchState } from './hooks/useBESketchState';
import BESketchToolbar from './BESketchToolbar';
import BESketchCanvas from './BESketchCanvas';
import BESketchSidebar from './BESketchSidebar';
import { bathroomEstimateService } from '../../../services/bathroomEstimateService';

const { Sider, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

// ── Props ──

/** Extracted sketch data for syncing sketch → estimate form fields */
export interface SketchFixtureSync {
  // Room dimensions
  length_ft?: number;
  width_ft?: number;
  floor_sf?: number;
  wall_sf?: number;

  // Fixture replace flags
  replace_tub?: boolean;
  replace_shower?: boolean;
  replace_vanity?: boolean;
  replace_toilet?: boolean;

  // Demo flags
  demo_walls?: boolean;

  // Specs
  bathtub_spec?: Record<string, any>;
  shower_spec?: Record<string, any>;
  vanity_spec?: Record<string, any>;
}

export interface BESketchTabProps {
  /** Bathroom estimate ID for persistence */
  estimateId: string;
  /** Current estimate form data (for syncing dimensions, fixtures, etc.) */
  estimateData?: Record<string, any>;
  /** Callback when sketch data changes */
  onSketchChange?: (data: BESketchData) => void;
  /** Callback to sync fixture data → estimate form fields */
  onFixtureSync?: (sync: SketchFixtureSync) => void;
  /** Initial sketch data (loaded from backend) */
  initialSketchData?: BESketchData;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

// ── Component ──

/** Build sync payload from sketch rooms + fixtures → estimate form fields */
function buildSketchSync(data: BESketchData): SketchFixtureSync {
  const { fixtures, rooms } = data;
  const ppf = data.settings.pixelsPerFoot;
  const sync: SketchFixtureSync = {};

  // ── Room dimensions (use primary bathroom room) ──
  const bathroom = rooms.find(r => r.roomType === 'bathroom') || rooms[0];
  if (bathroom && bathroom.boundary.length >= 3) {
    const xs = bathroom.boundary.map(p => p.x);
    const ys = bathroom.boundary.map(p => p.y);
    const widthPx = Math.max(...xs) - Math.min(...xs);
    const depthPx = Math.max(...ys) - Math.min(...ys);
    const widthFt = Math.round((widthPx / ppf) * 4) / 4;
    const depthFt = Math.round((depthPx / ppf) * 4) / 4;
    sync.length_ft = widthFt;
    sync.width_ft = depthFt;
    sync.floor_sf = Math.round(widthFt * depthFt * 10) / 10;

    const heightFt = (bathroom.heightInches || 96) / 12;
    const perimeterFt = 2 * (widthFt + depthFt);
    sync.wall_sf = Math.round(perimeterFt * heightFt * 10) / 10;
  }

  // ── Fixture flags & specs ──
  const bathtub = fixtures.find(f => f.type === 'bathtub');
  const shower = fixtures.find(f => f.type === 'shower');
  const vanities = fixtures.filter(f => f.type === 'vanity');
  const toilet = fixtures.find(f => f.type === 'toilet');

  sync.replace_tub = !!bathtub;
  sync.replace_shower = !!shower;
  sync.replace_vanity = vanities.length > 0;
  sync.replace_toilet = !!toilet;
  // demo_floor is a user decision — don't auto-set from sketch
  sync.demo_walls = !!(shower || bathtub);

  if (bathtub) {
    const p = bathtub.properties;
    const subType = p.bathtubSubType ?? 'standard_alcove';
    const typeMap: Record<string, string> = {
      standard_alcove: 'alcove', drop_in: 'drop_in',
      corner_garden: 'corner', freestanding: 'freestanding',
    };
    sync.bathtub_spec = {
      type: typeMap[subType] ?? 'alcove',
      material: 'acrylic',
      surround_tile: !!p.hasSurround,
      tub_length_in: Math.max(bathtub.dimensions.width, bathtub.dimensions.height),
      tub_depth_in: Math.min(bathtub.dimensions.width, bathtub.dimensions.height),
      surround_height_in: p.surroundHeight ?? 60,
      surround_wall_count: p.surroundWallCount ?? 3,
    };
  }

  if (shower) {
    const p = shower.properties;
    sync.shower_spec = {
      type: (p.showerWallCount ?? 3) > 0 ? 'custom_tile' : 'one_piece',
      width_in: shower.dimensions.width,
      depth_in: shower.dimensions.height,
      tile_height_in: p.showerTileHeight ?? 84,
      niches: p.nicheCount ?? 0,
      bench: !!p.hasBench,
    };
  }

  if (vanities.length > 0) {
    sync.vanity_spec = {
      items: vanities.map(v => ({
        width: v.dimensions.width,
        sinks: v.properties.sinkCount ?? 1,
      })),
    };
  }

  return sync;
}

const BESketchTab: React.FC<BESketchTabProps> = ({
  estimateId,
  estimateData,
  onSketchChange,
  onFixtureSync,
  initialSketchData,
  isActive = false,
}) => {
  const api = useBESketchState();
  const lastLoadedRef = useRef<string | null>(null);

  // Load sketch_data when estimate data arrives or changes
  useEffect(() => {
    if (!initialSketchData) return;
    // Compare by a stable signature to avoid re-loading our own saves
    const sig = JSON.stringify({
      r: initialSketchData.rooms?.length ?? 0,
      f: initialSketchData.fixtures?.length ?? 0,
      w: initialSketchData.walls?.length ?? 0,
      v: initialSketchData.version,
    });
    if (sig !== lastLoadedRef.current) {
      lastLoadedRef.current = sig;
      api.loadSketch(initialSketchData);
    }
  }, [initialSketchData, api]);

  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const stageRef = useRef<any>(null); // Konva.Stage ref passed to canvas

  // ── Zoom controls ──
  const handleZoom = useCallback((direction: 'in' | 'out' | 'fit') => {
    const stage = stageRef.current;
    if (!stage) return;
    if (direction === 'fit') {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      setZoomLevel(1);
    } else {
      const scaleBy = 1.25;
      const oldScale = stage.scaleX();
      const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
      const mousePointTo = {
        x: (center.x - stage.x()) / oldScale,
        y: (center.y - stage.y()) / oldScale,
      };
      const newScale = direction === 'in'
        ? Math.min(5, oldScale * scaleBy)
        : Math.max(0.2, oldScale / scaleBy);
      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: center.x - mousePointTo.x * newScale,
        y: center.y - mousePointTo.y * newScale,
      });
      setZoomLevel(newScale);
    }
    stage.batchDraw();
  }, [canvasSize]);

  // ── Expose sketch capture for PDF export ──
  useEffect(() => {
    (window as any).__beSketchCapture = () => {
      const stage = stageRef.current;
      if (!stage) return undefined;
      const d = api.data;
      if (!d.rooms.length && !d.fixtures.length && !d.walls.length) return undefined;
      try {
        // Compute content bounding box from data
        const allX: number[] = [];
        const allY: number[] = [];
        const ppf = d.settings.pixelsPerFoot;
        d.rooms.forEach(r => r.boundary.forEach(p => { allX.push(p.x); allY.push(p.y); }));
        d.walls.forEach(w => { allX.push(w.start.x, w.end.x); allY.push(w.start.y, w.end.y); });
        d.fixtures.forEach(f => {
          const hw = (f.dimensions.width / 12) * ppf / 2;
          const hh = (f.dimensions.height / 12) * ppf / 2;
          allX.push(f.position.x - hw, f.position.x + hw);
          allY.push(f.position.y - hh, f.position.y + hh);
        });
        if (!allX.length) return undefined;
        const pad = 20;
        const minX = Math.max(0, Math.min(...allX) - pad);
        const minY = Math.max(0, Math.min(...allY) - pad);
        const maxX = Math.max(...allX) + pad;
        const maxY = Math.max(...allY) + pad;
        const cropW = maxX - minX;
        const cropH = maxY - minY;

        // Save current zoom/pan transform
        const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
        const oldPos = { x: stage.x(), y: stage.y() };

        // Reset to identity so content coords match capture coords
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });

        // Hide grid layer (first) and dimension labels layer (last)
        const layers = stage.getLayers();
        const hiddenLayers: any[] = [];
        layers.forEach((layer: any, idx: number) => {
          if (idx === 0 || idx === layers.length - 1) {
            if (layer.visible()) {
              layer.visible(false);
              hiddenLayers.push(layer);
            }
          }
        });
        const overlays = document.querySelectorAll<HTMLElement>('[data-sketch-overlay]');
        overlays.forEach(el => { el.style.display = 'none'; });
        stage.batchDraw();

        // Capture only the content region
        const dataUrl = stage.toDataURL({
          pixelRatio: 2,
          x: minX,
          y: minY,
          width: cropW,
          height: cropH,
        });

        // Restore zoom/pan and visibility
        stage.scale(oldScale);
        stage.position(oldPos);
        hiddenLayers.forEach(l => l.visible(true));
        overlays.forEach(el => { el.style.display = ''; });
        stage.batchDraw();
        return dataUrl.replace(/^data:image\/png;base64,/, '');
      } catch (e) {
        return undefined;
      }
    };
    return () => { delete (window as any).__beSketchCapture; };
  }, [api.data]);

  // ── Resize observer ──
  useEffect(() => {
    if (!containerRef.current || !isActive) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const sidebarW = isMobile ? 0 : (sidebarCollapsed ? 0 : 260);
      setCanvasSize({
        width: Math.max(200, rect.width - sidebarW - 2),
        height: Math.max(200, rect.height - 2),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isActive, sidebarCollapsed, isMobile]);

  // ── Notify parent on changes ──
  useEffect(() => {
    if (api.isDirty && onSketchChange) {
      onSketchChange(api.data);
    }
  }, [api.data, api.isDirty, onSketchChange]);

  // ── Sync sketch (rooms + fixtures) → estimate form fields ──
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!onFixtureSync) return;
    // On edit: sync when sketch is dirty (user changed something)
    // On load: sync once when sketch has fixtures (e.g. saved from another env)
    if (api.isDirty) {
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    } else if (!initialSyncDone.current && api.data.fixtures.length > 0) {
      initialSyncDone.current = true;
      const sync = buildSketchSync(api.data);
      onFixtureSync(sync);
    }
  }, [api.data.fixtures, api.data.rooms, api.isDirty, onFixtureSync]);

  // ── Save handler ──
  const handleSave = useCallback(async () => {
    try {
      await bathroomEstimateService.update(estimateId, {
        sketch_data: api.data as any,
      });
      api.setIsDirty(false);
      message.success('Sketch saved');
    } catch (err) {
      message.error('Failed to save sketch');
      console.error('Sketch save error:', err);
    }
  }, [api, estimateId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 300 }}>
      {/* Top bar: Toolbar + Save */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, borderBottom: '1px solid #e8e8e8',
        minWidth: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <BESketchToolbar
            api={api}
            onZoomIn={() => handleZoom('in')}
            onZoomOut={() => handleZoom('out')}
            onZoomFit={() => handleZoom('fit')}
            zoomLevel={zoomLevel}
          />
        </div>
        <Space size={4} style={{ padding: '4px 8px', flexShrink: 0 }}>
          {api.isDirty && <Text type="warning" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>*</Text>}
          <Tooltip title="Save sketch (Ctrl+S)">
            <Button
              size="small"
              icon={<SaveOutlined />}
              type={api.isDirty ? 'primary' : 'default'}
              onClick={handleSave}
            />
          </Tooltip>
          {isMobile ? (
            <Tooltip title="Show panels">
              <Button
                size="small"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setDrawerOpen(true)}
              />
            </Tooltip>
          ) : (
            <Tooltip title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              <Button
                size="small"
                icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              />
            </Tooltip>
          )}
        </Space>
      </div>

      {/* Main area: Canvas + Sidebar */}
      <div
        ref={containerRef}
        style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}
      >
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <BESketchCanvas api={api} width={canvasSize.width} height={canvasSize.height} stageRef={stageRef} onZoomChange={setZoomLevel} />
        </div>

        {/* Desktop: inline sidebar */}
        {!isMobile && !sidebarCollapsed && (
          <BESketchSidebar api={api} width={260} />
        )}
      </div>

      {/* Mobile: Drawer sidebar */}
      {isMobile && (
        <Drawer
          title="Sketch Panels"
          placement="bottom"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          height="70vh"
          styles={{ body: { padding: 0 } }}
        >
          <BESketchSidebar api={api} width="100%" />
        </Drawer>
      )}

      {/* Status bar (compact) */}
      <div
        style={{
          padding: '2px 8px',
          borderTop: '1px solid #e8e8e8',
          backgroundColor: '#fafafa',
          fontSize: 10,
          display: 'flex',
          gap: 12,
          color: '#888',
          flexShrink: 0,
        }}
      >
        <span><strong style={{ textTransform: 'capitalize' }}>{api.activeTool.replace('_', ' ')}</strong></span>
        <span>W:{api.data.walls.length}</span>
        <span>R:{api.data.rooms.length}</span>
        <span>F:{api.data.fixtures.length}</span>
        {(api.data.drywallRepairZones ?? []).length > 0 && (
          <span style={{ color: '#d46b08' }}>DW:{api.data.drywallRepairZones.length}</span>
        )}
        {!isMobile && <span>Scale: {api.data.settings.pixelsPerFoot} px/ft</span>}
        {api.selectedId && !isMobile && <span>Selected: {api.selectedId.slice(0, 15)}</span>}
      </div>
    </div>
  );
};

export default BESketchTab;
