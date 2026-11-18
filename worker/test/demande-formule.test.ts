// worker/test/demande-formule.test.ts
// Volet « Votre formule » (2026-11-18, migration 105). Ce qu'on verrouille : la formule affichée
// suit la fiche (formule du backoffice, sinon le palier) ; le prix est celui du barème du site ;
// seuls le maire et les élus demandent, une seule demande en cours par commune, rien ne s'active
// tout seul ; l'email part à l'équipe ; une demande de plus de 30 jours ne bloque plus.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';

const emails = vi.hoisted(() => ({ envoyes: [] as { to: string; sujet: string; html: string; replyTo?: string }[] }));
vi.mock('../src/lib/email', () => ({
  envoyerEmail: async (_e: any, to: string, sujet: string, html: string, _a?: any, replyTo?: string) => { emails.envoyes.push({ to, sujet, html, replyTo }); return 'id'; },
}));

import commune from '../src/routes/commune';
import { formuleActuelle, demandeEnCours } from '../src/lib/formule-commune';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'fake-jwt-secret-suffisamment-long' };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  return true;
}
function filtrer(table: Ligne[], params: URLSearchParams) {
  let lignes = [...table];
  for (const [cle, v] of params.entries()) if (!['select', 'order', 'limit', 'offset'].includes(cle)) lignes = lignes.filter((l) => correspond(l[cle], v));
  return lignes;
}
function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const ok = (corps: any, status = 200) => Promise.resolve(new Response(JSON.stringify(corps), { status }));
  if (methode === 'GET') {
    const select = url.searchParams.get('select');
    const lignes = filtrer(db[table] || [], url.searchParams);
    return ok(select ? lignes.map((l) => Object.fromEntries(select.split(',').map((ch) => [ch, l[ch]]))) : lignes);
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), statut: 'en_attente', created_at: new Date().toISOString(), ...l }));
    (db[table] ??= []).push(...inserees);
    return ok(inserees, 201);
  }
  if (methode === 'PATCH') {
    const lignes = filtrer(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

async function appel(chemin: string, role: string, corps?: any, user_id = 'maire-1') {
  const jeton = await sign({ user_id, commune_id: 'c-1', role, exp: Math.floor(Date.now() / 1000) + 600 }, ENV.JWT_SECRET);
  const attentes: Promise<any>[] = [];
  const res = await commune.request(chemin, {
    method: corps ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: `agora_access=${jeton}` },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }, ENV, { waitUntil: (p: Promise<any>) => attentes.push(p), passThroughOnException: () => {} } as any);
  await Promise.all(attentes);
  return res;
}

const DEMANDE = { formule_souhaitee: 'accompagne', telephone: '03 22 00 00 00', message: 'Plutôt le mardi <matin>' };

beforeEach(() => {
  db = {
    communes: [{ id: 'c-1', nom: 'Eaucourt-sur-Somme', population: 357, formule: null, forfait: 'Gratuit', telephone_mairie: '03 22 00 00 00' }],
    onglets_config: [
      { commune_id: 'c-1', cle: 'actualites', actif: true }, { commune_id: 'c-1', cle: 'mur', actif: false },
      { commune_id: 'c-1', cle: 'conseil', actif: false }, { commune_id: 'c-1', cle: 'profil', actif: true },
    ],
    users: [{ id: 'maire-1', commune_id: 'c-1', prenom: 'Jean', nom: 'Dupont', email: 'maire@exemple.fr' }],
    demandes_formule: [], parametres_facturation: [], modeles_email: [],
  };
  emails.envoyes = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('formule affichée', () => {
  it('formule du backoffice, sinon le palier', () => {
    expect(formuleActuelle({ formule: 'accompagne', forfait: 'Fondateur' }, 0)).toBe('accompagne');
    expect(formuleActuelle({ formule: null, forfait: 'Fondateur' }, 0)).toBe('fondateur');
    expect(formuleActuelle({ formule: null, forfait: 'Gratuit' }, 3)).toBe('gratuite');
    expect(formuleActuelle({ formule: null, forfait: 'Version complète' }, 0)).toBe('complete');
  });

  it('GET /formule : onglets, prix au barème du site, droit de demander', async () => {
    const data = await (await appel('/formule', 'maire')).json();
    expect(data).toMatchObject({ formule: 'gratuite', population: 357, prix_annuels: { autonomie: 290, accompagne: 490 }, peut_demander: true, demande_en_cours: null });
    expect(data.onglets_verrouilles.sort()).toEqual(['conseil', 'mur']);
    expect(data.onglets_inclus).toContain('actualites');
    expect(data.onglets_inclus).toContain('agenda'); // sans ligne en base = actif
    expect(data.onglets_inclus).not.toContain('profil');
    expect(data.offres.autonomie.label).toBe('Autonomie');
    expect((await (await appel('/formule', 'admin')).json()).peut_demander).toBe(false);
    expect((await appel('/formule', 'citoyen')).status).toBe(403);
  });
});

describe('demande de changement de formule', () => {
  it('enregistrée, email à l’équipe (échappé), rien d’activé', async () => {
    const res = await appel('/demande-formule', 'maire', DEMANDE);
    expect(res.status).toBe(201);
    expect(db.demandes_formule).toHaveLength(1);
    expect(db.demandes_formule[0]).toMatchObject({ commune_id: 'c-1', user_id: 'maire-1', formule_souhaitee: 'accompagne', statut: 'en_attente' });
    expect(emails.envoyes).toHaveLength(1);
    expect(emails.envoyes[0]).toMatchObject({ to: 'contact@plateforme-agora.fr', replyTo: 'maire@exemple.fr' });
    expect(emails.envoyes[0].sujet).toContain('Eaucourt-sur-Somme');
    expect(emails.envoyes[0].html).toContain('&lt;matin&gt;');
    expect(db.onglets_config.find((o) => o.cle === 'mur')!.actif).toBe(false);
    expect(db.communes[0].formule).toBeNull();
    // Le volet le montre, et le bouton disparaît.
    expect(await (await appel('/formule', 'maire')).json()).toMatchObject({ demande_en_cours: { formule_souhaitee: 'accompagne' }, peut_demander: false });
  });

  it('une seule demande en cours ; possible à nouveau après 30 jours', async () => {
    expect((await appel('/demande-formule', 'elu', DEMANDE)).status).toBe(201);
    expect((await appel('/demande-formule', 'maire', DEMANDE)).status).toBe(409);
    expect(emails.envoyes).toHaveLength(1);
    db.demandes_formule[0].created_at = new Date(Date.now() - 31 * 86400000).toISOString();
    expect((await appel('/demande-formule', 'maire', DEMANDE)).status).toBe(201);
    expect(db.demandes_formule.filter((d) => d.statut === 'en_attente')).toHaveLength(1);
    expect(demandeEnCours([{ statut: 'en_attente', created_at: new Date(Date.now() - 31 * 86400000).toISOString() }])).toBeNull();
  });

  it('refusée aux admins et habitants, aux saisies invalides, et aux communes déjà complètes', async () => {
    expect((await appel('/demande-formule', 'admin', DEMANDE)).status).toBe(403);
    expect((await appel('/demande-formule', 'citoyen', DEMANDE)).status).toBe(403);
    expect((await appel('/demande-formule', 'maire', { ...DEMANDE, telephone: 'appelez-moi' })).status).toBe(400);
    expect((await appel('/demande-formule', 'maire', { ...DEMANDE, formule_souhaitee: 'premium' })).status).toBe(400);
    db.communes[0].formule = 'accompagne';
    expect((await appel('/demande-formule', 'maire', DEMANDE)).status).toBe(400);
    expect(db.demandes_formule).toEqual([]);
    expect(emails.envoyes).toEqual([]);
  });
});
