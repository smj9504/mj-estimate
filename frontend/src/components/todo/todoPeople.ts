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
