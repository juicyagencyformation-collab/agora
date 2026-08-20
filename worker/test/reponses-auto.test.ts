// worker/test/reponses-auto.test.ts
// Couvre l'interprétation automatique des réponses reçues des mairies (voir
// src/backoffice/reponses-auto.ts) : extraction de l'adresse expéditrice, appel du modèle de
// langage (IA choisie explicitement par Léandre le 2026-08-20 plutôt qu'une détection par
// mots-clés, jugée trop fragile face à la variété des formulations), et surtout le principe de
// sécurité central — ne JAMAIS agir sur une extraction incertaine, toujours journaliser même
// quand on ne fait rien, pour qu'une réponse ne disparaisse jamais silencieusement.
// Aucun appel réseau réel : fetch() est stubbé (Supabase + Resend + Anthropic), même esprit que
// test/onboarding-drip.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  extraireAdresse, interpreterReponseAuto, traiterReponseAutoProspect, traiterEmailRecu,
  type InterpretationReponse,
} from '../src/backoffice/reponses-auto';

// --- Fausse base Supabase + faux Resend/Anthropic, pilotés par fetch() ------------------------
type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let anthropicReponse: { texte: string; status?: number } | null = null;
let anthropicAppels = 0;
let resendCorpsReponse: { text?: string | null; html?: string | null; from?: string; status?: number } | null = null;
let resendAppels = 0;

function reinitialiser() {
  db = { prospects: [], prospect_interactions: [] };
  anthropicReponse = null;
  anthropicAppels = 0;
  resendCorpsReponse = null;
  resendAppels = 0;
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  return true;
}

