/**
 * CabinetSketchEditor
 *
 * Optional layout canvas for a cabinet estimate: draw walls to sketch a
 * room outline, then place cabinets from the same catalog used by
 * CabinetBoxEditor. Scoped-down analog of
 * water-mitigation/sketch/WMFloorSketchEditor.tsx — only a `select` tool
 * and a `wall` tool (click-click drawing, snap-to-endpoint, Shift = axis
 * lock), plus click-to-place cabinet shapes. No demolition/equipment/
 * containment/room-detection concepts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import { Button, Select, Space, Tag, Tooltip, message } from 'antd';
import {
  BorderOutlined,
  DeleteOutlined,
  RedoOutlined,
  SaveOutlined,
  SelectOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { cabinetSketchService } from '../../../services/cabinetSketchService';
import { useCabinetSketchState } from '../../../hooks/useCabinetSketchState';
import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';
import { WALL_SNAP_THRESHOLD, DEFAULT_WALL_THICKNESS, DEFAULT_WALL_COLOR } from '../../../types/cabinetSketch';
import { CABINET_PRESETS, getOptionsForType } from '../CabinetBoxEditor';
import type { SectionType } from '../CabinetBoxEditor';
import type { CabType } from '../../../types/cabinetEstimate';
import CabinetWallRenderer, { CabinetWallPreview } from './CabinetWallRenderer';
import CabinetShapeRenderer from './CabinetShapeRenderer';
import { pixelsToFeet, generateOverlayId, snapToWallEndpoint, constrainToAxis } from './cabinetSketchUtils';

const CANVAS_HEIGHT = 560;

export interface CabinetSketchEditorProps {
  estimateId: string;
  /** Fired once per placed cabinet — lets the parent page bump the matching List View qty. */
  onCabinetPlaced?: (code: string, cabType: CabType) => void;
}

