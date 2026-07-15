/**
 * Vercel Serverless Function for link preview OG meta tags.
 *
 * Only receives bot/crawler requests (filtered by vercel.json rewrite rules).
 * Fetches contract info from backend and returns HTML with OG meta tags
 * so link previews in Kakao, iMessage, Slack, etc. show:
 *   Title: "Certificate of Completion - Enter Construction"
 *   Description: "Certificate Of Completion | Prepared for: Jai Lee | ..."
 */

const BACKEND_URL = 'https://mjestimate-backend.onrender.com';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  const { token } = req.query;

  let title = 'Document Signing';
  let description = 'Please review and sign this document.';
  let companyName = '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BACKEND_URL}/api/sign/${token}`, {
      headers: { 'User-Agent': 'SimpleWorks-OG/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const docTitle = data.title || data.template_name || 'Document';
      companyName = data.company_name || '';
      const clientName = data.client_name || '';
      const docType = (data.document_type || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

      title = companyName ? `${docTitle} - ${companyName}` : docTitle;

      const parts = [];
      if (docType) parts.push(docType);
      if (clientName) parts.push(`Prepared for: ${clientName}`);
      parts.push('Please review and sign this document.');
      description = parts.join(' | ');
    }
  } catch (_) {
    // Use defaults on error
  }

  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeCompany = escapeHtml(companyName);
  const host = req.headers.host || 'simple-works.vercel.app';
  const pageUrl = `https://${host}/sign/${token}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${pageUrl}" />
  ${safeCompany ? `<meta property="og:site_name" content="${safeCompany}" />` : ''}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
</head>
<body>
  <p><a href="/sign/${token}">Open document</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.status(200).send(html);
};
