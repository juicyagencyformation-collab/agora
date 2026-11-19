// worker/test/prospection-appels.test.ts
// Prospection par téléphone (2026-11-19) : horaires d'ouverture des mairies (format réel de
// l'annuaire service-public), suite donnée à un appel, ordre de la file d'appels du jour et
// route POST /prospects/:id/resultat-appel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import {
  parserPlagesOuverture, etatOuverture, resumerHoraires, prochaineOuverture, prochainJourOuvre,
} from '../src/lib/horaires-mairie';
import app, { suiteAppel, trierFileAppels, tarifProspect } from '../src/backoffice/prospection';

// Champs plage_ouverture réels (mairies d'Abbeville et de Favières, relevés le 2026-11-19).
const ABBEVILLE = '[{"nom_jour_debut": "Lundi", "nom_jour_fin": "Jeudi", "valeur_heure_debut_1": "08:30:00", "valeur_heure_fin_1": "12:00:00", "valeur_heure_debut_2": "13:30:00", "valeur_heure_fin_2": "18:00:00", "commentaire": ""}, {"nom_jour_debut": "Vendredi", "nom_jour_fin": "Vendredi", "valeur_heure_debut_1": "08:30:00", "valeur_heure_fin_1": "12:00:00", "valeur_heure_debut_2": "13:30:00", "valeur_heure_fin_2": "17:30:00", "commentaire": ""}]';
const FAVIERES = '[{"nom_jour_debut": "Lundi", "nom_jour_fin": "Vendredi", "valeur_heure_debut_1": "09:00:00", "valeur_heure_fin_1": "11:30:00", "valeur_heure_debut_2": "", "valeur_heure_fin_2": "", "commentaire": ""}]';
const abbeville = parserPlagesOuverture(ABBEVILLE)!;

// Le 19/11/2026 est un jeudi ; en novembre, Paris = UTC+1.
const JEUDI_10H = new Date('2026-11-19T09:00:00Z');
const JEUDI_12H30 = new Date('2026-11-19T11:30:00Z');
const VENDREDI_18H = new Date('2026-11-20T17:00:00Z');

describe('horaires des mairies', () => {
  it('lit le format de l\'annuaire, créneaux vides ignorés', () => {
    expect(abbeville['1']).toEqual([['08:30', '12:00'], ['13:30', '18:00']]);
    expect(abbeville['5']).toEqual([['08:30', '12:00'], ['13:30', '17:30']]);
    expect(abbeville['6']).toBeUndefined();
    expect(parserPlagesOuverture(FAVIERES)!['3']).toEqual([['09:00', '11:30']]);
  });
  it('renvoie null sur une entrée vide, invalide ou sans créneau', () => {
    expect(parserPlagesOuverture(null)).toBeNull();
    expect(parserPlagesOuverture('[]')).toBeNull();
    expect(parserPlagesOuverture('pas du json')).toBeNull();
    expect(parserPlagesOuverture('[{"nom_jour_debut": "Lundi", "nom_jour_fin": "Lundi", "valeur_heure_debut_1": "", "valeur_heure_fin_1": ""}]')).toBeNull();
  });
  it('dit si la mairie est ouverte, à l\'heure de Paris', () => {
    expect(etatOuverture(abbeville, JEUDI_10H)).toMatchObject({ ouvert: true, jusqua: '12:00', libelle: "Ouverte jusqu'à 12 h" });
    expect(etatOuverture(abbeville, JEUDI_12H30)).toMatchObject({ ouvert: false, libelle: "Fermée · ouvre aujourd'hui à 13 h 30" });
    expect(etatOuverture(abbeville, VENDREDI_18H)).toMatchObject({ ouvert: false, libelle: 'Fermée · ouvre lundi à 8 h 30' });
    // Heure d'été (UTC+2) : 6 h 45 UTC un jeudi de juillet = 8 h 45 à Paris.
    expect(etatOuverture(abbeville, new Date('2026-07-02T06:45:00Z'))!.ouvert).toBe(true);
    expect(etatOuverture(null, JEUDI_10H)).toBeNull();
  });
  it('trouve le prochain créneau strictement après maintenant', () => {
    expect(prochaineOuverture(abbeville, JEUDI_10H)).toEqual({ date: '2026-11-19', heure: '13:30' });
    expect(prochaineOuverture(abbeville, VENDREDI_18H)).toEqual({ date: '2026-11-23', heure: '08:30' });
    expect(prochainJourOuvre('2026-11-20')).toBe('2026-11-23');
  });
  it('résume les horaires en regroupant les jours identiques', () => {
    expect(resumerHoraires(abbeville)).toBe('Lun–Jeu 8 h 30–12 h, 13 h 30–18 h · Ven 8 h 30–12 h, 13 h 30–17 h 30');
    expect(resumerHoraires(parserPlagesOuverture(FAVIERES))).toBe('Lun–Ven 9 h–11 h 30');
  });
});

