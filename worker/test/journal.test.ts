// worker/test/journal.test.ts
// Journal papier — MODE ESSAI (2026-11-14) : réservé au superadmin, lecture seule (aucune
// écriture en base, aucun article marqué « déjà paru »), isolation tenant, jours de la semaine
// calculés à partir des dates, PDF refusé proprement sans navigateur Cloudflare (binding absent
// des tests, voir wrangler.test.toml).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import journal, { partiesDate } from '../src/routes/journal';
import { htmlEnParagraphes, ordreRubriques } from '../src/lib/journal-contenus';
import { CLES_THEMES_ACTUS } from '../src/lib/themes-actus';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let ecritures: string[];
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET, FRONTEND_URL: 'https://front.test' };
const CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('gte.')) return new Date(valeur).getTime() >= new Date(filtre.slice(4)).getTime();
  if (filtre.startsWith('lte.')) return new Date(valeur).getTime() <= new Date(filtre.slice(4)).getTime();
  if (filtre.startsWith('lt.')) return new Date(valeur).getTime() < new Date(filtre.slice(3)).getTime();
  return true;
}
// and=(col.op.valeur,col.op.valeur) — toutes les conditions vraies.
function correspondEt(l: Ligne, expr: string): boolean {
  return expr.slice(1, -1).split(',').every((cond) => {
    const i = cond.indexOf('.');
    return correspond(l[cond.slice(0, i)], cond.slice(i + 1));
  });
}
const filtrer = (table: Ligne[], p: URLSearchParams) => table.filter((l) => [...p.entries()].every(([k, v]) =>
  ['select', 'order', 'limit', 'offset'].includes(k) || (k === 'and' ? correspondEt(l, v) : correspond(l[k], v))));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname !== 'fake.supabase.test') return Promise.resolve(new Response('absent', { status: 404 })); // polices
  const methode = init?.method || 'GET';
  if (methode !== 'GET') { ecritures.push(`${methode} ${url.pathname}`); return Promise.resolve(new Response('[]', { status: 200 })); }
  const table = url.pathname.replace('/rest/v1/', '');
  return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
}

