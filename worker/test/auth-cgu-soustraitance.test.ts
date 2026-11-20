// worker/test/auth-cgu-soustraitance.test.ts
// Gate d'acceptation des CGU + accord de sous-traitance RGPD (art. 28, article 10) et preuve
// associée (migration 108, worker/src/lib/cgu.ts) : seuls les rôles décideurs acceptent, une fois
// par version ; chaque acceptation est journalisée avec le texte exact servi et son empreinte ;
// l'attestation du backoffice ne montre que la commune demandée. Même esprit de faux fetch() que
// test/lois.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import auth from '../src/auth';
import preuvesCgu from '../src/backoffice/preuves-cgu';
import { VERSION_CGU } from '../src/lib/cgu';
import { hasherSha256Hex } from '../src/lib/hash';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let siteEnPanne: boolean;
let tablesAbsentes: string[];

const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET,
  FRONTEND_URL: 'https://site.test',
};
const PAGE_CGU = `<html><head><meta name="version-cgu" content="${VERSION_CGU}"></head><body><h2>10. Sous-traitance de données personnelles</h2></body></html>`;
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function reinitialiser() {
  db = { users: [], acceptations_cgu: [], versions_cgu: [], communes: [], parametres_facturation: [] };
  emailsEnvoyes = [];
  siteEnPanne = false;
  tablesAbsentes = [];
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre === 'not.is.true') return valeur !== true;
  return true;
}
function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}
let emailsEnvoyes: any[];
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === 'https://api.resend.com') {
    emailsEnvoyes.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 }));
  }
  if (url.origin === ENV.FRONTEND_URL) {
    return Promise.resolve(siteEnPanne ? new Response('panne', { status: 503 }) : new Response(PAGE_CGU, { status: 200 }));
  }
  const table = url.pathname.replace('/rest/v1/', '');
  if (tablesAbsentes.includes(table)) return Promise.resolve(new Response('{"code":"42P01"}', { status: 404 }));
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = [JSON.parse(String(init.body))].flat();
    for (const l of corps) {
      if (table === 'acceptations_cgu' && db[table].some((x) => x.user_id === l.user_id && x.version === l.version)) {
        return Promise.resolve(new Response('{"code":"23505"}', { status: 409 }));
      }
      if (table === 'versions_cgu' && db[table].some((x) => x.empreinte_sha256 === l.empreinte_sha256)) continue;
      if (table === 'acceptations_cgu') l.id ??= `acc-${db[table].length + 1}`;
      (db[table] ??= []).push({ created_at: '2026-11-20T10:00:00.000Z', ...l });
    }
    return Promise.resolve(new Response(JSON.stringify(corps.map((l) => ({ created_at: '2026-11-20T10:00:00.000Z', ...l }))), { status: 201 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

async function cookiePour(user_id: string, commune_id: string, role: string) {
  const token = await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET);
  return { headers: { Cookie: `agora_access=${token}`, 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': 'Navigateur de test' } };
}
const sessionStaff = async () => ({
  headers: { Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` },
});
const accepter = async (user_id: string, role: string) => auth.request('/accepter-cgu-soustraitance', {
  method: 'POST', ...(await cookiePour(user_id, C1, role)),
}, ENV);
const gate = async (user_id: string, role: string) =>
  (await (await auth.request('/me', { ...(await cookiePour(user_id, C1, role)) }, ENV)).json()).cgu_sous_traitance_a_accepter;

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /me — cgu_sous_traitance_a_accepter', () => {
  it('false pour un citoyen', async () => {
    db.users.push({ id: 'u1', commune_id: C1, role: 'citoyen' });
    expect(await gate('u1', 'citoyen')).toBe(false);
  });

  it('true pour un maire qui n\'a jamais accepté', async () => {
    db.users.push({ id: 'u2', commune_id: C1, role: 'maire' });
    expect(await gate('u2', 'maire')).toBe(true);
  });

  it('true malgré une ancienne date posée par la migration 080 (pas une preuve)', async () => {
    db.users.push({ id: 'u3', commune_id: C1, role: 'maire', cgu_sous_traitance_acceptee_le: '2026-10-12T00:00:00.000Z' });
    expect(await gate('u3', 'maire')).toBe(true);
  });

  it('true si seule une version antérieure a été acceptée', async () => {
    db.users.push({ id: 'u4', commune_id: C1, role: 'elu' });
    db.acceptations_cgu.push({ user_id: 'u4', commune_id: C1, version: '2026-10-12' });
    expect(await gate('u4', 'elu')).toBe(true);
  });

  it('false une fois la version en vigueur acceptée', async () => {
    db.users.push({ id: 'u5', commune_id: C1, role: 'admin' });
    db.acceptations_cgu.push({ user_id: 'u5', commune_id: C1, version: VERSION_CGU });
    expect(await gate('u5', 'admin')).toBe(false);
  });

  it('ne bloque jamais l\'app si le journal est indisponible (migration pas encore passée)', async () => {
    db.users.push({ id: 'u6', commune_id: C1, role: 'maire' });
    tablesAbsentes = ['acceptations_cgu'];
    const res = await auth.request('/me', { ...(await cookiePour('u6', C1, 'maire')) }, ENV);
    expect(res.status).toBe(200);
    expect((await res.json()).cgu_sous_traitance_a_accepter).toBe(false);
  });
});

describe('POST /accepter-cgu-soustraitance', () => {
  it('journalise la preuve complète et archive le texte exact servi', async () => {
    db.users.push({ id: 'u7', commune_id: C1, role: 'maire', prenom: 'Marie', nom: 'Dupont', email: 'maire@c1.fr' });
    const res = await accepter('u7', 'maire');
    expect(res.status).toBe(200);
    const empreinte = await hasherSha256Hex(PAGE_CGU);
    expect(db.acceptations_cgu).toHaveLength(1);
    expect(db.acceptations_cgu[0]).toMatchObject({
      commune_id: C1, user_id: 'u7', role: 'maire', version: VERSION_CGU, empreinte_sha256: empreinte,
      nom_affiche: 'Marie Dupont', email: 'maire@c1.fr', ip: '203.0.113.7', user_agent: 'Navigateur de test',
    });
    expect(db.versions_cgu).toHaveLength(1);
    expect(db.versions_cgu[0]).toMatchObject({ empreinte_sha256: empreinte, version: VERSION_CGU, texte_html: PAGE_CGU });
    expect(db.users[0].cgu_sous_traitance_acceptee_le).toBeTruthy();
    expect(await gate('u7', 'maire')).toBe(false);
  });

  it('double clic : une seule ligne, pas d\'erreur', async () => {
    db.users.push({ id: 'u8', commune_id: C1, role: 'elu', prenom: 'Paul', nom: 'Martin', email: 'p@c1.fr' });
    expect((await accepter('u8', 'elu')).status).toBe(200);
    expect((await accepter('u8', 'elu')).status).toBe(200);
    expect(db.acceptations_cgu).toHaveLength(1);
    expect(db.versions_cgu).toHaveLength(1);
  });

  it('site injoignable : l\'acceptation est quand même enregistrée, sans texte archivé', async () => {
    db.users.push({ id: 'u9', commune_id: C1, role: 'admin', prenom: 'A', nom: 'B', email: 'a@c1.fr' });
    siteEnPanne = true;
    expect((await accepter('u9', 'admin')).status).toBe(200);
    expect(db.acceptations_cgu[0].empreinte_sha256).toBeNull();
    expect(db.versions_cgu).toHaveLength(0);
  });

  it('envoie un accusé de réception à la personne et à la mairie, et le note dans le journal', async () => {
    db.communes.push({ id: C1, nom: 'Commune Un', slug: 'un', email_mairie: 'Mairie@C1.fr' });
    db.users.push({ id: 'u12', commune_id: C1, role: 'maire', prenom: 'Marie', nom: '<b>Dupont</b>', email: 'maire@perso.fr' });
    ENV.RESEND_API_KEY = 'cle-de-test';
    try {
      expect((await accepter('u12', 'maire')).status).toBe(200);
    } finally {
      delete ENV.RESEND_API_KEY;
    }
    expect(emailsEnvoyes).toHaveLength(1);
    expect(emailsEnvoyes[0].to).toEqual(['maire@perso.fr', 'mairie@c1.fr']);
    expect(emailsEnvoyes[0].html).toContain('Commune Un');
    expect(emailsEnvoyes[0].html).not.toContain('<b>Dupont</b>'); // nom saisi par l'utilisateur : échappé
    expect(db.acceptations_cgu[0]).toMatchObject({ accuse_email_id: 'resend-123', accuse_envoye_a: 'maire@perso.fr, mairie@c1.fr' });
  });

  it('double clic : un seul accusé de réception', async () => {
    db.communes.push({ id: C1, nom: 'Commune Un', slug: 'un', email_mairie: 'mairie@c1.fr' });
    db.users.push({ id: 'u13', commune_id: C1, role: 'elu', prenom: 'Paul', nom: 'Martin', email: 'p@c1.fr' });
    ENV.RESEND_API_KEY = 'cle-de-test';
    try {
      await accepter('u13', 'elu');
      await accepter('u13', 'elu');
    } finally {
      delete ENV.RESEND_API_KEY;
    }
    expect(emailsEnvoyes).toHaveLength(1);
  });

  it('refuse (403) pour un citoyen, rien n\'est enregistré', async () => {
    db.users.push({ id: 'u10', commune_id: C1, role: 'citoyen' });
    expect((await accepter('u10', 'citoyen')).status).toBe(403);
    expect(db.acceptations_cgu).toHaveLength(0);
  });
});

describe('GET /preuves-cgu/:communeId (backoffice)', () => {
  it('refuse sans session staff', async () => {
    const res = await preuvesCgu.request(`/${C1}`, {}, ENV);
    expect(res.status).toBe(401);
  });

  it('renvoie le journal de la seule commune demandée, avec le texte accepté', async () => {
    db.communes.push({ id: C1, nom: 'Commune Un', slug: 'un', espace_officiel: true }, { id: C2, nom: 'Commune Deux', slug: 'deux' });
    db.users.push({ id: 'u11', commune_id: C1, role: 'maire', prenom: 'Marie', nom: 'Dupont', email: 'maire@c1.fr' });
    await accepter('u11', 'maire');
    db.acceptations_cgu.push({ user_id: 'autre', commune_id: C2, version: VERSION_CGU, role: 'maire', email: 'x@c2.fr' });

    const res = await preuvesCgu.request(`/${C1}`, { ...(await sessionStaff()) }, ENV);
    expect(res.status).toBe(200);
    const corps = await res.json() as any;
    expect(corps.commune.nom).toBe('Commune Un');
    expect(corps.acceptations).toHaveLength(1);
    expect(corps.acceptations[0].email).toBe('maire@c1.fr');
    expect(corps.versions).toHaveLength(1);
    expect(corps.versions[0].texte_html).toBe(PAGE_CGU);
  });

  it('registre : liste les seules communes à espace officiel, hors commune nationale', async () => {
    db.communes.push(
      { id: C1, nom: 'Commune Un', departement: '80', espace_officiel: true, dpa_communes: { dpo: 'CDG 80' } },
      { id: C2, nom: 'Commune Deux', departement: '80', espace_officiel: false },
      { id: 'n', nom: 'Explorateurs', espace_officiel: true, niveau_national: true },
    );
    const res = await preuvesCgu.request('/registre', { ...(await sessionStaff()) }, ENV);
    expect(res.status).toBe(200);
    const corps = await res.json() as any;
    expect(corps.communes).toEqual([{ nom: 'Commune Un', departement: '80', dpo: 'CDG 80' }]);
  });

  it('identifiant invalide : 400', async () => {
    const res = await preuvesCgu.request('/pas-un-uuid', { ...(await sessionStaff()) }, ENV);
    expect(res.status).toBe(400);
  });
});
