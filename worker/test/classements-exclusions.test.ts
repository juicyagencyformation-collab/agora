// worker/test/classements-exclusions.test.ts
// Classements Explorer (2026-11-22) : pas de comptes supprimés ; un superadmin qui joue y reste.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import chasses from '../src/routes/chasses_tresor';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET, R2_PUBLIC_BASE: 'https://cdn.test' };
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre === 'is.null') return valeur == null;
  if (filtre === 'not.is.null') return valeur != null;
  if (filtre.startsWith('gte.')) return new Date(valeur).getTime() >= new Date(filtre.slice(4)).getTime();
  if (filtre.startsWith('lt.')) return new Date(valeur).getTime() < new Date(filtre.slice(3)).getTime();
  return true;
}
// or=(col.op.valeur,col.op.valeur) — au moins une condition vraie.
function correspondOu(l: Ligne, expr: string): boolean {
  return expr.slice(1, -1).split(',').some((cond) => {
    const i = cond.indexOf('.');
    return correspond(l[cond.slice(0, i)], cond.slice(i + 1));
  });
}
const filtrer = (table: Ligne[], p: URLSearchParams) => table.filter((l) => [...p.entries()].every(([k, v]) =>
  ['select', 'order', 'limit', 'offset'].includes(k) || (k === 'or' ? correspondOu(l, v) : correspond(l[k], v))));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), statut: 'visible', ...l }));
    (db[table] ??= []).push(...lignes);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const visees = filtrer(db[table] || [], url.searchParams);
    visees.forEach((l) => Object.assign(l, JSON.parse(String(init.body))));
    return Promise.resolve(new Response(JSON.stringify(visees), { status: 200 }));
  }
  if (methode === 'DELETE') {
    const visees = new Set(filtrer(db[table] || [], url.searchParams));
    db[table] = (db[table] || []).filter((l) => !visees.has(l));
    return Promise.resolve(new Response('[]', { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const cookie = async (user_id: string, role: string) => ({
  Cookie: `agora_access=${await sign({ user_id, commune_id: 'c1', role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const appel = async (app: any, chemin: string, methode: string, user_id: string, role: string, corps?: object) =>
  app.request(chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(await cookie(user_id, role)) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }, ENV, FAUX_EXECUTION_CTX);

beforeEach(() => {
  db = {
    users: [
      { id: 'u1', commune_id: 'c1', prenom: 'Véro', nom: 'O', role: 'citoyen', etapes_chasse_validees: 16, enigmes_trouvees: 6 },
      { id: 'u2', commune_id: 'c1', prenom: 'supprimé', nom: 'Compte', role: 'citoyen', compte_supprime_le: '2026-11-01T00:00:00Z', etapes_chasse_validees: 10, enigmes_trouvees: 2 },
      { id: 'u3', commune_id: 'c1', prenom: 'superadmin', nom: 'S', role: 'superadmin', etapes_chasse_validees: 0, enigmes_trouvees: 3 },
    ],
    progressions_chasse: [
      { commune_id: 'c1', chasse_id: 'ch1', user_id: 'u1', validee_at: '2026-11-01T10:00:00Z' },
      { commune_id: 'c1', chasse_id: 'ch1', user_id: 'u2', validee_at: '2026-11-01T11:00:00Z' },
      { commune_id: 'c1', chasse_id: 'ch1', user_id: 'u3', validee_at: '2026-11-01T12:00:00Z' },
    ],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Classements sans comptes supprimés', () => {
  it('classement Explorer', async () => {
    const { classement } = await (await appel(chasses, '/classement-exploration', 'GET', 'u1', 'citoyen')).json();
    expect(classement.map((l: any) => l.score)).toEqual([22, 3]);
  });
  it('classement d’une chasse', async () => {
    const { classement } = await (await appel(chasses, '/ch1/classement', 'GET', 'u1', 'citoyen')).json();
    expect(classement).toHaveLength(2);
    expect(classement[0].prenom).toContain('Véro');
  });
});
