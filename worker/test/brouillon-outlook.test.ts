// worker/test/brouillon-outlook.test.ts
// Brouillon Outlook (.eml) préparé depuis l'onglet Échanges : fichier ouvert en rédaction par
// Outlook (X-Unsent), mise en forme HTML et pièces jointes ; mêmes garde-fous que l'envoi Resend.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import prospection from '../src/backoffice/prospection';
import { construireEml, encoderEnTete, texteDepuisHtml } from '../src/lib/eml';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET,
  FRONTEND_URL: 'https://plateforme-agora.fr', EMAIL_FROM: 'Plateforme-Agora <contact@plateforme-agora.fr>',
  EMAIL_REPLY_TO_PROSPECTION: 'prospection@replies.plateforme-agora.fr',
};
const P1 = '11111111-1111-4111-8111-111111111111';

const decoderPartie = (eml: string, type: string) => {
  const m = eml.match(new RegExp(`Content-Type: ${type}; charset="utf-8"\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n--`));
  return m ? new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/\r\n/g, '')), (ch) => ch.charCodeAt(0))) : '';
};

beforeEach(() => {
  db = {
    prospects: [{ id: P1, nom: 'Fay-les-Étangs', contact_email: 'mairie@fay.fr', statut: 'contacte', commune_id: null }],
    prospect_interactions: [], desinscriptions_email: [], communes: [],
  };
  vi.stubGlobal('fetch', (input: any, init?: any) => {
    const url = new URL(String(input));
    const table = url.pathname.replace('/rest/v1/', '');
    const methode = init?.method || 'GET';
    if (methode === 'POST') { (db[table] ??= []).push(JSON.parse(String(init.body))); return Promise.resolve(new Response('[]', { status: 201 })); }
    if (methode === 'PATCH') return Promise.resolve(new Response('[]'));
    const lignes = (db[table] || []).filter((l) => [...url.searchParams.entries()].every(([k, v]) =>
      ['select', 'limit', 'order'].includes(k) || !v.startsWith('eq.') || String(l[k]) === v.slice(3)));
    return Promise.resolve(new Response(JSON.stringify(lignes)));
  });
});
afterEach(() => vi.unstubAllGlobals());

const preparer = async (corps: object) => prospection.request(`/prospects/${P1}/brouillon-outlook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` },
  body: JSON.stringify(corps),
}, ENV);

describe('fichier .eml', () => {
  it('s\'ouvre en rédaction, encode l\'objet accentué, porte le HTML, le texte et les pièces jointes', () => {
    const eml = construireEml({
      de: 'Plateforme-Agora <contact@plateforme-agora.fr>', a: 'mairie@fay.fr', repondreA: 'prospection@replies.plateforme-agora.fr',
      objet: 'Votre application à Fay', html: '<p>Bonjour <b>Madame</b>,</p><p>Voici le lien : <a href="https://plateforme-agora.fr/fay/">votre espace</a></p>',
      pieces: [{ nom: 'Plaquette - Fay-les-Étangs.pdf', type: 'application/pdf', contenu: new TextEncoder().encode('%PDF-1.4 test') }],
    });
    expect(eml.startsWith('X-Unsent: 1\r\n')).toBe(true);
    expect(eml).toContain('To: mairie@fay.fr\r\n');
    expect(eml).toContain('Reply-To: prospection@replies.plateforme-agora.fr\r\n');
    expect(eml).toContain(`Subject: ${encoderEnTete('Votre application à Fay')}\r\n`);
    expect(encoderEnTete('Votre application à Fay')).toMatch(/^=\?UTF-8\?B\?/);
    expect(decoderPartie(eml, 'text/html')).toContain('Bonjour <b>Madame</b>');
    expect(decoderPartie(eml, 'text/plain')).toContain('votre espace (https://plateforme-agora.fr/fay/)');
    expect(eml).toContain('filename="Plaquette - Fay-les-Etangs.pdf"');
    expect(eml).toContain(`filename*=UTF-8''${encodeURIComponent('Plaquette - Fay-les-Étangs.pdf')}`);
    expect(eml.trimEnd().endsWith('--')).toBe(true);
    expect(texteDepuisHtml('<p>a&amp;b</p><br>c')).toBe('a&b\n\nc');
  });
});

describe('route du brouillon Outlook', () => {
  it('email libre sans pièce jointe : fichier .eml, lien de désinscription, trace avec le texte dans Échanges', async () => {
    const res = await preparer({ modele: 'libre', objet: 'Suite à notre appel', message: 'Bonjour,\nvoici les informations.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('message/rfc822');
    expect(res.headers.get('Content-Disposition')).toContain('.eml');
    const eml = await res.text();
    expect(eml).toContain('To: mairie@fay.fr');
    const html = decoderPartie(eml, 'text/html');
    expect(html).toContain('Bonjour,<br>voici les informations.');
    expect(html).toContain('/api/desinscription?e=mairie%40fay.fr');
    expect(db.prospect_interactions[0].contenu).toContain('Brouillon Outlook (email libre) préparé pour mairie@fay.fr');
    expect(db.prospect_interactions[0].contenu).toContain('voici les informations.');
  });

  it('refuse une adresse désinscrite, un email libre incomplet, et des documents sans espace créé', async () => {
    db.desinscriptions_email.push({ id: 'd1', email: 'mairie@fay.fr' });
    expect((await preparer({ modele: 'libre', objet: 'x', message: 'y' })).status).toBe(409);
    db.desinscriptions_email = [];
    expect((await preparer({ modele: 'libre', objet: 'x' })).status).toBe(400);
    expect((await preparer({ modele: 'libre', objet: 'x', message: 'y', documents: ['affiche'] })).status).toBe(400);
    expect((await preparer({ modele: 'libre', objet: 'x', message: 'y', documents: ['inconnu'] })).status).toBe(400);
    expect(db.prospect_interactions).toHaveLength(0);
  });

  it('plaquette demandée sans navigateur Cloudflare : message clair, rien de noté', async () => {
    const res = await preparer({ modele: 'libre', objet: 'x', message: 'y', documents: ['plaquette'] });
    expect(res.status).toBe(502);
    expect((await res.json() as any).erreur).toContain('PDF indisponible');
    expect(db.prospect_interactions).toHaveLength(0);
  });
});
