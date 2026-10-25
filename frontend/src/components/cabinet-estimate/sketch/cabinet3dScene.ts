/**
 * Turns the 3D model (cabinet3dModel.ts) into three.js objects: cabinet
 * boxes with their doors, drawers, glass and countertops, sinks, the
 * detach & reset appliances with a tag over each, see-through walls and a
 * floor with a 1 ft grid. One inch is one world unit.
 *
 * Colours follow the Front view, so the two read as the same drawing.
 */

import * as THREE from 'three';
import { COUNTER_TOP_IN, GLASS_STILE_IN } from './cabinetFronts';
import type { Face } from './cabinetFronts';
import { applianceExtent, modelBounds, toPlan } from './cabinet3dModel';
import type { ApplianceSolid, CabinetSolid, CounterSlab, FillerSolid, FrontRun, Pt2, WallSolid } from './cabinet3dModel';
import type { LocalRect } from './sketchAppliances';

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
  steel: '#c5cbd0',
  steelFace: '#d9dee2',
  steelEdge: '#5f6b73',
  dark: '#2f3337',
  burner: '#5a6066',
  window: '#39424a',
  wood: '#c49a6c',
  bowl: '#8f99a1',
  /** The detach & reset tag, as on the plan. */
  tag: '#b45309',
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

/** A plan outline (local x, z), less any holes, stood up between heights y0 and y1. */
function prism(points: Pt2[], y0: number, y1: number, holes: Pt2[][] = []): THREE.BufferGeometry {
  // The shape is drawn in (x, -z) and extruded along +Z; turning it a
  // quarter about X then stands it up with z back where it belongs.
  const flat = (pts: Pt2[]) => pts.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(flat(points));
  shape.holes = holes.map((h) => new THREE.Path(flat(h)));
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

const rectPoints = ([x0, z0, x1, z1]: LocalRect): Pt2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

/** A box between local x0..x1, z0..z1 and heights y0..y1, outlined. */
function block(rect: LocalRect, y0: number, y1: number, color: string, edge: string): THREE.Mesh {
  return withEdges(new THREE.Mesh(prism(rectPoints(rect), y0, y1), solidMaterial(color)), edge);
}

/** An upright cylinder standing on (x, y0, z). */
function post(x: number, z: number, radius: number, y0: number, height: number, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), solidMaterial(color));
  mesh.position.set(x, y0 + height / 2, z);
  return mesh;
}

/** A sink set in the counter of its base: rim, bowls with their drains, and the faucet behind. */
function sinkObject(sink: NonNullable<CabinetSolid['sink']>): THREE.Group {
  const group = new THREE.Group();
  const top = COUNTER_TOP_IN;
  group.add(block(sink.rim, top, top + 0.15, COLORS.steelFace, COLORS.steelEdge));
  for (const bowl of sink.bowls) {
    group.add(block(bowl, top + 0.15, top + 0.18, COLORS.bowl, COLORS.steelEdge));
    group.add(post((bowl[0] + bowl[2]) / 2, (bowl[1] + bowl[3]) / 2, 1.4, top + 0.18, 0.04, COLORS.dark));
  }
  const [fx, fz] = sink.faucet;
  group.add(post(fx, fz, 0.6, top, 11, COLORS.steel));
  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 8), solidMaterial(COLORS.steel));
  spout.position.set(fx, top + 10.5, fz + 4);
  group.add(spout);
  return group;
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
  if (solid.sink) group.add(sinkObject(solid.sink));
  return group;
}