describe('suite donnée à un appel', () => {
  it('pas de réponse : rappel au prochain créneau, statut inchangé', () => {
    expect(suiteAppel({ resultat: 'pas_de_reponse' }, { statut: 'a_contacter', horaires_ouverture: abbeville }, JEUDI_10H))
      .toMatchObject({ statut: 'a_contacter', date: '2026-11-19', heure: '13:30' });
    // Sans horaires connus : prochain jour ouvré, sans heure.
    expect(suiteAppel({ resultat: 'pas_de_reponse' }, { statut: 'contacte' }, VENDREDI_18H))
      .toMatchObject({ statut: 'contacte', date: '2026-11-23', heure: null });
  });
  it('demande un mail : contacté, rappel à J+3', () => {
    expect(suiteAppel({ resultat: 'envoyer_mail' }, { statut: 'a_contacter' }, JEUDI_10H))
      .toMatchObject({ statut: 'contacte', date: '2026-11-22', heure: null });
  });
  it('démo fixée : RDV à la date convenue, journalisée lisiblement', () => {
    const s = suiteAppel({ resultat: 'demo', date: '2026-11-26', heure: '14:00', note: 'Avec le maire' }, { statut: 'contacte' }, JEUDI_10H);
    expect(s).toMatchObject({ statut: 'rdv', date: '2026-11-26', heure: '14:00' });
    expect(s.contenu).toBe('📞 Démo fixée — démo le jeudi 26/11 à 14 h\nAvec le maire');
  });
  it('pas intéressé : perdu, nouvelle tentative dans 10 mois', () => {
    expect(suiteAppel({ resultat: 'pas_interesse' }, { statut: 'contacte' }, JEUDI_10H))
      .toMatchObject({ statut: 'perdu', date: '2027-09-19', heure: null });
  });
  it('un refus qui reprend contact repasse en contacté ; un client gagné le reste', () => {
    expect(suiteAppel({ resultat: 'rappeler', date: '2026-11-24' }, { statut: 'perdu' }, JEUDI_10H).statut).toBe('contacte');
    expect(suiteAppel({ resultat: 'demo', date: '2026-11-24' }, { statut: 'gagne' }, JEUDI_10H).statut).toBe('gagne');
  });
});

describe('ordre de la file d\'appels', () => {
  it('joignable, puis ouverte, puis 🔑, puis la plus proche', () => {
    const file = [
      { nom: 'sans-tel', contact_telephone: null, ouverture: { ouvert: true }, maire_connecte: true, distance_km: 1 },
      { nom: 'loin', contact_telephone: '03', ouverture: null, maire_connecte: false, distance_km: 40 },
      { nom: 'proche', contact_telephone: '03', ouverture: null, maire_connecte: false, distance_km: 5 },
      { nom: 'cle', contact_telephone: '03', ouverture: { ouvert: false }, maire_connecte: true, distance_km: 90 },
      { nom: 'ouverte', contact_telephone: '03', ouverture: { ouvert: true }, maire_connecte: false, distance_km: null },
    ].sort(trierFileAppels);
    expect(file.map((p) => p.nom)).toEqual(['ouverte', 'cle', 'proche', 'loin', 'sans-tel']);
  });
});

