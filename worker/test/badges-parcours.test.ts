// worker/test/badges-parcours.test.ts
// Badges de parcours (2026-11-15, migration 104). Ce qu'on verrouille : le badge réglé par la
// mairie est gagné une seule fois par personne en terminant le parcours, avec un rang figé ; il
// est COPIÉ (une modification du parcours ne change pas les badges déjà gagnés) ; le grand badge
// du village tombe quand tous les parcours publiés (au moins 2) sont terminés ; le mode test
// montre le badge sans rien écrire ; une panne des badges ne casse jamais la validation ; un jeu
// joué ailleurs range le badge chez la commune du COMPTE. Fausse base pilotée par fetch(), même
// esprit que chasses-brouillon.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';

vi.mock('../src/lib/push', () => ({
  utilisateursAbonnesA: async () => [],
  envoyerNotificationAUtilisateurs: async () => {},
}));
vi.mock('../src/storage', () => ({
  uploaderFichier: async () => 'https://cdn.test/x.jpg',
  deleteObject: async () => {},
}));

import chasses from '../src/routes/chasses_tresor';
import { attribuerBadgesFinParcours, collectionParcours, nomGrandBadge } from '../src/lib/badges-parcours';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let tablesEnPanne: Set<string>;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'fake-jwt-secret-suffisamment-long', R2_PUBLIC_BASE: 'https://cdn.test' };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('lt.')) return Number(valeur) < Number(filtre.slice(3));
  if (filtre.startsWith('gt.')) return Number(valeur) > Number(filtre.slice(3));
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
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
  if (tablesEnPanne.has(table)) return ok({ message: 'relation does not exist' }, 500);
  if (methode === 'GET') {
    const select = url.searchParams.get('select');
    const lignes = filtrer(db[table] || [], url.searchParams);
    return ok(select ? lignes.map((l) => Object.fromEntries(select.split(',').map((ch) => [ch, l[ch]]))) : lignes);
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...l }));
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

async function requete(chemin: string, init: RequestInit = {}, role = 'admin', user_id = 'maire-1') {
  const jeton = await sign({ user_id, commune_id: 'c-1', role, exp: Math.floor(Date.now() / 1000) + 600 }, ENV.JWT_SECRET);
  const attentes: Promise<any>[] = [];
  const res = await chasses.request(chemin, { ...init, headers: { ...(init.headers as any), Cookie: `agora_access=${jeton}` } }, ENV,
    { waitUntil: (p: Promise<any>) => attentes.push(p), passThroughOnException: () => {} } as any);
  await Promise.all(attentes);
  return res;
}
const envoyer = (methode: string, chemin: string, corps: any, role = 'admin', user_id = 'maire-1') =>
  requete(chemin, { method: methode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }, role, user_id);

const LAT = 50.06;
const BADGE = { nom: 'Gardien du patrimoine', icone: '🏰', metal: 'or', phrase: 'Vous connaissez Eaucourt.' };
const PARCOURS = {
  titre: 'Balade patrimoine', description: 'Une balade', mode: 'balade', rayon_metres: 40, badge: BADGE,
  etapes: [
    { titre: 'Château', indice: '', lat: LAT, lng: 1.88, type_contenu: 'texte', contenu: 'Le château' },
    { titre: 'Moulin', indice: '', lat: LAT + 0.01, lng: 1.88, type_contenu: 'texte', contenu: 'Le moulin' },
  ],
};

// Crée puis publie : renvoie l'id et les étapes dans l'ordre.
async function parcoursPublie(corps: any = PARCOURS) {
  const res = await envoyer('POST', '/', corps);
  expect(res.status).toBe(201);
  const id = (await res.json()).chasse_id as string;
  expect((await envoyer('POST', `/${id}/publier`, {})).status).toBe(200);
  return { id, etapes: db.etapes_chasse.filter((e) => e.chasse_id === id).sort((a, b) => a.ordre - b.ordre) };
}
// Joue tout le parcours ; renvoie la réponse de la dernière étape.
async function terminer(etapes: Ligne[], joueur: string) {
  let data: any;
  for (const e of etapes) {
    const res = await envoyer('POST', '/valider-position', { etape_id: e.id, lat: e.lat, lng: e.lng }, 'citoyen', joueur);
    expect(res.status).toBe(200);
    data = await res.json();
  }
  return data;
}

