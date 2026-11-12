import DOMPurify from 'dompurify';

/**
 * HTML that is safe to put in the page with dangerouslySetInnerHTML or innerHTML.
 *
 * Received email (supplement replies, the claim timeline), sent email, line-item
 * notes and work-order text are stored as HTML that people outside the office can
 * write. Inserted raw, a `<img onerror>` or `javascript:` link in one of them runs
 * as the signed-in user and can read the login token from localStorage. DOMPurify
 * removes scripts, event handlers and script URLs and keeps the formatting
 * (tables, inline styles, links, images, `<style>` blocks).
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}

/**
 * A whole HTML document (html/head/body kept, so its `<style>` still applies)
 * with scripts and handlers removed, for writing into a window we open.
 */
export function sanitizeHtmlDocument(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true });
}
