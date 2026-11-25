// worker/test/commune-rgpd.test.ts
// GET /:slug/commune/rgpd : adresse de la mairie et DPO pour la politique de confidentialité,
// seulement pour un espace géré par la mairie (sinon l'éditeur est responsable : rien à afficher).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import commune from '../src/routes/commune';

let db: Record<string, any[]>;
const app = new Hono();
app.use('/:slug/*', async (c: any, next) => { c.set('commune_id_resolue', 'c1'); c.set('slug_commune', c.req.param('slug')); await next(); });
app.route('/:slug/commune', commune);
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET: 'secret' };

beforeEach(() => {
  db = {
    communes: [{ id: 'c1', espace_officiel: true }],
    dpa_communes: [{ commune_id: 'c1', adresse_mairie: '1 place de la Mairie, 60000 Tourly', dpo: 'CDG 60 — dpo@cdg60.fr', texte_contrat: '<p>long</p>' }],
  };
  vi.stubGlobal('fetch', (input: any) => {
    const url = new URL(String(input));
    const table = url.pathname.replace('/rest/v1/', '');
    const colonnes = (url.searchParams.get('select') || '').split(',');
    const lignes = (db[table] || []).map((l) => Object.fromEntries(colonnes.filter((k) => k in l).map((k) => [k, l[k]])));
    return Promise.resolve(new Response(JSON.stringify(lignes)));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('coordonnées RGPD de la mairie', () => {
  it('donne l\'adresse et le DPO d\'un espace géré par la mairie, rien d\'autre', async () => {
    const d = await (await app.request('/tourly/commune/rgpd', {}, ENV)).json() as any;
    expect(d).toEqual({ adresse_mairie: '1 place de la Mairie, 60000 Tourly', dpo: 'CDG 60 — dpo@cdg60.fr' });
  });
  it('rien pour un espace ouvert par des habitants, ni quand le DPA n\'est pas rempli', async () => {
    db.communes[0].espace_officiel = false;
    expect(await (await app.request('/tourly/commune/rgpd', {}, ENV)).json()).toEqual({ adresse_mairie: null, dpo: null });
    db.communes[0].espace_officiel = true;
    db.dpa_communes = [];
    expect(await (await app.request('/tourly/commune/rgpd', {}, ENV)).json()).toEqual({ adresse_mairie: null, dpo: null });
  });
});
