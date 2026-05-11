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
import { Layout, Button, Space, Typography, message, Spin, Tooltip } from 'antd';
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

// ── Props ──

export interface BESketchTabProps {
  /** Bathroom estimate ID for persistence */
  estimateId: string;
  /** Current estimate form data (for syncing dimensions, fixtures, etc.) */
  estimateData?: Record<string, any>;
  /** Callback when sketch data changes */
  onSketchChange?: (data: BESketchData) => void;
  /** Initial sketch data (loaded from backend) */
  initialSketchData?: BESketchData;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

// ── Component ──

const BESketchTab: React.FC<BESketchTabProps> = ({
  estimateId,
  estimateData,
  onSketchChange,
  initialSketchData,
  isActive = false,
}) => {
  const api = useBESketchState(initialSketchData);
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // ── Resize observer ──
  useEffect(() => {
    if (!containerRef.current || !isActive) return;

    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const sidebarW = sidebarCollapsed ? 0 : 280;
      setCanvasSize({
        width: Math.max(400, rect.width - sidebarW - 2),
        height: Math.max(400, rect.height - 2),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isActive, sidebarCollapsed]);

  // ── Notify parent on changes ──
  useEffect(() => {
    if (api.isDirty && onSketchChange) {
      onSketchChange(api.data);
    }
  }, [api.data, api.isDirty, onSketchChange]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 500 }}>
      {/* Top bar: Toolbar + Save */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <BESketchToolbar api={api} />
        <Space style={{ padding: '6px 12px' }}>
          {api.isDirty && <Text type="warning" style={{ fontSize: 11 }}>Unsaved changes</Text>}
          <Tooltip title="Save sketch (Ctrl+S)">
            <Button
              size="small"
              icon={<SaveOutlined />}
              type={api.isDirty ? 'primary' : 'default'}
              onClick={handleSave}
            >
              Save
            </Button>
          </Tooltip>
          <Tooltip title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            <Button
              size="small"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Main area: Canvas + Sidebar */}
      <div
        ref={containerRef}
        style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}
      >
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <BESketchCanvas api={api} width={canvasSize.width} height={canvasSize.height} />
        </div>

        {!sidebarCollapsed && (
          <BESketchSidebar api={api} width={280} />
        )}
      </div>

      {/* Status bar */}
      <div
        style={{
          padding: '4px 12px',
          borderTop: '1px solid #e8e8e8',
          backgroundColor: '#fafafa',
          fontSize: 11,
          display: 'flex',
          gap: 16,
          color: '#666',
        }}
      >
        <span>Tool: <strong style={{ textTransform: 'capitalize' }}>{api.activeTool.replace('_', ' ')}</strong></span>
        <span>Walls: {api.data.walls.length}</span>
        <span>Rooms: {api.data.rooms.length}</span>
        <span>Fixtures: {api.data.fixtures.length}</span>
        <span>Scale: {api.data.settings.pixelsPerFoot} px/ft</span>
        {api.selectedId && <span>Selected: {api.selectedId.slice(0, 15)}</span>}
      </div>
    </div>
  );
};

export default BESketchTab;
