// worker/test/role-staff.test.ts
// Couvre exigerAdmin (src/middleware/backoffice.ts, migration 094) : un compte « assistant » est
// refusé sur les réglages sensibles de la SOP §8, un « admin » passe, et tant que la colonne role
// n'existe pas (migration pas encore lancée) personne n'est bloqué.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { backofficeMiddleware, exigerAdmin } from '../src/middleware/backoffice';

const env = { JWT_SECRET: 'secret-de-test', SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };

function appProtegee() {
  const app = new Hono();
  app.put('/reglage', backofficeMiddleware, exigerAdmin, (c) => c.json({ ok: true }));
  return app;
}

async function appeler(reponseSupabase: () => Promise<Response>) {
  vi.stubGlobal('fetch', reponseSupabase);
  const jeton = await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 600 }, env.JWT_SECRET);
  return appProtegee().request('/reglage', { method: 'PUT', headers: { Cookie: `agora_bo=${jeton}` } }, env);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('exigerAdmin', () => {
  it('refuse un assistant', async () => {
    const res = await appeler(async () => new Response(JSON.stringify([{ role: 'assistant' }])));
    expect(res.status).toBe(403);
  });

  it('laisse passer un admin', async () => {
    const res = await appeler(async () => new Response(JSON.stringify([{ role: 'admin' }])));
    expect(res.status).toBe(200);
  });

  it('laisse passer tout le monde tant que la migration 094 n’est pas lancée', async () => {
    const res = await appeler(async () => new Response('{"message":"column staff_backoffice.role does not exist"}', { status: 400 }));
    expect(res.status).toBe(200);
  });
});
