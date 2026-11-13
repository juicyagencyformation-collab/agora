// worker/test/chasses-brouillon.test.ts
// Brouillon → test → publication des parcours (2026-11-13). Ce qu'on verrouille : une chasse
// créée n'est ni visible ni jouable ni notifiée avant « Publier » ; le mode test n'écrit rien
// (ni progression ni XP — anti-farming) ; un brouillon se restructure librement en gardant les
// qr_token ; la publication refait le contrôle, ne notifie qu'une fois, et « Réactiver » ne la
// contourne pas. Fausse base Supabase pilotée par fetch(), même esprit que jeux-ailleurs.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';

const push = vi.hoisted(() => ({ envoyes: [] as string[] }));
vi.mock('../src/lib/push', () => ({
  utilisateursAbonnesA: async () => ['abonne-1'],
  envoyerNotificationAUtilisateurs: async (_e: any, _c: string, _ids: string[], _t: string, corps: string) => { push.envoyes.push(corps); },
}));
const r2 = vi.hoisted(() => ({ effaces: [] as string[] }));
vi.mock('../src/storage', () => ({
  uploaderFichier: async () => 'https://cdn.test/x.jpg',
  deleteObject: async (_e: any, cle: string) => { r2.effaces.push(cle); },
}));

import chasses, { verifierAvantPublication } from '../src/routes/chasses_tresor';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'k', JWT_SECRET: 'fake-jwt-secret-suffisamment-long', R2_PUBLIC_BASE: 'https://cdn.test' };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('lt.')) return Number(valeur) < Number(filtre.slice(3));
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
  if (methode === 'GET') {
    const select = url.searchParams.get('select');
    const lignes = filtrer(db[table] || [], url.searchParams);
    return ok(select ? lignes.map((l) => Object.fromEntries(select.split(',').map((ch) => [ch, l[ch]]))) : lignes);
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...inserees);
    return ok(inserees, 201);
  }
  if (methode === 'PATCH') {
    const lignes = filtrer(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, JSON.parse(String(init.body)));
    return ok(lignes);
  }
  if (methode === 'DELETE') {
    const aEffacer = new Set(filtrer(db[table] || [], url.searchParams));
    db[table] = (db[table] || []).filter((l) => !aEffacer.has(l));
    return Promise.resolve(new Response(null, { status: 204 }));
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
const etape = (titre: string, lat: number, extra: Ligne = {}) => ({ titre, indice: 'Par là', lat, lng: 1.88, type_contenu: 'texte', contenu: `Texte ${titre}`, ...extra });
const PARCOURS = {
  titre: 'Du clocher au moulin', description: 'Une balade', mode: 'balade', rayon_metres: 40,
  etapes: [etape('Mairie', LAT), etape('Église', LAT + 0.003, { type_contenu: 'enigme', contenu: 'Les États … ?', enigme_reponse: 'généraux' }), etape('Moulin', LAT + 0.01)],
};

async function creerBrouillon() {
  const res = await envoyer('POST', '/', PARCOURS);
  expect(res.status).toBe(201);
  return (await res.json()).chasse_id as string;
}

beforeEach(() => {
  db = {
    chasses_tresor: [{ id: 'ch-publiee', commune_id: 'c-1', titre: 'Ancienne', actif: true, brouillon: false, mode: 'chasse', rayon_metres: 50, created_at: '2026-11-01' }],
    etapes_chasse: [], progressions_chasse: [], users: [{ id: 'maire-1', commune_id: 'c-1', xp: 0 }],
  };
  push.envoyes = [];
  r2.effaces = [];
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('brouillon de parcours', () => {
  it('création = brouillon : invisible des habitants, sans notification, listé pour la mairie', async () => {
    const id = await creerBrouillon();
    expect(push.envoyes).toEqual([]);
    expect(db.chasses_tresor.find((c) => c.id === id)).toMatchObject({ actif: false, brouillon: true });

    const habitant = await (await requete('/', {}, 'citoyen', 'habitant')).json();
    expect(habitant.chasses.map((c: any) => c.id)).toEqual(['ch-publiee']);
    expect(habitant).not.toHaveProperty('brouillons');

    const mairie = await (await requete('/')).json();
    expect(mairie.brouillons.map((c: any) => c.id)).toEqual([id]);
    // Un brouillon n'est pas une archive (sinon « Réactiver » le publierait sans contrôle).
    expect((await (await requete('/?archivees=true')).json()).chasses).toEqual([]);
  });

  it('injouable tant que non publié', async () => {
    const id = await creerBrouillon();
    const premiere = db.etapes_chasse.find((e) => e.chasse_id === id && e.ordre === 0)!;
    const res = await envoyer('POST', '/valider-position', { etape_id: premiere.id, lat: premiere.lat, lng: premiere.lng }, 'citoyen', 'habitant');
    expect(res.status).toBe(404);
    expect(db.progressions_chasse).toEqual([]);
  });

  it('mode test : rejoue découverte et énigme sans rien enregistrer, distance en option', async () => {
    const id = await creerBrouillon();
    const [mairie, eglise] = db.etapes_chasse.filter((e) => e.chasse_id === id).sort((a, b) => a.ordre - b.ordre);

    const decouverte = await (await envoyer('POST', `/${id}/tester`, { etape_id: mairie.id })).json();
    expect(decouverte.contenu_revele).toEqual({ type: 'texte', texte: 'Texte Mairie' });

    const question = await (await envoyer('POST', `/${id}/tester`, { etape_id: eglise.id, lat: LAT, lng: 1.88 })).json();
    expect(question).toMatchObject({ etape_enigme: true, question: 'Les États … ?', dans_la_zone: false, rayon_metres: 40 });
    expect(question.distance_metres).toBeGreaterThan(300);
    expect((await envoyer('POST', `/${id}/tester`, { etape_id: eglise.id, reponse: 'royaux' })).status).toBe(400);
    expect((await envoyer('POST', `/${id}/tester`, { etape_id: eglise.id, reponse: 'GÉNÉRAUX' })).status).toBe(200);

    expect(db.progressions_chasse).toEqual([]);
    expect(db.users[0].xp).toBe(0);
    expect((await envoyer('POST', `/${id}/tester`, { etape_id: mairie.id }, 'citoyen', 'habitant')).status).toBe(403);
  });

  it('modification libre : ajout, retrait, réordre ; les étapes gardées conservent leur QR', async () => {
    const id = await creerBrouillon();
    const [mairie, eglise, moulin] = db.etapes_chasse.filter((e) => e.chasse_id === id).sort((a, b) => a.ordre - b.ordre);
    moulin.photo_r2_key = 'c-1/chasses/moulin.jpg';
    const qrMoulin = moulin.qr_token;

    const res = await envoyer('PUT', `/${id}`, {
      ...PARCOURS, mode: 'chasse',
      etapes: [{ ...etape('Moulin', LAT + 0.01), id: moulin.id }, etape('Pont', LAT + 0.02), { ...etape('Mairie', LAT), id: mairie.id }],
    });
    expect(res.status).toBe(200);
    const apres = db.etapes_chasse.filter((e) => e.chasse_id === id).sort((a, b) => a.ordre - b.ordre);
    expect(apres.map((e) => e.titre)).toEqual(['Moulin', 'Pont', 'Mairie']);
    expect(apres[0].qr_token).toBe(qrMoulin);
    expect(apres.some((e) => e.id === eglise.id)).toBe(false);
    expect(r2.effaces).toEqual(['c-1/chasses/moulin.jpg']); // photo plus envoyée → effacée
    expect(db.chasses_tresor.find((c) => c.id === id)!.mode).toBe('chasse');

    // Une étape d'une autre chasse ne peut pas être « adoptée » par ce brouillon.
    db.etapes_chasse.push({ id: '99999999-9999-4999-8999-999999999999', commune_id: 'c-1', chasse_id: 'ch-publiee', ordre: 0 });
    const intrus = await envoyer('PUT', `/${id}`, { ...PARCOURS, etapes: [{ ...etape('X', LAT), id: '99999999-9999-4999-8999-999999999999' }] });
    expect(intrus.status).toBe(400);
    // Un parcours publié ne se restructure pas.
    expect((await envoyer('PUT', '/ch-publiee', PARCOURS)).status).toBe(404);
  });

  it('publication : contrôle refait, une seule notification, puis jouable', async () => {
    const id = await creerBrouillon();
    db.etapes_chasse.find((e) => e.chasse_id === id && e.ordre === 1)!.enigme_reponse = null;
    const refus = await envoyer('POST', `/${id}/publier`, {});
    expect(refus.status).toBe(400);
    expect((await refus.json()).erreurs).toEqual(['Étape 2 : l’énigme n’a pas de question ou pas de réponse.']);
    expect(push.envoyes).toEqual([]);

    db.etapes_chasse.find((e) => e.chasse_id === id && e.ordre === 1)!.enigme_reponse = 'généraux';
    expect((await envoyer('POST', `/${id}/publier`, {}, 'citoyen', 'habitant')).status).toBe(403);
    expect((await envoyer('POST', `/${id}/publier`, {})).status).toBe(200);
    expect((await envoyer('POST', `/${id}/publier`, {})).status).toBe(404); // double clic
    expect(push.envoyes).toEqual(['Du clocher au moulin']);
    expect(db.chasses_tresor.find((c) => c.id === id)).toMatchObject({ actif: true, brouillon: false });
    expect((await (await requete('/', {}, 'citoyen', 'habitant')).json()).chasses.map((c: any) => c.id)).toContain(id);
  });

  it('« Réactiver » ne publie jamais un brouillon', async () => {
    const id = await creerBrouillon();
    const res = await envoyer('PATCH', `/${id}`, { titre: 'X', actif: true });
    expect(res.status).toBe(400);
    expect(db.chasses_tresor.find((c) => c.id === id)).toMatchObject({ actif: false, brouillon: true });
  });
});

describe('verifierAvantPublication', () => {
  const e = (ordre: number, lat: number, extra: Ligne = {}) => ({ ordre, lat, lng: 1.88, type_contenu: 'texte', contenu: 'x', ...extra });

  it('signale deux étapes de balade plus proches que le rayon', () => {
    const { erreurs, avertissements } = verifierAvantPublication(
      { mode: 'balade', rayon_metres: 40, description: 'd' },
      [e(0, 50.0610), e(1, 50.06125), e(2, 50.0700)], // ≈ 28 m puis ≈ 970 m
    );
    expect(erreurs).toEqual([]);
    expect(avertissements).toHaveLength(1);
    expect(avertissements[0]).toMatch(/^Étapes 1 et 2 : 28 m d’écart/);
  });

  it('bloque une énigme sans réponse, une découverte vide ou un parcours sans étape', () => {
    expect(verifierAvantPublication({ mode: 'balade', rayon_metres: 40, description: 'd' }, []).erreurs).toEqual(['Le parcours n’a aucune étape.']);
    const { erreurs } = verifierAvantPublication({ mode: 'balade', rayon_metres: 40, description: 'd' }, [
      e(0, 50.0, { contenu: ' ' }), e(1, 50.1, { type_contenu: 'enigme', contenu: 'Q ?', enigme_reponse: '' }),
    ]);
    expect(erreurs).toEqual(['Étape 1 : la découverte n’a pas de texte.', 'Étape 2 : l’énigme n’a pas de question ou pas de réponse.']);
  });

  it('rappelle les QR à poser (mode chasse) et l’absence de description', () => {
    const { avertissements } = verifierAvantPublication({ mode: 'chasse', rayon_metres: 50, description: '' }, [e(0, 50.0), e(1, 50.1)]);
    expect(avertissements).toEqual([
      'Chasse au trésor : les 2 QR codes doivent être imprimés et posés avant de publier (bouton « Voir les QR codes »).',
      'Pas de description : les joueurs ne savent pas à quoi s’attendre avant de commencer.',
    ]);
  });
});
