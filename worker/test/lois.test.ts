// worker/test/lois.test.ts
// Couvre l'isolation inter-commune de worker/src/routes/lois.ts, en particulier
// POST /commentaires/:id/signaler (faille IDOR corrigée le 2026-10-09 : le signalement
// masquait n'importe quel commentaire par son UUID, sans vérifier qu'il appartenait à la
// commune de l'appelant). Même esprit de faux fetch() que test/decouverte.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import lois from '../src/routes/lois';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET,
};

function reinitialiser() {
  db = { lois_commentaires: [], lois_signalements: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
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

async function cookiePour(commune_id: string, user_id = 'u1') {
  const token = await sign({ user_id, commune_id, role: 'citoyen', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  return { headers: { Cookie: `agora_access=${token}` } };
}

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /commentaires/:id/signaler', () => {
  it('refuse (404) de signaler le commentaire d\'une autre commune, et ne le masque pas', async () => {
    db.lois_commentaires.push({ id: 'com-1', loi_id: 'loi-1', commune_id: 'commune-A', user_id: 'auteur', contenu: 'x', masque: false });

    const res = await lois.request('/commentaires/com-1/signaler', {
      method: 'POST', ...(await cookiePour('commune-B')),
    }, ENV);

    expect(res.status).toBe(404);
    expect(db.lois_commentaires[0].masque).toBe(false);
    expect(db.lois_signalements).toHaveLength(0);
  });

  it('masque bien le commentaire quand il appartient à la commune de l\'appelant', async () => {
    db.lois_commentaires.push({ id: 'com-1', loi_id: 'loi-1', commune_id: 'commune-A', user_id: 'auteur', contenu: 'x', masque: false });

    const res = await lois.request('/commentaires/com-1/signaler', {
      method: 'POST', ...(await cookiePour('commune-A')),
    }, ENV);

    expect(res.status).toBe(200);
    expect(db.lois_commentaires[0].masque).toBe(true);
    expect(db.lois_signalements).toHaveLength(1);
  });
});
