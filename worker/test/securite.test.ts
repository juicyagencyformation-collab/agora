// worker/test/securite.test.ts
// Couvre src/lib/securite.ts : liste d'origines EXACTE (CORS), refus des écritures inter-sites
// (CSRF), et options des cookies. Testé via une mini-app Hono montée comme dans index.ts, pour
// ne pas dépendre de toutes les routes.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { origineAutorisee, protectionCsrf, OPTIONS_COOKIE } from '../src/lib/securite';

function appTest() {
  const app = new Hono();
  app.use('*', cors({ origin: (origin, c) => (origineAutorisee(origin, c.env) ? origin : ''), credentials: true, maxAge: 600 }));
  app.use('*', protectionCsrf);
  app.get('/eaucourt/actus', (c) => c.json({ ok: true }));
  app.post('/eaucourt/auth/login', (c) => c.json({ ok: true }));
  app.post('/backoffice/webhook-resend', (c) => c.json({ erreur: 'Signature invalide' }, 401));
  return app;
}

describe('origineAutorisee', () => {
  it('accepte le domaine de production, ses sous-domaines et l’adresse de secours', () => {
    expect(origineAutorisee('https://plateforme-agora.fr')).toBe(true);
    expect(origineAutorisee('https://www.plateforme-agora.fr')).toBe(true);
    expect(origineAutorisee('https://newappcitoyenne.pages.dev')).toBe(true);
    expect(origineAutorisee('https://abc123.newappcitoyenne.pages.dev')).toBe(true);
  });

  it('refuse les origines qui ne font que ressembler', () => {
    for (const o of [
      'https://pirate.pages.dev',
      'https://localhost.pirate.com',
      'https://192.168.pirate.com',
      'https://plateforme-agora.fr.pirate.com',
      'https://pirateplateforme-agora.fr',
      'http://plateforme-agora.fr',
      'https://newappcitoyenne.pages.dev.pirate.com',
      'null',
      '',
    ]) {
      expect(origineAutorisee(o), o).toBe(false);
    }
    expect(origineAutorisee(undefined)).toBe(false);
  });

  it('n’accepte localhost et le réseau local qu’en développement', () => {
    expect(origineAutorisee('http://localhost:5173')).toBe(false);
    expect(origineAutorisee('http://192.168.1.20:8787')).toBe(false);
    expect(origineAutorisee('http://localhost:5173', { ENVIRONNEMENT: 'dev' })).toBe(true);
    expect(origineAutorisee('http://127.0.0.1:8787', { ENVIRONNEMENT: 'dev' })).toBe(true);
    expect(origineAutorisee('http://192.168.1.20:8787', { ENVIRONNEMENT: 'dev' })).toBe(true);
    expect(origineAutorisee('http://localhost.pirate.com', { ENVIRONNEMENT: 'dev' })).toBe(false);
  });
});

describe('CORS', () => {
  it('renvoie l’en-tête Access-Control-Allow-Origin pour plateforme-agora.fr', async () => {
    const res = await appTest().request('/eaucourt/actus', { headers: { Origin: 'https://plateforme-agora.fr' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://plateforme-agora.fr');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('ne renvoie rien d’exploitable pour une origine pirate', async () => {
    for (const o of ['https://pirate.pages.dev', 'https://localhost.pirate.com', 'https://plateforme-agora.fr.pirate.com']) {
      const res = await appTest().request('/eaucourt/actus', { headers: { Origin: o } });
      expect(res.headers.get('Access-Control-Allow-Origin') ?? '', o).not.toBe(o);
    }
  });
});

describe('protectionCsrf', () => {
  it('laisse passer une connexion depuis le vrai site', async () => {
    const res = await appTest().request('/eaucourt/auth/login', {
      method: 'POST', headers: { Origin: 'https://plateforme-agora.fr', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(200);
  });

  it('refuse une écriture depuis une origine pirate', async () => {
    const res = await appTest().request('/eaucourt/auth/login', {
      method: 'POST', headers: { Origin: 'https://pirate.pages.dev', 'Content-Type': 'text/plain' }, body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('refuse une écriture sans Origin mais marquée inter-sites par le navigateur', async () => {
    const res = await appTest().request('/eaucourt/auth/login', {
      method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('laisse passer le webhook Resend (pas d’Origin) jusqu’à sa propre vérification de signature', async () => {
    const res = await appTest().request('/backoffice/webhook-resend', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('ne bloque jamais une lecture (GET), même depuis ailleurs', async () => {
    const res = await appTest().request('/eaucourt/actus', { headers: { Origin: 'https://pirate.pages.dev' } });
    expect(res.status).toBe(200);
  });
});

describe('OPTIONS_COOKIE', () => {
  it('pose des cookies httpOnly, Secure, SameSite=Lax', () => {
    expect(OPTIONS_COOKIE).toEqual({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });
});
