import { test, expect as baseExpect, Browser, BrowserContext, Page } from '@playwright/test';

// Pages are lazy chunks; on the dev server the first load of each can be slow
const expect = baseExpect.configure({ timeout: 20_000 });

// Password resets and changes against a real backend: an admin reset signs
// the person out and makes them choose their own password, and a change with
// the emailed code signs out their other devices.
//
// The test creates a staff account and deactivates it in afterAll. Point it
// at a throwaway database, on a backend started with DEBUG=true and
// EMAIL_ENABLED=false so the code comes back in the response instead of by
// email:
//   E2E_API_URL         backend for both the test's own calls and the page's
//                       /api requests (which then skip the dev server proxy).
//   E2E_ADMIN_PASSWORD  that database's admin password (for one made by
//                       init-admin, see create_initial_admin). Skipped without.
//   E2E_ADMIN_USER      defaults to admin.

const API = process.env.E2E_API_URL || 'http://localhost:8000';
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

// Made-up passwords, built at run time so secret scanners don't flag test data
const fakePassword = (label: string) => `${label}-${Math.random().toString(36).slice(2, 10)}`;

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiLogin(username: string, password: string): Promise<Session> {
  const res = await api(null, 'POST', '/api/auth/login', { username, password });
  if (res.status !== 200) throw new Error(`login ${username} -> ${res.status}`);
  return { token: res.body.access_token, user: res.body.user };
}

/** Tokens record when they were issued to the second; a change signs out earlier ones */
const nextSecond = () => new Promise(resolve => setTimeout(resolve, 1100));

const openContexts: BrowserContext[] = [];

async function newPage(browser: Browser, session?: Session): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  openContexts.push(context);
  if (process.env.E2E_API_URL) {
    // Send the page's API calls to the same backend the test talks to
    await context.route(
      url => url.pathname.startsWith('/api/'),
      async route => {
        const { pathname, search } = new URL(route.request().url());
        const response = await route.fetch({ url: `${API}${pathname}${search}` });
        await route.fulfill({ response });
      },
    );
  }
  if (session) {
    // Only on the first load: after a sign-out the page must not get it back
    await context.addInitScript(([token, user]) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('auth_token', token as string);
      localStorage.setItem('auth_user', user as string);
    }, [session.token, JSON.stringify(session.user)]);
  }
  return context.newPage();
}

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map(async context => {
    // Dashboard polling may still be mid-request
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }));
});

test.describe.configure({ mode: 'serial' });

test.describe('Password sessions', () => {
  test.skip(!ADMIN_PASSWORD, 'Set E2E_ADMIN_PASSWORD to the throwaway database\'s admin password');

  const stamp = Date.now();
  const username = `e2e-pw-${stamp}`;
  let admin: Session;
  let staffId: string;
  let password = fakePassword('first');
  let signedIn: string; // their session token once they chose their own password

  test.beforeAll(async () => {
    await fetch(`${API}/api/auth/init-admin`, { method: 'POST' });
    admin = await apiLogin(ADMIN_USER, ADMIN_PASSWORD);
    const created = await api(admin.token, 'POST', '/api/auth/register', {
      username,
      email: `${username}@example.com`,
      password,
      first_name: 'E2E',
      last_name: 'Password',
      staff_number: `E2E-PW-${stamp}`,
      role: 'technician',
      hire_date: new Date().toISOString(),
    });
    expect(created.status).toBe(200);
    staffId = created.body.id;
  });

  test.afterAll(async () => {
    if (admin && staffId) await api(admin.token, 'PUT', `/api/auth/staff/${staffId}`, { is_active: false });
  });

  test('an admin reset signs the person out and they choose their own password', async ({ browser }) => {
    const before = await apiLogin(username, password);
    expect(before.user.must_change_password).toBe(false);
    const theirPage = await newPage(browser, before);
    await theirPage.goto('/profile');
    await expect(theirPage.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    await nextSecond();

    // The admin resets it from User Management
    const adminPage = await newPage(browser, admin);
    await adminPage.goto('/admin/users');
    await adminPage.getByRole('button', { name: `Reset password for ${username}` }).click();
    const dialog = adminPage.getByRole('dialog', { name: 'Reset password for E2E Password' });
    await dialog.getByRole('button', { name: 'Reset password' }).click();
    const temporary = (await dialog.getByTestId('new-password').innerText()).trim();
    expect(temporary).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(
      adminPage.getByRole('row').filter({ hasText: username }).getByText('Temporary password'),
    ).toBeVisible();

    // Their open session no longer works
    expect((await api(before.token, 'GET', '/api/auth/me')).status).toBe(401);
    await theirPage.reload();
    const expired = theirPage.getByRole('dialog').filter({ hasText: 'Session Expired' });
    await expired.getByRole('button', { name: 'Log In' }).click();
    await expect(theirPage).toHaveURL(/\/login/);

    // Signing in with the temporary password leads to choosing their own
    await theirPage.getByPlaceholder('Username or Email').fill(username);
    await theirPage.getByPlaceholder('Password').fill(temporary);
    await theirPage.getByRole('button', { name: 'Sign In' }).click();
    await expect(theirPage.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();

    password = fakePassword('second');
    await theirPage.getByLabel('Temporary password').fill(temporary);
    await theirPage.getByLabel('New password', { exact: true }).fill(password);
    await theirPage.getByLabel('Confirm new password').fill(password);
    await theirPage.getByRole('button', { name: 'Save password' }).click();
    await expect(theirPage.getByRole('heading', { name: 'Choose your own password' })).toBeHidden();

    await theirPage.goto('/profile');
    await expect(theirPage.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    expect((await api(null, 'POST', '/api/auth/login', { username, password: temporary })).status).toBe(401);
    signedIn = await theirPage.evaluate(() => localStorage.getItem('auth_token')) as string;
    expect((await api(signedIn, 'GET', '/api/auth/me')).body.must_change_password).toBe(false);
  });

  test('a change with the emailed code signs out the other devices', async ({ browser }) => {
    // The session from the test above plays the other device. Sign-ins are
    // limited to five a minute, so this file uses no more than that.
    const otherDevice = signedIn;
    const thisDevice = await apiLogin(username, password);
    await nextSecond();

    const page = await newPage(browser, thisDevice);
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await dialog.getByRole('button', { name: 'Send code' }).click();
    // Email is off on the test backend, so the dialog shows the code
    const code = (await dialog.locator('code').innerText()).trim();
    expect(code).toMatch(/^\d{6}$/);

    password = fakePassword('third');
    await dialog.getByLabel('Code from the email').fill(code);
    await dialog.getByLabel('New password', { exact: true }).fill(password);
    await dialog.getByLabel('Confirm new password').fill(password);
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed. Other devices are signed out.')).toBeVisible();

    const signedOut = await api(otherDevice, 'GET', '/api/auth/me');
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.detail).toBe('Your password was changed. Sign in again.');
    expect((await api(thisDevice.token, 'GET', '/api/auth/me')).status).toBe(401);

    // This tab carries on with the token it was handed
    await page.reload();
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    await expect(page).toHaveURL(/\/profile/);
    const handedBack = await page.evaluate(() => localStorage.getItem('auth_token'));
    expect(handedBack).not.toBe(thisDevice.token);
    expect((await api(handedBack, 'GET', '/api/auth/me')).status).toBe(200);
  });
});
