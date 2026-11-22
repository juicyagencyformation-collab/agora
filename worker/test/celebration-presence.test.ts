// worker/test/celebration-presence.test.ts
// « +N » de participation citoyenne (2026-11-22, migration 117) : points prévus dès le scan,
// total (base + bonus) à la validation, célébration listée une seule fois puis marquée vue,
// jamais sur la présence de quelqu'un d'autre ; en_attente tant qu'un scan récent attend.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import agenda from '../src/routes/agenda';

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

const dans = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const QR = 'a0000000-0000-4000-8000-000000000001';
const P1 = 'b0000000-0000-4000-8000-000000000001';
const P2 = 'b0000000-0000-4000-8000-000000000002';

beforeEach(() => {
  db = {
    events: [{ id: 'e1', commune_id: 'c1', user_id: 'u-orga', titre: 'Nettoyage des berges', type_action: 'nettoyage',
      necessite_validation_presence: true, qr_token: QR, date_debut: dans(-1), date_fin: dans(1), lat: null, lng: null }],
    participations_citoyennes: [], points_citoyens_history: [], badges_citoyens: [], user_badges_citoyens: [],
    users: [{ id: 'u-hab', commune_id: 'c1', score_citoyen: 0 }, { id: 'u-autre', commune_id: 'c1', score_citoyen: 0 }],
    push_subscriptions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Célébration « +N » de présence citoyenne', () => {
  it('le scan annonce les points prévus et passe en attente', async () => {
    const res = await appel(agenda, '/e1/scanner', 'POST', 'u-hab', 'citoyen', { qr_token: QR });
    expect(res.status).toBe(200);
    expect((await res.json()).points_prevus).toBe(40);
    const suivi = await (await appel(agenda, '/mes-confirmations', 'GET', 'u-hab', 'citoyen')).json();
    expect(suivi).toEqual({ confirmations: [], en_attente: true });
  });

  it('validation par un élu : total bonus compris, célébré une seule fois', async () => {
    db.participations_citoyennes.push({ id: P1, commune_id: 'c1', event_id: 'e1', user_id: 'u-hab', statut: 'scanne', scan_le: dans(0) });
    const val = await appel(agenda, `/e1/participations-citoyennes/${P1}/valider`, 'PATCH', 'u-elu', 'elu');
    expect((await val.json()).points_gagnes).toBe(50); // 40 + 10 de bonus élu

    const avant = await (await appel(agenda, '/mes-confirmations', 'GET', 'u-hab', 'citoyen')).json();
    expect(avant.confirmations).toEqual([{ id: P1, points: 50, titre: 'Nettoyage des berges' }]);
    expect(avant.en_attente).toBe(false);

    expect((await appel(agenda, '/mes-confirmations/vues', 'POST', 'u-hab', 'citoyen', { ids: [P1] })).status).toBe(200);
    const apres = await (await appel(agenda, '/mes-confirmations', 'GET', 'u-hab', 'citoyen')).json();
    expect(apres.confirmations).toEqual([]);
  });

  it("impossible de marquer vue la célébration de quelqu'un d'autre", async () => {
    db.participations_citoyennes.push({ id: P2, commune_id: 'c1', event_id: 'e1', user_id: 'u-autre', statut: 'confirme', points_attribues: 40 });
    await appel(agenda, '/mes-confirmations/vues', 'POST', 'u-hab', 'citoyen', { ids: [P2] });
    expect(db.participations_citoyennes[0].celebration_vue_le).toBeUndefined();
    const autre = await (await appel(agenda, '/mes-confirmations', 'GET', 'u-autre', 'citoyen')).json();
    expect(autre.confirmations).toHaveLength(1);
  });
});
