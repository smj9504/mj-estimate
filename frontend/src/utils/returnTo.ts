/**
 * Where a page's Back goes when another page opened it. The opener puts its
 * own address in the navigation state (a client page's address carries its
 * tab and open claim), and the page's Back or Cancel returns there instead of
 * to the page's own list. Opened any other way, Back goes to the list.
 */
import { useLocation } from 'react-router-dom';

export interface ReturnState {
  returnTo?: string;
}

/** Navigation state that brings Back to the page at this location */
export const returnHere = (location: { pathname: string; search: string }): ReturnState => ({
  returnTo: `${location.pathname}${location.search}`,
});

/** The in-app address this page was opened from, if its opener left one */
export const returnToOf = (state: unknown): string | undefined => {
  const returnTo = (state as ReturnState | null)?.returnTo;
  return typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : undefined;
};

export const useReturnTo = (): string | undefined => returnToOf(useLocation().state);
