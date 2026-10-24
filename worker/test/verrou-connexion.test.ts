// worker/test/verrou-connexion.test.ts
// Couvre le verrou par compte après trop d'échecs de mot de passe (src/lib/securite.ts) : seuil,
// filtres envoyés à Supabase (email en minuscules, commune ou backoffice), et surtout le
// fail-open — une table absente ou une panne Supabase ne doit JAMAIS bloquer les connexions.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { connexionVerrouillee, enregistrerEchecConnexion, MAX_ECHECS_CONNEXION } from '../src/lib/securite';

const env = { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };

function supabaseRenvoie(total: number | null, statut = 200) {
  const appels: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    appels.push(decodeURIComponent(String(url)));
    const headers = total === null ? {} : { 'content-range': `0-0/${total}` };
    return new Response('[]', { status: statut, headers });
  });
  return appels;
}

afterEach(() => vi.unstubAllGlobals());

describe('connexionVerrouillee', () => {
  it(`bloque à partir de ${MAX_ECHECS_CONNEXION} échecs, pas avant`, async () => {
    supabaseRenvoie(MAX_ECHECS_CONNEXION - 1);
    expect(await connexionVerrouillee(env, 'commune-1', 'a@b.fr')).toBe(false);
    supabaseRenvoie(MAX_ECHECS_CONNEXION);
    expect(await connexionVerrouillee(env, 'commune-1', 'a@b.fr')).toBe(true);
  });

  it('compte par commune et par email en minuscules ; commune null = backoffice', async () => {
    const appels = supabaseRenvoie(0);
    await connexionVerrouillee(env, 'commune-1', '  Claire@Exemple.FR ');
    await connexionVerrouillee(env, null, 'staff@exemple.fr');
    expect(appels[0]).toContain('email=eq.claire@exemple.fr');
    expect(appels[0]).toContain('commune_id=eq.commune-1');
    expect(appels[0]).toContain('created_at=gte.');
    expect(appels[1]).toContain('commune_id=is.null');
  });

  it('laisse passer si la table n’existe pas encore (migration non appliquée)', async () => {
    supabaseRenvoie(null, 404);
    expect(await connexionVerrouillee(env, 'commune-1', 'a@b.fr')).toBe(false);
  });

  it('laisse passer si Supabase est injoignable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('réseau'); });
    expect(await connexionVerrouillee(env, 'commune-1', 'a@b.fr')).toBe(false);
  });
});

describe('enregistrerEchecConnexion', () => {
  it('n’interrompt jamais la connexion en cas d’erreur', async () => {
    supabaseRenvoie(null, 404);
    await expect(enregistrerEchecConnexion(env, 'commune-1', 'a@b.fr')).resolves.toBeUndefined();
  });
});
