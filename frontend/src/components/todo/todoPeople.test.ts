import { describe, expect, it } from 'vitest';

import { assignedTo, sharedWith } from './todoPeople';

const me = { id: 'me', name: 'Minjee Song' };
const alex = { id: 'alex', name: 'Alex Kim' };
const sam = { id: 'sam', name: 'Sam Lee' };

describe('assignedTo', () => {
  it('names everyone on a shared todo, the viewer first as You', () => {
    expect(assignedTo({ assignees: [alex, me, sam] }, 'me')).toBe('You, Alex Kim, Sam Lee');
    expect(assignedTo({ assignees: [alex, sam] }, 'me')).toBe('Alex Kim, Sam Lee');
  });

  it('says nothing for a todo that is only the viewer’s', () => {
    expect(assignedTo({ assignees: [me] }, 'me')).toBeNull();
  });

  it('falls back to the owner for a todo listed without assignees', () => {
    expect(assignedTo({ owner_id: 'alex', owner_name: 'Alex Kim' }, 'me')).toBe('Alex Kim');
    expect(assignedTo({ owner_id: 'me', owner_name: 'Minjee Song' }, 'me')).toBeNull();
    expect(assignedTo({}, 'me')).toBeNull();
  });
});

describe('sharedWith', () => {
  it('names the others on a todo the viewer shares', () => {
    expect(sharedWith({ assignees: [me, alex, sam] }, 'me')).toBe('Alex Kim, Sam Lee');
  });

  it('is nothing for a todo of the viewer’s own, or one they are not on', () => {
    expect(sharedWith({ assignees: [me] }, 'me')).toBeNull();
    expect(sharedWith({ assignees: [alex] }, 'me')).toBeNull();
    expect(sharedWith({}, 'me')).toBeNull();
  });
});
