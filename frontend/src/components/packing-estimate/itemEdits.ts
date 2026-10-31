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

/** The attributes the server's plan depends on; quantity only multiplies it */
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

/** Labor of the items that count, whole job */
export const countedHours = (items: DetectedContentItem[]) =>
  items.reduce((sum, item) => sum + (isUnconfirmed(item) ? 0 : item.estimated_labor_hours ?? 0), 0);

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
    next.estimated_labor_hours = Math.round(
      (item.base_labor_hours + item.per_unit_labor_hours * next.quantity) * 100,
    ) / 100;
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
    // The answer priced the quantity it was sent; it may have changed since
    estimated_labor_hours: Math.round(
      ((planned.base_labor_hours ?? 0) + (planned.per_unit_labor_hours ?? 0) * current.quantity) * 100,
    ) / 100,
    estimator_flags: planned.estimator_flags,
  };
}
