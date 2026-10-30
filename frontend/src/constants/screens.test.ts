import { describe, expect, it } from 'vitest';
import { HOME_CHOICES, HOME_TODOS, hasLimitedScreen, homePath, opensScreen, screenForPath } from './screens';

describe('opensScreen', () => {
  it('opens a screen that was granted', () => {
    expect(opensScreen(['water_mitigation'], 'water_mitigation')).toBe(true);
  });

  it('opens Water Mitigation pages for the View grant alone', () => {
    expect(opensScreen(['water_mitigation_view'], screenForPath('/water-mitigation/123')!)).toBe(true);
    expect(opensScreen(['water_mitigation_view'], screenForPath('/water-mitigation/123/edit')!)).toBe(true);
  });

  it('keeps the View grant out of the WM template and scope item screens', () => {
    expect(opensScreen(['water_mitigation_view'], screenForPath('/water-mitigation/templates')!)).toBe(false);
    expect(opensScreen(['water_mitigation_view'], screenForPath('/water-mitigation/standard-scope-items')!)).toBe(false);
  });

  it('does not open a screen that was not granted', () => {
    expect(opensScreen(['clients'], 'water_mitigation')).toBe(false);
  });
});

describe('hasLimitedScreen', () => {
  it('is true with only the View grant', () => {
    expect(hasLimitedScreen(['water_mitigation_view'], 'water_mitigation')).toBe(true);
  });

  it('is false when the full screen is granted too', () => {
    expect(hasLimitedScreen(['water_mitigation', 'water_mitigation_view'], 'water_mitigation')).toBe(false);
  });

  it('is false with neither grant or no screen list yet', () => {
    expect(hasLimitedScreen(['clients'], 'water_mitigation')).toBe(false);
    expect(hasLimitedScreen(undefined, 'water_mitigation')).toBe(false);
  });
});

describe('homePath', () => {
  const canOpenAll = () => true;

  it('is the todo board with nothing chosen', () => {
    expect(homePath(null, canOpenAll)).toBe('/todos');
    expect(homePath(undefined, canOpenAll)).toBe('/todos');
    expect(homePath(HOME_TODOS, canOpenAll)).toBe('/todos');
  });

  it('opens the chosen screen', () => {
    expect(homePath('onsite_signing', canOpenAll)).toBe('/onsite-signing');
    expect(homePath('claims_lifecycle', canOpenAll)).toBe('/claims-lifecycle');
  });

  it('falls back to the todo board when they can no longer open it', () => {
    expect(homePath('onsite_signing', path => path !== '/onsite-signing')).toBe('/todos');
  });

  it('falls back to the todo board for a screen that no longer exists', () => {
    expect(homePath('retired_screen', canOpenAll)).toBe('/todos');
  });

  it('does not offer a limited grant, which has no page of its own', () => {
    expect(HOME_CHOICES.map(c => c.key)).not.toContain('water_mitigation_view');
    expect(HOME_CHOICES[0].key).toBe(HOME_TODOS);
  });
});
