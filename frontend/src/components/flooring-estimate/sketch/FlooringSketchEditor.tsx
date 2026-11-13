/**
 * Flooring sketch editor: rooms drawn to scale, wall to wall, level by
 * level, with their doorways, base cabinets and the fixtures standing on
 * the floor. Everything the estimate measures comes from here. It saves as
 * it is drawn.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Button, Grid, Input, Modal, Popconfirm, Space, Tabs } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { FixtureType, FlooringEstimate, FlooringSketch } from '../../../types/flooringEstimate';
import FLSketchCanvas, { type CanvasAction, type Selection, type SketchTool } from './FLSketchCanvas';
import FLSketchInspector from './FLSketchInspector';
import FLSketchToolbar from './FLSketchToolbar';
import { useSketchAutosave } from './hooks/useSketchAutosave';
import {
  addCabinetRun, addFixture, addLevel, addOpening, addRoom, addWall, historyReducer, moveRoom, normalizeSketch,
  removeCabinetRun, removeFixture, removeLevel, removeOpening, removeRoom, removeWall, renameLevel, setRoomPoints,
  updateCabinetRun, updateFixture, updateOpening,
} from './utils/sketchOps';

export interface FlooringSketchEditorProps {
  estimateId: string;
  /** The sketch as saved; read once (key the editor by estimate) */
  initialSketch: FlooringSketch | null | undefined;
  readOnly?: boolean;
  onSaved?: (estimate: FlooringEstimate) => void;
  /** Set to a function that saves any change still waiting (the page calls it before calculating) */
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

const TOOL_KEYS: Record<string, SketchTool> = { v: 'select', r: 'rect', p: 'polygon', d: 'opening', w: 'wall' };

