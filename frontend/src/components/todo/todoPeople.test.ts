import { describe, expect, it } from 'vitest';

import { addedText, assignedTo, assigneeOptions, isMine, sharedWith } from './todoPeople';

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

describe('assigneeOptions', () => {
  it('puts the viewer first as You, then everyone by name', () => {
    const people = [{ id: 'sam', name: 'Sam Lee' }, { id: 'me', name: 'Minjee Song' }, { id: 'alex', name: 'Alex Kim' }];
    expect(assigneeOptions(people, 'me')).toEqual([
      { value: 'me', label: 'You' },
      { value: 'alex', label: 'Alex Kim' },
      { value: 'sam', label: 'Sam Lee' },
    ]);
  });

  it('keeps the viewer pickable before the list has loaded', () => {
    expect(assigneeOptions([], 'me', ['me'])).toEqual([{ value: 'me', label: 'You' }]);
  });
});

describe('isMine and addedText', () => {
  it('knows a todo only for others is not on the viewer\u2019s board', () => {
    expect(isMine({ assignees: [alex] }, 'me')).toBe(false);
    expect(isMine({ assignees: [alex, me] }, 'me')).toBe(true);
    expect(isMine({ owner_id: 'me' }, 'me')).toBe(true);
  });

  it('says who else a new todo went to', () => {
    expect(addedText({ assignees: [me] }, 'me')).toBe('Todo added');
    expect(addedText({ assignees: [alex] }, 'me')).toBe('Todo added for Alex Kim');
    expect(addedText({ assignees: [me, alex] }, 'me')).toBe('Todo added for you and Alex Kim');
    expect(addedText({ assignees: [me, alex, sam] }, 'me')).toBe('Todo added for you, Alex Kim and Sam Lee');
    expect(addedText({ assignees: [alex, sam] }, 'me')).toBe('Todo added for Alex Kim and Sam Lee');
  });
});
