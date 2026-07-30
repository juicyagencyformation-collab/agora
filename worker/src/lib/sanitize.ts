// worker/src/lib/sanitize.ts
export function sanitizeHtml(html: string): string {
  let safe = html.replace(/<(?!\/?(?:b|i|u|s|br|span|a|p)\b)[^>]*>/gi, '');

  safe = safe.replace(/<a\s+([^>]*)>/gi, (_, attrs) => {
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch ? hrefMatch[1] : '#';
    if (!/^https?:\/\//i.test(href)) return '<a>';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
  });

  safe = safe.replace(/<span\s+([^>]*)>/gi, (_, attrs) => {
    const styleMatch = attrs.match(/style\s*=\s*["']([^"']+)["']/i);
    if (!styleMatch) return '<span>';
    const proprietesOk = styleMatch[1].split(';').filter((decl: string) => {
      const prop = decl.split(':')[0]?.trim().toLowerCase();
      return ['color', 'text-transform', 'text-decoration', 'background-color'].includes(prop);
    });
    return `<span style="${proprietesOk.join(';')}">`;
  });

  return safe;
}
