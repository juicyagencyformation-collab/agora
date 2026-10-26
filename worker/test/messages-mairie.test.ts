// worker/test/messages-mairie.test.ts
// Bandeau "Message de la mairie" : publication réservée aux gestionnaires, durée bornée, seuls
// les messages non expirés sont lus, retrait limité à sa propre commune.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import messagesMairie from '../src/routes/messages_mairie';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('gt.')) return new Date(valeur).getTime() > new Date(filtre.slice(3)).getTime();
  return true;
}
const filtrer = (table: Ligne[], p: URLSearchParams) =>
  table.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  if (methode === 'POST') {
    const l = { id: crypto.randomUUID(), ...JSON.parse(String(init.body)) };
    (db[table] ??= []).push(l);
    return Promise.resolve(new Response(JSON.stringify([l]), { status: 201 }));
  }
  if (methode === 'DELETE') {
    const visees = new Set(filtrer(db[table] || [], url.searchParams));
    db[table] = (db[table] || []).filter((l) => !visees.has(l));
    return Promise.resolve(new Response('[]', { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const cookie = async (commune_id: string, role: string) => ({
  Cookie: `agora_access=${await sign({ user_id: 'u-' + role, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const dans = (jours: number) => new Date(Date.now() + jours * 86400000).toISOString();
const publier = async (role: string, corps: object) => messagesMairie.request('/', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(await cookie('c1', role)) }, body: JSON.stringify(corps),
}, ENV, FAUX_EXECUTION_CTX);

beforeEach(() => { db = { messages_mairie: [], users: [], push_subscriptions: [] }; vi.stubGlobal('fetch', fetchFake); });
afterEach(() => vi.unstubAllGlobals());

describe('POST /messages-mairie', () => {
  it('refuse un simple habitant', async () => {
    expect((await publier('citoyen', { texte: 'Coupure d\'eau', fin_le: dans(2) })).status).toBe(403);
    expect(db.messages_mairie).toHaveLength(0);
  });
  it('publie pour un gestionnaire, rattaché à sa commune', async () => {
    const res = await publier('admin', { texte: 'Coupure d\'eau mardi de 9h à 12h', fin_le: dans(2), notifier: true });
    expect(res.status).toBe(201);
    expect(db.messages_mairie[0]).toMatchObject({ commune_id: 'c1', auteur_id: 'u-admin', texte: 'Coupure d\'eau mardi de 9h à 12h' });
  });
  it('refuse une date passée, une durée trop longue ou un texte trop long', async () => {
    expect((await publier('elu', { texte: 'x', fin_le: dans(-1) })).status).toBe(400);
    expect((await publier('elu', { texte: 'x', fin_le: dans(61) })).status).toBe(400);
    expect((await publier('elu', { texte: 'x'.repeat(281), fin_le: dans(2) })).status).toBe(400);
    expect(db.messages_mairie).toHaveLength(0);
  });
});

describe('GET et DELETE /messages-mairie', () => {
  it('ne renvoie que les messages non expirés de sa commune', async () => {
    db.messages_mairie.push(
      { id: 'actif', commune_id: 'c1', texte: 'Actif', fin_le: dans(1) },
      { id: 'expire', commune_id: 'c1', texte: 'Expiré', fin_le: dans(-1) },
      { id: 'autre', commune_id: 'c2', texte: 'Autre commune', fin_le: dans(1) },
    );
    const res = await messagesMairie.request('/', { headers: await cookie('c1', 'citoyen') }, ENV);
    expect((await res.json() as any).messages.map((m: any) => m.id)).toEqual(['actif']);
  });
  it("ne retire pas le message d'une autre commune", async () => {
    db.messages_mairie.push({ id: 'm2', commune_id: 'c2', texte: 'Autre', fin_le: dans(1) });
    const res = await messagesMairie.request('/m2', { method: 'DELETE', headers: await cookie('c1', 'maire') }, ENV);
    expect(res.status).toBe(200);
    expect(db.messages_mairie).toHaveLength(1);
  });
});
