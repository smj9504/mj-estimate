import { test, expect as baseExpect, Page, Route } from '@playwright/test';
import { ALL_SCREEN_KEYS } from '../src/constants/screens';

// Pages are lazy chunks; on the dev server the first load of each can be slow
const expect = baseExpect.configure({ timeout: 20_000 });

// Admins reset someone's password from User Management, and each person
// changes their own from their profile with a code emailed to them.
//
// The API is mocked in the browser, so this needs only the dev server and
// checks what the screens send and show. The server side (codes, expiry,
// attempts, who may reset) is covered by
// backend/tests/test_password_management.py.

const ADMIN = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'boss',
  email: 'boss@example.com',
  first_name: 'Pat',
  last_name: 'Boss',
  full_name: 'Pat Boss',
  role: 'admin',
  staff_number: 'A1',
  is_active: true,
  can_login: true,
  email_verified: true,
  created_at: '2026-01-01T00:00:00',
  screen_access: null,
};

const JANE = {
  ...ADMIN,
  id: '22222222-2222-2222-2222-222222222222',
  username: 'jane',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Tech',
  full_name: 'Jane Tech',
  role: 'technician',
  staff_number: 'T1',
};

// Made-up passwords, built at run time so secret scanners don't flag test data
const fakePassword = (label: string) => `${label}-${Math.random().toString(36).slice(2, 10)}`;
const TEMPORARY = fakePassword('temp');
const ADMIN_CHOSEN = fakePassword('chosen');
const NEW_PASSWORD = fakePassword('new');
const WRONG_PASSWORD = fakePassword('wrong');
const TOO_SHORT = 'x'.repeat(7);

type Handler = (route: Route) => Promise<void> | void;

/**
 * Open a page signed in as this person, with every /api request answered
 * here: by `handlers` keyed "METHOD /path", otherwise an empty list.
 */
async function signedInPage(page: Page, user: typeof ADMIN, handlers: Record<string, Handler>) {
  await page.addInitScript(stored => {
    localStorage.setItem('auth_token', 'e2e-token');
    localStorage.setItem('auth_user', stored);
  }, JSON.stringify(user));

  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const handler = handlers[`${route.request().method()} ${pathname}`];
    if (handler) return handler(route);
    if (pathname === '/api/auth/me') {
      return route.fulfill({ json: { ...user, screens: ALL_SCREEN_KEYS } });
    }
    return route.fulfill({ json: [] });
  });
}

