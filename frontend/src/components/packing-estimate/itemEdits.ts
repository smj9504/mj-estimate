/**
 * What an estimator's edit does to a detected item. The server works out the
 * packing method, materials and labor from the item's attributes; this keeps
 * what the AI left open, and keeps a late answer from overwriting a newer edit.
 */
import type {
  DetectedContentItem, ItemReviewField,
} from '../../types/packing-estimate';

/** Editing one of these settles the matching question from the analysis */
const REVIEW_FIELD_OF: Partial<Record<keyof DetectedContentItem, ItemReviewField>> = {
  name: 'name',
  quantity: 'quantity',
  category: 'category',
  size: 'size',
  weight: 'weight',
  is_fragile: 'fragile',
  needs_disassembly: 'disassembly',
};

/** The attributes the server's plan depends on; quantity is worked out here */
const PLANNED_FIELDS: (keyof DetectedContentItem)[] = [
  'name', 'category', 'size', 'weight', 'is_fragile', 'is_high_value',
  'needs_disassembly', 'packing_method', 'packing_locked',
];

let lastUid = 0;

const newUid = () => {
  lastUid += 1;
  return `item_${Date.now()}_${lastUid}`;
};

/** Gives each item a place on screen that survives others being removed */
export const withUids = (items: DetectedContentItem[]): DetectedContentItem[] =>
  items.map(item => (item.uid ? item : { ...item, uid: newUid() }));

export const newItem = (): DetectedContentItem => ({
  uid: newUid(),
  name: '',
  category: 'Other',
  quantity: 1,
  size: 'small',
  weight: 'light',
  is_fragile: false,
  is_high_value: false,
  needs_disassembly: false,
  uncertain_fields: [],
});

export const needsReview = (item: DetectedContentItem) => (item.uncertain_fields?.length ?? 0) > 0;

/** The AI wasn't sure it's there; it isn't priced until someone keeps it */
export const isUnconfirmed = (item: DetectedContentItem) => !!item.uncertain_fields?.includes('presence');

export const reviewCount = (items: DetectedContentItem[]) => items.filter(needsReview).length;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What `quantity` units count as when the room has `pooled` units of their size
 * packed the same way: more of the same add less (item_plan.unit_times).
 */
const unitTimes = (quantity: number, pooled: number, exponent: number) =>
  quantity * Math.max(pooled, quantity) ** (exponent - 1);

const canPool = (item: DetectedContentItem) =>
  item.base_labor_hours != null && item.per_unit_labor_hours != null && item.quantity_exponent != null;

/** An item's hours on its own: its setup, then its units, each one more adding less */
const ownHours = (item: DetectedContentItem, quantity: number) => round2(
  (item.base_labor_hours ?? 0)
  + (item.per_unit_labor_hours ?? 0) * quantity ** (item.quantity_exponent ?? 1),
);

/**
 * Each item's labor as the estimate prices it: a room's units of one size packed
 * the same way share their time, so its 40 plates and 20 bowls go faster than
 * either alone. One the AI isn't sure is there is priced on its own, and an item
 * saved before this was worked out keeps the hours it was saved with.
 */
export function roomItemHours(items: DetectedContentItem[]): (number | undefined)[] {
  const poolKey = (item: DetectedContentItem) => `${item.packing_method ?? ''}|${item.size ?? ''}`;
  const pooled = new Map<string, number>();
  items.forEach(item => {
    if (isUnconfirmed(item) || !canPool(item)) return;
    pooled.set(poolKey(item), (pooled.get(poolKey(item)) ?? 0) + item.quantity);
  });
  return items.map(item => {
    if (!canPool(item)) return item.estimated_labor_hours;
    if (isUnconfirmed(item)) return ownHours(item, item.quantity);
    const units = unitTimes(item.quantity, pooled.get(poolKey(item)) ?? item.quantity, item.quantity_exponent as number);
    return round2((item.base_labor_hours ?? 0) + (item.per_unit_labor_hours ?? 0) * units);
  });
}

/** Labor of the items that count, whole job */
export const countedHours = (items: DetectedContentItem[]) => {
  const hours = roomItemHours(items);
  return items.reduce((sum, item, i) => sum + (isUnconfirmed(item) ? 0 : hours[i] ?? 0), 0);
};

export const needsPlan = (patch: Partial<DetectedContentItem>) =>
  PLANNED_FIELDS.some(field => field in patch);

export function editItem(item: DetectedContentItem, patch: Partial<DetectedContentItem>): DetectedContentItem {
  const settled = Object.keys(patch).map(field => REVIEW_FIELD_OF[field as keyof DetectedContentItem]);
  const open = (item.uncertain_fields ?? []).filter(field => !settled.includes(field));
  const next: DetectedContentItem = {
    ...item,
    ...patch,
    uncertain_fields: open,
    review_note: open.length > 0 ? item.review_note : null,
  };
  if ('quantity' in patch && item.base_labor_hours != null && item.per_unit_labor_hours != null) {
    next.estimated_labor_hours = ownHours(item, next.quantity);
  }
  return next;
}

/** The estimator agrees with what the AI put down, or keeps an item it doubted */
export const confirmItem = (item: DetectedContentItem): DetectedContentItem => ({
  ...item,
  uncertain_fields: [],
  review_note: null,
});

export const planSignature = (item: DetectedContentItem) =>
  JSON.stringify(PLANNED_FIELDS.map(field => item[field] ?? null));

/**
 * The server's plan onto the item as it is now, unless the item moved on while
 * the request was out: then a newer request is on its way with the newer edit.
 */
export function mergePlan(
  current: DetectedContentItem,
  sentSignature: string,
  planned: DetectedContentItem,
): DetectedContentItem {
  if (planSignature(current) !== sentSignature) return current;
  return {
    ...current,
    size: planned.size,
    weight: planned.weight,
    packing_method: planned.packing_method,
    required_materials: planned.required_materials,
    base_labor_hours: planned.base_labor_hours,
    per_unit_labor_hours: planned.per_unit_labor_hours,
    quantity_exponent: planned.quantity_exponent,
    // The answer priced the quantity it was sent; it may have changed since
    estimated_labor_hours: ownHours(planned, current.quantity),
    estimator_flags: planned.estimator_flags,
  };
}
