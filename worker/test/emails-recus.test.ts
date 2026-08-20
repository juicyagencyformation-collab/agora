// worker/test/emails-recus.test.ts
// Couvre la boîte de réception des réponses reçues (voir src/backoffice/emails-recus.ts) :
// extraction de l'adresse expéditrice, tri par mots-clés (fermeture / changement d'adresse /
// autre — volontairement SANS IA, décision prise avec Léandre le 2026-08-20 après une première
// version à base de modèle de langage jugée trop complexe pour le besoin), et l'orchestration
// depuis le webhook (matching du prospect, déduplication par event_id). Aucun appel réseau réel :
// fetch() est stubbé (Supabase + Resend), même esprit que test/onboarding-drip.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extraireAdresse, classifierParMotsCles, traiterEmailRecu } from '../src/backoffice/emails-recus';

// --- Fausse base Supabase + faux Resend, pilotés par fetch() -----------------------------------
type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let resendCorpsReponse: { text?: string | null; html?: string | null; status?: number } | null = null;
let resendAppels = 0;

function reinitialiser() {
  db = { prospects: [], emails_recus: [] };
  resendCorpsReponse = null;
  resendAppels = 0;
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
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

  if (url.hostname === 'api.resend.com' && url.pathname.startsWith('/emails/receiving/')) {
    resendAppels += 1;
    if (!resendCorpsReponse || resendCorpsReponse.status) {
      return Promise.resolve(new Response('erreur', { status: resendCorpsReponse?.status || 500 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ text: resendCorpsReponse.text ?? null, html: resendCorpsReponse.html ?? null }), { status: 200 }));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  if (methode === 'GET') {
    return Promise.resolve(new Response(JSON.stringify(appliquerRequete(db[table] || [], url.searchParams)), { status: 200 }));
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
};

function ajouterProspect(overrides: Partial<Ligne> = {}): Ligne {
  const p = { id: crypto.randomUUID(), nom: 'Testville', contact_email: 'mairie@testville.fr', ...overrides };
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
  });
});

describe('classifierParMotsCles', () => {
  it('détecte une fermeture (vacances, congés, absence, fermeture exceptionnelle)', () => {
    expect(classifierParMotsCles('La mairie est fermée jusqu\'au 10 septembre.')).toBe('fermeture');
    expect(classifierParMotsCles('Je suis actuellement en congés, de retour le 5 septembre.')).toBe('fermeture');
    expect(classifierParMotsCles('Fermeture exceptionnelle du secrétariat cette semaine.')).toBe('fermeture');
    expect(classifierParMotsCles('Out of office until next week.')).toBe('fermeture');
  });

  it('détecte un changement d\'adresse email', () => {
    expect(classifierParMotsCles('Cette adresse n\'est plus utilisée, merci d\'utiliser contact@mairie.fr.')).toBe('changement_email');
    expect(classifierParMotsCles('Notre nouvelle adresse est secretariat@mairie.fr.')).toBe('changement_email');
    expect(classifierParMotsCles('This address is no longer monitored, please use info@townhall.fr.')).toBe('changement_email');
  });

  it('priorise changement_email quand les deux sont mentionnés (info la plus actionnable)', () => {
    const texte = 'Je suis en congés. Merci d\'utiliser plutôt secretariat@mairie.fr en mon absence.';
    expect(classifierParMotsCles(texte)).toBe('changement_email');
  });

  it('classe "autre" un message sans mot-clé reconnu', () => {
    expect(classifierParMotsCles('Merci de votre message, nous reviendrons vers vous.')).toBe('autre');
    expect(classifierParMotsCles('')).toBe('autre');
  });
});

describe('traiterEmailRecu — orchestration depuis le webhook', () => {
  it('enregistre un email classé, rattaché au prospect trouvé par l\'adresse expéditrice', async () => {
    const p = ajouterProspect({ nom: 'Testville', contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { text: 'La mairie est fermée jusqu\'à nouvel ordre.' };

    await traiterEmailRecu(ENV, 'evt-1', 'email-abc', 'Mairie de Testville <mairie@testville.fr>', 'Re: Présentation Agora');

    expect(db.emails_recus).toHaveLength(1);
    expect(db.emails_recus[0]).toMatchObject({
      event_id: 'evt-1', prospect_id: p.id, commune_nom: 'Testville',
      expediteur: 'mairie@testville.fr', sujet: 'Re: Présentation Agora', categorie: 'fermeture',
    });
  });

  it('enregistre quand même le message si aucun prospect ne correspond (prospect_id null)', async () => {
    resendCorpsReponse = { text: 'Bonjour, merci de votre message.' };

    await traiterEmailRecu(ENV, 'evt-2', 'email-abc', 'inconnu@ailleurs.fr', null);

    expect(db.emails_recus).toHaveLength(1);
    expect(db.emails_recus[0].prospect_id).toBeNull();
    expect(db.emails_recus[0].commune_nom).toBeNull();
  });

  it('ne duplique pas un même événement webhook rejoué (déduplication par event_id)', async () => {
    ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { text: 'Fermé pour congés.' };

    await traiterEmailRecu(ENV, 'evt-3', 'email-abc', 'mairie@testville.fr', null);
    await traiterEmailRecu(ENV, 'evt-3', 'email-abc', 'mairie@testville.fr', null); // même event_id, rejoué

    expect(db.emails_recus).toHaveLength(1);
  });

  it('se rabat sur le corps HTML si aucun texte brut n\'est fourni', async () => {
    ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { text: null, html: '<p>Nous sommes <b>fermés</b> pour congés.</p>' };

    await traiterEmailRecu(ENV, 'evt-4', 'email-abc', 'mairie@testville.fr', null);

    expect(db.emails_recus[0].categorie).toBe('fermeture');
    expect(db.emails_recus[0].texte).not.toContain('<b>');
  });

  it('n\'enregistre rien si la récupération du corps échoue (retentera au prochain envoi)', async () => {
    ajouterProspect({ contact_email: 'mairie@testville.fr' });
    resendCorpsReponse = { status: 500 };

    await traiterEmailRecu(ENV, 'evt-5', 'email-abc', 'mairie@testville.fr', null);

    expect(db.emails_recus).toHaveLength(0);
  });

  it('ne plante pas si l\'adresse expéditrice du webhook est absente/invalide', async () => {
    await expect(traiterEmailRecu(ENV, 'evt-6', 'email-abc', '', null)).resolves.toBeUndefined();
    expect(resendAppels).toBe(0);
    expect(db.emails_recus).toHaveLength(0);
  });
});
