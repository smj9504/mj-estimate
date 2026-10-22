import { test, expect as baseExpect, Page, Locator, Browser, BrowserContext } from '@playwright/test';
import { SCREEN_GROUPS, ALL_SCREEN_KEYS } from '../src/constants/screens';

// Pages are lazy chunks; on the dev server the first load of each can be slow
const expect = baseExpect.configure({ timeout: 20_000 });

// Screen access: admins pick which sidebar screens each role sees, and can
// give one person their own list. The sidebar, mobile nav and direct URLs
// all follow it.
//
// The tests create two staff accounts and change the Technician and Sales
// role defaults; afterAll puts the role defaults back and deactivates the
// accounts. Point them at a throwaway database where you can:
//   E2E_API_URL  backend for both the test's own calls and the page's /api
//                requests (which then skip the dev server proxy). Without it,
//                the page uses the dev server proxy and the test calls
//                http://localhost:8000, so both must reach the same backend.

const API = process.env.E2E_API_URL || 'http://localhost:8000';
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'admin123';

const LABEL: Record<string, string> = Object.fromEntries(
  SCREEN_GROUPS.flatMap(g => g.screens.map(s => [s.key, s.label])),
);

interface Session {
  token: string;
  user: { id: string; username: string; [key: string]: unknown };
}

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function apiLogin(username: string, password: string): Promise<Session> {
  const data = await api(null, 'POST', '/api/auth/login', { username, password });
  return { token: data.access_token, user: data.user };
}

const openContexts: BrowserContext[] = [];

async function newContext(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...(viewport ? { viewport } : {}) });
  openContexts.push(context);
  if (process.env.E2E_API_URL) {
    // Send the page's API calls to the same backend the test talks to
    await context.route(
      url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/'),
      async route => {
        const { pathname, search } = new URL(route.request().url());
        const response = await route.fetch({ url: `${API}${pathname}${search}` });
        await route.fulfill({ response });
      },
    );
  }
  return context;
}

/**
 * Open a page already signed in as this person. The stored user carries no
 * screen list, so what the sidebar shows has to come from /api/auth/me.
 */
async function pageAs(browser: Browser, session: Session, viewport?: { width: number; height: number }) {
  const context = await newContext(browser, viewport);
  const { screens, screen_access, ...storedUser } = session.user;
  await context.addInitScript(([token, user]) => {
    localStorage.setItem('auth_token', token as string);
    localStorage.setItem('auth_user', user as string);
  }, [session.token, JSON.stringify(storedUser)]);
  return context.newPage();
}

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map(async context => {
    // Dashboard polling may still be mid-request
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }));
});

/** Group titles and item labels in the sidebar, with every group opened. */
async function readSidebar(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible();
  const submenus = nav.locator('li.ant-menu-submenu');
  const count = await submenus.count();
  for (let i = 0; i < count; i++) {
    const submenu = submenus.nth(i);
    if (!(await submenu.evaluate(el => el.classList.contains('ant-menu-submenu-open')))) {
      await submenu.locator('.ant-menu-submenu-title').first().click();
    }
  }
  await expect(nav.locator('li.ant-menu-submenu-open')).toHaveCount(count);
  return {
    groups: await nav.locator('.ant-menu-submenu-title .ant-menu-title-content').allInnerTexts(),
    items: await nav.locator('li.ant-menu-item .ant-menu-title-content').allInnerTexts(),
  };
}

/** Tick exactly these screens in a ScreenChecklist. */
async function chooseScreens(scope: Locator, keys: string[]) {
  for (const key of ALL_SCREEN_KEYS) {
    await scope.getByRole('checkbox', { name: LABEL[key], exact: true }).setChecked(keys.includes(key));
  }
}

