// worker/src/backoffice/onboarding-drip.ts
// Séquence d'onboarding/upsell des communes gratuites, déclenchée quotidiennement par
// verifierSequenceOnboarding (voir cron.ts), avec en plus un déclencheur temps réel côté front
// (clic sur un module verrouillé, voir POST /:slug/moderation/onglets/:cle/verrouille-clique
// dans routes/moderation.ts) qui alimente la même table activation_events.
//
// Logique (fournie par Léandre, non réinterprétée) :
//   J+3 sans événement d'activation  -> email_2 (relance activation)
//   J+7 sans événement d'activation  -> email_3 (check-in humain)
//   J+7 avec >=1 événement           -> email_4 (encouragement + graine upsell)
//   >=3 TYPES d'événements distincts -> email_5 (upsell dédié), une seule fois, JAMAIS sur un
//     critère de date seul — c'est la règle la plus importante de tout ce système.
// sequence_emails_sent (contrainte UNIQUE commune_id+email_type) est le garde-fou anti-doublon :
// vérifié avant tout envoi ET protégé par la contrainte elle-même si jamais deux exécutions se
// chevauchaient.
//
// Rapport de diagnostic : chaque appel renvoie le détail de ce qu'il a examiné et pourquoi
// chaque commune a été retenue/ignorée — sans ça, un échec silencieux (ex. commune sans maire)
// est indiagnosticable depuis le backoffice (voir POST /administration/onboarding-drip/executer).
import { supabaseSelect, supabaseSelectTout, supabaseInsert } from '../db';
import {
  contextePresentation, envoyerModeleGenerique,
  MODELE_ONBOARDING_RELANCE_J3_DEFAUT, MODELE_ONBOARDING_CHECKIN_J7_DEFAUT,
  MODELE_ONBOARDING_ENCOURAGEMENT_J7_DEFAUT, MODELE_ONBOARDING_UPSELL_DEFAUT,
} from './email-commune';

const TYPES_EVENEMENTS_POUR_UPSELL = ['article_publie', 'calendrier_dechets_rempli', 'module_verrouille_clique'];

export type LigneRapport = { commune_id: string; commune_nom: string; email_type: string; resultat: string };
export type RapportCondition = { candidates: number; eligibles: number; lignes: LigneRapport[]; erreur?: string };
export type RapportSequence = {
  email_2: RapportCondition; email_3: RapportCondition; email_4: RapportCondition; email_5: RapportCondition;
};