test.describe('Admin resets a password', () => {
  let resetBodies: unknown[];

  test.beforeEach(async ({ page }) => {
    resetBodies = [];
    await signedInPage(page, ADMIN, {
      'GET /api/auth/staff': route => route.fulfill({
        json: [ADMIN, { ...JANE, must_change_password: resetBodies.length > 0 }],
      }),
      'GET /api/auth/screen-access': route =>
        route.fulfill({ json: { screens: ALL_SCREEN_KEYS, role_defaults: {} } }),
      [`POST /api/auth/staff/${JANE.id}/reset-password`]: route => {
        const body = route.request().postDataJSON();
        resetBodies.push(body);
        return route.fulfill({ json: { password: body.new_password ?? TEMPORARY } });
      },
    });
    await page.goto('/admin/users');
  });

  test('a made-up temporary password is shown once to pass on', async ({ page }) => {
    const janeRow = page.getByRole('row').filter({ hasText: 'jane@example.com' });
    await expect(janeRow.getByText('Temporary password')).toBeHidden();

    await page.getByRole('button', { name: 'Reset password for jane' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset password for Jane Tech' });
    await expect(dialog.getByText("they're signed out everywhere", { exact: false })).toBeVisible();

    await dialog.getByRole('button', { name: 'Reset password' }).click();

    await expect(dialog.getByTestId('new-password')).toHaveText(TEMPORARY);
    expect(resetBodies).toEqual([{}]);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(janeRow.getByText('Temporary password')).toBeVisible();
  });

  test('admins cannot reset their own password here', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Reset password for boss' })).toBeDisabled();
  });

  test('the admin can type the password instead', async ({ page }) => {
    await page.getByRole('button', { name: 'Reset password for jane' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset password for Jane Tech' });

    await dialog.getByText('Set the password myself').click();
    const password = dialog.getByLabel('New password');
    await password.fill(TOO_SHORT);
    await dialog.getByRole('button', { name: 'Reset password' }).click();
    await expect(dialog.getByText('Use at least 8 characters')).toBeVisible();
    expect(resetBodies).toEqual([]);

    await password.fill(ADMIN_CHOSEN);
    await dialog.getByRole('button', { name: 'Reset password' }).click();

    await expect(dialog.getByTestId('new-password')).toHaveText(ADMIN_CHOSEN);
    expect(resetBodies).toEqual([{ new_password: ADMIN_CHOSEN }]);
  });
});

test.describe('Changing your own password', () => {
  let changeBodies: unknown[];
  let codeRequests: number;
  let profileUpdates: unknown[];

  test.beforeEach(async ({ page }) => {
    changeBodies = [];
    codeRequests = 0;
    profileUpdates = [];
    await signedInPage(page, JANE, {
      'POST /api/auth/me/change-password/code': route => {
        codeRequests += 1;
        return route.fulfill({ json: { sent_to: 'j***@example.com', expires_in_minutes: 10 } });
      },
      'POST /api/auth/me/change-password': route => {
        const body = route.request().postDataJSON();
        changeBodies.push(body);
        if (body.code !== '482913') {
          return route.fulfill({
            status: 400,
            json: { detail: 'That code is wrong or has expired. Send a new code and try again.' },
          });
        }
        return route.fulfill({
          json: { message: 'Password changed successfully', access_token: 'token-after-change' },
        });
      },
      'PUT /api/auth/me': route => {
        const body = route.request().postDataJSON();
        profileUpdates.push(body);
        return route.fulfill({ json: { ...JANE, ...body } });
      },
    });
    await page.goto('/profile');
  });

  test('a code emailed to you confirms the change', async ({ page }) => {
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await expect(dialog.getByText('jane@example.com')).toBeVisible();

    await dialog.getByRole('button', { name: 'Send code' }).click();
    await expect(dialog.getByText('j***@example.com')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
    expect(codeRequests).toBe(1);

    await dialog.getByLabel('Code from the email').fill('111111');
    await dialog.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await dialog.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(dialog.getByText('That code is wrong or has expired.', { exact: false })).toBeVisible();

    await dialog.getByLabel('Code from the email').fill('482913');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    await expect(page.getByText('Password changed. Other devices are signed out.')).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(changeBodies).toEqual([
      { code: '111111', new_password: NEW_PASSWORD },
      { code: '482913', new_password: NEW_PASSWORD },
    ]);
    // The change signed out every session; this tab carries on with the new token
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBe('token-after-change');
  });

  test('the form checks the code and passwords before sending', async ({ page }) => {
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await dialog.getByRole('button', { name: 'Send code' }).click();

    await dialog.getByLabel('Code from the email').fill('12ab');
    await dialog.getByLabel('New password', { exact: true }).fill(TOO_SHORT);
    await dialog.getByLabel('Confirm new password').fill('different');
    await dialog.getByRole('button', { name: 'Change password' }).click();

    await expect(dialog.getByText('The code is 6 digits')).toBeVisible();
    await expect(dialog.getByText('Use at least 8 characters')).toBeVisible();
    await expect(dialog.getByText("The passwords don't match")).toBeVisible();
    expect(changeBodies).toEqual([]);
  });

  test('your email is read-only and not sent with profile changes', async ({ page }) => {
    const email = page.getByLabel('Email');
    await expect(email).toHaveValue('jane@example.com');
    await expect(email).toBeDisabled();

    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(() => profileUpdates.length).toBe(1);
    expect(profileUpdates[0]).not.toHaveProperty('email');
  });
});

test.describe('After an admin reset', () => {
  let temporaryChanges: unknown[];

  test.beforeEach(async ({ page }) => {
    temporaryChanges = [];
    await signedInPage(page, { ...JANE, must_change_password: true } as typeof JANE, {
      'POST /api/auth/me/change-temporary-password': route => {
        const body = route.request().postDataJSON();
        temporaryChanges.push(body);
        if (body.current_password !== TEMPORARY) {
          return route.fulfill({ status: 400, json: { detail: 'The temporary password is incorrect' } });
        }
        return route.fulfill({
          json: { message: 'Password changed successfully', access_token: 'token-after-change' },
        });
      },
    });
  });

  test('the person chooses their own password before anything else', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeHidden();

    await page.getByLabel('Temporary password').fill(WRONG_PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('The temporary password is incorrect')).toBeVisible();

    await page.getByLabel('Temporary password').fill(TEMPORARY);
    await page.getByRole('button', { name: 'Save password' }).click();

    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    expect(temporaryChanges).toEqual([
      { current_password: WRONG_PASSWORD, new_password: NEW_PASSWORD },
      { current_password: TEMPORARY, new_password: NEW_PASSWORD },
    ]);
    const stored = await page.evaluate(() => ({
      token: localStorage.getItem('auth_token'),
      user: JSON.parse(localStorage.getItem('auth_user') || '{}'),
    }));
    expect(stored.token).toBe('token-after-change');
    expect(stored.user.must_change_password).toBe(false);
  });

  test('they can sign out instead', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
