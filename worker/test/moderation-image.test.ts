// worker/test/moderation-image.test.ts
// Couvre photoSuspecte (src/lib/moderation-image.ts) : filtre préventif Cloudflare Workers AI
// (modèle de vision, binding env.AI) sur les photos soumises par les citoyens, réservé aux
// communes en formule "accompagne" ou "premium". Points les plus importants à vérifier : le
// filtre par formule (argument commercial, jamais pour les communes en "autonomie") et le
// fail-open (jamais de blocage de publication à cause d'un binding absent, d'une réponse
// inattendue du modèle, d'une panne du modèle ou de Supabase).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { photoSuspecte } from '../src/lib/moderation-image';

const DONNEES = new TextEncoder().encode('fausse-image').buffer;
const COMMUNE_ID = 'commune-test';

function stubSupabaseFormule(formule: string | null) {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify([{ formule }]), { status: 200 })));
}

function envAvecAi(run: (...args: any[]) => Promise<any>) {
  return { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', AI: { run } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('photoSuspecte', () => {
  it('ne bloque jamais si le binding AI est absent (fail-open)', async () => {
    const suspecte = await photoSuspecte(
      { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' },
      COMMUNE_ID, DONNEES, 'image/jpeg',
    );
    expect(suspecte).toBe(false);
  });

  it('ne tente jamais d\'analyser un type non-image (ex. audio)', async () => {
    const run = vi.fn();
    const suspecte = await photoSuspecte(envAvecAi(run), COMMUNE_ID, DONNEES, 'audio/webm');
    expect(suspecte).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('n\'appelle jamais le modèle pour une commune en formule "autonomie"', async () => {
    stubSupabaseFormule('autonomie');
    const run = vi.fn();
    const suspecte = await photoSuspecte(envAvecAi(run), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('n\'appelle jamais le modèle pour une commune sans formule définie', async () => {
    stubSupabaseFormule(null);
    const run = vi.fn();
    const suspecte = await photoSuspecte(envAvecAi(run), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('détecte une photo jugée à refuser (réponse "OUI") pour une commune "accompagne"', async () => {
    stubSupabaseFormule('accompagne');
    const suspecte = await photoSuspecte(envAvecAi(async () => ({ response: 'OUI' })), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(true);
  });

  it('laisse passer une photo jugée sûre (réponse "NON") pour une commune "premium"', async () => {
    stubSupabaseFormule('premium');
    const suspecte = await photoSuspecte(envAvecAi(async () => ({ response: 'NON' })), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
  });

  it('ne bloque jamais si la réponse du modèle est inattendue (fail-open)', async () => {
    stubSupabaseFormule('premium');
    const suspecte = await photoSuspecte(envAvecAi(async () => ({ response: 'Je ne peux pas répondre à cela.' })), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
  });

  it('ne bloque jamais si le modèle échoue (fail-open)', async () => {
    stubSupabaseFormule('premium');
    const suspecte = await photoSuspecte(envAvecAi(async () => { throw new Error('modèle non accepté sur ce compte'); }), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
  });

  it('ne bloque jamais si Supabase est injoignable (fail-open)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNRESET')));
    const suspecte = await photoSuspecte(envAvecAi(async () => ({ response: 'OUI' })), COMMUNE_ID, DONNEES, 'image/jpeg');
    expect(suspecte).toBe(false);
  });
});
