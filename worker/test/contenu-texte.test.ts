// worker/test/contenu-texte.test.ts
// Couvre chargerContenuTexte/enregistrerContenuTexte (voir src/backoffice/contenu-texte.ts) :
// petits textes citoyen (popup module verrouillé, checklist de démarrage) éditables depuis le
// backoffice via la table modeles_email, sans commune_id (contenu global). Mock Supabase en
// mémoire GET/POST/PATCH repris de prospection-ab.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chargerContenuTexte, enregistrerContenuTexte, DEFAUTS_CONTENU_TEXTE, CLES_CONTENU_TEXTE } from '../src/backoffice/contenu-texte';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

function reinitialiserDb() {
  db = { modeles_email: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('in.(') && filtre.endsWith(')')) {
    const valeurs = filtre.slice(4, -1).split(',');
    return valeurs.includes(String(valeur));
  }
  return true;
}

function appliquerFiltres(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}

function fetchFake(input: any, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const methode = init?.method || 'GET';
  const table = url.pathname.replace('/rest/v1/', '');

  if (methode === 'GET') {
    return Promise.resolve(new Response(JSON.stringify(appliquerFiltres(db[table] || [], url.searchParams)), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init!.body));
    const ligne = { id: crypto.randomUUID(), ...corps };
    (db[table] ??= []).push(ligne);
    return Promise.resolve(new Response(JSON.stringify([ligne]), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init!.body));
    const ciblees = appliquerFiltres(db[table] || [], url.searchParams);
    for (const ligne of ciblees) Object.assign(ligne, corps);
    return Promise.resolve(new Response(JSON.stringify(ciblees), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key' };

beforeEach(() => {
  reinitialiserDb();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chargerContenuTexte', () => {
  it('renvoie les valeurs par défaut quand rien n\'est enregistré', async () => {
    const r = await chargerContenuTexte(ENV);
    expect(r).toEqual(DEFAUTS_CONTENU_TEXTE);
  });

  it('renvoie la valeur personnalisée pour une cle éditée, les défauts pour les autres', async () => {
    db.modeles_email.push({ cle: 'checklist_titre', corps_html: '👋 Bien démarrer avec Plateforme-Agora' });

    const r = await chargerContenuTexte(ENV);

    expect(r.checklist_titre).toBe('👋 Bien démarrer avec Plateforme-Agora');
    expect(r.popup_verrouille_titre).toBe(DEFAUTS_CONTENU_TEXTE.popup_verrouille_titre);
  });

  it('reste résilient si la lecture échoue (défauts complets)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('réseau down')));
    const r = await chargerContenuTexte(ENV);
    expect(r).toEqual(DEFAUTS_CONTENU_TEXTE);
  });
});

describe('enregistrerContenuTexte', () => {
  it('insère une nouvelle ligne quand la cle n\'existe pas encore', async () => {
    await enregistrerContenuTexte(ENV, 'checklist_titre', 'Nouveau titre');

    expect(db.modeles_email).toHaveLength(1);
    expect(db.modeles_email[0]).toMatchObject({ cle: 'checklist_titre', corps_html: 'Nouveau titre' });
  });

  it('met à jour la ligne existante plutôt que d\'en créer une seconde', async () => {
    db.modeles_email.push({ id: 'x', cle: 'checklist_titre', corps_html: 'Ancien titre' });

    await enregistrerContenuTexte(ENV, 'checklist_titre', 'Titre modifié');

    expect(db.modeles_email).toHaveLength(1);
    expect(db.modeles_email[0].corps_html).toBe('Titre modifié');
  });

  it('un enregistrement se reflète dans un chargement suivant', async () => {
    await enregistrerContenuTexte(ENV, 'popup_verrouille_corps', '<p>Nouveau corps {{module}}</p>');

    const r = await chargerContenuTexte(ENV);

    expect(r.popup_verrouille_corps).toBe('<p>Nouveau corps {{module}}</p>');
    // Les autres cles restent inchangées.
    expect(r.checklist_titre).toBe(DEFAUTS_CONTENU_TEXTE.checklist_titre);
  });
});

describe('cohérence des defauts', () => {
  it('DEFAUTS_CONTENU_TEXTE couvre exactement CLES_CONTENU_TEXTE', () => {
    expect(Object.keys(DEFAUTS_CONTENU_TEXTE).sort()).toEqual([...CLES_CONTENU_TEXTE].sort());
  });
});
