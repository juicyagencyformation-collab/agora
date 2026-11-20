// worker/test/accord-maire.test.ts
// Accord du maire par lien personnel, sans compte (migration 109) : envoi depuis le backoffice
// (preuves-cgu.ts), page qui n'enregistre RIEN sur un simple GET (scanners des messageries),
// accord au clic (POST) journalisé comme une acceptation « maire » par le lien, usage unique,
// expiration. Même esprit de faux fetch() que auth-cgu-soustraitance.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import accordMaire from '../src/routes/accord-maire';
import preuvesCgu from '../src/backoffice/preuves-cgu';
import { VERSION_CGU } from '../src/lib/cgu';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emails: any[];

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET,
  FRONTEND_URL: 'https://site.test', RESEND_API_KEY: 'cle-de-test',
};
const C1 = '11111111-1111-4111-8111-111111111111';
const PAGE_CGU = `<html><head><meta name="version-cgu" content="${VERSION_CGU}"></head><body>Sous-traitance de données personnelles</body></html>`;

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre === 'is.null') return valeur == null;
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  return true;
}
function filtrer(table: Ligne[], params: URLSearchParams): Ligne[] {
  return table.filter((l) => [...params.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k) || correspond(l[k], v)));
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === 'https://api.resend.com') {
    emails.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ id: `resend-${emails.length}` }), { status: 200 }));
  }
  if (url.origin === ENV.FRONTEND_URL) return Promise.resolve(new Response(PAGE_CGU, { status: 200 }));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const lignes = filtrer(db[table] ||= [], url.searchParams);
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  if (methode === 'PATCH') {
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const ajoutes = [JSON.parse(String(init.body))].flat().map((l) => ({ id: `${table}-${db[table].length + 1}`, created_at: new Date().toISOString(), ...l }));
    db[table].push(...ajoutes);
    return Promise.resolve(new Response(JSON.stringify(ajoutes), { status: 201 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const sessionStaff = async () => ({
  'Content-Type': 'application/json',
  Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
async function demanderLien(corps: object = {}) {
  const res = await preuvesCgu.request(`/${C1}/demander-accord-maire`, { method: 'POST', headers: await sessionStaff(), body: JSON.stringify(corps) }, ENV);
  const token = String(emails.at(-1)?.html || '').match(/accord-maire\/([a-f0-9-]+)/)?.[1];
  return { res, token };
}
const cliquer = (token: string, nom = 'Marie Dupont') => accordMaire.request(`/${token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '198.51.100.4' },
  body: new URLSearchParams({ nom }).toString(),
}, ENV);

beforeEach(() => {
  db = {
    communes: [{ id: C1, nom: 'Commune Un', slug: 'un', email_mairie: 'mairie@c1.fr' }],
    prospects: [{ commune_id: C1, nom_maire: 'Marie Dupont', maire_civilite: 'Madame' }],
    users: [], conventions: [], demandes_accord_maire: [], acceptations_cgu: [], versions_cgu: [], journal_activite: [],
  };
  emails = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Envoi du lien depuis le backoffice', () => {
  it('refuse sans session staff', async () => {
    const res = await preuvesCgu.request(`/${C1}/demander-accord-maire`, { method: 'POST', body: '{}' }, ENV);
    expect(res.status).toBe(401);
    expect(emails).toHaveLength(0);
  });

  it('envoie à l\'adresse de la mairie, à la maire nommée, et ne stocke que l\'empreinte du jeton', async () => {
    const { res, token } = await demanderLien();
    expect(res.status).toBe(200);
    expect(emails[0].to).toBe('mairie@c1.fr');
    expect(emails[0].html).toContain('Madame la Maire');
    expect(token).toBeTruthy();
    expect(db.demandes_accord_maire[0]).toMatchObject({ commune_id: C1, envoye_a: 'mairie@c1.fr', nom_maire: 'Marie Dupont' });
    expect(db.demandes_accord_maire[0].token_hash).not.toContain(token!);
  });

  it('accepte une autre adresse saisie, refuse une adresse invalide', async () => {
    expect((await demanderLien({ email: 'Maire.Perso@Exemple.fr' })).res.status).toBe(200);
    expect(emails[0].to).toBe('maire.perso@exemple.fr');
    expect((await demanderLien({ email: 'pas-un-email' })).res.status).toBe(400);
  });
});

describe('Page du lien et accord du maire', () => {
  it('le simple affichage (GET) n\'enregistre rien', async () => {
    const { token } = await demanderLien();
    const res = await accordMaire.request(`/${token}`, {}, ENV);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="Marie Dupont"');
    expect(html).toContain('Commune Un');
    expect(db.acceptations_cgu).toHaveLength(0);
    expect(db.demandes_accord_maire[0].utilise_le).toBeUndefined();
  });

  it('le clic enregistre l\'accord du maire, par le lien, avec accusé de réception', async () => {
    const { token } = await demanderLien();
    const res = await cliquer(token!, 'Marie Dupont-Martin');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('bien enregistré');
    expect(db.acceptations_cgu).toHaveLength(1);
    expect(db.acceptations_cgu[0]).toMatchObject({
      commune_id: C1, user_id: null, role: 'maire', canal: 'lien_mairie', version: VERSION_CGU,
      nom_affiche: 'Marie Dupont-Martin', email: 'mairie@c1.fr', ip: '198.51.100.4',
    });
    expect(db.acceptations_cgu[0].empreinte_sha256).toBeTruthy();
    expect(db.demandes_accord_maire[0].utilise_le).toBeTruthy();
    expect(emails).toHaveLength(2); // le lien, puis l'accusé de réception
    expect(emails[1].subject).toContain('Accusé de réception');
    expect(emails[1].html).toContain('Marie Dupont-Martin');
  });

  it('usage unique : un second clic n\'enregistre rien de plus', async () => {
    const { token } = await demanderLien();
    await cliquer(token!);
    const res = await cliquer(token!);
    expect(res.status).toBe(200);
    expect(db.acceptations_cgu).toHaveLength(1);
  });

  it('lien expiré : refusé, rien enregistré', async () => {
    const { token } = await demanderLien();
    db.demandes_accord_maire[0].expires_at = '2020-01-01T00:00:00.000Z';
    expect((await cliquer(token!)).status).toBe(410);
    expect(db.acceptations_cgu).toHaveLength(0);
  });

  it('lien inconnu ou mal formé : 404', async () => {
    expect((await accordMaire.request('/abc', {}, ENV)).status).toBe(404);
    expect((await cliquer('0'.repeat(72))).status).toBe(404);
  });

  it('nom manquant : la page revient avec un message, rien enregistré', async () => {
    const { token } = await demanderLien();
    const res = await cliquer(token!, ' ');
    expect(res.status).toBe(400);
    expect(db.acceptations_cgu).toHaveLength(0);
    expect(db.demandes_accord_maire[0].utilise_le).toBeUndefined();
  });
});
