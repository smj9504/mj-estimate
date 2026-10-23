/**
 * Cabinet3DView
 *
 * The sketch in 3D: the plan's cabinets stood up at their real sizes, with
 * doors, drawers, glass, countertops and the drawn walls. Drag to orbit,
 * scroll to zoom, right-drag to pan; click a cabinet to select it (Ctrl /
 * Cmd adds to the selection), click empty space to deselect.
 *
 * View-only like the Front view: cabinets are moved in the plan and sized
 * in the Edit tab. Plain three.js rather than a React renderer — the scene
 * is rebuilt whole whenever the sketch or selection changes (a kitchen is
 * a few hundred meshes), and drawn only when something changes.
 *
 * Loaded lazily by CabinetSketchEditor, so three.js is only downloaded
 * when the 3D view is opened.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { AimOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CabinetSketchCabinet, CabinetSketchWall } from '../../../types/cabinetSketch';
import type { PresetCatalog } from './cabinetSketchLayout';
import { cabinetSolids, mainFacing, modelBounds, wallSolids } from './cabinet3dModel';
import { buildCabinetScene, cabinetIdOf, disposeScene } from './cabinet3dScene';

const BACKGROUND = '#f7f7f5';
/** How far (screen px) the pointer may move between press and release and still count as a click. */
const CLICK_SLOP_PX = 4;

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group | null;
  render: () => void;
}

export interface Cabinet3DViewProps {
  cabinets: CabinetSketchCabinet[];
  walls: CabinetSketchWall[];
  presets: PresetCatalog;
  scalePixelsPerFoot: number;
  height: number;
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onDeselect: () => void;
}

const Cabinet3DView: React.FC<Cabinet3DViewProps> = ({
  cabinets,
  walls,
  presets,
  scalePixelsPerFoot,
  height,
  selectedIds,
  onSelect,
  onDeselect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  // Bumped when the renderer is (re)created, so the model is put into the new scene.
  const [stageVersion, setStageVersion] = useState(0);
  const framed = useRef(false);
  const [failed, setFailed] = useState(false);
  // Latest callbacks, so the pointer handlers set up once still call the current ones.
  const pickRef = useRef({ onSelect, onDeselect });
  pickRef.current = { onSelect, onDeselect };

  const solids = useMemo(
    () => cabinetSolids(cabinets, presets, scalePixelsPerFoot),
    [cabinets, presets, scalePixelsPerFoot]
  );
  const wallModels = useMemo(() => wallSolids(walls, scalePixelsPerFoot), [walls, scalePixelsPerFoot]);

  // Stand in front of the doors, a little to one side and above, far enough back to see it all.
  const frameView = useCallback(() => {
    const stage = stageRef.current;
    const bounds = modelBounds(solids, wallModels);
    if (!stage || !bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 96);
    const distance = size * 1.3 + 48;
    const [fx, fz] = mainFacing(solids);
    const angle = Math.atan2(fz, fx) + 0.45;
    stage.camera.position.set(cx + Math.cos(angle) * distance, distance * 0.7, cz + Math.sin(angle) * distance);
    stage.controls.target.set(cx, 36, cz);
    stage.controls.update();
    stage.render();
  }, [solids, wallModels]);

  // Renderer, camera, lights and controls: once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 900, height);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8bc', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-300, 600, 400);
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#ffffff', 0.6);
    fill.position.set(400, 300, -300);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(40, (container.clientWidth || 900) / height, 1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Stay above the floor.
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 24;
    controls.maxDistance = 2400;

    const stage: Stage = {
      renderer,
      scene,
      camera,
      controls,
      content: null,
      render: () => renderer.render(scene, camera),
    };
    stageRef.current = stage;
    framed.current = false;
    setStageVersion((v) => v + 1);
    controls.addEventListener('change', stage.render);

    const resize = new ResizeObserver((entries) => {
      const w = Math.max(320, Math.floor(entries[0]?.contentRect.width ?? 0));
      if (!w) return;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      stage.render();
    });
    resize.observe(container);

    // A click (not a drag) picks the cabinet under the pointer, or clears the selection.
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > CLICK_SLOP_PX || !stage.content) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      // Walls are see-through, so a cabinet behind one is still the pick.
      const hit = raycaster
        .intersectObjects(stage.content.children, true)
        .find((h) => h.object instanceof THREE.Mesh && cabinetIdOf(h.object));
      const id = hit ? cabinetIdOf(hit.object) : null;
      if (id) pickRef.current.onSelect(id, e.ctrlKey || e.metaKey);
      else pickRef.current.onDeselect();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      if (stage.content) disposeScene(stage.content);
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [height]);

  // The model: rebuilt whenever the sketch or the selection changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.content) {
      stage.scene.remove(stage.content);
      disposeScene(stage.content);
    }
    stage.content = buildCabinetScene(solids, wallModels, selectedIds);
    stage.scene.add(stage.content);
    // Frame the kitchen the first time there is one to see; after that the camera stays where it was put.
    if (!framed.current && (solids.length > 0 || wallModels.length > 0)) {
      framed.current = true;
      frameView();
    } else {
      stage.render();
    }
  }, [solids, wallModels, selectedIds, frameView, stageVersion]);

  if (failed) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f5e5b', fontSize: 13 }}>
        The 3D view needs WebGL, which this browser has turned off.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height, cursor: 'grab' }} />
      {cabinets.length === 0 && walls.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f5e5b', fontSize: 13, pointerEvents: 'none' }}>
          No cabinets to show yet. Add cabinets in the Edit tab and they appear here.
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 8 }}>
        <Tooltip title="Back to the starting view">
          <Button size="small" icon={<AimOutlined />} onClick={frameView}>
            Reset view
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default Cabinet3DView;