beforeEach(() => {
  db = {
    communes: [{ id: 'c-1', nom: 'Eaucourt-sur-Somme' }, { id: 'c-2', nom: 'Le Crotoy' }],
    chasses_tresor: [], etapes_chasse: [], progressions_chasse: [], badges_parcours: [],
    users: ['maire-1', 'camille', 'dominique'].map((id) => ({ id, commune_id: 'c-1', xp: 0, niveau: 1 })),
  };
  tablesEnPanne = new Set();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('réglage du badge par la mairie', () => {
  it('enregistré à la création, visible des joueurs avant de jouer', async () => {
    const { id } = await parcoursPublie();
    expect(db.chasses_tresor.find((c) => c.id === id)).toMatchObject({ badge_nom: 'Gardien du patrimoine', badge_icone: '🏰', badge_metal: 'or' });
    const liste = await (await requete('/', {}, 'citoyen', 'camille')).json();
    expect(liste.chasses[0]).toMatchObject({ badge_nom: 'Gardien du patrimoine', badge_icone: '🏰' });
  });

  it('icône ou métal hors liste refusés', async () => {
    expect((await envoyer('POST', '/', { ...PARCOURS, badge: { ...BADGE, icone: '<img>' } })).status).toBe(400);
    expect((await envoyer('POST', '/', { ...PARCOURS, badge: { ...BADGE, metal: 'platine' } })).status).toBe(400);
  });
});

describe('gagner le badge', () => {
  it('une fois par personne, avec un rang figé ; rien avant la dernière étape', async () => {
    const { etapes } = await parcoursPublie();
    const premiere = await (await envoyer('POST', '/valider-position', { etape_id: etapes[0].id, lat: LAT, lng: 1.88 }, 'citoyen', 'camille')).json();
    expect(premiere.badges_parcours).toEqual([]);

    const fin = await (await envoyer('POST', '/valider-position', { etape_id: etapes[1].id, lat: etapes[1].lat, lng: 1.88 }, 'citoyen', 'camille')).json();
    expect(fin.badges_parcours).toEqual([expect.objectContaining({
      type: 'parcours', nom: 'Gardien du patrimoine', village_nom: 'Eaucourt-sur-Somme', parcours_titre: 'Balade patrimoine', rang: 1,
    })]);
    const second = await terminer(etapes, 'dominique');
    expect(second.badges_parcours[0].rang).toBe(2);
    expect(db.badges_parcours).toHaveLength(2);

    // Rejouer la dernière étape : refusé, aucun badge de plus.
    expect((await envoyer('POST', '/valider-position', { etape_id: etapes[1].id, lat: etapes[1].lat, lng: 1.88 }, 'citoyen', 'camille')).status).toBe(400);
    expect(db.badges_parcours).toHaveLength(2);
  });

  it('le badge gagné est une copie : modifier ou retirer celui du parcours ne le change pas', async () => {
    const { id, etapes } = await parcoursPublie();
    await terminer(etapes, 'camille');
    expect((await envoyer('PATCH', `/${id}`, { titre: 'Balade patrimoine', badge: { ...BADGE, nom: 'Autre nom' } })).status).toBe(200);
    expect(db.chasses_tresor.find((c) => c.id === id)!.badge_nom).toBe('Autre nom');
    expect((await envoyer('PATCH', `/${id}`, { titre: 'Balade patrimoine', badge: null })).status).toBe(200);
    expect(db.chasses_tresor.find((c) => c.id === id)!.badge_nom).toBeNull();
    expect(db.badges_parcours[0].nom).toBe('Gardien du patrimoine');
    // Un PATCH sans le champ badge (ancienne version de l'appli) n'y touche pas.
    db.chasses_tresor.find((c) => c.id === id)!.badge_nom = 'Remis';
    await envoyer('PATCH', `/${id}`, { titre: 'Balade patrimoine' });
    expect(db.chasses_tresor.find((c) => c.id === id)!.badge_nom).toBe('Remis');
  });

  it('parcours sans badge : rien, sauf le grand badge du village quand tout est terminé', async () => {
    const sansBadge = await parcoursPublie({ ...PARCOURS, titre: 'Tour des étangs', badge: undefined });
    const avecBadge = await parcoursPublie();
    const r1 = await terminer(sansBadge.etapes, 'camille');
    expect(r1.badges_parcours).toEqual([]);
    const r2 = await terminer(avecBadge.etapes, 'camille');
    expect(r2.badges_parcours.map((b: any) => b.type)).toEqual(['parcours', 'village']);
    expect(r2.badges_parcours[1]).toMatchObject({ nom: "Connaisseur d'Eaucourt-sur-Somme", icone: '🏆', metal: 'or', rang: 1 });
  });

  it('grand badge : monte d’un niveau quand on termine de nouveau tout, après un ajout de la mairie', async () => {
    const a = await parcoursPublie({ ...PARCOURS, titre: 'A', badge: undefined });
    const b = await parcoursPublie({ ...PARCOURS, titre: 'B', badge: undefined });
    await terminer(a.etapes, 'camille');
    expect((await terminer(b.etapes, 'camille')).badges_parcours).toEqual([expect.objectContaining({ type: 'village', niveau: 1 })]);

    // La mairie publie deux nouveaux parcours : le profil montre qu'il y a du nouveau.
    const c = await parcoursPublie({ ...PARCOURS, titre: 'C', badge: undefined });
    const d = await parcoursPublie({ ...PARCOURS, titre: 'D', badge: undefined });
    expect((await collectionParcours(ENV, 'c-1', 'camille')).grand_badge).toMatchObject({ obtenu: true, niveau: 1, total: 4, termines: 2 });

    // Un seul des deux terminé : pas encore de niveau.
    expect((await terminer(c.etapes, 'camille')).badges_parcours).toEqual([]);
    const fin = await terminer(d.etapes, 'camille');
    expect(fin.badges_parcours).toEqual([expect.objectContaining({ type: 'village', niveau: 2, ameliore: true, rang: 1, phrase: 'Les 4 parcours du village, tous terminés.' })]);
    const grands = db.badges_parcours.filter((x) => x.type === 'village');
    expect(grands).toHaveLength(1); // une mise à jour, jamais une deuxième ligne
    expect(grands[0]).toMatchObject({ niveau: 2 });
    expect(grands[0].ameliore_le).toBeTruthy();
  });

  it('pas de grand badge pour une commune à un seul parcours', async () => {
    const { etapes } = await parcoursPublie();
    const fin = await terminer(etapes, 'camille');
    expect(fin.badges_parcours.map((b: any) => b.type)).toEqual(['parcours']);
  });

  it('une panne des badges ne casse jamais la fin du parcours', async () => {
    const { etapes } = await parcoursPublie();
    tablesEnPanne.add('badges_parcours');
    const fin = await terminer(etapes, 'camille');
    expect(fin).toMatchObject({ ok: true, parcours_termine: true, badges_parcours: [] });
  });
});

describe('mode test', () => {
  it('la dernière étape montre le badge, sans rien enregistrer', async () => {
    const res = await envoyer('POST', '/', PARCOURS);
    const id = (await res.json()).chasse_id;
    const [premiere, derniere] = db.etapes_chasse.filter((e) => e.chasse_id === id).sort((a, b) => a.ordre - b.ordre);
    expect((await (await envoyer('POST', `/${id}/tester`, { etape_id: premiere.id })).json()).badges_parcours).toEqual([]);
    const test = await (await envoyer('POST', `/${id}/tester`, { etape_id: derniere.id })).json();
    expect(test.badges_parcours).toEqual([expect.objectContaining({ nom: 'Gardien du patrimoine', rang: null })]);
    expect(db.badges_parcours).toEqual([]);
  });
});

describe('collection et jeux ailleurs', () => {
  it('un parcours joué ailleurs range le badge chez la commune du compte', async () => {
    db.chasses_tresor.push({ id: 'ch-ailleurs', commune_id: 'c-2', titre: 'Les phoques', actif: true, badge_nom: 'Ami des phoques', badge_icone: '🐟', badge_metal: 'somme', badge_phrase: null });
    const gagnes = await attribuerBadgesFinParcours(ENV, 'c-1', 'c-2', 'camille', 'ch-ailleurs');
    expect(gagnes).toEqual([expect.objectContaining({ nom: 'Ami des phoques', village_nom: 'Le Crotoy', rang: 1 })]);
    expect(db.badges_parcours[0]).toMatchObject({ commune_id: 'c-1', commune_parcours_id: 'c-2' });
    // Un parcours d'une autre commune ne peut pas être revendiqué sous un mauvais identifiant.
    expect(await attribuerBadgesFinParcours(ENV, 'c-1', 'c-1', 'camille', 'ch-ailleurs')).toEqual([]);
  });

  it('profil : badges gagnés, silhouettes et progression vers le grand badge', async () => {
    const a = await parcoursPublie();
    await parcoursPublie({ ...PARCOURS, titre: 'Chemin des moulins', badge: { ...BADGE, nom: 'Meunier' } });
    await parcoursPublie({ ...PARCOURS, titre: 'Sans badge', badge: undefined });
    await terminer(a.etapes, 'camille');
    const collection = await collectionParcours(ENV, 'c-1', 'camille');
    expect(collection.badges.map((b: any) => b.nom)).toEqual(['Gardien du patrimoine']);
    expect(collection.a_decouvrir.map((p: any) => p.parcours_titre)).toEqual(['Chemin des moulins']);
    expect(collection.grand_badge).toMatchObject({ total: 3, termines: 1, obtenu: false });
  });

  it('nom du grand badge selon le village', () => {
    expect(nomGrandBadge('Eaucourt-sur-Somme')).toBe("Connaisseur d'Eaucourt-sur-Somme");
    expect(nomGrandBadge('Le Crotoy')).toBe('Connaisseur du Crotoy');
    expect(nomGrandBadge('Les Andelys')).toBe('Connaisseur des Andelys');
    expect(nomGrandBadge('Tourly')).toBe('Connaisseur de Tourly');
    expect(nomGrandBadge("L'Étoile")).toBe("Connaisseur de L'Étoile");
  });
});