/** One detach & reset appliance, built from boxes in its own frame: x along it, z from its back to its front, y up from its bottom. */
function applianceObject(a: ApplianceSolid, selected: boolean): THREE.Group {
  const group = new THREE.Group();
  // In a cabinet, picking it picks the cabinet.
  if (a.hostId) group.userData.cabinetId = a.hostId;
  group.position.set(a.x, a.bottom, a.z);
  group.rotation.y = (-a.rotation * Math.PI) / 180;

  const { width: w, height: h, back: b } = a;
  const front = b + a.depth;
  const edge = selected ? COLORS.selected : COLORS.steelEdge;
  const body = (color: string = COLORS.steel) => block([0, b, w, front], 0, h, color, edge);
  // A panel on the front, standing out from it by `out`.
  const panel = (x0: number, x1: number, y0: number, y1: number, color: string, out = 0.4) =>
    block([x0, front, x1, front + out], y0, y1, color, edge);
  const barAcross = (x0: number, x1: number, y: number) => block([x0, front + 0.4, x1, front + 1.4], y - 0.4, y + 0.4, COLORS.dark, COLORS.dark);
  const barUp = (x: number, y0: number, y1: number) => block([x - 0.4, front + 0.4, x + 0.4, front + 1.4], y0, y1, COLORS.dark, COLORS.dark);
  const burners = (y: number) => {
    for (const fx of [0.28, 0.72]) {
      for (const fz of [0.3, 0.7]) group.add(post(w * fx, b + a.depth * fz, Math.min(w, a.depth) * 0.12, y, 0.25, COLORS.burner));
    }
  };

  switch (a.spec.model) {
    case 'fridge': {
      const split = h * 0.36;
      group.add(body());
      group.add(panel(0.4, w / 2 - 0.2, split + 0.3, h - 0.4, COLORS.steelFace));
      group.add(panel(w / 2 + 0.2, w - 0.4, split + 0.3, h - 0.4, COLORS.steelFace));
      group.add(panel(0.4, w - 0.4, 0.4, split - 0.3, COLORS.steelFace));
      group.add(barUp(w / 2 - 1.6, split + 6, Math.min(split + 34, h - 4)));
      group.add(barUp(w / 2 + 1.6, split + 6, Math.min(split + 34, h - 4)));
      group.add(barAcross(w * 0.3, w * 0.7, split - 3));
      break;
    }
    case 'range': {
      group.add(body());
      group.add(panel(0.8, w - 0.8, 0.5, 4.5, COLORS.steelFace));
      group.add(panel(0.8, w - 0.8, 5, h - 6, COLORS.steelFace));
      group.add(panel(4, w - 4, 10, h - 14, COLORS.window, 0.6));
      group.add(barAcross(3, w - 3, h - 8));
      group.add(block([0.5, b + 0.5, w - 0.5, front - 0.5], h, h + 0.3, COLORS.dark, COLORS.dark));
      burners(h + 0.3);
      break;
    }
    case 'cooktop':
      group.add(body(COLORS.dark));
      burners(h);
      break;
    case 'oven':
      group.add(body());
      group.add(panel(4, w - 4, h * 0.2, h - 7, COLORS.window, 0.3));
      group.add(barAcross(3, w - 3, h - 3.5));
      break;
    case 'microwave':
      group.add(body());
      group.add(panel(1.5, w * 0.68, 2, h - 2, COLORS.window));
      group.add(panel(w * 0.72, w - 1.5, 2, h - 2, COLORS.dark));
      group.add(barUp(w * 0.7, 3, h - 3));
      break;
    case 'hood':
      group.add(body(h > 12 ? COLORS.wood : COLORS.steel));
      break;
    case 'disposal':
      group.add(post(w / 2, b + a.depth / 2, (Math.min(w, a.depth) / 2) * 0.9, 0, h, COLORS.dark));
      break;
    default: {
      // A dishwasher (and any appliance this catalog doesn't know).
      group.add(body());
      group.add(panel(0.3, w - 0.3, 4.5, h - 0.3, COLORS.steelFace));
      group.add(barAcross(3, w - 3, h - 3));
    }
  }
  if (a.counter) {
    group.add(block([0, b, w, front + 1], h, COUNTER_TOP_IN, COLORS.counter, '#6f6d68'));
  }
  return group;
}

