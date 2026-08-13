// worker/test/backoffice-middleware.test.ts
// Garde de sécurité du backoffice : seul un jeton portant scope='backoffice' + staff_id passe.
// Un jeton citoyen (même superadmin), qui n'a pas ce scope, doit être rejeté — c'est le point
// d'isolation central entre le périmètre staff et le périmètre tenant.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { backofficeMiddleware } from '../src/middleware/backoffice';

const SECRET = 'secret-de-test';
const env = { JWT_SECRET: SECRET };

function appProtegee() {
  const app = new Hono();
  app.get('/protege', backofficeMiddleware, (c) => c.json({ staff_id: c.get('staff_id') }));
  return app;
}

function avecCookie(token?: string) {
  return token ? { headers: { Cookie: `agora_bo=${token}` } } : {};
}

describe('backofficeMiddleware', () => {
  it('refuse sans cookie', async () => {
    const res = await appProtegee().request('/protege', {}, env);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton citoyen (pas de scope backoffice)', async () => {
    const jetonCitoyen = await sign(
      { user_id: 'u1', commune_id: 'c1', role: 'superadmin', exp: Math.floor(Date.now() / 1000) + 900 },
      SECRET,
    );
    const res = await appProtegee().request('/protege', avecCookie(jetonCitoyen), env);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const jetonEtranger = await sign(
      { staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 },
      'mauvais-secret',
    );
    const res = await appProtegee().request('/protege', avecCookie(jetonEtranger), env);
    expect(res.status).toBe(401);
  });

  it('accepte un jeton backoffice valide et expose staff_id', async () => {
    const jetonStaff = await sign(
      { staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 },
      SECRET,
    );
    const res = await appProtegee().request('/protege', avecCookie(jetonStaff), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ staff_id: 's1' });
  });
});
