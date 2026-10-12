// worker/test/actus-fichier-pv.test.ts
// Couvre le PDF joint à un article "actualités" (demande du 2026-10-12) : PATCH /actus/:id
// ignorait silencieusement fichier_pv_url/fichier_pv_type avant ce correctif (seule la
// création les écrivait). Même esprit de faux fetch() que test/lois.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import actus from '../src/routes/actus';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET,
  R2_PUBLIC_BASE: 'https://cdn.exemple.test',
};

function reinitialiser() {
  db = { articles: [], article_images: [], onglets_config: [], activation_events: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}
function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...inserees);
    return Promise.resolve(new Response(JSON.stringify(inserees), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

async function cookiePour(commune_id: string, user_id = 'u1', role = 'admin') {
  const token = await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  return { headers: { Cookie: `agora_access=${token}` } };
}

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PATCH /:id — fichier_pv_url / fichier_pv_type', () => {
  it('ajoute un PDF à un article qui n\'en avait pas', async () => {
    db.articles.push({ id: 'a1', commune_id: 'c1', titre: 'x', contenu_html: '<p>x</p>', fichier_pv_url: null, fichier_pv_type: null });
    const res = await actus.request('/a1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1')),
      body: JSON.stringify({ fichier_pv_url: 'https://cdn.exemple.test/doc.pdf', fichier_pv_type: 'pdf' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.articles[0].fichier_pv_url).toBe('https://cdn.exemple.test/doc.pdf');
    expect(db.articles[0].fichier_pv_type).toBe('pdf');
  });

  it('retire un PDF déjà joint (null explicite)', async () => {
    db.articles.push({ id: 'a2', commune_id: 'c1', titre: 'x', contenu_html: '<p>x</p>', fichier_pv_url: 'https://cdn.exemple.test/ancien.pdf', fichier_pv_type: 'pdf' });
    const res = await actus.request('/a2', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1')),
      body: JSON.stringify({ fichier_pv_url: null, fichier_pv_type: null }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.articles[0].fichier_pv_url).toBeNull();
  });

  it('ne touche pas au PDF existant si le champ est absent du corps', async () => {
    db.articles.push({ id: 'a3', commune_id: 'c1', titre: 'x', contenu_html: '<p>x</p>', fichier_pv_url: 'https://cdn.exemple.test/garde.pdf', fichier_pv_type: 'pdf' });
    const res = await actus.request('/a3', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1')),
      body: JSON.stringify({ titre: 'Nouveau titre' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.articles[0].fichier_pv_url).toBe('https://cdn.exemple.test/garde.pdf');
  });
});
