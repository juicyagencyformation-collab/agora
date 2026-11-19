// worker/test/vigilance-notifications.test.ts
// Notifications de vigilance (2026-11-19). Ce qu'on verrouille : une vigilance orange qui
// commence part en notification aux seuls abonnés (notif_vigilance) des communes du département,
// avec le texte affiché sur les téléphones ; une seule fois par vigilance ; une commune sans
// département n'est jamais servie (d'où le rattrapage des espaces de prospection, voir
// prospection-activation.test.ts).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const envois = vi.hoisted(() => ({ liste: [] as { endpoint: string; payload: any }[] }));
vi.mock('@pushforge/builder', () => ({
  buildPushHTTPRequest: async ({ subscription, message }: any) => {
    envois.liste.push({ endpoint: subscription.endpoint, payload: message.payload });
    return { endpoint: subscription.endpoint, headers: {}, body: 'chiffre' };
  },
}));

import { synchroniserVigilanceMeteoFrance } from '../src/lib/vigilance-meteofrance';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let bulletin: any[];
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', VAPID_PRIVATE_KEY: '{}' };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur == null;
  if (filtre === 'not.is.null') return valeur != null;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}
function filtrer(table: Ligne[], params: URLSearchParams) {
  let lignes = [...table];
  for (const [cle, v] of params.entries()) {
    if (!['select', 'order', 'limit', 'offset', 'or', 'on_conflict'].includes(cle)) lignes = lignes.filter((l) => correspond(l[cle], v));
  }
  return lignes;
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const ok = (corps: any, status = 200) => Promise.resolve(new Response(JSON.stringify(corps), { status }));
  if (url.hostname === 'public.opendatasoft.com') return ok({ results: bulletin });
  if (url.hostname === 'push.test') return Promise.resolve(new Response(null, { status: 201 }));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    const select = url.searchParams.get('select');
    const lignes = filtrer(db[table] || [], url.searchParams);
    return ok(select ? lignes.map((l) => Object.fromEntries(select.split(',').map((ch) => [ch, l[ch]]))) : lignes);
  }
  if (methode === 'POST') {
    const lignes = JSON.parse(String(init.body)) as Ligne[];
    const cles = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
    for (const l of lignes) {
      const existante = cles.length ? (db[table] ??= []).find((e) => cles.every((k) => e[k] === l[k])) : null;
      if (existante) Object.assign(existante, l); else (db[table] ??= []).push({ id: crypto.randomUUID(), ...l });
    }
    return ok(lignes, 201);
  }
  if (methode === 'PATCH') {
    const lignes = filtrer(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return ok(lignes);
  }
  if (methode === 'DELETE') return ok([]);
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const heure = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(() => {
  bulletin = [{ domain_id: '80', phenomenon_id: 2, color_id: 3, begin_time: heure(-1), end_time: heure(5) }];
  db = {
    communes: [
      { id: 'c-somme', departement: '80', lat: 50.1, lng: 1.9 },
      { id: 'c-oise', departement: '60', lat: 49.4, lng: 2.8 },
      { id: 'c-sans-dep', departement: null, lat: null, lng: null },
    ],
    users: [
      { id: 'u-abonne', commune_id: 'c-somme', notif_vigilance: true },
      { id: 'u-refus', commune_id: 'c-somme', notif_vigilance: false },
      { id: 'u-oise', commune_id: 'c-oise', notif_vigilance: true },
      { id: 'u-sans-dep', commune_id: 'c-sans-dep', notif_vigilance: true },
    ],
    push_subscriptions: [
      { id: 's1', user_id: 'u-abonne', commune_id: 'c-somme', endpoint: 'https://push.test/abonne', p256dh: 'p', auth: 'a' },
      { id: 's2', user_id: 'u-refus', commune_id: 'c-somme', endpoint: 'https://push.test/refus', p256dh: 'p', auth: 'a' },
      { id: 's3', user_id: 'u-oise', commune_id: 'c-oise', endpoint: 'https://push.test/oise', p256dh: 'p', auth: 'a' },
      { id: 's4', user_id: 'u-sans-dep', commune_id: 'c-sans-dep', endpoint: 'https://push.test/sans-dep', p256dh: 'p', auth: 'a' },
    ],
    alertes_meteo: [],
  };
  envois.liste = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('notification de vigilance', () => {
  it('une vigilance orange qui commence part aux seuls abonnés du département, avec le texte du téléphone', async () => {
    await synchroniserVigilanceMeteoFrance(ENV);
    expect(envois.liste.map((e) => e.endpoint)).toEqual(['https://push.test/abonne']);
    expect(envois.liste[0].payload).toEqual({
      title: '⚠️ Vigilance orange — pluie-inondation',
      body: 'Consultez les détails et les horaires dans l\'application.',
      url: '/index.html?onglet=accueil',
    });
    expect(db.alertes_meteo).toMatchObject([{ commune_id: 'c-somme', type: 'pluie_inondation', niveau: 'orange', origine: 'auto' }]);
  });

  it('une seule notification par vigilance : rien au passage suivant du cron', async () => {
    await synchroniserVigilanceMeteoFrance(ENV);
    envois.liste = [];
    await synchroniserVigilanceMeteoFrance(ENV);
    expect(envois.liste).toEqual([]);
  });

  it('jaune : ni bandeau ni notification', async () => {
    bulletin[0].color_id = 2;
    await synchroniserVigilanceMeteoFrance(ENV);
    expect(envois.liste).toEqual([]);
    expect(db.alertes_meteo).toEqual([]);
  });

  it('une commune sans département n’est jamais servie', async () => {
    bulletin.push({ domain_id: '60', phenomenon_id: 1, color_id: 3, begin_time: heure(-1), end_time: heure(5) });
    await synchroniserVigilanceMeteoFrance(ENV);
    expect(envois.liste.map((e) => e.endpoint).sort()).toEqual(['https://push.test/abonne', 'https://push.test/oise']);
  });
});
