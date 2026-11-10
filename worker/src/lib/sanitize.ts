// worker/src/lib/sanitize.ts
// Nettoyage du HTML de l'éditeur riche (actus, bulletin). Chaque balise est RECONSTRUITE à
// partir d'une liste blanche, jamais conservée telle quelle : avant le 2026-11-10, les balises
// autorisées gardaient leurs attributs (`<b onmouseover=…>`, `<span/onclick=…>` passaient) —
// faille devenue sérieuse dès que les responsables d'association ont pu publier (lot 2), et
// avant d'exposer ce HTML sur une page publique (/lire/<id>). Un « < » qui n'ouvre pas une
// balise complète est échappé : sinon `<img src=x onerror=…` sans « > » final reprendrait vie
// une fois collé devant d'autre HTML.
const BALISES_SANS_ATTRIBUT = ['b', 'i', 'u', 's', 'br', 'p'];
const PROPRIETES_STYLE_OK = ['color', 'text-transform', 'text-decoration', 'background-color'];

function reconstruireBalise(balise: string): string {
  const m = balise.match(/^<(\/?)([a-z]+)([^>]*)>$/i);
  if (!m) return '';
  const [, fermante, nomBrut, attrs] = m;
  const nom = nomBrut.toLowerCase();
  if (![...BALISES_SANS_ATTRIBUT, 'a', 'span'].includes(nom)) return '';
  if (fermante) return nom === 'br' ? '' : `</${nom}>`;
  if (BALISES_SANS_ATTRIBUT.includes(nom)) return `<${nom}>`;

  if (nom === 'a') {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
    if (!/^https?:\/\//i.test(href)) return '<a>';
    return `<a href="${href.replace(/</g, '%3C')}" target="_blank" rel="noopener noreferrer">`;
  }

  const style = attrs.match(/style\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!style) return '<span>';
  const declarations = style.split(';').filter((decl) => {
    const prop = decl.split(':')[0]?.trim().toLowerCase();
    return PROPRIETES_STYLE_OK.includes(prop) && !/[<>]/.test(decl); // rgb(…) de l'éditeur reste permis
  });
  return declarations.length ? `<span style="${declarations.join(';')}">` : '<span>';
}

export function sanitizeHtml(html: string): string {
  return html.replace(/<[^>]*>|</g, (balise) => (balise === '<' ? '&lt;' : reconstruireBalise(balise)));
}
