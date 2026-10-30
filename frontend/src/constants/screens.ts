// Screens an admin can grant or withhold per role and per person.
// Keys must match SCREEN_KEYS in backend/app/domains/auth/screen_access.py.
//
// `paths` are route prefixes that belong to the screen, including its detail
// and create pages. A route that no screen claims (dashboard, profile, admin
// pages) is open to everyone who passes its role check.

export interface ScreenDef {
  key: string;
  label: string;
  paths: string[];
  // A lesser grant of another screen: it opens that screen's paths, and the
  // pages leave out what it doesn't cover
  limits?: string;
  hint?: string;
}

export interface ScreenGroup {
  label: string;
  screens: ScreenDef[];
}

export const SCREEN_GROUPS: ScreenGroup[] = [
  {
    label: 'Jobs & Claims',
    screens: [
      { key: 'onsite_signing', label: 'On-site Signing', paths: ['/onsite-signing'] },
      { key: 'claims_lifecycle', label: 'Claims Dashboard', paths: ['/claims-lifecycle'] },
      { key: 'claim_followup', label: 'Follow-up', paths: ['/claim-followup'] },
      { key: 'water_mitigation', label: 'Water Mitigation', paths: ['/water-mitigation'] },
      {
        key: 'water_mitigation_view',
        label: 'Water Mitigation (View)',
        paths: [],
        limits: 'water_mitigation',
        hint: 'Job details, photos, documents, trash',
      },
      { key: 'rebuild_projects', label: 'Rebuild Projects', paths: ['/rebuild-projects'] },
      { key: 'work_orders', label: 'Work Orders', paths: ['/work-orders', '/work-order', '/create/work-order'] },
      { key: 'clients', label: 'Clients', paths: ['/clients'] },
      { key: 'supplements', label: 'Supplements', paths: ['/supplements'] },
    ],
  },
  {
    label: 'Estimates',
    screens: [
      { key: 'pack_calculator', label: 'Pack Calculator', paths: ['/reconstruction-estimate/pack-calculator-new'] },
      { key: 'cabinet_estimates', label: 'Cabinet', paths: ['/cabinet-estimates'] },
      { key: 'bathroom_estimates', label: 'Bathroom', paths: ['/bathroom-estimates'] },
      { key: 'roofing_estimates', label: 'Roofing', paths: ['/roofing-estimates'] },
      { key: 'siding_estimates', label: 'Siding', paths: ['/siding-estimates'] },
      { key: 'material_prices', label: '자재 기본 단가', paths: ['/roofing/material-prices'] },
      { key: 'pricing_settings', label: '견적 계산 단가', paths: ['/roofing/pricing-settings'] },
    ],
  },
  {
    label: 'Documents',
    screens: [
      {
        key: 'estimates',
        label: 'Estimates',
        paths: ['/documents/estimate', '/create/estimate', '/create/insurance-estimate', '/edit/estimate', '/insurance-estimate'],
      },
      { key: 'invoices', label: 'Invoices', paths: ['/documents/invoice', '/create/invoice', '/invoices'] },
      { key: 'material_orders', label: 'Material Orders', paths: ['/material-orders', '/material-order'] },
      {
        key: 'plumber_reports',
        label: 'Plumber Reports',
        paths: ['/documents/plumber_report', '/create/plumber-report', '/plumber-reports'],
      },
      {
        key: 'electrician_reports',
        label: 'Electrician Reports',
        paths: ['/documents/electrician_report', '/create/electrician-report', '/electrician-reports'],
      },
      { key: 'contract_templates', label: 'Contract Templates', paths: ['/contract-templates'] },
      { key: 'repair_templates', label: 'Repair Templates', paths: ['/repair-templates'] },
      { key: 'repair_estimate', label: 'Repair Estimate', paths: ['/repair-estimate-wizard'] },
    ],
  },
  {
    label: 'Tools & Data',
    screens: [
      { key: 'line_items', label: 'Line Items', paths: ['/line-items'] },
      { key: 'insurance_extractions', label: 'Insurance Extraction', paths: ['/insurance-extractions'] },
      { key: 'material_detection', label: 'AI Material Detection', paths: ['/reconstruction-estimate/material-detection'] },
      { key: 'debris_calculator', label: 'Debris Calculator', paths: ['/reconstruction-estimate/debris'] },
      { key: 'cheat_sheet', label: 'Cheat Sheet', paths: ['/cheat-sheet'] },
      { key: 'wm_templates', label: 'WM Report Templates', paths: ['/water-mitigation/templates'] },
      {
        key: 'wm_scope_items',
        label: 'WM Scope Items',
        paths: ['/water-mitigation/standard-scope-items', '/water-mitigation/scope-item-categories'],
      },
      { key: 'photo_metadata', label: 'Photo Metadata', paths: ['/tools/photo-metadata'] },
      { key: 'room_dimensions', label: 'Room Dimensions', paths: ['/tools/room-dimensions'] },
      { key: 'pdf_editor', label: 'PDF Editor', paths: ['/pdf-editor'] },
      { key: 'email_ingestion', label: 'Email Ingestion', paths: ['/email-ingestion'] },
    ],
  },
];

export const ALL_SCREEN_KEYS: string[] = SCREEN_GROUPS.flatMap(g => g.screens.map(s => s.key));

// Longest prefix first, so /water-mitigation/templates is not read as /water-mitigation
const PATH_INDEX: { path: string; key: string }[] = SCREEN_GROUPS
  .flatMap(g => g.screens.flatMap(s => s.paths.map(path => ({ path, key: s.key }))))
  .sort((a, b) => b.path.length - a.path.length);

/** The screen a route belongs to, or null when no screen claims it. */
export function screenForPath(pathname: string): string | null {
  const match = PATH_INDEX.find(({ path }) => pathname === path || pathname.startsWith(`${path}/`));
  return match ? match.key : null;
}

const LIMITED_GRANTS: { key: string; limits: string }[] = SCREEN_GROUPS
  .flatMap(g => g.screens)
  .filter((s): s is ScreenDef & { limits: string } => !!s.limits)
  .map(({ key, limits }) => ({ key, limits }));

/** Whether a person given `granted` may open `screen`, in full or limited. */
export function opensScreen(granted: string[], screen: string): boolean {
  return granted.includes(screen)
    || LIMITED_GRANTS.some(g => g.limits === screen && granted.includes(g.key));
}

/** Given only the limited grant of `screen`, not the full one. */
export function hasLimitedScreen(granted: string[] | undefined, screen: string): boolean {
  if (!granted || granted.includes(screen)) return false;
  return LIMITED_GRANTS.some(g => g.limits === screen && granted.includes(g.key));
}

// ── What "/" opens ─────────────────────────────────

export const HOME_TODOS = 'todos';

export interface HomeChoice {
  key: string;
  label: string;
  path: string;
}

/** The todo board, then every screen with a page of its own. Keys match validate_home_screen on the backend. */
export const HOME_CHOICES: HomeChoice[] = [
  { key: HOME_TODOS, label: 'Todos', path: '/todos' },
  ...SCREEN_GROUPS.flatMap(g => g.screens)
    .filter(s => s.paths.length > 0)
    .map(s => ({ key: s.key, label: s.label, path: s.paths[0] })),
];

/** Where "/" takes this person; a screen they can no longer open falls back to the todo board */
export function homePath(homeScreen: string | null | undefined, canOpen: (path: string) => boolean): string {
  const choice = HOME_CHOICES.find(c => c.key === homeScreen);
  return choice && canOpen(choice.path) ? choice.path : '/todos';
}
