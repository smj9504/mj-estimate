/**
 * Turns the 3D model (cabinet3dModel.ts) into three.js objects: cabinet
 * boxes with their doors, drawers, glass and countertops, appliances, see-
 * through walls and a floor with a 1 ft grid. One inch is one world unit.
 *
 * Colours follow the Front view, so the two read as the same drawing.
 */

import * as THREE from 'three';
import { COUNTER_TOP_IN, GLASS_STILE_IN } from './cabinetFronts';
import type { Face } from './cabinetFronts';
import { modelBounds } from './cabinet3dModel';
import type { CabinetSolid, FrontRun, Pt2, WallSolid } from './cabinet3dModel';

/** Walls are drawn to the 8 ft ceiling the Front view uses. */
export const WALL_HEIGHT_IN = 96;
/** Thickness of a door or drawer front, inches. */
const FACE_THICK_IN = 0.75;
/** An appliance opening is a panel set nearly flush with the box. */
const OPENING_THICK_IN = 0.3;

const COLORS = {
  box: '#EADCC6',
  boxEdge: '#8B5E3C',
  face: '#FBF6EF',
  faceEdge: '#A87B54',
  appliance: '#d9d9d6',
  applianceEdge: '#5f5e5b',
  counter: '#8c8a85',
  toe: '#c9c1b4',
  glass: '#BFD8EA',
  pull: '#5f5e5b',
  wall: '#dedad2',
  wallEdge: '#a8a49c',
  floor: '#f1eee8',
  grid: '#dcd8d0',
  selected: '#1f74c9',
};

/** A solid colour that sits a hair behind its outline, so the edges don't flicker. */
function solidMaterial(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    ...extra,
  });
}

/** A plan outline (local x, z) stood up between heights y0 and y1. */
function prism(points: Pt2[], y0: number, y1: number): THREE.BufferGeometry {
  // The shape is drawn in (x, -z) and extruded along +Z; turning it a
  // quarter about X then stands it up with z back where it belongs.
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  return geometry;
}

function withEdges(mesh: THREE.Mesh, color: string): THREE.Mesh {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({ color })
  );
  mesh.add(edges);
  return mesh;
}

/** The doors, drawers and openings of one front run, in the cabinet's local frame. */
function frontMeshes(run: FrontRun, glass: boolean, edgeColor: string): THREE.Object3D[] {
  const [ax, az] = run.a;
  const len = Math.hypot(run.b[0] - ax, run.b[1] - az);
  if (len < 0.01) return [];
  const u = { x: (run.b[0] - ax) / len, z: (run.b[1] - az) / len };
  const n = { x: -u.z, z: u.x };
  // Turned so the mesh's x runs along the front and its z points out of it.
  const turn = Math.atan2(-u.z, u.x);
  const at = (along: number, out: number, y: number) =>
    new THREE.Vector3(ax + u.x * along + n.x * out, y, az + u.z * along + n.z * out);

  const out: THREE.Object3D[] = [];
  const place = (obj: THREE.Object3D, along: number, outward: number, y: number) => {
    obj.position.copy(at(along, outward, y));
    obj.rotation.y = turn;
    out.push(obj);
  };

  run.faces.forEach((f: Face) => {
    if (f.w <= 0 || f.h <= 0) return;
    const opening = f.kind === 'opening';
    const thick = opening ? OPENING_THICK_IN : FACE_THICK_IN;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(f.w, f.h, thick),
      solidMaterial(opening ? COLORS.appliance : COLORS.face)
    );
    place(withEdges(panel, opening ? COLORS.applianceEdge : edgeColor), f.x + f.w / 2, thick / 2 + 0.02, f.y + f.h / 2);

    if (glass && f.kind === 'door') {
      const stile = Math.min(GLASS_STILE_IN, f.w / 4, f.h / 4);
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(f.w - 2 * stile, f.h - 2 * stile),
        solidMaterial(COLORS.glass, { roughness: 0.15, transparent: true, opacity: 0.8 })
      );
      place(pane, f.x + f.w / 2, thick + 0.04, f.y + f.h / 2);
    }
    if (f.kind === 'drawer' && f.h > 3) {
      const pull = new THREE.Mesh(new THREE.BoxGeometry(Math.min(f.w * 0.4, 5), 0.5, 0.6), solidMaterial(COLORS.pull));
      place(pull, f.x + f.w / 2, thick + 0.3, f.y + f.h - Math.min(f.h / 2, 2));
    }
  });
  return out;
}

