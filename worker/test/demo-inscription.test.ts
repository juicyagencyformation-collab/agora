// worker/test/demo-inscription.test.ts
// Commune de démonstration (acces_libre, ex. Bonvivre) : aucune inscription possible, le visiteur
// est orienté vers rejoindre.html (2026-11-16 : de vrais habitants s'y inscrivaient par erreur).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import auth from '../src/auth';

let requetes: { methode: string; table: string }[];
let accesLibre: boolean;

const app = new Hono();
app.use('/:slug/auth/*', async (c, next) => {
  c.set('commune_id_resolue' as never, 'c-1' as never);
  c.set('slug_commune' as never, c.req.param('slug') as never);
  await next();
});
app.route('/:slug/auth', auth);

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET: 'secret' };
const ctx: any = { waitUntil: () => {}, passThroughOnException: () => {} };
const inscrire = () => app.request('/bonvivre/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'habitant@exemple.fr', password: 'motdepasse', nom: 'Martin', prenom: 'Paul', consentement_rgpd: true, duree_saisie_ms: 60_000 }),
}, ENV, ctx);

beforeEach(() => {
  requetes = [];
  vi.stubGlobal('fetch', (input: any, init?: any) => {
    const url = new URL(String(input));
    const methode = init?.method || 'GET';
    const table = url.pathname.replace('/rest/v1/', '');
    requetes.push({ methode, table });
    if (methode === 'GET' && table === 'communes') return Promise.resolve(new Response(JSON.stringify([{ acces_libre: accesLibre }])));
    // Compte déjà existant : la commune normale s'arrête là, après le contrôle de démo.
    if (methode === 'GET' && table === 'users' && url.searchParams.has('email')) return Promise.resolve(new Response(JSON.stringify([{ id: 'u-1' }])));
    return Promise.resolve(new Response('[]'));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('inscription sur une commune de démonstration', () => {
  it('refuse et oriente vers rejoindre.html, sans créer de compte', async () => {
    accesLibre = true;
    const res = await inscrire();
    expect(res.status).toBe(403);
    expect((await res.json() as any).lien).toBe('/rejoindre.html');
    expect(requetes.some((r) => r.methode === 'POST' && r.table === 'users')).toBe(false);
  });

  it('laisse passer une commune normale (jusqu’au contrôle de compte existant)', async () => {
    accesLibre = false;
    const res = await inscrire();
    expect(res.status).toBe(400);
    expect((await res.json() as any).erreur).toBe('Un compte existe déjà avec cet email');
  });
});