// — Route —
type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

const filtrer = (t: Ligne[], p: URLSearchParams) => t.filter((l) => [...p.entries()]
  .every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || !v.startsWith('eq.') || String(l[k]) === v.slice(3)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const ok = (d: any, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  const methode = init?.method || 'GET';
  if (methode === 'GET') return ok(filtrer(db[table] || [], url.searchParams));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...lignes);
    return ok(lignes, 201);
  }
  if (methode === 'PATCH') {
    const lignes = filtrer(db[table] || [], url.searchParams);
    lignes.forEach((l) => Object.assign(l, JSON.parse(String(init.body))));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const sessionStaff = async () => ({
  Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
  'Content-Type': 'application/json',
});
const poster = async (id: string, corps: any) => app.request(`/prospects/${id}/resultat-appel`,
  { method: 'POST', headers: await sessionStaff(), body: JSON.stringify(corps) }, ENV);
const patcher = async (id: string, corps: any) => app.request(`/prospects/${id}`,
  { method: 'PATCH', headers: await sessionStaff(), body: JSON.stringify(corps) }, ENV);

beforeEach(() => {
  db = {
    prospects: [
      { id: 'p1', statut: 'a_contacter', horaires_ouverture: null, prochaine_relance_le: null, prochaine_relance_heure: null },
      { id: 'p2', statut: 'ne_plus_contacter', horaires_ouverture: null },
    ],
    prospect_interactions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /appels-du-jour', () => {
  it('ne garde que les communes dans le rayon, dans l\'ordre d\'appel', async () => {
    const verifie = new Date().toISOString(); // horaires déjà vérifiés : pas d'appel à l'annuaire
    db.prospects = [
      // Pont-Remy (~3 km d'Eaucourt), Abbeville (~5 km), Amiens (~36 km), Lille (~85 km)
      { id: 'pont', nom: 'Pont-Remy', statut: 'contacte', lat: 50.054, lng: 1.910, contact_telephone: '03', horaires_verifies_le: verifie, prochaine_relance_le: '2026-08-20' },
      { id: 'abb', nom: 'Abbeville', statut: 'a_contacter', lat: 50.105, lng: 1.835, contact_telephone: '03', horaires_verifies_le: verifie, prochaine_relance_le: null, commune_id: 'c-abb' },
      { id: 'ami', nom: 'Amiens', statut: 'contacte', lat: 49.894, lng: 2.302, contact_telephone: '03', horaires_verifies_le: verifie, prochaine_relance_le: '2026-08-20' },
      { id: 'lil', nom: 'Lille', statut: 'contacte', lat: 50.629, lng: 3.057, contact_telephone: '03', horaires_verifies_le: verifie, prochaine_relance_le: '2026-08-20' },
    ];
    db.users = [{ commune_id: 'c-abb', role: 'admin', derniere_connexion_streak: '2026-11-01' }];
    const res = await app.request('/appels-du-jour?rayon_km=30', { headers: await sessionStaff() }, ENV);
    const corps: any = await res.json();
    expect(res.status).toBe(200);
    expect(corps.rayon_km).toBe(30);
    // Amiens (~36 km) et Lille hors du cercle de 30 km.
    expect(corps.appels.map((a: any) => a.nom)).toEqual(['Abbeville', 'Pont-Remy']); // 🔑 avant la plus proche
    expect(corps.appels[1]).toMatchObject({ distance_km: 3, maire_connecte: false });
  });
});

describe('POST /prospects/:id/resultat-appel', () => {
  it('refuse sans session staff', async () => {
    const res = await app.request('/prospects/p1/resultat-appel', { method: 'POST', body: '{}' }, ENV);
    expect(res.status).toBe(401);
  });
  it('exige une date pour un rappel', async () => {
    expect((await poster('p1', { resultat: 'rappeler' })).status).toBe(400);
    expect((await poster('p1', { resultat: 'rappeler', date: '2026-11-26', heure: '25:00' })).status).toBe(400);
  });
  it('refuse un prospect qui ne veut plus être contacté', async () => {
    expect((await poster('p2', { resultat: 'pas_de_reponse' })).status).toBe(409);
    expect(db.prospect_interactions).toHaveLength(0);
  });
  it('enregistre le rappel, l\'heure, le statut, et journalise l\'appel', async () => {
    const res = await poster('p1', { resultat: 'rappeler', date: '2026-11-26', heure: '14:00', note: 'Secrétaire : Sandrine' });
    expect(res.status).toBe(200);
    expect(db.prospects[0]).toMatchObject({ statut: 'contacte', prochaine_relance_le: '2026-11-26', prochaine_relance_heure: '14:00' });
    expect(db.prospect_interactions.map((i) => i.type)).toEqual(['appel', 'statut']);
    expect(db.prospect_interactions[0].contenu).toBe('📞 À rappeler — rappel le jeudi 26/11 à 14 h\nSecrétaire : Sandrine');
  });
  it('pas intéressé : enregistre la date et la raison du refus', async () => {
    await poster('p1', { resultat: 'pas_interesse', note: 'Déjà IntraMuros' });
    expect(db.prospects[0]).toMatchObject({ statut: 'perdu', raison_perdu: 'Déjà IntraMuros', prochaine_relance_heure: null });
    expect(db.prospects[0].perdu_le).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("qualification et fiche prête pour l'appel (lot 2)", () => {
  it('enregistre la qualification, sans les rubriques vides', async () => {
    const res = await patcher('p1', { qualification: { interlocuteur: 'secretaire', outil_actuel: 'facebook', irritant: null } });
    expect(res.status).toBe(200);
    expect(db.prospects[0].qualification).toEqual({ interlocuteur: 'secretaire', outil_actuel: 'facebook' });
    await patcher('p1', { qualification: { outil_actuel: null } });
    expect(db.prospects[0].qualification).toBeNull();
  });
  it('refuse une valeur ou une rubrique inconnue', async () => {
    expect((await patcher('p1', { qualification: { outil_actuel: 'minitel' } })).status).toBe(400);
    expect((await patcher('p1', { qualification: { humeur: 'bonne' } })).status).toBe(400);
  });
  it('donne la distance depuis Eaucourt et le prix de la commune', async () => {
    Object.assign(db.prospects[0], { nom: 'Pont-Remy', population: 1500, lat: 50.054, lng: 1.910, horaires_verifies_le: new Date().toISOString() });
    const corps: any = await (await app.request('/prospects/p1', { headers: await sessionStaff() }, ENV)).json();
    // Barème par défaut : 500 × 0,60 + 1 000 × 0,20 = 500 €, Accompagné + 200 €, fondateur − 35 %.
    expect(corps.prospect).toMatchObject({
      distance_km: 3,
      tarif: { habitants: 1500, sur_devis: false, autonomie: 500, accompagne: 700, fondateur_autonomie: 325, fondateur_accompagne: 455 },
    });
  });
  it('suit le barème en base : plancher, centimes, sur devis, population inconnue', async () => {
    db.parametres_facturation = [{ cle: 'bareme_prix_plancher', valeur: '290' }];
    expect(await tarifProspect(ENV, 200)).toMatchObject({ autonomie: 290, fondateur_autonomie: 188.5 });
    expect(await tarifProspect(ENV, 8000)).toEqual({ habitants: 8000, sur_devis: true });
    expect(await tarifProspect(ENV, null)).toBeNull();
  });
});
