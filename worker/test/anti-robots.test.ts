// worker/test/anti-robots.test.ts
// Protection des inscriptions (lib/anti-robots.ts, 2026-11-06) : Turnstile vérifié côté serveur
// (succès, bonne action, bon site — refus si Cloudflare ne répond pas), temps de saisie, plafonds.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { jetonTurnstileValide, saisieTropRapide, plafondInscriptionsAtteint, plafondDemandesRejoindreAtteint } from '../src/lib/anti-robots';

const contexte = (env: any) => ({ env, req: { header: () => null } });
const ENV_TURNSTILE = { TURNSTILE_SECRET: 'secret-test', TURNSTILE_HOSTNAMES: 'plateforme-agora.fr, newappcitoyenne.pages.dev' };
const reponseSiteverify = (corps: any, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corps), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('Turnstile', () => {
  it('ne bloque rien tant que le secret n’est pas posé sur le Worker', async () => {
    expect(await jetonTurnstileValide(contexte({}), undefined, 'inscription')).toBe(true);
  });

  it('accepte un jeton valide, pour la bonne action, venant de notre site', async () => {
    reponseSiteverify({ success: true, action: 'inscription', hostname: 'plateforme-agora.fr' });
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(true);
  });

  it('refuse : jeton absent, échec, autre action, autre site, liste de sites vide', async () => {
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), undefined, 'inscription')).toBe(false);
    reponseSiteverify({ success: false, action: 'inscription', hostname: 'plateforme-agora.fr' });
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(false);
    reponseSiteverify({ success: true, action: 'rejoindre', hostname: 'plateforme-agora.fr' });
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(false);
    reponseSiteverify({ success: true, action: 'inscription', hostname: 'site-pirate.example' });
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(false);
    expect(await jetonTurnstileValide(contexte({ TURNSTILE_SECRET: 'x' }), 'jeton', 'inscription')).toBe(false);
  });

  it('refuse si Cloudflare ne répond pas ou répond une erreur (on ne laisse jamais passer par défaut)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(false);
    reponseSiteverify({ success: true, action: 'inscription', hostname: 'plateforme-agora.fr' }, 500);
    expect(await jetonTurnstileValide(contexte(ENV_TURNSTILE), 'jeton', 'inscription')).toBe(false);
  });
});

describe('temps de saisie', () => {
  it('écarte un formulaire rempli en moins de 2,5 s, sans pénaliser l’absence de mesure', () => {
    expect(saisieTropRapide(400)).toBe(true);
    expect(saisieTropRapide(8000)).toBe(false);
    expect(saisieTropRapide(undefined)).toBe(false);
  });
});

describe('plafonds', () => {
  const ENV = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const base = (total: number, journal: any[] = []) => {
    const appels: { methode: string; url: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = String(input); const methode = init?.method || 'GET';
      appels.push({ methode, url });
      if (url.includes('journal_activite') && methode === 'GET') return new Response(JSON.stringify(journal));
      if (methode === 'POST') return new Response('[]', { status: 201 });
      return new Response('[]', { headers: { 'content-range': `0-0/${total}` } });
    }));
    return appels;
  };

  it('laisse passer sous le plafond, sans alerte', async () => {
    const appels = base(12);
    expect(await plafondInscriptionsAtteint(ENV, 'c1', 'fay', 40)).toBe(false);
    expect(appels.some((a) => a.methode === 'POST')).toBe(false);
  });

  it('bloque au plafond et alerte le backoffice une seule fois par heure', async () => {
    let appels = base(40);
    expect(await plafondInscriptionsAtteint(ENV, 'c1', 'fay', 40)).toBe(true);
    expect(appels.filter((a) => a.methode === 'POST' && a.url.includes('journal_activite'))).toHaveLength(1);
    appels = base(41, [{ id: 'deja' }]); // alerte déjà posée dans l'heure
    expect(await plafondInscriptionsAtteint(ENV, 'c1', 'fay', 40)).toBe(true);
    expect(appels.some((a) => a.methode === 'POST')).toBe(false);
  });

  it('plafonne les demandes « Rejoindre » sur 24 h (quota d’emails)', async () => {
    base(49);
    expect(await plafondDemandesRejoindreAtteint(ENV)).toBe(false);
    base(50);
    expect(await plafondDemandesRejoindreAtteint(ENV)).toBe(true);
  });
});
