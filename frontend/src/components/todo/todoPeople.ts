/**
 * Who a todo is assigned to, as the person looking at it reads it. A todo can
 * be assigned to several people; it is one todo, on each of their boards.
 */

import type { Todo } from '../../types/client';

type People = Pick<Todo, 'assignees' | 'owner_id' | 'owner_name'>;

/**
 * Everyone it's assigned to, the viewer first as "You", for the client page.
 * A todo that is only the viewer's says nothing, as before todos were shared.
 */
export const assignedTo = (todo: People, meId?: string | null): string | null => {
  const people = todo.assignees ?? [];
  if (people.length === 0) {
    // From before assignees: whoever's board it's on, unless that's the viewer
    return todo.owner_name && todo.owner_id !== meId ? todo.owner_name : null;
  }
  if (people.length === 1 && people[0].id === meId) return null;
  return [...people]
    .sort((a, b) => Number(b.id === meId) - Number(a.id === meId))
    .map(person => (person.id === meId ? 'You' : person.name || 'Someone'))
    .join(', ');
};

/** The others a todo on the viewer's board is shared with, if any */
export const sharedWith = (todo: People, meId?: string | null): string | null => {
  const people = todo.assignees ?? [];
  const others = people.filter(person => person.id !== meId);
  if (others.length === 0 || others.length === people.length) return null;
  return others.map(person => person.name || 'Someone').join(', ');
};

/**
 * People to pick a todo's assignees from: the viewer first as "You", then by
 * name. Anyone already picked stays listed, even before the list has loaded.
 */
export const assigneeOptions = (
  people: { id: string; name: string }[],
  meId: string | null | undefined,
  picked: string[] = [],
): { value: string; label: string }[] => {
  const known = new Set(people.map(person => person.id));
  const all = [
    ...people,
    ...picked.filter(id => !known.has(id)).map(id => ({ id, name: id === meId ? 'You' : 'Someone' })),
  ];
  return all
    .map(person => ({ value: person.id, label: person.id === meId ? 'You' : person.name }))
    .sort((a, b) => Number(b.value === meId) - Number(a.value === meId) || a.label.localeCompare(b.label));
};

/** Whether a todo is on the viewer's board */
export const isMine = (todo: People, meId?: string | null): boolean => {
  const people = todo.assignees ?? [];
  return people.length > 0 ? people.some(person => person.id === meId) : todo.owner_id === meId;
};

/** What adding a todo says: who else it went to, when it went to anyone else */
export const addedText = (todo: People, meId?: string | null): string => {
  const others = (todo.assignees ?? []).filter(person => person.id !== meId);
  if (others.length === 0) return 'Todo added';
  const names = [
    ...(isMine(todo, meId) ? ['you'] : []),
    ...others.map(person => person.name || 'Someone'),
  ];
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Todo added for ${list}`;
};