const CabinetSketchEditor: React.FC<CabinetSketchEditorProps> = ({ estimateId, onCabinetPlaced }) => {
  const queryClient = useQueryClient();
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setStageWidth(Math.max(400, Math.floor(width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data: sketch, isLoading } = useQuery({
    queryKey: ['cabinet-sketch', estimateId],
    queryFn: () => cabinetSketchService.getSketch(estimateId),
    enabled: !!estimateId,
  });

  const {
    state,
    setTool,
    setActivePreset,
    selectElement,
    toggleSelectElement,
    deselect,
    selectedIds,
    batchMoveSelected,
    addWall,
    updateWall,
    removeWall,
    addCabinet,
    updateCabinet,
    removeCabinet,
    loadOverlayData,
    markSaved,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCabinetSketchState();

  const loadedRef = useRef(false);
  useEffect(() => {
    if (sketch && !loadedRef.current) {
      loadOverlayData(sketch.overlay_data);
      loadedRef.current = true;
    }
  }, [sketch, loadOverlayData]);

  const scalePixelsPerFoot = sketch?.scale_pixels_per_foot ?? 20;

  const saveMutation = useMutation({
    mutationFn: () => cabinetSketchService.saveOverlay(estimateId, state.overlayData),
    onSuccess: () => {
      markSaved();
      queryClient.invalidateQueries({ queryKey: ['cabinet-sketch', estimateId] });
      message.success('Sketch saved');
    },
    onError: () => message.error('Failed to save sketch'),
  });

  // Save when navigating away from this view while dirty.
  useEffect(() => {
    return () => {
      if (state.isDirty) {
        cabinetSketchService.saveOverlay(estimateId, state.overlayData).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateId]);

  // ------------------------------------------------------------------
  // Wall drawing state (click-click paradigm, chained)
  // ------------------------------------------------------------------
  const [wallDrawStart, setWallDrawStart] = useState<{ x: number; y: number } | null>(null);
  const wallDrawStartRef = useRef(wallDrawStart);
  wallDrawStartRef.current = wallDrawStart;
  const [wallDrawCursor, setWallDrawCursor] = useState<{ x: number; y: number } | null>(null);
  const [wallSnapEnd, setWallSnapEnd] = useState<{ x: number; y: number } | null>(null);

  const getCanvasPos = useCallback((): { x: number; y: number } => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const ptr = stage.getPointerPosition();
    if (!ptr) return { x: 0, y: 0 };
    return { x: ptr.x, y: ptr.y };
  }, []);

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const wds = wallDrawStartRef.current;
      if (state.activeTool !== 'wall' || !wds) return;
      const pos = getCanvasPos();
      let endPos = pos;
      if (e.evt.shiftKey) endPos = constrainToAxis(wds, pos);
      const snap = snapToWallEndpoint(endPos, state.overlayData.walls, WALL_SNAP_THRESHOLD);
      setWallDrawCursor(snap.snapped ? snap.point : endPos);
      setWallSnapEnd(snap.snapped ? snap.point : null);
    },
    [state.activeTool, state.overlayData.walls, getCanvasPos]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Clicking empty canvas deselects, unless a tool is actively placing something.
      const clickedOnEmpty = e.target === e.target.getStage();
      const pos = getCanvasPos();

      if (state.activeTool === 'wall') {
        const snapped = snapToWallEndpoint(pos, state.overlayData.walls, WALL_SNAP_THRESHOLD);
        const wds = wallDrawStartRef.current;
        if (!wds) {
          setWallDrawStart(snapped.point);
          setWallDrawCursor(snapped.point);
        } else {
          let endPoint = snapped.point;
          if (e.evt.shiftKey) endPoint = constrainToAxis(wds, endPoint);

          const dx = endPoint.x - wds.x;
          const dy = endPoint.y - wds.y;
          const lengthPx = Math.sqrt(dx * dx + dy * dy);
          if (lengthPx > 5) {
            const wall: CabinetSketchWall = {
              id: generateOverlayId(),
              start_x: wds.x,
              start_y: wds.y,
              end_x: endPoint.x,
              end_y: endPoint.y,
              thickness: DEFAULT_WALL_THICKNESS,
              color: DEFAULT_WALL_COLOR,
              length_ft: pixelsToFeet(lengthPx, scalePixelsPerFoot),
            };
            addWall(wall);
            // Chain: continue drawing from the endpoint just placed.
            setWallDrawStart(endPoint);
            setWallDrawCursor(endPoint);
          }
        }
        return;
      }

      if (state.activeTool === 'place_cabinet' && state.activePresetCode) {
        const preset = CABINET_PRESETS[state.activePresetCode];
        if (preset) {
          const widthPx = (preset.width / 12) * scalePixelsPerFoot;
          const heightPx = (preset.height / 12) * scalePixelsPerFoot;
          const cabinet: CabinetSketchCabinet = {
            id: generateOverlayId(),
            preset_code: state.activePresetCode,
            cab_type: preset.cab_type,
            x: pos.x - widthPx / 2,
            y: pos.y - heightPx / 2,
            width: widthPx,
            height: heightPx,
            rotation: 0,
            label: state.activePresetCode,
          };
          addCabinet(cabinet);
          onCabinetPlaced?.(state.activePresetCode, preset.cab_type);
        }
        setTool('select');
        setActivePreset(null);
        return;
      }

      if (clickedOnEmpty) deselect();
    },
    [
      state.activeTool,
      state.activePresetCode,
      state.overlayData.walls,
      scalePixelsPerFoot,
      getCanvasPos,
      addWall,
      addCabinet,
      onCabinetPlaced,
      setTool,
      setActivePreset,
      deselect,
    ]
  );

  // Cancel an in-progress wall chain, and undo/redo/delete shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (wallDrawStartRef.current) {
          setWallDrawStart(null);
          setWallDrawCursor(null);
          setWallSnapEnd(null);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        selectedIds.forEach((id) => {
          removeWall(id);
          removeCabinet(id);
        });
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectedIds, removeWall, removeCabinet]);

  const handleSelect = useCallback(
    (elementType: 'wall' | 'cabinet') => (id: string, ctrlKey?: boolean) => {
      if (ctrlKey) toggleSelectElement({ element_id: id, element_type: elementType });
      else selectElement({ element_id: id, element_type: elementType });
    },
    [selectElement, toggleSelectElement]
  );

  const handleCabinetDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      if (selectedIds.size > 1 && selectedIds.has(id)) {
        batchMoveSelected(id, x, y);
      } else {
        updateCabinet({ id, x, y });
      }
    },
    [selectedIds, batchMoveSelected, updateCabinet]
  );

  const handleCabinetTransformEnd = useCallback(
    (id: string, width: number, height: number, rotation: number) => {
      updateCabinet({ id, width, height, rotation });
    },
    [updateCabinet]
  );

  const handleWallEndpointDrag = useCallback(
    (wallId: string, endpoint: 'start' | 'end', x: number, y: number) => {
      const snap = snapToWallEndpoint({ x, y }, state.overlayData.walls, WALL_SNAP_THRESHOLD);
      const pt = snap.point;
      const wall = state.overlayData.walls.find((w) => w.id === wallId);
      if (!wall) return;
      const otherX = endpoint === 'start' ? wall.end_x : wall.start_x;
      const otherY = endpoint === 'start' ? wall.end_y : wall.start_y;
      const newLength = pixelsToFeet(Math.hypot(pt.x - otherX, pt.y - otherY), scalePixelsPerFoot);
      updateWall({
        id: wallId,
        ...(endpoint === 'start' ? { start_x: pt.x, start_y: pt.y } : { end_x: pt.x, end_y: pt.y }),
        length_ft: newLength,
      });
    },
    [state.overlayData.walls, scalePixelsPerFoot, updateWall]
  );

  const handleWallDragEnd = useCallback(
    (wallId: string, dx: number, dy: number) => {
      const wall = state.overlayData.walls.find((w) => w.id === wallId);
      if (!wall) return;
      updateWall({
        id: wallId,
        start_x: wall.start_x + dx,
        start_y: wall.start_y + dy,
        end_x: wall.end_x + dx,
        end_y: wall.end_y + dy,
      });
    },
    [state.overlayData.walls, updateWall]
  );

  // Cabinet catalog select — grouped options, same source as CabinetBoxEditor.
  const presetSections: SectionType[] = ['base', 'wall', 'tall'];
  const presetOptions = useMemo(
    () =>
      presetSections.map((type) => ({
        label: type === 'base' ? 'Base Cabinets' : type === 'wall' ? 'Wall Cabinets' : 'Tall Cabinets',
        options: getOptionsForType(type),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  if (isLoading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>Loading sketch…</div>;
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Tooltip title="Select / move / resize">
          <Button
            type={state.activeTool === 'select' ? 'primary' : 'default'}
            icon={<SelectOutlined />}
            onClick={() => {
              setTool('select');
              setWallDrawStart(null);
              setWallDrawCursor(null);
            }}
          >
            Select
          </Button>
        </Tooltip>
        <Tooltip title="Draw walls — click to start, click again to place, Esc to stop, Shift to lock to horizontal/vertical">
          <Button
            type={state.activeTool === 'wall' ? 'primary' : 'default'}
            icon={<BorderOutlined />}
            onClick={() => setTool('wall')}
          >
            Draw Wall
          </Button>
        </Tooltip>

        <Select
          placeholder="+ Place cabinet…"
          style={{ width: 240 }}
          showSearch
          value={undefined}
          onChange={(code: string) => {
            setActivePreset(code);
            setTool('place_cabinet');
          }}
          options={presetOptions}
          filterOption={(input, option: any) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
        />
        {state.activeTool === 'place_cabinet' && state.activePresetCode && (
          <Tag color="blue">Click canvas to place {state.activePresetCode}</Tag>
        )}

        <Button icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
        <Button icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
        <Button
          icon={<DeleteOutlined />}
          danger
          disabled={selectedIds.size === 0}
          onClick={() => {
            selectedIds.forEach((id) => {
              removeWall(id);
              removeCabinet(id);
            });
          }}
        >
          Delete
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          Save Sketch{state.isDirty ? ' *' : ''}
        </Button>
      </Space>

      <div
        ref={containerRef}
        style={{ border: '1px solid #d9d9d9', borderRadius: 4, overflow: 'hidden', background: '#fafafa' }}
      >
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={CANVAS_HEIGHT}
          onClick={handleStageClick}
          onTap={handleStageClick}
          onMouseMove={handleStageMouseMove}
          style={{ cursor: state.activeTool === 'wall' || state.activeTool === 'place_cabinet' ? 'crosshair' : 'default' }}
        >
          <Layer>
            {state.overlayData.walls.map((wall) => (
              <CabinetWallRenderer
                key={wall.id}
                wall={wall}
                isSelected={selectedIds.has(wall.id)}
                onSelect={handleSelect('wall')}
                onDragEndpoint={handleWallEndpointDrag}
                onWallDragEnd={handleWallDragEnd}
              />
            ))}

            {wallDrawStart && wallDrawCursor && (
              <CabinetWallPreview
                startX={wallDrawStart.x}
                startY={wallDrawStart.y}
                endX={wallDrawCursor.x}
                endY={wallDrawCursor.y}
                snappedEnd={wallSnapEnd}
              />
            )}

            {state.overlayData.cabinets.map((cabinet) => (
              <CabinetShapeRenderer
                key={cabinet.id}
                cabinet={cabinet}
                isSelected={selectedIds.has(cabinet.id)}
                onSelect={handleSelect('cabinet')}
                onDragEnd={handleCabinetDragEnd}
                onTransformEnd={handleCabinetTransformEnd}
              />
            ))}
          </Layer>
        </Stage>
      </div>

      {state.overlayData.walls.length === 0 && state.overlayData.cabinets.length === 0 && (
        <div style={{ marginTop: 8, color: '#999', fontSize: 13 }}>
          Draw walls to sketch a room outline, then pick a cabinet from the dropdown above and click the canvas
          to place it. This view is optional — it doesn't affect pricing.
        </div>
      )}
    </div>
  );
};

export default CabinetSketchEditor;
