// worker/test/copie-envois.test.ts
// Copie cachée des emails envoyés à la main depuis le backoffice (lib/email.ts, copieEnvois) :
// ajoutée seulement si l'adresse est configurée, jamais en double avec le destinataire.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { envoyerEmail, copieEnvois } from '../src/lib/email';

let corps: any[];
beforeEach(() => {
  corps = [];
  vi.stubGlobal('fetch', (_url: any, init?: any) => {
    corps.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

const ENV = { RESEND_API_KEY: 'r', EMAIL_FROM: 'Plateforme-Agora <contact@plateforme-agora.fr>', EMAIL_COPIE_ENVOIS: ' contact@plateforme-agora.fr ' };

describe('copie cachée des envois manuels', () => {
  it('lit l\'adresse configurée (espaces retirés), rien si elle est vide', () => {
    expect(copieEnvois(ENV)).toBe('contact@plateforme-agora.fr');
    expect(copieEnvois({})).toBeUndefined();
    expect(copieEnvois({ EMAIL_COPIE_ENVOIS: '  ' })).toBeUndefined();
  });

  it('ajoute la copie cachée quand elle est demandée, pas sinon, ni vers le destinataire lui-même', async () => {
    await envoyerEmail(ENV, 'mairie@tourly.fr', 'Objet', '<p>x</p>', undefined, undefined, undefined, copieEnvois(ENV));
    await envoyerEmail(ENV, 'mairie@tourly.fr', 'Objet', '<p>x</p>');
    await envoyerEmail(ENV, 'Contact@plateforme-agora.fr', 'Objet', '<p>x</p>', undefined, undefined, undefined, copieEnvois(ENV));
    expect(corps[0].bcc).toBe('contact@plateforme-agora.fr');
    expect(corps[1].bcc).toBeUndefined();
    expect(corps[2].bcc).toBeUndefined();
  });
});
