// worker/test/purge-echanges-prospection.test.ts
// Durée de conservation des échanges de prospection (3 ans, annoncée dans la politique de
// confidentialité le 2026-11-06) : les réponses reçues et le suivi des envois plus anciens sont
// supprimés, jamais la liste d'opposition (emails_rejetes).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { purgerEchangesProspection, DUREE_CONSERVATION_PROSPECTION_MS } from '../src/cron';

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

afterEach(() => vi.unstubAllGlobals());

describe('purgerEchangesProspection', () => {
  it('supprime les échanges de plus de 3 ans, et seulement ceux-là', async () => {
    const appels: { methode: string; table: string; params: URLSearchParams }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = new URL(String(input));
      appels.push({ methode: init?.method || 'GET', table: url.pathname.replace('/rest/v1/', ''), params: url.searchParams });
      return new Response(null, { status: 204 });
    }));
    const avant = Date.now();
    await purgerEchangesProspection(ENV);

    expect(appels.map((a) => `${a.methode} ${a.table}`)).toEqual(['DELETE emails_recus', 'DELETE envois_prospection']);
    const limite = (filtre: string | null) => new Date(String(filtre).replace(/^lt\./, '')).getTime();
    for (const [appel, colonne] of [[appels[0], 'created_at'], [appels[1], 'envoye_le']] as const) {
      expect(appel.params.get(colonne)).toMatch(/^lt\./);
      expect(Math.abs(limite(appel.params.get(colonne)) - (avant - DUREE_CONSERVATION_PROSPECTION_MS))).toBeLessThan(60_000);
    }
    // La liste d'opposition n'est jamais touchée.
    expect(appels.some((a) => a.table === 'emails_rejetes')).toBe(false);
  });
});
