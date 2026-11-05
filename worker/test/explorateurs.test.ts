// worker/test/explorateurs.test.ts
// Espace Explorateurs (migration 098) : un compte de passage ne doit rien voir d'autre que son
// compte et les jeux des villages (middleware/explorateurs.ts, refus par défaut), et il est
// anonymisé après 12 mois sans connexion (cron.ts, purgerExplorateursInactifs).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { gardeEspaceExplorateurs } from '../src/middleware/explorateurs';
import { purgerExplorateursInactifs } from '../src/cron';

// Même enchaînement que index.ts : tenantMiddleware pose slug_commune, puis le verrou.
const app = new Hono();
app.use('/:slug/*', async (c, next) => { c.set('slug_commune', c.req.param('slug')); await next(); }, gardeEspaceExplorateurs);
app.all('*', (c) => c.text('ok'));
const statut = async (chemin: string, method = 'GET') => (await app.request(chemin, { method })).status;

describe('verrou de l’espace Explorateurs', () => {
  it('laisse passer le compte et les jeux des villages', async () => {
    for (const chemin of ['/explorateurs/auth/me', '/explorateurs/auth/register', '/explorateurs/commune', '/explorateurs/profil',
      '/explorateurs/push/preferences', '/explorateurs/jeux-ailleurs/fay', '/explorateurs/jeux-ailleurs/valider-qr']) {
      expect(await statut(chemin), chemin).toBe(200);
    }
    expect(await statut('/explorateurs/moderation/onglets')).toBe(200);
  });

  it('refuse tout le reste, y compris un module inconnu ou une écriture sur les onglets', async () => {
    for (const chemin of ['/explorateurs/mur', '/explorateurs/actus', '/explorateurs/coups-de-main', '/explorateurs/annuaire',
      '/explorateurs/enigmes', '/explorateurs/chasses-tresor/valider', '/explorateurs/moderation/utilisateurs',
      '/explorateurs/messages-mairie', '/explorateurs/module-de-demain']) {
      expect(await statut(chemin), chemin).toBe(403);
    }
    expect(await statut('/explorateurs/moderation/onglets/mur', 'PATCH')).toBe(403);
    expect(await statut('/explorateurs/enigmes', 'POST')).toBe(403);
  });

  it('ne touche à aucune autre commune', async () => {
    expect(await statut('/fay/mur')).toBe(200);
    expect(await statut('/fay/enigmes', 'POST')).toBe(200);
  });
});

describe('purge des comptes Explorateurs inactifs', () => {
  let requetes: { methode: string; url: URL; corps?: any }[];
  const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

  beforeEach(() => {
    requetes = [];
    vi.stubGlobal('fetch', (input: any, init?: any) => {
      const url = new URL(String(input));
      const methode = init?.method || 'GET';
      requetes.push({ methode, url, corps: init?.body ? JSON.parse(String(init.body)) : undefined });
      const table = url.pathname.replace('/rest/v1/', '');
      if (methode === 'GET' && table === 'communes') return Promise.resolve(new Response(JSON.stringify([{ id: 'c-explo' }])));
      if (methode === 'GET' && table === 'users') return Promise.resolve(new Response(JSON.stringify([{ id: 'u-vieux' }])));
      return Promise.resolve(new Response('[]'));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cherche seulement les comptes de l’espace, non supprimés, sans connexion depuis 12 mois', async () => {
    await purgerExplorateursInactifs(ENV);
    const espace = requetes.find((r) => r.url.pathname.endsWith('/communes'))!;
    expect(espace.url.searchParams.get('slug')).toBe('eq.explorateurs');
    expect(espace.url.searchParams.get('niveau_national')).toBe('eq.true');

    const recherche = requetes.find((r) => r.methode === 'GET' && r.url.pathname.endsWith('/users'))!;
    expect(recherche.url.searchParams.get('commune_id')).toBe('eq.c-explo');
    expect(recherche.url.searchParams.get('compte_supprime_le')).toBe('is.null');
    const seuil = recherche.url.searchParams.get('or')!.match(/derniere_connexion_streak\.lt\.(\d{4}-\d{2}-\d{2})/)![1];
    const joursEcoules = (Date.now() - new Date(seuil).getTime()) / (24 * 3600 * 1000);
    expect(Math.round(joursEcoules)).toBe(365);
  });

  it('anonymise le compte trouvé comme « Supprimer mon compte »', async () => {
    await purgerExplorateursInactifs(ENV);
    const anonymisation = requetes.find((r) => r.methode === 'PATCH' && r.url.pathname.endsWith('/users'))!;
    expect(anonymisation.url.searchParams.get('id')).toBe('eq.u-vieux');
    expect(anonymisation.url.searchParams.get('commune_id')).toBe('eq.c-explo');
    expect(anonymisation.corps).toMatchObject({ email: 'supprime-u-vieux@anonyme.local', nom: 'Compte', prenom: 'supprimé' });
    expect(requetes.some((r) => r.methode === 'DELETE' && r.url.pathname.endsWith('/refresh_tokens'))).toBe(true);
  });
});
