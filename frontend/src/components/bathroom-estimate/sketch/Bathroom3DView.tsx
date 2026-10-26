/**
 * Bathroom3DView
 *
 * The bathroom sketch in 3D at its real sizes: walls with their tile and
 * surrounds, doors and windows, the floor tile, and each fixture. Walls
 * between the camera and the room turn see-through, so the room can be
 * looked into from any side; "Eye level" stands in the doorway. "After
 * work" shows the tile to install, "Today" the tile there now. Drag to
 * orbit, scroll to zoom, right-drag to pan; clicking a wall or fixture
 * selects it in the sketch, so its panel opens beside the view.
 *
 * Plain three.js, rebuilt whole when the sketch changes and drawn only when
 * something moves. Loaded lazily by BESketchTab, so three.js is only
 * downloaded when the 3D view is opened.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented, Tooltip } from 'antd';
import { AimOutlined, EyeOutlined } from '@ant-design/icons';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BESketchData } from '../../../types/bathroomSketch';
import { bathroomModel, type BathroomModel, type FinishView } from './bathroom3dModel';
import { buildBathroomScene, disposeScene, sketchIdOf, updateCutaway, type BuiltScene } from './bathroom3dScene';
import { TileTextureCache } from './bathroom3dTextures';

const BACKGROUND = '#f7f7f5';
const EYE_HEIGHT_IN = 62;
const OUTSIDE_FOV = 45;
const INSIDE_FOV = 68;
/** How far (screen px) the pointer may move between press and release and still count as a click. */
const CLICK_SLOP_PX = 4;

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  textures: TileTextureCache;
  built: BuiltScene | null;
  render: () => void;
}

export interface Bathroom3DViewProps {
  sketch: BESketchData;
  /** The estimate's form values: tile, tops and metal finishes come from its specs. */
  estimate?: Record<string, any> | null;
  height: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

/** Light from above and to one side, its shadows covering the room. */
function aimSun(sun: THREE.DirectionalLight, model: BathroomModel) {
  if (!model.bounds) return;
  const { minX, maxX, minZ, maxZ } = model.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxZ - minZ, 96);
  sun.position.set(cx - size * 0.6, size * 2.2, cz + size * 0.9);
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();
  const half = size * 0.9;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: size * 6 });
  sun.shadow.camera.updateProjectionMatrix();
}

