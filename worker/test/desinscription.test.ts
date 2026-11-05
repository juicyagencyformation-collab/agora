// worker/test/desinscription.test.ts
// Couvre la désinscription des emails de suivi (src/lib/desinscription.ts, routes/desinscription.ts) :
// signature infalsifiable, lien + en-têtes List-Unsubscribe ajoutés à l'envoi, adresse désinscrite
// jamais relancée, page publique (GET sans effet, POST qui enregistre, lien bricolé refusé).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { signatureDesinscription, signatureValide, lienDesinscription, envoyerEmailSuivi } from '../src/lib/desinscription';
import routes from '../src/routes/desinscription';

const env = {
  JWT_SECRET: 'secret-de-test', FRONTEND_URL: 'https://plateforme-agora.fr',
  SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', RESEND_API_KEY: 'r', EMAIL_FROM: 'test@exemple.fr',
};

// Faux réseau : Supabase (table desinscriptions_email / communes) + Resend.
function reseau({ desinscrite = false } = {}) {
  const appels: { url: string; methode: string; corps: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: any = {}) => {
    const u = decodeURIComponent(String(url));
    appels.push({ url: u, methode: init.method || 'GET', corps: init.body ? JSON.parse(init.body) : null });
    if (u.includes('api.resend.com')) return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    if (u.includes('/desinscriptions_email') && (init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(desinscrite ? [{ id: 'x' }] : []), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  });
  return appels;
}

afterEach(() => vi.unstubAllGlobals());

describe('signature', () => {
  it('est stable, insensible à la casse, et refuse une adresse ou une signature bricolée', async () => {
    const s = await signatureDesinscription(env, 'Mairie@Exemple.fr');
    expect(s).toMatch(/^[a-f0-9]{32}$/);
    expect(await signatureValide(env, 'mairie@exemple.fr', s)).toBe(true);
    expect(await signatureValide(env, 'autre@exemple.fr', s)).toBe(false);
    expect(await signatureValide(env, 'mairie@exemple.fr', '0'.repeat(32))).toBe(false);
    expect(await signatureValide({ ...env, JWT_SECRET: 'autre' }, 'mairie@exemple.fr', s)).toBe(false);
  });

  it('construit un lien passant par le relais /api', async () => {
    expect(await lienDesinscription(env, 'A@B.fr')).toMatch(/^https:\/\/plateforme-agora\.fr\/api\/desinscription\?e=a%40b\.fr&s=[a-f0-9]{32}$/);
  });
});

describe('envoyerEmailSuivi', () => {
  it('ajoute le lien en bas et les en-têtes de désinscription des messageries', async () => {
    const appels = reseau();
    const id = await envoyerEmailSuivi(env, 'mairie@exemple.fr', 'Objet', '<html><body><p>Bonjour</p></body></html>');
    expect(id).toBe('email-1');
    const envoi = appels.find((a) => a.url.includes('api.resend.com'))!.corps;
    expect(envoi.html).toContain('Ne plus recevoir ces emails');
    expect(envoi.html.indexOf('Ne plus recevoir')).toBeLessThan(envoi.html.indexOf('</body>'));
    expect(envoi.headers['List-Unsubscribe']).toMatch(/^<https:\/\/plateforme-agora\.fr\/api\/desinscription\?e=mairie%40exemple\.fr&s=[a-f0-9]{32}>$/);
    expect(envoi.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('n’envoie rien à une adresse désinscrite', async () => {
    const appels = reseau({ desinscrite: true });
    expect(await envoyerEmailSuivi(env, 'mairie@exemple.fr', 'Objet', '<p>x</p>')).toBeNull();
    expect(appels.some((a) => a.url.includes('api.resend.com'))).toBe(false);
  });
});

describe('page publique de désinscription', () => {
  it('GET : affiche une confirmation sans rien enregistrer', async () => {
    const appels = reseau();
    const s = await signatureDesinscription(env, 'mairie@exemple.fr');
    const res = await routes.request(`/?e=mairie%40exemple.fr&s=${s}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Confirmer la désinscription');
    expect(appels.some((a) => a.methode === 'POST')).toBe(false);
  });

  it('POST : enregistre la désinscription (bouton des messageries compris)', async () => {
    const appels = reseau();
    const s = await signatureDesinscription(env, 'mairie@exemple.fr');
    const res = await routes.request(`/?e=mairie%40exemple.fr&s=${s}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }, env);
    expect(res.status).toBe(200);
    const ecriture = appels.find((a) => a.url.includes('/desinscriptions_email') && a.methode === 'POST');
    expect(ecriture?.corps).toEqual([{ email: 'mairie@exemple.fr', source: 'messagerie', commune_id: null }]);
  });

  it('refuse un lien dont la signature a été bricolée', async () => {
    const appels = reseau();
    const res = await routes.request(`/?e=victime%40exemple.fr&s=${'a'.repeat(32)}`, { method: 'POST' }, env);
    expect(res.status).toBe(400);
    expect(appels.some((a) => a.methode === 'POST')).toBe(false);
  });
});