async function openEditUser(page: Page, username: string) {
  await page.goto('/admin/users');
  await page.getByRole('row').filter({ hasText: username }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit User' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.configure({ mode: 'serial' });

test.describe('Screen access', () => {
  const stamp = Date.now();
  const TECH_DEFAULTS = ['clients', 'supplements', 'invoices'];

  let admin: Session;
  let tech: Session; // role technician
  let sales: Session; // role sales
  const salesPassword = `Sales-${stamp}!`;
  let originalDefaults: Record<string, string[]>;

  test.beforeAll(async () => {
    await fetch(`${API}/api/auth/init-admin`, { method: 'POST' });
    admin = await apiLogin(ADMIN_USER, ADMIN_PASSWORD);

    const settings = await api(admin.token, 'GET', '/api/auth/screen-access');
    expect(settings.screens).toEqual(ALL_SCREEN_KEYS); // frontend and backend lists agree
    originalDefaults = settings.role_defaults;

    const register = (role: string, password: string) => api(admin.token, 'POST', '/api/auth/register', {
      username: `e2e-${role}-${stamp}`,
      email: `e2e-${role}-${stamp}@example.com`,
      password,
      first_name: 'E2E',
      last_name: role,
      staff_number: `E2E-${role}-${stamp}`,
      role,
      hire_date: new Date().toISOString(),
    });
    const techUser = await register('technician', `Tech-${stamp}!`);
    const salesUser = await register('sales', salesPassword);

    await api(admin.token, 'PUT', '/api/auth/screen-access/roles/technician', { screens: TECH_DEFAULTS });

    tech = await apiLogin(techUser.username, `Tech-${stamp}!`);
    sales = await apiLogin(salesUser.username, salesPassword);
  });

  test.afterAll(async () => {
    if (!admin) return;
    for (const role of ['technician', 'sales']) {
      if (originalDefaults?.[role]) {
        await api(admin.token, 'PUT', `/api/auth/screen-access/roles/${role}`, { screens: originalDefaults[role] });
      }
    }
    for (const session of [tech, sales]) {
      if (session) await api(admin.token, 'PUT', `/api/auth/staff/${session.user.id}`, { is_active: false });
    }
  });

  test('role defaults decide which screens are in the sidebar', async ({ browser }) => {
    const page = await pageAs(browser, tech);
    await page.goto('/todos');

    const { groups, items } = await readSidebar(page);
    expect(groups).toEqual(['Jobs & Claims', 'Documents']);
    expect(items).toEqual(['Todos', 'Clients', 'Supplements', 'Invoices']);
  });

  test('a screen left out cannot be opened by URL, detail pages included', async ({ browser }) => {
    const page = await pageAs(browser, tech);

    for (const blocked of ['/roofing-estimates', '/edit/estimate/123', '/water-mitigation/templates']) {
      await page.goto(blocked);
      await expect(page).toHaveURL(/\/unauthorized$/);
      await expect(page.getByText('Access Denied')).toBeVisible();
    }

    await page.goto('/clients/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page).toHaveURL(/\/clients\//);

    // Home opens the todo board, which every screen list includes
    await page.goto('/');
    await expect(page).toHaveURL(/\/todos$/);
  });

  test('mobile bottom nav hides shortcuts to screens left out', async ({ browser }) => {
    const page = await pageAs(browser, tech, { width: 390, height: 844 });
    await page.goto('/todos');

    const bottomNav = page.getByRole('navigation', { name: 'Quick navigation' });
    await expect(bottomNav.getByRole('button', { name: 'Todos' })).toBeVisible();
    await expect(bottomNav.getByRole('button', { name: 'New todo' })).toBeVisible();
    await expect(bottomNav.getByRole('button', { name: 'Open menu' })).toBeVisible();
    await expect(bottomNav.getByRole('button', { name: 'Claims' })).toHaveCount(0);
    await expect(bottomNav.getByRole('button', { name: 'Estimates' })).toHaveCount(0);
  });

  test('people cannot widen their own screen list', async () => {
    await api(tech.token, 'PUT', '/api/auth/me', { screen_access: ALL_SCREEN_KEYS });
    const me = await api(tech.token, 'GET', '/api/auth/me');
    expect(me.screen_access).toBeNull();
    expect(me.screens).toEqual(TECH_DEFAULTS);

    await expect(
      api(tech.token, 'PUT', '/api/auth/screen-access/roles/technician', { screens: ALL_SCREEN_KEYS }),
    ).rejects.toThrow(/403/);
  });

  test('an admin gives one person their own screens', async ({ browser }) => {
    const adminPage = await pageAs(browser, admin);
    const dialog = await openEditUser(adminPage, tech.user.username);

    await dialog.getByRole('radio', { name: 'Choose screens for this person' }).check();
    // The list starts from what the role gives them
    for (const key of TECH_DEFAULTS) {
      await expect(dialog.getByRole('checkbox', { name: LABEL[key], exact: true })).toBeChecked();
    }
    await chooseScreens(dialog, ['work_orders', 'estimates']);
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(adminPage.getByText('User updated successfully')).toBeVisible();
    await expect(
      adminPage.getByRole('row').filter({ hasText: tech.user.username }).getByText(`Custom · 2/${ALL_SCREEN_KEYS.length}`),
    ).toBeVisible();

    const staff = await api(admin.token, 'GET', '/api/auth/staff');
    expect(staff.find((s: any) => s.id === tech.user.id).screen_access).toEqual(['work_orders', 'estimates']);

    const techPage = await pageAs(browser, tech);
    await techPage.goto('/todos');
    const { groups, items } = await readSidebar(techPage);
    // Work Orders is hidden from the menu for now, so its group drops out
    expect(groups).toEqual(['Documents']);
    expect(items).toEqual(['Todos', 'Estimates']);
  });

  test('"Same as role" puts the person back on the role defaults', async ({ browser }) => {
    const adminPage = await pageAs(browser, admin);
    const dialog = await openEditUser(adminPage, tech.user.username);

    await expect(dialog.getByRole('radio', { name: 'Choose screens for this person' })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Same as role (Technician)' }).check();
    // The role's screens are shown but can't be edited here
    await expect(dialog.getByRole('checkbox', { name: 'Clients', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Clients', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(adminPage.getByText('User updated successfully')).toBeVisible();

    const me = await api(tech.token, 'GET', '/api/auth/me');
    expect(me.screen_access).toBeNull();
    expect(me.screens).toEqual(TECH_DEFAULTS);

    const techPage = await pageAs(browser, tech);
    await techPage.goto('/todos');
    expect((await readSidebar(techPage)).items).toEqual(['Todos', 'Clients', 'Supplements', 'Invoices']);
  });

  test('an admin sets a role\'s screens on the "Screens by role" tab', async ({ browser }) => {
    const adminPage = await pageAs(browser, admin);
    await adminPage.goto('/admin/users');
    await adminPage.getByRole('tab', { name: 'Screens by role' }).click();
    const panel = adminPage.getByRole('tabpanel', { name: 'Screens by role' });

    await panel.locator('.ant-select').click();
    await adminPage.locator('.ant-select-item-option[title="Sales"]').click();
    await chooseScreens(panel, ['claims_lifecycle', 'clients', 'cheat_sheet']);
    await panel.getByRole('button', { name: 'Save Sales screens' }).click();
    await expect(adminPage.getByText('Sales screens saved')).toBeVisible();

    const settings = await api(admin.token, 'GET', '/api/auth/screen-access');
    expect(settings.role_defaults.sales).toEqual(['claims_lifecycle', 'clients', 'cheat_sheet']);
  });

  test('signing in with the login form shows only the role\'s screens', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto('/login');
    await page.fill('input#login_username', sales.user.username);
    await page.fill('input#login_password', salesPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/todos$/);

    const { groups, items } = await readSidebar(page);
    expect(groups).toEqual(['Jobs & Claims', 'Tools & Data']);
    expect(items).toEqual(['Todos', 'Claims Dashboard', 'Clients', 'Cheat Sheet']);

    await page.goto('/');
    await expect(page).toHaveURL(/\/todos$/);
  });

  test('admins always see every screen', async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await page.goto('/todos');

    const { groups, items } = await readSidebar(page);
    expect(groups).toEqual(['Jobs & Claims', 'Estimates', 'Documents', 'Tools & Data', 'Admin']);
    // Work Orders is hidden from the menu for now
    for (const key of ALL_SCREEN_KEYS.filter(k => k !== 'work_orders')) {
      expect(items).toContain(LABEL[key]);
    }
    expect(items).not.toContain('Work Orders');
  });
});