const Bathroom3DView: React.FC<Bathroom3DViewProps> = ({ sketch, estimate, height, selectedId, onSelect }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [stageVersion, setStageVersion] = useState(0);
  const framed = useRef(false);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<FinishView>('after');
  const pickRef = useRef(onSelect);
  pickRef.current = onSelect;

  const model = useMemo(() => bathroomModel(sketch, estimate, view), [sketch, estimate, view]);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Above the room from its front corner, far enough back to see all of it
  const frameView = useCallback(() => {
    const stage = stageRef.current;
    const b = modelRef.current.bounds;
    if (!stage || !b) return;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 72);
    stage.camera.fov = OUTSIDE_FOV;
    stage.camera.updateProjectionMatrix();
    stage.camera.position.set(cx + size * 0.75, size * 1.15 + 40, cz + size * 1.05);
    stage.controls.target.set(cx, 30, cz);
    stage.controls.update();
  }, []);

  // Standing in the doorway (or at the front of the room), looking in
  const eyeLevel = useCallback(() => {
    const stage = stageRef.current;
    const m = modelRef.current;
    const b = m.bounds;
    if (!stage || !b) return;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    let from = new THREE.Vector3(cx, EYE_HEIGHT_IN, b.maxZ - 10);
    for (const w of m.walls) {
      const door = w.openings.find((o) => o.kind === 'door');
      if (!door || !w.inward) continue;
      const t = (door.rect.x0 + door.rect.x1) / 2 / (w.lengthIn || 1);
      // Past the open door's reach, so it stands beside you, not in the way
      const x = w.a[0] + (w.b[0] - w.a[0]) * t + w.inward[0] * 40;
      const z = w.a[1] + (w.b[1] - w.a[1]) * t + w.inward[1] * 40;
      from = new THREE.Vector3(x, EYE_HEIGHT_IN, z);
      break;
    }
    // A wider lens inside a small room, as a phone camera would see it
    stage.camera.fov = INSIDE_FOV;
    stage.camera.updateProjectionMatrix();
    stage.camera.position.copy(from);
    const look = new THREE.Vector3(cx, 44, cz);
    // Look past the middle of the room, toward the far wall
    look.add(look.clone().sub(from).setY(0).multiplyScalar(0.5));
    stage.controls.target.copy(look);
    stage.controls.update();
  }, []);

  // Renderer, camera, lights and controls: once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 900, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    // Soft since r180 (PCFSoftShadowMap is deprecated there)
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    // A soft room around everything, for chrome, glass and glazed tile to reflect
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.4;
    scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8ba', 0.55));
    const sun = new THREE.DirectionalLight('#fff6e8', 1.35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    const camera = new THREE.PerspectiveCamera(OUTSIDE_FOV, (container.clientWidth || 900) / height, 1, 6000);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Stay above the floor
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 6;
    controls.maxDistance = 2000;

    const stage: Stage = {
      renderer,
      scene,
      camera,
      controls,
      sun,
      textures: new TileTextureCache(renderer.capabilities.getMaxAnisotropy()),
      built: null,
      render: () => {
        if (stage.built) updateCutaway(stage.built, camera);
        renderer.render(scene, camera);
      },
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

    // A click (not a drag) picks the wall or fixture under the pointer; see-through walls are passed over
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e: PointerEvent) => {
      if (!downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > CLICK_SLOP_PX || !stage.built) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const ghosts = new Set(stage.built.walls.filter((w) => w.ghosted).map((w) => w.group.userData.sketchId));
      const hit = raycaster
        .intersectObjects(stage.built.root.children, true)
        .find((h) => {
          const id = sketchIdOf(h.object);
          return h.object instanceof THREE.Mesh && id && !ghosts.has(id);
        });
      pickRef.current?.(hit ? sketchIdOf(hit.object) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      if (stage.built) disposeScene(stage.built.root);
      stage.textures.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [height]);

  // The model: rebuilt whenever the sketch, the estimate's looks, the finish shown or the selection changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.built) {
      stage.scene.remove(stage.built.root);
      disposeScene(stage.built.root);
    }
    stage.built = buildBathroomScene(model, stage.textures, selectedId);
    stage.scene.add(stage.built.root);
    aimSun(stage.sun, model);
    // Frame the room the first time there is one to see; after that the camera stays where it was put
    if (!framed.current && model.bounds) {
      framed.current = true;
      frameView();
    }
    stage.render();
  }, [model, selectedId, frameView, stageVersion]);

  if (failed) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f5e5b', fontSize: 13 }}>
        3D isn't available in this browser (WebGL is off).
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height }}>
      <div ref={containerRef} style={{ height, cursor: 'grab' }} />
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as FinishView)}
          options={[
            { value: 'after', label: 'After work' },
            { value: 'today', label: 'Today' },
          ]}
        />
        <Tooltip title="Back to the view from above">
          <Button size="small" icon={<AimOutlined />} onClick={() => { frameView(); stageRef.current?.render(); }}>
            Reset view
          </Button>
        </Tooltip>
        <Tooltip title="Stand in the doorway at eye height">
          <Button size="small" icon={<EyeOutlined />} onClick={() => { eyeLevel(); stageRef.current?.render(); }}>
            Eye level
          </Button>
        </Tooltip>
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 11, color: '#73726e', pointerEvents: 'none' }}>
        Drag to orbit · scroll to zoom · right-drag to pan · click a wall or fixture to select it
      </div>
    </div>
  );
};

export default Bathroom3DView;
