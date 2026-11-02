// worker/test/decouverte-chiffres.test.ts
// Bandeau « chiffres réels » de la page d'accueil (GET /decouverte/chiffres) : totaux de toute la
// plateforme sans la démo, la commune nationale ni la commune de test ; une seule série de
// comptages par 24 h (Cache API) ; jamais de faux « 0 » si Supabase échoue.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import decouverte, { CLE_CACHE_CHIFFRES } from '../src/routes/decouverte';

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };
const TOTAUX: Record<string, number> = { connexions_journalieres: 625, articles_lus_par_utilisateur: 239, votes: 120, article_sondage_votes: 38, articles: 65 };
let appels: URL[];
let enPanne: string | null;
let enAttente: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => { enAttente.push(p); }, passThroughOnException() {} }) as any;

function fetchFake(input: any): Promise<Response> {
  const url = new URL(String(input));
  appels.push(url);
  const table = url.pathname.replace('/rest/v1/', '');
  if (table === 'communes') return Promise.resolve(new Response(JSON.stringify([{ id: 'demo' }, { id: 'test' }]), { status: 200 }));
  if (table === enPanne) return Promise.resolve(new Response('erreur', { status: 500 }));
  return Promise.resolve(new Response('[]', { status: 206, headers: { 'content-range': `0-0/${TOTAUX[table]}` } }));
}

beforeEach(async () => {
  appels = []; enPanne = null; enAttente = [];
  await caches.default.delete(CLE_CACHE_CHIFFRES);
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /chiffres', () => {
  it('renvoie les totaux de la plateforme, démo et test exclues', async () => {
    const res = await decouverte.request('/chiffres', {}, ENV, ctx());
    expect(res.status).toBe(200);
    const d: any = await res.json();
    expect(d).toMatchObject({ visites: 625, lectures: 239, votes: 158, actualites: 65 });
    expect(typeof d.calcule_le).toBe('string');
    const comptages = appels.filter((u) => !u.pathname.endsWith('/communes'));
    expect(comptages).toHaveLength(5);
    for (const u of comptages) expect(u.searchParams.get('commune_id')).toBe('not.in.(demo,test)');
    expect(appels.find((u) => u.pathname.endsWith('/communes'))?.searchParams.get('or')).toContain('acces_libre.eq.true');
  });

  it('ne recompte pas avant 24 h : la deuxième visite sort du cache', async () => {
    await decouverte.request('/chiffres', {}, ENV, ctx());
    await Promise.all(enAttente);
    appels = [];
    const res = await decouverte.request('/chiffres', {}, ENV, ctx());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).visites).toBe(625);
    expect(appels).toHaveLength(0);
  });

  it('répond 503, jamais un faux zéro, si un comptage échoue', async () => {
    enPanne = 'votes';
    const res = await decouverte.request('/chiffres', {}, ENV, ctx());
    expect(res.status).toBe(503);
    await Promise.all(enAttente);
    expect(await caches.default.match(CLE_CACHE_CHIFFRES)).toBeUndefined();
  });
});