const cookie = async (role: string, commune_id = 'c1') => ({
  Cookie: `agora_access=${await sign({ user_id: 'u1', commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const PERIODE = 'debut=2026-09-01&fin=2026-11-30&agenda_debut=2026-12-01&agenda_fin=2027-02-28';
const A1 = 'a0000000-0000-4000-8000-000000000001';
const A_MASQUE = 'a0000000-0000-4000-8000-000000000002';
const A_AUTRE_COMMUNE = 'a0000000-0000-4000-8000-000000000003';
const E1 = 'e0000000-0000-4000-8000-000000000001';

const demande = (articles: string[]) => ({
  titre: 'Le p\'tit journal Eaucourtois', numero: 5, saison: 'Hiver 2026',
  periode: { debut: '2026-09-01', fin: '2026-11-30', agenda_debut: '2026-12-01', agenda_fin: '2027-02-28' },
  edito: { texte: 'Chères Eaucourtoises, chers Eaucourtois,\nBonne lecture.', signataire: 'Le maire' },
  opposition: { choix: 'aucun_bloc' },
  articles: articles.map((id) => ({ id })), evenements: [E1], sondages: [],
  encarts: { signalements: true, dechets: false, numeros_utiles: true },
});
const poster = async (chemin: string, role: string, corps: object) => journal.request(chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(await cookie(role)) }, body: JSON.stringify(corps),
}, ENV, CTX);

beforeEach(() => {
  ecritures = [];
  db = {
    communes: [{ id: 'c1', slug: 'eaucourt', nom: 'Eaucourt-sur-Somme', departement: 'Somme', population: 400, couleur_theme: '#2C5F6E', couleur_accent: '#E2C97E', logo_url: null, telephone_mairie: '03 22 00 00 00' }],
    articles: [
      { id: A1, commune_id: 'c1', titre: 'Repas des aînés', contenu_html: '<p>58 convives</p><p>Merci &amp; bravo</p>', categorie: 'vie_village', section: 'actualites', fiche_id: null, statut: 'visible', created_at: '2026-10-18T10:00:00Z' },
      { id: A_MASQUE, commune_id: 'c1', titre: 'Article masqué', contenu_html: '<p>x</p>', categorie: 'vie_village', section: 'actualites', fiche_id: null, statut: 'masquee', created_at: '2026-10-19T10:00:00Z' },
      { id: A_AUTRE_COMMUNE, commune_id: 'c2', titre: 'Secret de la commune voisine', contenu_html: '<p>y</p>', categorie: 'vie_village', section: 'actualites', fiche_id: null, statut: 'visible', created_at: '2026-10-20T10:00:00Z' },
      { id: 'a-hors-periode', commune_id: 'c1', titre: 'Article de juin', contenu_html: '<p>z</p>', categorie: 'vie_village', section: 'actualites', fiche_id: null, statut: 'visible', created_at: '2026-06-01T10:00:00Z' },
    ],
    article_images: [], annuaire: [],
    events: [
      { id: E1, commune_id: 'c1', titre: 'Vœux du maire', lieu: 'Salle des fêtes', date_debut: '2027-01-09T17:00:00Z', date_fin: '2027-01-09T19:00:00Z', statut: 'visible' },
      { id: 'e-autre', commune_id: 'c2', titre: 'Fête voisine', lieu: '', date_debut: '2027-01-10T17:00:00Z', date_fin: '2027-01-10T19:00:00Z', statut: 'visible' },
    ],
    sondages: [], choix_sondage: [], votes: [],
    alertes: [{ commune_id: 'c1', statut: 'resolue', created_at: '2026-10-01T08:00:00Z' }, { commune_id: 'c1', statut: 'ouverte', created_at: '2026-10-02T08:00:00Z' }],
    dechets_config: [], dechets_exceptions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Journal papier en essai : accès', () => {
  it('est refusé à tout autre rôle que superadmin', async () => {
    for (const role of ['citoyen', 'admin', 'elu', 'maire']) {
      expect((await journal.request(`/contenus?${PERIODE}`, { headers: await cookie(role) }, ENV, CTX)).status).toBe(403);
      expect((await poster('/apercu', role, demande([A1]))).status).toBe(403);
    }
  });
});

describe('Journal papier en essai : contenus', () => {
  it('ne propose que les articles visibles de la commune, publiés pendant la période', async () => {
    const res = await journal.request(`/contenus?${PERIODE}`, { headers: await cookie('superadmin') }, ENV, CTX);
    expect(res.status).toBe(200);
    const corps: any = await res.json();
    const titres = corps.rubriques.flatMap((r: any) => r.articles.map((a: any) => a.titre));
    expect(titres).toEqual(['Repas des aînés']);
    expect(corps.evenements.map((e: any) => e.titre)).toEqual(['Vœux du maire']);
    expect(corps.signalements).toEqual({ recus: 2, resolus: 1, en_cours: 1 });
    expect(ecritures).toEqual([]);
  });

  it('n\'imprime jamais un article d\'une autre commune ni un article masqué, même si leur id est envoyé', async () => {
    const res = await poster('/apercu', 'superadmin', demande([A1, A_MASQUE, A_AUTRE_COMMUNE]));
    expect(res.status).toBe(200);
    const { html } = await res.json() as any;
    expect(html).toContain('Repas des aînés');
    expect(html).toContain('Merci &amp; bravo');
    expect(html).not.toContain('Article masqué');
    expect(html).not.toContain('Secret de la commune voisine');
    expect(html).toContain('Vœux du maire');
    expect(html).toContain('Numéros utiles');
    expect(ecritures).toEqual([]); // essai : rien n'est écrit, aucun article marqué « déjà paru »
  });

  it('échappe le texte saisi (retouche, édito)', async () => {
    const d: any = demande([A1]);
    d.articles = [{ id: A1, titre: '<script>alert(1)</script>' }];
    const { html } = await (await poster('/apercu', 'superadmin', d)).json() as any;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('refuse une image intégrée qui n\'est pas une image', async () => {
    const d: any = demande([A1]);
    d.couverture = { image: 'data:text/html;base64,PHNjcmlwdD4=', credit: '' };
    expect((await poster('/apercu', 'superadmin', d)).status).toBe(400);
  });

  it('répond 503 pour le PDF quand le navigateur Cloudflare n\'est pas disponible', async () => {
    expect((await poster('/pdf', 'superadmin', demande([A1]))).status).toBe(503);
  });
});

describe('Journal papier : outils', () => {
  it('calcule le jour de la semaine à partir de la date (heure de Paris)', () => {
    expect(partiesDate('2026-11-21T10:00:00Z').jour).toBe('sam');
    expect(partiesDate('2026-12-06T10:00:00Z').jour).toBe('dim');
    expect(partiesDate('2026-12-21T10:00:00Z').jour).toBe('lun');
    expect(partiesDate('2027-01-09T17:00:00Z')).toMatchObject({ jour: 'sam', num: '9', mois: 'Janvier 2027', heure: '18 h' });
  });
  it('transforme le HTML des actus en paragraphes de texte', () => {
    expect(htmlEnParagraphes('<p>Un <b>deux</b></p><p>Trois&nbsp;&amp; quatre<br>cinq</p>')).toEqual(['Un deux', 'Trois & quatre', 'cinq']);
  });
  it('fait de chaque thème d\'actualité une rubrique du journal', () => {
    const cles = ordreRubriques().map((r) => r.cle);
    CLES_THEMES_ACTUS.forEach((t) => expect(cles).toContain(t));
  });
});
