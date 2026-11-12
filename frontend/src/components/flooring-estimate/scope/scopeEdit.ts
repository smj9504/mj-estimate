/**
 * Changes to what the estimator chose for a flooring estimate: the floors
 * and items of each room, and the job's defaults and General items.
 *
 * A choice set to null goes back to following its default, and is left out
 * of what is saved, so the server's rule (or the job's choice) decides it
 * again. Each function returns a new value.
 */

import type {
  CustomItem, ItemChoice, JobScope, RoomScope, TakeoffItem,
} from '../../../types/flooringEstimate';

type Scopes = Record<string, RoomScope>;

/** The object without null or undefined fields; undefined when nothing is left */
export function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

function withChoice(
  choices: Record<string, ItemChoice> | undefined, key: string, patch: Partial<ItemChoice>,
): Record<string, ItemChoice> | undefined {
  const next = { ...(choices || {}) };
  const merged = compact({ ...(next[key] || {}), ...patch });
  if (merged) next[key] = merged;
  else delete next[key];
  return Object.keys(next).length ? next : undefined;
}

function putRoom(scopes: Scopes, roomId: string, room: RoomScope): Scopes {
  const next = { ...scopes };
  // Defaults aren't kept: in the estimate, no item choices, no custom lines
  const kept = compact({
    ...room,
    included: room.included === false ? false : undefined,
    items: room.items && Object.keys(room.items).length ? room.items : undefined,
    custom_items: room.custom_items && room.custom_items.length ? room.custom_items : undefined,
  });
  if (kept) next[roomId] = kept;
  else delete next[roomId];
  return next;
}

export function setRoomField(scopes: Scopes, roomId: string, patch: Partial<RoomScope>): Scopes {
  return putRoom(scopes, roomId, { ...(scopes[roomId] || {}), ...patch });
}

export function setRoomItem(scopes: Scopes, roomId: string, key: string, patch: Partial<ItemChoice>): Scopes {
  const room = scopes[roomId] || {};
  return putRoom(scopes, roomId, { ...room, items: withChoice(room.items, key, patch) });
}

/** Forgets every choice made for an item in a room */
export function resetRoomItem(scopes: Scopes, roomId: string, key: string): Scopes {
  return setRoomItem(scopes, roomId, key, { on: null, qty: null, unit_price: null, note: null });
}

export function setJobDefaults(job: JobScope, patch: NonNullable<JobScope['defaults']>): JobScope {
  return { ...job, defaults: compact({ ...(job.defaults || {}), ...patch }) };
}

export function setJobRoomItem(job: JobScope, key: string, patch: Partial<ItemChoice>): JobScope {
  return { ...job, room_items: withChoice(job.room_items, key, { ...patch, qty: null }) };
}

export function setGeneralItem(job: JobScope, key: string, patch: Partial<ItemChoice>): JobScope {
  return { ...job, items: withChoice(job.items, key, patch) };
}

// ── Custom lines ──

let seq = 0;
export const customId = () => `c_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function addCustom(list: CustomItem[] | undefined): CustomItem[] {
  return [...(list || []), { id: customId(), description: 'New line', quantity: 1, unit: 'EA', unit_price: 0 }];
}

/** A line priced from the price list: its price follows the estimate's prices unless one is typed */
export function addPricedCustom(list: CustomItem[] | undefined, item: { key: string; label: string; unit: string }): CustomItem[] {
  return [...(list || []), {
    id: customId(), description: item.label, quantity: 1, unit: item.unit, unit_price: null, price_key: item.key,
  }];
}

/** A custom line's price: as typed, else its price-list price */
export function customPrice(item: CustomItem, priceList: Map<string, number>): number {
  if (item.unit_price != null) return item.unit_price;
  return (item.price_key && priceList.get(item.price_key)) || 0;
}

export function updateCustom(list: CustomItem[] | undefined, id: string, patch: Partial<CustomItem>): CustomItem[] {
  return (list || []).map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function removeCustom(list: CustomItem[] | undefined, id: string): CustomItem[] {
  return (list || []).filter((c) => c.id !== id);
}

// ── What an item shows before the server has answered ──

export interface ShownItem {
  on: boolean;
  onSource: 'room' | 'job' | 'default';
  qty: number;
  qtyTyped: boolean;
  unitPrice: number;
  priceTyped: boolean;
  /** Before material tax and O&P */
  total: number;
}

/**
 * An item as the estimator's latest choices make it. The server's takeoff
 * gives the measured quantity and the default; the choices may be newer
 * than the takeoff (not saved yet), so they are applied here.
 */
export function shownItem(
  item: TakeoffItem, room: ItemChoice | undefined, job: ItemChoice | undefined, catalogPrice: number | undefined,
): ShownItem {
  const onSource = room?.on != null ? 'room' : job?.on != null ? 'job' : 'default';
  const on = room?.on ?? job?.on ?? item.default_on;
  const qtyTyped = room?.qty != null;
  const qty = room?.qty ?? item.auto_qty;
  const typedPrice = room?.unit_price ?? job?.unit_price;
  const priceTyped = typedPrice != null;
  const unitPrice = typedPrice ?? catalogPrice ?? item.unit_price;
  return { on, onSource, qty, qtyTyped, unitPrice, priceTyped, total: on ? round2(qty * unitPrice) : 0 };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
