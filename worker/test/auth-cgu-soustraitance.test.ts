// worker/test/auth-cgu-soustraitance.test.ts
// Couvre la gate d'acceptation des clauses de sous-traitance RGPD (art. 28) intégrées aux CGU
// le 2026-10-12 : seuls les rôles décideurs (admin/élu/maire/superadmin) doivent l'accepter,
// jamais un citoyen — voir worker/src/auth.ts (GET /me, POST /accepter-cgu-soustraitance) et
// db/migrations/080_cgu_soustraitance.sql. Même esprit de faux fetch() que test/lois.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import auth from '../src/auth';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET,
};

function reinitialiser() {
  db = { users: [] };
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
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

async function cookiePour(user_id: string, commune_id: string, role: string) {
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

describe('GET /me — cgu_sous_traitance_a_accepter', () => {
  it('false pour un citoyen, même sans acceptation enregistrée', async () => {
    db.users.push({ id: 'u1', commune_id: 'c1', role: 'citoyen', cgu_sous_traitance_acceptee_le: null });
    const res = await auth.request('/me', { ...(await cookiePour('u1', 'c1', 'citoyen')) }, ENV);
    expect((await res.json()).cgu_sous_traitance_a_accepter).toBe(false);
  });

  it('true pour un maire qui n\'a jamais accepté', async () => {
    db.users.push({ id: 'u2', commune_id: 'c1', role: 'maire', cgu_sous_traitance_acceptee_le: null });
    const res = await auth.request('/me', { ...(await cookiePour('u2', 'c1', 'maire')) }, ENV);
    expect((await res.json()).cgu_sous_traitance_a_accepter).toBe(true);
  });

  it('false pour un maire qui a déjà accepté', async () => {
    db.users.push({ id: 'u3', commune_id: 'c1', role: 'maire', cgu_sous_traitance_acceptee_le: '2026-10-12T00:00:00.000Z' });
    const res = await auth.request('/me', { ...(await cookiePour('u3', 'c1', 'maire')) }, ENV);
    expect((await res.json()).cgu_sous_traitance_a_accepter).toBe(false);
  });
});

describe('POST /accepter-cgu-soustraitance', () => {
  it('enregistre l\'acceptation pour un rôle décideur', async () => {
    db.users.push({ id: 'u4', commune_id: 'c1', role: 'elu', cgu_sous_traitance_acceptee_le: null });
    const res = await auth.request('/accepter-cgu-soustraitance', {
      method: 'POST', ...(await cookiePour('u4', 'c1', 'elu')),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.users[0].cgu_sous_traitance_acceptee_le).toBeTruthy();
  });

  it('refuse (403) pour un citoyen', async () => {
    db.users.push({ id: 'u5', commune_id: 'c1', role: 'citoyen', cgu_sous_traitance_acceptee_le: null });
    const res = await auth.request('/accepter-cgu-soustraitance', {
      method: 'POST', ...(await cookiePour('u5', 'c1', 'citoyen')),
    }, ENV);
    expect(res.status).toBe(403);
    expect(db.users[0].cgu_sous_traitance_acceptee_le).toBeNull();
  });
});