const FlooringSketchEditor: React.FC<FlooringSketchEditorProps> = ({ estimateId, initialSketch, readOnly, onSaved, saveRef }) => {
  const [history, dispatch] = useReducer(historyReducer, initialSketch, (s) => ({
    past: [], present: normalizeSketch(s), future: [],
  }));
  const sketch = history.present;
  const presentRef = useRef(sketch);
  presentRef.current = sketch;

  const [levelId, setLevelId] = useState(sketch.levels[0].id);
  const level = sketch.levels.find((l) => l.id === levelId) ?? sketch.levels[0];
  const [tool, setTool] = useState<SketchTool>('select');
  const [fixtureType, setFixtureType] = useState<FixtureType>('toilet');
  const [selection, setSelection] = useState<Selection>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [zoomRequest, setZoomRequest] = useState({ factor: 1, n: 0 });
  const [levelDialog, setLevelDialog] = useState<{ mode: 'add' | 'rename'; name: string } | null>(null);

  const { status, saveNow } = useSketchAutosave(estimateId, sketch, onSaved, !readOnly);
  useEffect(() => {
    if (!saveRef) return undefined;
    saveRef.current = saveNow;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, saveNow]);

  const screens = Grid.useBreakpoint();
  const wide = !!screens.lg;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const canvasHeight = wide ? Math.max(440, Math.min(760, window.innerHeight - 300)) : 420;

  const apply = useCallback((next: FlooringSketch) => dispatch({ type: 'apply', sketch: next }), []);

  // A level or a selection that an undo took away goes too
  useEffect(() => {
    if (!sketch.levels.some((l) => l.id === levelId)) setLevelId(sketch.levels[0].id);
  }, [sketch, levelId]);
  useEffect(() => {
    if (!selection) return;
    const lists = {
      room: level.rooms, opening: level.openings, cabinet: level.cabinet_runs, fixture: level.fixtures, wall: level.walls,
    } as const;
    if (!(lists[selection.kind] as { id: string }[]).some((x) => x.id === selection.id)) setSelection(null);
  }, [level, selection]);

  const handleAction = useCallback((a: CanvasAction) => {
    const s = presentRef.current;
    const lid = level.id;
    switch (a.type) {
      case 'addRoom': {
        const r = addRoom(s, lid, a.points);
        apply(r.sketch);
        setSelection({ kind: 'room', id: r.roomId });
        return;
      }
      case 'roomPoints':
        apply(setRoomPoints(s, lid, a.roomId, a.points));
        return;
      case 'moveRoom':
        apply(moveRoom(s, lid, a.roomId, a.dx, a.dy));
        return;
      case 'addOpening': {
        const r = addOpening(s, lid, a.opening);
        apply(r.sketch);
        setSelection({ kind: 'opening', id: r.openingId });
        return;
      }
      case 'moveOpening':
        apply(updateOpening(s, lid, a.id, { a: a.a, b: a.b }));
        return;
      case 'addCabinetRun': {
        const r = addCabinetRun(s, lid, a.run);
        apply(r.sketch);
        setSelection({ kind: 'cabinet', id: r.runId });
        return;
      }
      case 'moveCabinetRun':
        apply(updateCabinetRun(s, lid, a.id, { a: a.a, b: a.b }));
        return;
      case 'addWall': {
        const r = addWall(s, lid, a.wall);
        apply(r.sketch);
        setSelection({ kind: 'wall', id: r.wallId });
        return;
      }
      case 'addFixture': {
        const r = addFixture(s, lid, a.fixtureType, a.at);
        apply(r.sketch);
        setSelection({ kind: 'fixture', id: r.fixtureId });
        return;
      }
      case 'moveFixture':
        apply(updateFixture(s, lid, a.id, { x: a.x, y: a.y }));
        return;
      default:
    }
  }, [apply, level.id]);

  const deleteSelected = useCallback(() => {
    if (!selection || readOnly) return;
    const s = presentRef.current;
    const remove = {
      room: removeRoom, opening: removeOpening, cabinet: removeCabinetRun, fixture: removeFixture, wall: removeWall,
    }[selection.kind];
    apply(remove(s, level.id, selection.id));
    setSelection(null);
  }, [selection, readOnly, apply, level.id]);

  // Shortcuts, unless typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection && tool !== 'polygon') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape' && tool !== 'polygon') {
        setTool('select');
        setSelection(null);
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()] && !readOnly) {
        setTool(TOOL_KEYS[e.key.toLowerCase()]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, tool, deleteSelected, readOnly]);

  const toolDone = useCallback(() => setTool('select'), []);

  const levelTabs = useMemo(() => sketch.levels.map((l) => ({ key: l.id, label: l.name })), [sketch.levels]);

  const saveLevelDialog = () => {
    if (!levelDialog) return;
    const name = levelDialog.name.trim();
    if (!name) return;
    if (levelDialog.mode === 'add') {
      const r = addLevel(presentRef.current, name);
      apply(r.sketch);
      setLevelId(r.levelId);
      setSelection(null);
    } else {
      apply(renameLevel(presentRef.current, level.id, name));
    }
    setLevelDialog(null);
  };

  const canvas = (
    <div ref={wrapRef} style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden', minWidth: 0 }}>
      {canvasWidth > 0 && (
        <FLSketchCanvas
          level={level}
          tool={tool}
          fixtureType={fixtureType}
          selection={selection}
          width={canvasWidth}
          height={canvasHeight}
          readOnly={readOnly}
          fitSignal={fitSignal}
          zoomRequest={zoomRequest}
          onSelect={setSelection}
          onAction={handleAction}
          onToolDone={toolDone}
        />
      )}
    </div>
  );

  const inspector = (
    <FLSketchInspector
      sketch={sketch}
      level={level}
      selection={selection}
      readOnly={readOnly}
      onApply={apply}
      onSelect={setSelection}
    />
  );

  return (
    <div data-testid="flooring-sketch-editor">
      <FLSketchToolbar
        tool={tool}
        fixtureType={fixtureType}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        status={status}
        readOnly={readOnly}
        compact={!screens.md}
        onTool={setTool}
        onFixtureType={setFixtureType}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onFit={() => setFitSignal((n) => n + 1)}
        onZoom={(factor) => setZoomRequest((z) => ({ factor, n: z.n + 1 }))}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0' }}>
        <Tabs
          size="small"
          activeKey={level.id}
          items={levelTabs}
          onChange={(key) => {
            setLevelId(key);
            setSelection(null);
          }}
          style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          tabBarStyle={{ marginBottom: 0 }}
        />
        {!readOnly && (
          <Space size={4}>
            <Button size="small" icon={<PlusOutlined />} onClick={() => setLevelDialog({ mode: 'add', name: '' })}>Level</Button>
            <Button size="small" icon={<EditOutlined />} aria-label="Rename level"
              onClick={() => setLevelDialog({ mode: 'rename', name: level.name })} />
            {sketch.levels.length > 1 && (
              <Popconfirm title={`Delete ${level.name}?`} description="Every room drawn on it goes too."
                okText="Delete" okButtonProps={{ danger: true }}
                onConfirm={() => {
                  apply(removeLevel(presentRef.current, level.id));
                  setSelection(null);
                }}>
                <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete level" />
              </Popconfirm>
            )}
          </Space>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: 12, marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{canvas}</div>
        <div style={{ width: wide ? 300 : '100%', flexShrink: 0 }}>{inspector}</div>
      </div>

      <Modal
        open={!!levelDialog}
        title={levelDialog?.mode === 'add' ? 'Add a level' : 'Rename level'}
        okText={levelDialog?.mode === 'add' ? 'Add' : 'Save'}
        onOk={saveLevelDialog}
        onCancel={() => setLevelDialog(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={levelDialog?.name ?? ''}
          placeholder="e.g. Basement, 2nd Floor"
          onChange={(e) => setLevelDialog((d) => (d ? { ...d, name: e.target.value } : d))}
          onPressEnter={saveLevelDialog}
          aria-label="Level name"
        />
      </Modal>
    </div>
  );
};

export default FlooringSketchEditor;
