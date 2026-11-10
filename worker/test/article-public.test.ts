// worker/test/article-public.test.ts
// Page publique /lire/<id> (2026-11-10) : GET /decouverte/articles/:id ne doit JAMAIS renvoyer
// l'article d'un village — seulement ceux de la commune éditoriale 'plateforme-agora', visibles,
// de la section actualités. Plus le nettoyeur HTML durci le même jour (balises reconstruites,
// aucun attribut d'événement ne survit), dont dépend l'affichage sans script de cette page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import decouverte from '../src/routes/decouverte';
import { sanitizeHtml } from '../src/lib/sanitize';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

const filtrer = (table: Ligne[], p: URLSearchParams) => table.filter((l) => [...p.entries()].every(([k, v]) =>
  ['select', 'order', 'limit', 'offset'].includes(k) || (v.startsWith('eq.') ? String(l[k]) === v.slice(3) : true)));

const ID_EDITO = 'a0000000-0000-4000-8000-000000000001';
const ID_VILLAGE = 'a0000000-0000-4000-8000-000000000002';
const ID_MASQUE = 'a0000000-0000-4000-8000-000000000003';
const ID_CONSEIL = 'a0000000-0000-4000-8000-000000000004';

beforeEach(() => {
  db = {
    communes: [{ id: 'edito', slug: 'plateforme-agora' }, { id: 'village', slug: 'eaucourt' }],
    articles: [
      { id: ID_EDITO, commune_id: 'edito', section: 'actualites', statut: 'visible', titre: "Lire l'étiquette d'un œuf", contenu_html: '<p onclick="x()">Le code <b>0</b></p>', created_at: '2026-11-10T08:00:00Z' },
      { id: ID_VILLAGE, commune_id: 'village', section: 'actualites', statut: 'visible', titre: 'Conseil municipal', contenu_html: '<p>Interne</p>', created_at: '2026-11-10T08:00:00Z' },
      { id: ID_MASQUE, commune_id: 'edito', section: 'actualites', statut: 'masquee', titre: 'Masqué', contenu_html: '', created_at: '2026-11-10T08:00:00Z' },
      { id: ID_CONSEIL, commune_id: 'edito', section: 'conseil', statut: 'visible', titre: 'Délibération', contenu_html: '', created_at: '2026-11-10T08:00:00Z' },
    ],
    article_images: [{ id: 'i1', commune_id: 'edito', article_id: ID_EDITO, url: 'https://cdn.test/oeuf.jpg', ordre: 0 }],
  };
  vi.stubGlobal('fetch', (input: any) => {
    const url = new URL(String(input));
    const table = url.pathname.replace('/rest/v1/', '');
    return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

const lire = (id: string) => decouverte.request(`/articles/${id}`, { method: 'GET' }, ENV);

describe('GET /decouverte/articles/:id', () => {
  it('renvoie un article de la commune éditoriale, HTML nettoyé, avec ses images', async () => {
    const res = await lire(ID_EDITO);
    expect(res.status).toBe(200);
    const { article } = await res.json() as any;
    expect(article.titre).toBe("Lire l'étiquette d'un œuf");
    expect(article.contenu_html).toBe('<p>Le code <b>0</b></p>');
    expect(article.images).toEqual(['https://cdn.test/oeuf.jpg']);
    expect(article.commune_id).toBeUndefined();
  });

  it("n'ouvre jamais l'article d'un village", async () => {
    expect((await lire(ID_VILLAGE)).status).toBe(404);
  });

  it('refuse un article masqué ou hors actualités, et un identifiant invalide', async () => {
    expect((await lire(ID_MASQUE)).status).toBe(404);
    expect((await lire(ID_CONSEIL)).status).toBe(404);
    expect((await lire('pas-un-uuid')).status).toBe(404);
  });
});

describe('sanitizeHtml', () => {
  it("garde la mise en forme de l'éditeur", () => {
    const html = '<b>gras</b> <i>it</i><br><span style="color: rgb(255, 0, 0)">rouge</span> <a href="https://exemple.fr">lien</a>';
    expect(sanitizeHtml(html)).toBe('<b>gras</b> <i>it</i><br><span style="color: rgb(255, 0, 0)">rouge</span> <a href="https://exemple.fr" target="_blank" rel="noopener noreferrer">lien</a>');
  });

  it("retire tout attribut d'événement, même collé au nom de balise", () => {
    expect(sanitizeHtml('<b onmouseover="alert(1)">x</b>')).toBe('<b>x</b>');
    expect(sanitizeHtml('<span/onclick=alert(1)>x</span>')).toBe('<span>x</span>');
    expect(sanitizeHtml('<a/onclick=alert(1) href="https://a.fr">x</a>')).toBe('<a href="https://a.fr" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('supprime les balises interdites et échappe un « < » orphelin', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>ok<script>alert(1)</script>')).toBe('okalert(1)');
    expect(sanitizeHtml('fin <img src=x onerror=alert(1)')).toBe('fin &lt;img src=x onerror=alert(1)');
    expect(sanitizeHtml('<span style="position:fixed;color:red">x</span>')).toBe('<span style="color:red">x</span>');
  });
});
