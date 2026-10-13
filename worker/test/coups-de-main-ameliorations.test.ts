// worker/test/coups-de-main-ameliorations.test.ts
// Couvre les 3 ameliorations du 2026-10-13 : statut "pourvu", photo optionnelle (retrait via
// PATCH null), et l'interet prive (POST /:id/interet + GET /:id/interets reserve a l'auteur).
// Meme esprit de faux fetch() que test/lois.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import coupsDeMain from '../src/routes/coups_de_main';

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
  db = { coups_de_main: [], coups_de_main_interets: [], users: [] };
}

function correspond(valeur: any, filtre: string): boolean {
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
  if (url.hostname === 'onesignal-nope.invalid') return Promise.reject(new Error('jamais appelé'));
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
  if (methode === 'DELETE') {
    const avant = (db[table] || []).length;
    db[table] = (db[table] || []).filter((l) => !correspond(l.id, url.searchParams.get('id') || ''));
    return Promise.resolve(new Response(JSON.stringify({ supprimees: avant - db[table].length }), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

async function cookiePour(commune_id: string, user_id: string, role = 'citoyen') {
  const token = await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  return { headers: { Cookie: `agora_access=${token}` } };
}

// POST /:id/interet notifie l'auteur via c.executionCtx.waitUntil — absent par défaut quand on
// appelle .request() directement dans un test (Hono lève sinon "This context has no
// ExecutionContext"), d'où ce faux contexte minimal.
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

// envoyerNotificationAUtilisateurs lit push_subscriptions (vide ici = aucun envoi, sans erreur).
beforeEach(() => {
  reinitialiser();
  db.push_subscriptions = [] as any;
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /:id/interet', () => {
  it('refuse d\'exprimer un intérêt pour sa propre annonce', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', titre: 'Prêt tondeuse' });
    const res = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({}),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res.status).toBe(400);
  });

  it('enregistre un intérêt avec message, puis refuse un doublon', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', titre: 'Prêt tondeuse' });
    const res1 = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'voisin')), body: JSON.stringify({ message: 'Dispo ce week-end, 06...' }),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res1.status).toBe(201);
    expect(db.coups_de_main_interets).toHaveLength(1);
    expect(db.coups_de_main_interets[0].message).toContain('06');

    const res2 = await coupsDeMain.request('/a1/interet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'voisin')), body: JSON.stringify({}),
    }, ENV, FAUX_EXECUTION_CTX);
    expect(res2.status).toBe(400);
    expect(db.coups_de_main_interets).toHaveLength(1);
  });
});

describe('GET /:id/interets', () => {
  it('réservé à l\'auteur — un autre citoyen est refusé', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    const res = await coupsDeMain.request('/a1/interets', { ...(await cookiePour('c1', 'curieux')) }, ENV);
    expect(res.status).toBe(403);
  });

  it('l\'auteur voit les intéressés avec leur identité', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur' });
    db.users.push({ id: 'voisin', commune_id: 'c1', prenom: 'Jean', nom: 'Dupont' });
    db.coups_de_main_interets.push({ id: 'i1', commune_id: 'c1', annonce_id: 'a1', user_id: 'voisin', message: 'Dispo' });
    const res = await coupsDeMain.request('/a1/interets', { ...(await cookiePour('c1', 'auteur')) }, ENV);
    expect(res.status).toBe(200);
    const { interets } = await res.json();
    expect(interets).toHaveLength(1);
    expect(interets[0].prenom).toBe('Jean');
  });
});

describe('PATCH /:id — pourvu et photo', () => {
  it('marque une annonce comme pourvue', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', pourvu: false });
    const res = await coupsDeMain.request('/a1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({ pourvu: true }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main[0].pourvu).toBe(true);
  });

  it('retire une photo déjà jointe (null explicite)', async () => {
    db.coups_de_main.push({ id: 'a1', commune_id: 'c1', user_id: 'auteur', photo_r2_key: 'c1/coups-de-main/x.jpg', photo_url: 'https://cdn.exemple.test/c1/coups-de-main/x.jpg' });
    const res = await coupsDeMain.request('/a1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      ...(await cookiePour('c1', 'auteur')), body: JSON.stringify({ photo_r2_key: null }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.coups_de_main[0].photo_url).toBeNull();
  });
});
