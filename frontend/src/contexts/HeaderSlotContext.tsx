import { createContext, useContext } from 'react';

/**
 * The element in the app header's left side that a page can portal its own
 * title bar into, so the title sits on the same row as Search.
 * Null on phones (no room in the header) — pages then render the title inline.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export const useHeaderSlot = () => useContext(HeaderSlotContext);
