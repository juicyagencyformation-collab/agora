// worker/test/commune-reglages.test.ts
// Réglages techniques des modules (Photo du jour, Énigme photo, Mur des voisins, Découverte
// régionale) : superadmin uniquement, côté serveur comme à l'écran (2026-11-17). Les autres
// réglages de « Ma commune » restent ouverts aux gestionnaires.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import commune, { CHAMPS_REGLAGES_SUPERADMIN } from '../src/routes/commune';

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'fake-jwt-secret-suffisamment-long' };
let ecritures: any[];

beforeEach(() => {
  ecritures = [];
  vi.stubGlobal('fetch', async (_url: any, init?: any) => {
    if (init?.method === 'PATCH') ecritures.push(JSON.parse(String(init.body)));
    return new Response('[]', { status: 200 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function modifier(role: string, corps: Record<string, unknown>) {
  const jeton = await sign({ user_id: 'u-1', commune_id: 'c-1', role, exp: Math.floor(Date.now() / 1000) + 600 }, ENV.JWT_SECRET);
  return commune.request('/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: `agora_access=${jeton}` },
    body: JSON.stringify(corps),
  }, ENV);
}

describe('réglages techniques des modules', () => {
  it.each(['admin', 'elu', 'maire'])('refusés au rôle %s, sans rien écrire', async (role) => {
    for (const corps of [{ mur_duree: '24h' }, { rayon_validation_enigme: 80, enigme_duree: 'an' }, { photo_jour_seuil_validations: 3 }, { partage_regional: true }]) {
      expect((await modifier(role, corps)).status).toBe(403);
    }
    // Glissé au milieu d'un réglage autorisé : refusé aussi, rien n'est écrit.
    expect((await modifier(role, { couleur_theme: '#123456', mur_duree: '24h' })).status).toBe(403);
    expect(ecritures).toEqual([]);
  });

  it('autorisés au superadmin', async () => {
    expect((await modifier('superadmin', { mur_duree: '24h', partage_regional: true })).status).toBe(200);
    expect(ecritures).toEqual([{ mur_duree: '24h', partage_regional: true }]);
  });

  it('les autres réglages restent ouverts aux gestionnaires', async () => {
    expect((await modifier('maire', { couleur_theme: '#123456', contact_email: 'mairie@exemple.fr' })).status).toBe(200);
    expect(ecritures).toHaveLength(1);
    expect(CHAMPS_REGLAGES_SUPERADMIN).toHaveLength(7);
  });
});
