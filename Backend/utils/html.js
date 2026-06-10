/**
 * @file utils/html.js
 * @description Convert an HTML fragment to readable plain text (preserving line
 * breaks for block elements + list bullets, decoding common entities). Scraped
 * descriptions are sometimes HTML; this gives clean text for display and sync.
 */

/**
 * @param {unknown} input
 * @returns {string}
 */
export function htmlToText(input) {
  if (input == null) return '';
  let s = String(input);
  // Fast path: nothing to decode.
  if (!/[<&]/.test(s)) return s.trim();

  // Drop non-content elements entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // Block boundaries → newlines; list items → bullets.
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol|section|article|table)\s*>/gi, '\n');
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return '';
      }
    });
  // Tidy whitespace.
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export default { htmlToText };
