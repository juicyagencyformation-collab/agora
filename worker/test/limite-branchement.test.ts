// worker/test/limite-branchement.test.ts
// Vérifie le BRANCHEMENT de la limite de tentatives dans l'app réelle (src/index.ts : ordre des
// middlewares, chemins), pas seulement le middleware isolé (voir securite-limite.test.ts).
// Un faux limiteur qui refuse tout doit produire un 429 AVANT toute lecture en base.
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const refuseTout = { limit: async () => ({ success: false }) };
const env = { RELAIS_SECRET: 's', LIMITEUR_STRICT: refuseTout, LIMITEUR_LARGE: refuseTout, JWT_SECRET: 'x' };
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

function post(chemin: string) {
  return new Request('https://agora-worker.test' + chemin, {
    method: 'POST',
    headers: { Origin: 'https://plateforme-agora.fr', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
    body: JSON.stringify({ email: 'x@exemple.invalid', password: 'faux' }),
  });
}

describe('branchement de la limite de tentatives (app réelle)', () => {
  for (const chemin of ['/eaucourt/auth/login', '/backoffice/auth/login', '/eaucourt/auth/mot-de-passe-oublie', '/eaucourt/auth/register']) {
    it(`429 sur ${chemin} quand le limiteur refuse`, async () => {
      const res = await (worker as any).fetch(post(chemin), env, ctx);
      expect(res.status).toBe(429);
    });
  }
});