function cabinetObject(solid: CabinetSolid, selected: boolean): THREE.Group {
  const group = new THREE.Group();
  group.userData.cabinetId = solid.cabinet.id;
  group.position.set(solid.x, solid.bottom, solid.z);
  // The plan turns clockwise on screen (y down); about three's y axis that is negative.
  group.rotation.y = (-solid.rotation * Math.PI) / 180;

  const boxEdge = selected ? COLORS.selected : solid.appliance ? COLORS.applianceEdge : COLORS.boxEdge;
  const faceEdge = selected ? COLORS.selected : COLORS.faceEdge;

  const box = new THREE.Mesh(
    prism(solid.outline, solid.toeKick, solid.height),
    solidMaterial(solid.appliance ? COLORS.appliance : COLORS.box, selected ? { emissive: COLORS.selected, emissiveIntensity: 0.12 } : {})
  );
  group.add(withEdges(box, boxEdge));
  if (solid.toeKick > 0) {
    group.add(new THREE.Mesh(prism(solid.toeOutline, 0, solid.toeKick), solidMaterial(COLORS.toe)));
  }
  if (solid.counter) {
    const top = new THREE.Mesh(prism(solid.counter, solid.height, COUNTER_TOP_IN), solidMaterial(COLORS.counter));
    group.add(withEdges(top, '#6f6d68'));
  }
  for (const run of solid.fronts) group.add(...frontMeshes(run, solid.glass, faceEdge));
  return group;
}

function wallObject(wall: WallSolid): THREE.Mesh {
  const dx = wall.b[0] - wall.a[0];
  const dz = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dz);
  // See-through, so the cabinets stay in view from any side.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(len, WALL_HEIGHT_IN, wall.thickness),
    solidMaterial(COLORS.wall, { transparent: true, opacity: 0.35, depthWrite: false })
  );
  mesh.position.set((wall.a[0] + wall.b[0]) / 2, WALL_HEIGHT_IN / 2, (wall.a[1] + wall.b[1]) / 2);
  mesh.rotation.y = Math.atan2(-dz, dx);
  return withEdges(mesh, COLORS.wallEdge);
}

/** Everything the 3D view draws for the sketch, as one group to swap out when the sketch changes. */
export function buildCabinetScene(solids: CabinetSolid[], walls: WallSolid[], selectedIds: Set<string>): THREE.Group {
  const root = new THREE.Group();
  const bounds = modelBounds(solids, walls);
  if (bounds) {
    // Floor and 1 ft grid, a couple of feet past the drawing on every side.
    const size = Math.ceil((Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 48) / 12) * 12;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), solidMaterial(COLORS.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    root.add(floor);
    const grid = new THREE.GridHelper(size, size / 12, COLORS.grid, COLORS.grid);
    grid.position.set(cx, 0.05, cz);
    root.add(grid);
  }
  for (const wall of walls) root.add(wallObject(wall));
  for (const solid of solids) root.add(cabinetObject(solid, selectedIds.has(solid.cabinet.id)));
  return root;
}

/** Free the GPU buffers of everything under `root`. */
export function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    const item = obj as THREE.Mesh;
    item.geometry?.dispose();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/** The cabinet a picked object belongs to, if any. */
export function cabinetIdOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) {
    if (o.userData.cabinetId) return o.userData.cabinetId as string;
  }
  return null;
}