// Fenêtre d'un jour, UTC minuit à minuit, pour "créée il y a exactement N jours" — un seul champ
// filtré côté Supabase (gte), la borne haute est vérifiée en JS, même pattern que
// verifierRelanceInactivite (onboarding.ts) pour composer deux bornes sur la même colonne.
function fenetreJour(joursAvant: number): { debut: string; fin: string } {
  const debut = new Date();
  debut.setUTCHours(0, 0, 0, 0);
  debut.setUTCDate(debut.getUTCDate() - joursAvant);
  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

// Communes éligibles à toute la séquence : palier gratuit, client actif (exclut la commune
// nationale, une commune suspendue/résiliée, et toute démo comme decouverte-gratuite une fois
// résiliée — voir statut_client).
async function communesGratuitesCreeesIlYA(env: any, joursAvant: number): Promise<any[]> {
  const { debut, fin } = fenetreJour(joursAvant);
  const communes = await supabaseSelectTout(env, 'communes', {
    select: 'id,nom,slug,created_at',
    niveau_national: 'not.is.true', forfait: 'eq.Gratuit', statut_client: 'eq.active',
    created_at: `gte.${debut}`,
  });
  return communes.filter((cm: any) => cm.created_at < fin);
}

async function emailMaire(env: any, communeId: string): Promise<string | null> {
  const [maire] = await supabaseSelect(env, 'users', {
    select: 'email', commune_id: `eq.${communeId}`, role: 'eq.maire', order: 'created_at.asc', limit: '1',
  });
  return maire?.email || null;
}

// communeIds reste toujours une petite cohorte (les communes créées EXACTEMENT hier, ou avant-
// hier, etc.) : un simple in.() suffit, pas besoin du découpage par lots utilisé ailleurs pour
// des listes de plusieurs milliers d'id (voir prospection.ts, bug du 2026-08-19).
async function communesAvecEvenement(env: any, communeIds: string[]): Promise<Set<string>> {
  if (!communeIds.length) return new Set();
  const lignes = await supabaseSelect(env, 'activation_events', {
    select: 'commune_id', commune_id: `in.(${communeIds.join(',')})`, limit: '1000',
  });
  return new Set(lignes.map((l: any) => l.commune_id));
}

async function communesDejaEnvoyees(env: any, communeIds: string[], emailType: string): Promise<Set<string>> {
  if (!communeIds.length) return new Set();
  const lignes = await supabaseSelect(env, 'sequence_emails_sent', {
    select: 'commune_id', commune_id: `in.(${communeIds.join(',')})`, email_type: `eq.${emailType}`,
  });
  return new Set(lignes.map((l: any) => l.commune_id));
}

// Retourne le résultat (au lieu de rien) : c'est ce qui manquait pour diagnostiquer un envoi
// silencieusement sauté (ex. pas de compte maire) sans avoir à lire les logs du Worker.
async function envoyerEtJournaliser(
  env: any, commune: any, emailType: string, cle: string, defaut: { objet: string; corps_html: string },
): Promise<LigneRapport> {
  const base = { commune_id: commune.id, commune_nom: commune.nom, email_type: emailType };
  try {
    const destinataire = await emailMaire(env, commune.id);
    if (!destinataire) return { ...base, resultat: 'ignoré — aucun compte maire (role=maire) trouvé pour cette commune' };
    const ctx = contextePresentation(env.FRONTEND_URL, commune.nom, commune.slug);
    const { resendEmailId } = await envoyerModeleGenerique(env, cle, defaut, destinataire, ctx);
    if (!resendEmailId) return { ...base, resultat: `échec d'envoi Resend vers ${destinataire} (RESEND_API_KEY manquant ou API en erreur — voir logs Worker)` };
    // La contrainte UNIQUE(commune_id, email_type) est le vrai garde-fou : si deux exécutions se
    // chevauchent, la seconde insertion échoue et est avalée ici plutôt que de renvoyer l'email.
    await supabaseInsert(env, 'sequence_emails_sent', { commune_id: commune.id, email_type: emailType });
    return { ...base, resultat: `envoyé à ${destinataire}` };
  } catch (err: any) {
    console.error(`onboarding-drip (${emailType}) a échoué pour la commune ${commune.id} :`, err);
    return { ...base, resultat: `erreur : ${err?.message || err}` };
  }
}

async function traiterEmail2J3SansEvenement(env: any): Promise<RapportCondition> {
  try {
    const communes = await communesGratuitesCreeesIlYA(env, 3);
    if (!communes.length) return { candidates: 0, eligibles: 0, lignes: [] };
    const ids = communes.map((c: any) => c.id);
    const [avecEvenement, dejaEnvoyees] = await Promise.all([
      communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_2'),
    ]);
    const lignes: LigneRapport[] = [];
    for (const commune of communes) {
      if (avecEvenement.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_2', resultat: 'écarté — a déjà au moins un événement' }); continue; }
      if (dejaEnvoyees.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_2', resultat: 'écarté — déjà envoyé précédemment' }); continue; }
      lignes.push(await envoyerEtJournaliser(env, commune, 'email_2', 'onboarding_relance_j3', MODELE_ONBOARDING_RELANCE_J3_DEFAUT));
    }
    return { candidates: communes.length, eligibles: lignes.filter((l) => l.resultat.startsWith('envoyé')).length, lignes };
  } catch (err: any) {
    return { candidates: 0, eligibles: 0, lignes: [], erreur: err?.message || String(err) };
  }
}

async function traiterEmail3J7SansEvenement(env: any): Promise<RapportCondition> {
  try {
    const communes = await communesGratuitesCreeesIlYA(env, 7);
    if (!communes.length) return { candidates: 0, eligibles: 0, lignes: [] };
    const ids = communes.map((c: any) => c.id);
    const [avecEvenement, dejaEnvoyees] = await Promise.all([
      communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_3'),
    ]);
    const lignes: LigneRapport[] = [];
    for (const commune of communes) {
      if (avecEvenement.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_3', resultat: 'écarté — a déjà au moins un événement (candidat pour email_4 à la place)' }); continue; }
      if (dejaEnvoyees.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_3', resultat: 'écarté — déjà envoyé précédemment' }); continue; }
      lignes.push(await envoyerEtJournaliser(env, commune, 'email_3', 'onboarding_checkin_j7', MODELE_ONBOARDING_CHECKIN_J7_DEFAUT));
    }
    return { candidates: communes.length, eligibles: lignes.filter((l) => l.resultat.startsWith('envoyé')).length, lignes };
  } catch (err: any) {
    return { candidates: 0, eligibles: 0, lignes: [], erreur: err?.message || String(err) };
  }
}

async function traiterEmail4J7AvecEvenement(env: any): Promise<RapportCondition> {
  try {
    const communes = await communesGratuitesCreeesIlYA(env, 7);
    if (!communes.length) return { candidates: 0, eligibles: 0, lignes: [] };
    const ids = communes.map((c: any) => c.id);
    const [avecEvenement, dejaEnvoyees] = await Promise.all([
      communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_4'),
    ]);
    const lignes: LigneRapport[] = [];
    for (const commune of communes) {
      if (!avecEvenement.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_4', resultat: 'écarté — aucun événement (candidat pour email_3 à la place)' }); continue; }
      if (dejaEnvoyees.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_4', resultat: 'écarté — déjà envoyé précédemment' }); continue; }
      lignes.push(await envoyerEtJournaliser(env, commune, 'email_4', 'onboarding_encouragement_j7', MODELE_ONBOARDING_ENCOURAGEMENT_J7_DEFAUT));
    }
    return { candidates: communes.length, eligibles: lignes.filter((l) => l.resultat.startsWith('envoyé')).length, lignes };
  } catch (err: any) {
    return { candidates: 0, eligibles: 0, lignes: [], erreur: err?.message || String(err) };
  }
}

// RÈGLE DURE : jamais de critère de date ici, uniquement le nombre de TYPES d'événements
// distincts atteints (peu importe quand). "3 événements" = les 3 types définis dans
// TYPES_EVENEMENTS_POUR_UPSELL, chacun observé au moins une fois pour cette commune.
async function traiterEmail5SignalFort(env: any): Promise<RapportCondition> {
  try {
    const evenements = await supabaseSelectTout(env, 'activation_events', {
      select: 'commune_id,event_type', event_type: `in.(${TYPES_EVENEMENTS_POUR_UPSELL.join(',')})`,
    });
    const typesParCommune = new Map<string, Set<string>>();
    for (const e of evenements) {
      const set = typesParCommune.get(e.commune_id) ?? new Set<string>();
      set.add(e.event_type);
      typesParCommune.set(e.commune_id, set);
    }
    const idsEligibles = [...typesParCommune.entries()]
      .filter(([, types]) => types.size >= 3)
      .map(([communeId]) => communeId);
    if (!idsEligibles.length) return { candidates: 0, eligibles: 0, lignes: [] };

    const [communes, dejaEnvoyees] = await Promise.all([
      supabaseSelectTout(env, 'communes', {
        select: 'id,nom,slug,forfait,statut_client', id: `in.(${idsEligibles.join(',')})`,
      }),
      communesDejaEnvoyees(env, idsEligibles, 'email_5'),
    ]);
    const lignes: LigneRapport[] = [];
    for (const communeId of idsEligibles) {
      const commune = communes.find((c: any) => c.id === communeId);
      if (!commune) { lignes.push({ commune_id: communeId, commune_nom: '(introuvable)', email_type: 'email_5', resultat: 'écarté — commune introuvable (supprimée ?)' }); continue; }
      if (commune.forfait !== 'Gratuit') { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_5', resultat: `écarté — forfait "${commune.forfait || '(vide)'}" au lieu de "Gratuit"` }); continue; }
      if (commune.statut_client !== 'active') { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_5', resultat: `écarté — statut_client "${commune.statut_client}"` }); continue; }
      if (dejaEnvoyees.has(commune.id)) { lignes.push({ commune_id: commune.id, commune_nom: commune.nom, email_type: 'email_5', resultat: 'écarté — déjà envoyé précédemment' }); continue; }
      lignes.push(await envoyerEtJournaliser(env, commune, 'email_5', 'onboarding_upsell', MODELE_ONBOARDING_UPSELL_DEFAUT));
    }
    return { candidates: idsEligibles.length, eligibles: lignes.filter((l) => l.resultat.startsWith('envoyé')).length, lignes };
  } catch (err: any) {
    return { candidates: 0, eligibles: 0, lignes: [], erreur: err?.message || String(err) };
  }
}

export async function verifierSequenceOnboarding(env: any): Promise<RapportSequence> {
  return {
    email_2: await traiterEmail2J3SansEvenement(env),
    email_3: await traiterEmail3J7SansEvenement(env),
    email_4: await traiterEmail4J7AvecEvenement(env),
    email_5: await traiterEmail5SignalFort(env),
  };
}
