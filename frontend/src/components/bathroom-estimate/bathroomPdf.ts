/**
 * PDFs with pictures drawn in the browser and sent with the request: each
 * bathroom's plan as its Sketch tab draws it (bathroomPlanSnapshot), and the
 * 3D view on an option's PDF and the customer proposal (bathroom3dSnapshot,
 * loaded on demand with three.js). The restoration's PDF — the carrier's —
 * never gets a 3D view.
 */

import { bathroomEstimateService } from '../../services/bathroomEstimateService';
import type { BathroomEstimate } from '../../types/bathroomEstimate';

async function snapshots(
  estimates: Pick<BathroomEstimate, 'id' | 'sketch_data'>[],
  size: { width: number; height: number },
): Promise<Record<string, string>> {
  try {
    const { renderBathroomSnapshots } = await import('./sketch/bathroom3dSnapshot');
    return await renderBathroomSnapshots(
      estimates.map((e) => ({ key: e.id, sketch: e.sketch_data as any, estimate: e })),
      size,
    );
  } catch {
    // No WebGL, or three.js failed to load: the PDF goes without the picture
    return {};
  }
}

/** Each estimate's plan, drawn as on its Sketch tab (as saved), by id; none for one with no sketch */
export async function planImages(
  estimates: Pick<BathroomEstimate, 'id' | 'sketch_data'>[],
): Promise<Record<string, string>> {
  try {
    const { renderPlanSnapshots } = await import('./sketch/bathroomPlanSnapshot');
    return await renderPlanSnapshots(estimates.map((e) => ({ key: e.id, sketch: e.sketch_data as any, estimate: e as any })));
  } catch {
    // The PDF goes with the server's outline of the plan
    return {};
  }
}

/** One estimate's PDF with its plan (and an option's 3D view), from anywhere: the estimate list too */
export async function exportEstimatePdfWithPictures(estimateOrId: BathroomEstimate | string, opts: {
  show_breakdown_prices?: boolean;
  show_signature?: boolean;
  /** The plan as the open Sketch tab has it, for when it can't be drawn from the saved sketch */
  sketchImage?: string;
} = {}) {
  const estimate = typeof estimateOrId === 'string'
    ? await bathroomEstimateService.getById(estimateOrId)
    : estimateOrId;
  const plans = await planImages([estimate]);
  await bathroomEstimateService.exportPdf(estimate.id, {
    show_breakdown_prices: opts.show_breakdown_prices,
    show_signature: opts.show_signature,
    sketch_image: plans[estimate.id] ?? opts.sketchImage,
    render_image: await optionRender(estimate),
    address: estimate.property_address,
  });
}

/** The 3D picture for an option's PDF; none for the restoration or the current layout. */
export async function optionRender(estimate?: BathroomEstimate | null): Promise<string | undefined> {
  if (!estimate || estimate.kind !== 'option') return undefined;
  const pictures = await snapshots([estimate], { width: 1400, height: 820 });
  return pictures[estimate.id];
}

/**
 * A PDF of the job's bathrooms (one estimate each): every bathroom in one
 * PDF, or one priced on its own. Each bathroom's plan as its Sketch tab
 * draws it, each option pictured in 3D.
 */
export async function exportBathroomsPdfWith3D(open: BathroomEstimate, estimateIds: string[], opts: {
  show_breakdown_prices: boolean;
  show_signature: boolean;
  /** The open estimate's plan, captured from its Sketch tab */
  sketchImage?: string;
  suffix?: string;
}) {
  const estimates = await Promise.all(estimateIds.map((id) =>
    id === open.id ? Promise.resolve(open) : bathroomEstimateService.getById(id)));
  const options = estimates.filter((e) => e.kind === 'option');
  const renders = options.length ? await snapshots(options, { width: 1400, height: 820 }) : {};
  // Every bathroom's plan as its Sketch tab draws it; the open one's live
  // picture only when its saved sketch can't be drawn
  const plans = await planImages(estimates);
  if (opts.sketchImage && estimateIds.includes(open.id) && !plans[open.id]) plans[open.id] = opts.sketchImage;
  await bathroomEstimateService.exportBathroomsPdf(open.id, {
    estimate_ids: estimateIds,
    show_breakdown_prices: opts.show_breakdown_prices,
    show_signature: opts.show_signature,
    sketch_images: plans,
    renders,
    address: open.property_address,
    suffix: opts.suffix,
  });
}

/** The customer proposal for the job of `estimateId`, each estimate pictured in 3D. */
export async function exportProposalWith3D(estimateId: string, address?: string) {
  const group = await bathroomEstimateService.getGroup(estimateId);
  const priced = group.members.filter((m) => m.kind === 'restore' || m.kind === 'option');
  const renders = await snapshots(priced, { width: 900, height: 600 });
  await bathroomEstimateService.exportProposalPdf(estimateId, { address, renders });
}