function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
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

  if (url.hostname === 'api.anthropic.com') {
    anthropicAppels += 1;
    if (!anthropicReponse) return Promise.resolve(new Response('{}', { status: 500 }));
    if (anthropicReponse.status && anthropicReponse.status !== 200) {
      return Promise.resolve(new Response('erreur', { status: anthropicReponse.status }));
    }
    return Promise.resolve(new Response(JSON.stringify({ content: [{ text: anthropicReponse.texte }] }), { status: 200 }));
  }

  if (url.hostname === 'api.resend.com' && url.pathname.startsWith('/emails/receiving/')) {
    resendAppels += 1;
    if (!resendCorpsReponse || resendCorpsReponse.status) {
      return Promise.resolve(new Response('erreur', { status: resendCorpsReponse?.status || 500 }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      text: resendCorpsReponse.text ?? null, html: resendCorpsReponse.html ?? null, from: resendCorpsReponse.from,
    }), { status: 200 }));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  if (methode === 'GET') {
    return Promise.resolve(new Response(JSON.stringify(appliquerRequete(db[table] || [], url.searchParams)), { status: 200 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init!.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init!.body));
    const ligne = { id: crypto.randomUUID(), ...corps };
    (db[table] ??= []).push(ligne);
    return Promise.resolve(new Response(JSON.stringify([ligne]), { status: 201 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  RESEND_API_KEY: 'fake-resend-key',
  ANTHROPIC_API_KEY: 'fake-anthropic-key',
};

function ajouterProspect(overrides: Partial<Ligne> = {}): Ligne {
  const p = { id: crypto.randomUUID(), nom: 'Testville', contact_email: 'mairie@testville.fr', email_invalide: false, ...overrides };
  db.prospects.push(p);
  return p;
}

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------

describe('extraireAdresse', () => {
  it('extrait l\'adresse depuis "Nom <email>"', () => {
    expect(extraireAdresse('Mairie de Testville <mairie@testville.fr>')).toBe('mairie@testville.fr');
  });
  it('accepte une adresse nue', () => {
    expect(extraireAdresse('mairie@testville.fr')).toBe('mairie@testville.fr');
  });
  it('renvoie null sur une valeur vide ou invalide', () => {
    expect(extraireAdresse(null)).toBeNull();
    expect(extraireAdresse('')).toBeNull();
    expect(extraireAdresse('pas une adresse')).toBeNull();
    expect(extraireAdresse('Nom <pas-une-adresse>')).toBeNull();
  });
});

describe('interpreterReponseAuto', () => {
  it('parse une réponse JSON valide', async () => {
    anthropicReponse = { texte: '{"categorie":"fermeture","date_retour":"2026-09-01","nouvel_email":null,"resume":"Fermé jusqu\'au 1er septembre."}' };
    const r = await interpreterReponseAuto(ENV, 'Notre mairie est fermée jusqu\'au 1er septembre.');
    expect(r).toEqual({ categorie: 'fermeture', date_retour: '2026-09-01', nouvel_email: null, resume: "Fermé jusqu'au 1er septembre." });
  });

  it('retire un bloc ```json si le modèle en ajoute un malgré la consigne', async () => {
    anthropicReponse = { texte: '```json\n{"categorie":"autre","date_retour":null,"nouvel_email":null,"resume":"Rien d\'exploitable."}\n```' };
    const r = await interpreterReponseAuto(ENV, 'blabla');
    expect(r?.categorie).toBe('autre');
  });

  it('renvoie null si la catégorie n\'est pas reconnue', async () => {
    anthropicReponse = { texte: '{"categorie":"inconnu","date_retour":null,"nouvel_email":null,"resume":""}' };
    expect(await interpreterReponseAuto(ENV, 'x')).toBeNull();
  });

  it('renvoie null sur une réponse JSON malformée', async () => {
    anthropicReponse = { texte: 'ceci n\'est pas du JSON' };
    expect(await interpreterReponseAuto(ENV, 'x')).toBeNull();
  });

  it('renvoie null si l\'API Anthropic répond en erreur', async () => {
    anthropicReponse = { texte: '', status: 500 };
    expect(await interpreterReponseAuto(ENV, 'x')).toBeNull();
  });

  it('renvoie null sans appeler l\'API si ANTHROPIC_API_KEY est absente', async () => {
    const r = await interpreterReponseAuto({ ...ENV, ANTHROPIC_API_KEY: '' }, 'x');
    expect(r).toBeNull();
    expect(anthropicAppels).toBe(0);
  });

  it('renvoie null sans appeler l\'API si le texte est vide', async () => {
    const r = await interpreterReponseAuto(ENV, '   ');
    expect(r).toBeNull();
    expect(anthropicAppels).toBe(0);
  });

  it('ignore une date_retour mal formée plutôt que de la faire remonter telle quelle', async () => {
    anthropicReponse = { texte: '{"categorie":"fermeture","date_retour":"1er septembre 2026","nouvel_email":null,"resume":""}' };
    const r = await interpreterReponseAuto(ENV, 'x');
    expect(r?.date_retour).toBeNull();
  });

  it('ignore un nouvel_email invalide plutôt que de le faire remonter tel quel', async () => {
    anthropicReponse = { texte: '{"categorie":"changement_email","date_retour":null,"nouvel_email":"pas une adresse","resume":""}' };
    const r = await interpreterReponseAuto(ENV, 'x');
    expect(r?.nouvel_email).toBeNull();
  });
});

describe('traiterReponseAutoProspect — principe : ne jamais agir sur du douteux, toujours journaliser', () => {
  it('interprétation nulle (échec IA) : journalise le texte brut, ne touche à aucun champ', async () => {
    const p = ajouterProspect();
    await traiterReponseAutoProspect(ENV, p.id, null, 'Texte reçu original');

    expect(db.prospect_interactions).toHaveLength(1);
    expect(db.prospect_interactions[0]).toMatchObject({ type: 'note', prospect_id: p.id, staff_id: null });
    expect(db.prospect_interactions[0].contenu).toContain('Texte reçu original');
    expect(p.prochaine_relance_le).toBeUndefined();
    expect(p.contact_email).toBe('mairie@testville.fr');
  });

  it('catégorie "autre" : journalise le résumé, ne touche à aucun champ', async () => {
    const p = ajouterProspect();
    const interp: InterpretationReponse = { categorie: 'autre', date_retour: null, nouvel_email: null, resume: 'Accusé de vérification anti-robot.' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    expect(db.prospect_interactions).toHaveLength(1);
    expect(db.prospect_interactions[0].contenu).toContain('anti-robot');
    expect(p.contact_email).toBe('mairie@testville.fr');
  });

  it('fermeture avec date de retour : reprogramme la relance à cette date précise', async () => {
    const p = ajouterProspect();
    const interp: InterpretationReponse = { categorie: 'fermeture', date_retour: '2026-09-15', nouvel_email: null, resume: '' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    expect(p.prochaine_relance_le).toBe('2026-09-15');
    expect(db.prospect_interactions[0]).toMatchObject({ type: 'ferme' });
    expect(db.prospect_interactions[0].contenu).toContain('2026-09-15');
  });

  it('fermeture sans date : reprogramme la relance dans 14 jours par défaut', async () => {
    const p = ajouterProspect();
    const interp: InterpretationReponse = { categorie: 'fermeture', date_retour: null, nouvel_email: null, resume: '' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    const dans14Jours = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    expect(p.prochaine_relance_le).toBe(dans14Jours);
    expect(db.prospect_interactions[0].contenu).toContain('14 jours');
  });

  it('changement d\'email détecté et différent de l\'actuel : corrige le contact et lève email_invalide', async () => {
    const p = ajouterProspect({ contact_email: 'ancien@testville.fr', email_invalide: true });
    const interp: InterpretationReponse = { categorie: 'changement_email', date_retour: null, nouvel_email: 'nouveau@testville.fr', resume: '' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    expect(p.contact_email).toBe('nouveau@testville.fr');
    expect(p.email_invalide).toBe(false);
    expect(db.prospect_interactions[0]).toMatchObject({ type: 'contact' });
    expect(db.prospect_interactions[0].contenu).toContain('ancien@testville.fr → nouveau@testville.fr');
  });

  it('changement d\'email identique à l\'actuel : ne fait rien (pas de log superflu)', async () => {
    const p = ajouterProspect({ contact_email: 'meme@testville.fr' });
    const interp: InterpretationReponse = { categorie: 'changement_email', date_retour: null, nouvel_email: 'meme@testville.fr', resume: '' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    expect(db.prospect_interactions).toHaveLength(0);
  });

  it('changement d\'email annoncé mais adresse pas assez fiable pour être extraite : journalise pour relecture humaine, ne touche à aucun champ', async () => {
    const p = ajouterProspect({ contact_email: 'ancien@testville.fr' });
    const interp: InterpretationReponse = { categorie: 'changement_email', date_retour: null, nouvel_email: null, resume: 'Adresse changée, contactez le service.' };
    await traiterReponseAutoProspect(ENV, p.id, interp, 'texte brut');

    expect(p.contact_email).toBe('ancien@testville.fr'); // inchangé : jamais deviner une adresse
    expect(db.prospect_interactions).toHaveLength(1);
    expect(db.prospect_interactions[0].type).toBe('note');
  });
});

describe('traiterEmailRecu — orchestration bout en bout depuis le webhook', () => {
  it('ne fait rien si l\'expéditeur ne correspond à aucun prospect suivi (aucun appel Resend/Anthropic)', async () => {
    await traiterEmailRecu(ENV, 'email-123', 'inconnu@ailleurs.fr');

    expect(resendAppels).toBe(0);
    expect(anthropicAppels).toBe(0);
    expect(db.prospect_interactions).toHaveLength(0);
  });

  it('chemin complet : trouve le prospect, récupère le corps, interprète, agit', async () => {
    const p = ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { text: 'Nous sommes fermés jusqu\'au 10 septembre.', from: 'Mairie <mairie@testville.fr>' };
    anthropicReponse = { texte: '{"categorie":"fermeture","date_retour":"2026-09-10","nouvel_email":null,"resume":"Fermé jusqu\'au 10 septembre."}' };

    await traiterEmailRecu(ENV, 'email-123', 'Mairie de Testville <mairie@testville.fr>');

    expect(resendAppels).toBe(1);
    expect(anthropicAppels).toBe(1);
    expect(p.prochaine_relance_le).toBe('2026-09-10');
    expect(db.prospect_interactions[0]).toMatchObject({ type: 'ferme', prospect_id: p.id });
  });

  it('se rabat sur le corps HTML si aucun texte brut n\'est fourni', async () => {
    ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { text: null, html: '<p>Absent <b>jusqu\'au</b> 20/09.</p>', from: 'mairie@testville.fr' };
    anthropicReponse = { texte: '{"categorie":"autre","date_retour":null,"nouvel_email":null,"resume":"Absence signalée, date peu fiable."}' };

    await traiterEmailRecu(ENV, 'email-123', 'mairie@testville.fr');

    expect(anthropicAppels).toBe(1);
    expect(db.prospect_interactions).toHaveLength(1);
  });

  it('n\'insère rien si la récupération du corps échoue (retentera au prochain envoi)', async () => {
    ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { status: 500 };

    await traiterEmailRecu(ENV, 'email-123', 'mairie@testville.fr');

    expect(anthropicAppels).toBe(0);
    expect(db.prospect_interactions).toHaveLength(0);
  });

  it('ne plante pas si l\'adresse expéditrice du webhook est absente/invalide', async () => {
    await expect(traiterEmailRecu(ENV, 'email-123', '')).resolves.toBeUndefined();
    expect(resendAppels).toBe(0);
  });
});
