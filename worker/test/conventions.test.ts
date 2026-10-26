// worker/test/conventions.test.ts
// Convention « Commune fondatrice » : création (numéro libre, maire prérempli), formulaire public
// de la mairie par jeton (lien invalide ou convention signée refusés, validation), document généré
// (valeurs insérées, échappées, variante de reconduction, blancs signalés).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { routesStaff, routesFormulaire } from '../src/backoffice/conventions';
import { genererConventionHtml } from '../src/backoffice/convention-document';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre.startsWith('like.')) return String(valeur).startsWith(filtre.slice(5).replace('*', ''));
  return true;
}
const filtrer = (t: Ligne[], p: URLSearchParams) =>
  t.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const ok = (d: any, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  if (methode === 'GET') return ok(filtrer(db[table] || [], url.searchParams));
  if (methode === 'POST') {
    const l = { id: crypto.randomUUID(), statut: 'brouillon', ...JSON.parse(String(init.body)) };
    (db[table] ??= []).push(l);
    return ok([l], 201);
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    if (table === 'conventions' && corps.numero_fondatrice
      && db.conventions.some((x) => x.numero_fondatrice === corps.numero_fondatrice && !filtrer([x], url.searchParams).length)) {
      return ok({ code: '23505', message: 'duplicate key value violates unique constraint "idx_conventions_numero_fondatrice"' }, 409);
    }
    const lignes = filtrer(db[table] || [], url.searchParams);
    lignes.forEach((l) => Object.assign(l, corps));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const sessionStaff = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` });
const JETON = 'a'.repeat(64);

beforeEach(() => {
  db = {
    communes: [{ id: 'fay', nom: 'Fay-les-Étangs', slug: 'faylesetangs', departement: '60' }, { id: 'tourly', nom: 'Tourly', slug: 'tourly', departement: '60' }],
    users: [{ commune_id: 'fay', role: 'maire', prenom: 'Marie', nom: 'Dupont' }],
    prospects: [{ commune_id: 'tourly', nom_maire: 'Jean Martin' }],
    conventions: [], journal_activite: [],
    parametres_facturation: [
      { cle: 'entreprise_raison_sociale', valeur: 'SALLE LEANDRE' }, { cle: 'entreprise_siret', valeur: '88299247200010' },
      { cle: 'entreprise_mention_tva', valeur: 'TVA non applicable, art. 293 B du CGI' }, { cle: 'entreprise_email', valeur: 'contact@plateforme-agora.fr' },
    ],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('création par le staff', () => {
  it('refuse sans session staff', async () => {
    expect((await routesStaff.request('/commune/fay', { method: 'POST' }, ENV)).status).toBe(401);
  });
  it('prend le premier numéro libre, préremplit le maire et crée un lien secret', async () => {
    db.conventions.push({ id: 'x', commune_id: 'autre', numero_fondatrice: 1, statut: 'signee', jeton_formulaire: 'b'.repeat(64) });
    const res = await routesStaff.request('/commune/fay', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(res.status).toBe(201);
    const conv = db.conventions.find((x) => x.commune_id === 'fay')!;
    expect(conv).toMatchObject({ numero_fondatrice: 2, signataire_nom: 'Marie Dupont', signataire_qualite: 'maire' });
    expect(conv.jeton_formulaire).toMatch(/^[a-f0-9]{64}$/);
  });
  it('reprend le nom du maire de la fiche prospect à défaut de compte maire', async () => {
    await routesStaff.request('/commune/tourly', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(db.conventions[0].signataire_nom).toBe('Jean Martin');
  });
  it('refuse un numéro de commune fondatrice déjà attribué', async () => {
    db.conventions.push({ id: 'c1', commune_id: 'fay', numero_fondatrice: 1, statut: 'brouillon' }, { id: 'c2', commune_id: 'tourly', numero_fondatrice: 2, statut: 'brouillon' });
    const res = await routesStaff.request('/c2', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await sessionStaff()) }, body: JSON.stringify({ numero_fondatrice: 1 }) }, ENV);
    expect(res.status).toBe(400);
  });
});

describe('formulaire de la mairie (par lien)', () => {
  beforeEach(() => { db.conventions.push({ id: 'c1', commune_id: 'fay', statut: 'envoyee', numero_fondatrice: 2, jeton_formulaire: JETON }); });
  const envoyer = (corps: object, jeton = JETON) => routesFormulaire.request(`/${jeton}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  }, ENV);

  it('refuse un lien inconnu ou une convention déjà signée', async () => {
    expect((await routesFormulaire.request(`/${'f'.repeat(64)}`, {}, ENV)).status).toBe(404);
    expect((await routesFormulaire.request('/pas-un-jeton', {}, ENV)).status).toBe(404);
    db.conventions[0].statut = 'signee';
    expect((await routesFormulaire.request(`/${JETON}`, {}, ENV)).status).toBe(404);
  });
  it('enregistre les réponses (SIRET avec espaces accepté, champ vidé = effacé)', async () => {
    const res = await envoyer({ signataire_nom: 'Marie Dupont', siret_commune: '216 002 285 00011', option_reconduction: 'tacite', citation_autorisee: true, code_service_chorus: '' });
    expect(res.status).toBe(200);
    expect(db.conventions[0]).toMatchObject({ siret_commune: '21600228500011', option_reconduction: 'tacite', citation_autorisee: true, code_service_chorus: null });
    expect(db.conventions[0].formulaire_rempli_le).toBeTruthy();
  });
  it('refuse un SIRET incomplet, un email invalide ou un champ inattendu', async () => {
    expect((await envoyer({ siret_commune: '1234' })).status).toBe(400);
    expect((await envoyer({ facturation_email: 'pas-un-email' })).status).toBe(400);
    expect((await envoyer({ statut: 'signee' })).status).toBe(400);
    expect(db.conventions[0].statut).toBe('envoyee');
  });
});

describe('document', () => {
  const base = {
    numero_fondatrice: 2, signataire_nom: 'Marie Dupont', signataire_qualite: 'maire', deliberation_reference: '2026-45',
    deliberation_date: '2026-11-03', option_reconduction: null, siret_commune: '21600228500011', code_service_chorus: null,
    facturation_nom: 'Mairie', facturation_email: 'mairie@fay.fr', date_debut_souhaitee: null, citation_autorisee: null,
  } as any;
  const entreprise = { entreprise_siret: '88299247200010', entreprise_mention_tva: 'TVA non applicable, art. 293 B du CGI' };

  it('insère les valeurs, le département et le SIREN', () => {
    const html = genererConventionHtml({ ...base, option_reconduction: 'tacite' }, { nom: 'Fay-les-Étangs', slug: 'faylesetangs' }, '60', entreprise);
    expect(html).toContain('Commune de Fay-les-Étangs (Oise, 60)');
    expect(html).toContain('SIREN 882 992 472');
    expect(html).toContain('n° 2 / 10');
    expect(html).toContain('reconductible tacitement 3 fois');
    expect(html).toContain('plateforme-agora.fr/faylesetangs');
  });
  it('adapte le texte au renouvellement annuel et signale les blancs', () => {
    const html = genererConventionHtml({ ...base, option_reconduction: 'annuelle', deliberation_reference: null }, { nom: 'Tourly', slug: 'tourly' }, null, entreprise);
    expect(html).toContain('renouvelable chaque année par décision expresse');
    expect(html).not.toContain('reconductible tacitement 3 fois');
    expect(html).toContain('class="a-completer"');
  });
  it('neutralise un texte piégé saisi par la mairie', () => {
    const html = genererConventionHtml({ ...base, signataire_nom: '<img src=x onerror=alert(1)>' }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
