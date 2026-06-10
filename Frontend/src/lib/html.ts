/**
 * Convert an HTML fragment to readable plain text (block elements → line breaks,
 * list items → bullets, entities decoded). Scraped descriptions are sometimes
 * HTML; this renders clean text instead of raw tags. Mirrors Backend/utils/html.js.
 */
export function htmlToText(input: unknown): string {
  if (input == null) return '';
  let s = String(input);
  if (!/[<&]/.test(s)) return s.trim();

  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol|section|article|table)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
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
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
