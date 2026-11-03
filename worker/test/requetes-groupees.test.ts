// worker/test/requetes-groupees.test.ts
// Verrouille deux écritures groupées (2026-11-03) qui remplaçaient une requête par élément :
// - appliquerOngletsSurCommune : les 14 onglets d'une commune en UNE requête (upsert) ;
// - PATCH /prospection/prospects/statut-lot : 200 prospects en 3 requêtes, pas 400.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { appliquerOngletsSurCommune, TOUS_LES_ONGLETS } from '../src/backoffice/administration';
import prospection from '../src/backoffice/prospection';

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'secret-de-test' };
let appels: { methode: string; url: URL; corps: any }[];
let prospects: { id: string; statut: string }[];

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const methode = init?.method || 'GET';
  const corps = init?.body ? JSON.parse(String(init.body)) : null;
  appels.push({ methode, url, corps });
  if (methode === 'GET' && url.pathname.endsWith('/prospects')) {
    const ids = (url.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return Promise.resolve(new Response(JSON.stringify(prospects.filter((p) => ids.includes(p.id)))));
  }
  return Promise.resolve(new Response(JSON.stringify(Array.isArray(corps) ? corps : [corps ?? {}]), { status: 200 }));
}

beforeEach(() => { appels = []; prospects = []; vi.stubGlobal('fetch', fetchFake); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('écritures groupées', () => {
  it('écrit les 14 onglets d’une commune en une seule requête', async () => {
    await appliquerOngletsSurCommune(ENV, 'c1', ['actualites', 'agenda']);
    expect(appels).toHaveLength(1);
    expect(appels[0].url.searchParams.get('on_conflict')).toBe('commune_id,cle');
    expect(appels[0].corps).toHaveLength(TOUS_LES_ONGLETS.length);
    expect(appels[0].corps.filter((l: any) => l.actif).map((l: any) => l.cle).sort()).toEqual(['actualites', 'agenda']);
  });

  it('change le statut de 200 prospects en 3 requêtes, sans retoucher ceux déjà au bon statut', async () => {
    prospects = Array.from({ length: 200 }, (_, i) => ({ id: crypto.randomUUID(), statut: i < 150 ? 'contacté' : 'perdu' }));
    const jeton = await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 600 }, ENV.JWT_SECRET);
    const res = await prospection.request('/prospects/statut-lot', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: `agora_bo=${jeton}` },
      body: JSON.stringify({ ids: prospects.map((p) => p.id), statut: 'perdu' }),
    }, ENV);
    expect(await res.json()).toEqual({ ok: true, modifies: 150 });
    expect(appels).toHaveLength(3); // lecture + mise à jour groupée + historique groupé
    const maj = appels.find((a) => a.methode === 'PATCH')!;
    expect(maj.url.searchParams.get('id')!.split(',')).toHaveLength(150);
    expect(appels.find((a) => a.methode === 'POST')!.corps).toHaveLength(150);
  });
});