/** A flat tag that always faces the camera and shows through everything: where a detach & reset appliance is. */
function tagSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();
  const font = '600 40px "Segoe UI", Inter, sans-serif';
  const pad = 18;
  const tall = 64;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = tall;
  // Resizing the canvas reset the context.
  ctx.font = font;
  const r = 14;
  const wide = canvas.width;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(wide, 0, wide, tall, r);
  ctx.arcTo(wide, tall, 0, tall, r);
  ctx.arcTo(0, tall, 0, 0, r);
  ctx.arcTo(0, 0, wide, 0, r);
  ctx.closePath();
  ctx.fillStyle = COLORS.tag;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, tall / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  const heightIn = 5;
  sprite.scale.set((heightIn * wide) / tall, heightIn, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * The tag of an appliance: over one that stands on the floor or the
 * counter; on the face of one that hangs, or sits in a cabinet (an oven,
 * a disposal under the sink), so tags stacked one over another stay apart.
 */
function applianceTag(a: ApplianceSolid): THREE.Sprite {
  const sprite = tagSprite(`D&R · ${a.spec.label}`);
  const above = a.spec.mount === 'floor' || a.spec.mount === 'counter';
  const [x, z] = toPlan(a, [a.width / 2, above ? a.back + a.depth / 2 : a.back + a.depth + 1]);
  const y = above ? Math.max(a.bottom + a.height, COUNTER_TOP_IN) + 4 : a.bottom + a.height / 2;
  sprite.position.set(x, y, z);
  return sprite;
}

/** A countertop laid over several cabinets (the island top), in plan coordinates. */
function slabObject(slab: CounterSlab): THREE.Mesh {
  const top = new THREE.Mesh(prism(slab.outline, slab.bottom, COUNTER_TOP_IN, slab.holes), solidMaterial(COLORS.counter));
  return withEdges(top, '#6f6d68');
}

/** A tapered filler in an angled joint, in plan coordinates: finished like the doors on the door side, like the boxes at the back. */
function fillerObject(filler: FillerSolid): THREE.Group {
  const group = new THREE.Group();
  const front = !!filler.toeOutline;
  const body = new THREE.Mesh(prism(filler.outline, filler.toeKick, filler.height), solidMaterial(front ? COLORS.face : COLORS.box));
  group.add(withEdges(body, front ? COLORS.faceEdge : COLORS.boxEdge));
  if (filler.toeOutline && filler.toeKick > 0) {
    group.add(new THREE.Mesh(prism(filler.toeOutline, 0, filler.toeKick), solidMaterial(COLORS.toe)));
  }
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
export function buildCabinetScene(
  solids: CabinetSolid[],
  walls: WallSolid[],
  selectedIds: Set<string>,
  {
    counters = [],
    fillers = [],
    appliances = [],
  }: { counters?: CounterSlab[]; fillers?: FillerSolid[]; appliances?: ApplianceSolid[] } = {}
): THREE.Group {
  const root = new THREE.Group();
  const bounds = modelBounds(solids, walls, applianceExtent(appliances));
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
  // A range in its range base is drawn in place of the base's own appliance box.
  const replaced = new Set(appliances.filter((a) => a.replacesHost).map((a) => a.hostId));
  for (const solid of solids) {
    if (!replaced.has(solid.cabinet.id)) root.add(cabinetObject(solid, selectedIds.has(solid.cabinet.id)));
  }
  for (const slab of counters) root.add(slabObject(slab));
  for (const filler of fillers) root.add(fillerObject(filler));
  for (const a of appliances) {
    root.add(applianceObject(a, !!a.hostId && selectedIds.has(a.hostId)));
    root.add(applianceTag(a));
  }
  return root;
}

/** Free the GPU buffers of everything under `root`. */
export function disposeScene(root: THREE.Object3D) {
  root.traverse((obj) => {
    const item = obj as THREE.Mesh;
    item.geometry?.dispose();
    const material = item.material as THREE.Material | THREE.Material[] | undefined;
    // A tag's text is a texture of its own.
    const release = (m: THREE.Material) => {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    };
    if (Array.isArray(material)) material.forEach(release);
    else if (material) release(material);
  });
}

/** The cabinet a picked object belongs to, if any. */
export function cabinetIdOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) {
    if (o.userData.cabinetId) return o.userData.cabinetId as string;
  }
  return null;
}
