// worker/test/securite-limite.test.ts
// Couvre la limite de tentatives (src/lib/securite.ts) : IP réelle transmise par le relais /api,
// clé IP + email pour la connexion, et surtout les garde-fous de déploiement (inactive sans
// binding ou sans RELAIS_SECRET — sinon tous les visiteurs partageraient le même compteur).
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { limiterDebit, ipClient, egaliteTempsConstant } from '../src/lib/securite';

// Faux binding Rate Limiting : compte par clé, refuse au-delà de `limite`.
function fauxLimiteur(limite: number) {
  const compteurs = new Map<string, number>();
  return {
    cles: compteurs,
    async limit({ key }: { key: string }) {
      const n = (compteurs.get(key) ?? 0) + 1;
      compteurs.set(key, n);
      return { success: n <= limite };
    },
  };
}

function appTest() {
  const app = new Hono();
  app.use('/:slug/auth/login', limiterDebit('LIMITEUR_STRICT', { parEmail: true }));
  app.post('/:slug/auth/login', async (c) => c.json({ email: (await c.req.json()).email }));
  app.get('/:slug/auth/login', (c) => c.json({ ok: true }));
  return app;
}

const SECRET = 'secret-de-test';
const viaRelais = (ip: string, email = 'habitant@exemple.fr') => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Agora-Relais': SECRET, 'X-Agora-Client-IP': ip, 'CF-Connecting-IP': '2a06:98c0:3600::103' },
  body: JSON.stringify({ email, password: 'x' }),
});

describe('limiterDebit', () => {
  it('bloque la 6e tentative sur le même compte depuis la même IP (429 + Retry-After)', async () => {
    const env = { RELAIS_SECRET: SECRET, LIMITEUR_STRICT: fauxLimiteur(5) };
    const statuts: number[] = [];
    let derniere: Response | undefined;
    for (let i = 0; i < 7; i++) {
      derniere = await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7'), env);
      statuts.push(derniere.status);
    }
    expect(statuts).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(derniere!.headers.get('Retry-After')).toBe('60');
  });

  it('laisse le handler relire le corps après le middleware', async () => {
    const env = { RELAIS_SECRET: SECRET, LIMITEUR_STRICT: fauxLimiteur(5) };
    const res = await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7', 'Claire@Exemple.fr'), env);
    expect(await res.json()).toEqual({ email: 'Claire@Exemple.fr' });
  });

  it('ne pénalise pas d’autres habitants derrière la même connexion (clé IP + email)', async () => {
    const limiteur = fauxLimiteur(5);
    const env = { RELAIS_SECRET: SECRET, LIMITEUR_STRICT: limiteur };
    for (let i = 0; i < 6; i++) await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7', 'a@exemple.fr'), env);
    const autre = await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7', 'b@exemple.fr'), env);
    expect(autre.status).toBe(200);
    expect([...limiteur.cles.keys()]).toEqual([
      '203.0.113.7:/:slug/auth/login:a@exemple.fr',
      '203.0.113.7:/:slug/auth/login:b@exemple.fr',
    ]);
  });

  it('reste inactive sans RELAIS_SECRET (déploiement avant configuration du secret)', async () => {
    const limiteur = fauxLimiteur(0);
    const res = await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7'), { LIMITEUR_STRICT: limiteur });
    expect(res.status).toBe(200);
    expect(limiteur.cles.size).toBe(0);
  });

  it('reste inactive sans binding (configuration pas encore déployée)', async () => {
    const res = await appTest().request('/eaucourt/auth/login', viaRelais('203.0.113.7'), { RELAIS_SECRET: SECRET });
    expect(res.status).toBe(200);
  });

  it('ne limite jamais une lecture (GET)', async () => {
    const env = { RELAIS_SECRET: SECRET, LIMITEUR_STRICT: fauxLimiteur(0) };
    const res = await appTest().request('/eaucourt/auth/login', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }, env);
    expect(res.status).toBe(200);
  });
});

describe('ipClient', () => {
  const contexte = (env: any, entetes: Record<string, string>) => ({ env, req: { header: (n: string) => entetes[n] } });

  it('utilise l’IP transmise par le relais quand le secret est valide', () => {
    expect(ipClient(contexte({ RELAIS_SECRET: SECRET }, {
      'X-Agora-Relais': SECRET, 'X-Agora-Client-IP': '203.0.113.7', 'CF-Connecting-IP': '2a06:98c0:3600::103',
    }))).toBe('203.0.113.7');
  });

  it('ignore une IP inventée par un appel direct sans le bon secret', () => {
    expect(ipClient(contexte({ RELAIS_SECRET: SECRET }, {
      'X-Agora-Relais': 'mauvais', 'X-Agora-Client-IP': '1.2.3.4', 'CF-Connecting-IP': '198.51.100.9',
    }))).toBe('198.51.100.9');
    expect(ipClient(contexte({}, { 'X-Agora-Relais': SECRET, 'X-Agora-Client-IP': '1.2.3.4', 'CF-Connecting-IP': '198.51.100.9' }))).toBe('198.51.100.9');
  });
});

describe('egaliteTempsConstant', () => {
  it('compare correctement', () => {
    expect(egaliteTempsConstant('abc', 'abc')).toBe(true);
    expect(egaliteTempsConstant('abc', 'abd')).toBe(false);
    expect(egaliteTempsConstant('abc', 'abcd')).toBe(false);
  });
});
