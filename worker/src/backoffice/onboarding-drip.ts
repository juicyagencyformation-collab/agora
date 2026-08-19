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
import { supabaseSelect, supabaseSelectTout, supabaseInsert } from '../db';
import {
  contextePresentation, envoyerModeleGenerique,
  MODELE_ONBOARDING_RELANCE_J3_DEFAUT, MODELE_ONBOARDING_CHECKIN_J7_DEFAUT,
  MODELE_ONBOARDING_ENCOURAGEMENT_J7_DEFAUT, MODELE_ONBOARDING_UPSELL_DEFAUT,
} from './email-commune';

const TYPES_EVENEMENTS_POUR_UPSELL = ['article_publie', 'calendrier_dechets_rempli', 'module_verrouille_clique'];

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

async function envoyerEtJournaliser(
  env: any, commune: any, emailType: string, cle: string, defaut: { objet: string; corps_html: string },
): Promise<void> {
  try {
    const destinataire = await emailMaire(env, commune.id);
    if (!destinataire) return; // pas de compte maire retrouvé : rien à faire, pas d'erreur bruyante
    const ctx = contextePresentation(env.FRONTEND_URL, commune.nom, commune.slug);
    await envoyerModeleGenerique(env, cle, defaut, destinataire, ctx);
    // La contrainte UNIQUE(commune_id, email_type) est le vrai garde-fou : si deux exécutions se
    // chevauchent, la seconde insertion échoue et est avalée ici plutôt que de renvoyer l'email.
    await supabaseInsert(env, 'sequence_emails_sent', { commune_id: commune.id, email_type: emailType });
  } catch (err) {
    console.error(`onboarding-drip (${emailType}) a échoué pour la commune ${commune.id} :`, err);
  }
}

async function traiterEmail2J3SansEvenement(env: any): Promise<void> {
  const communes = await communesGratuitesCreeesIlYA(env, 3);
  if (!communes.length) return;
  const ids = communes.map((c: any) => c.id);
  const [avecEvenement, dejaEnvoyees] = await Promise.all([
    communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_2'),
  ]);
  for (const commune of communes) {
    if (avecEvenement.has(commune.id) || dejaEnvoyees.has(commune.id)) continue;
    await envoyerEtJournaliser(env, commune, 'email_2', 'onboarding_relance_j3', MODELE_ONBOARDING_RELANCE_J3_DEFAUT);
  }
}

async function traiterEmail3J7SansEvenement(env: any): Promise<void> {
  const communes = await communesGratuitesCreeesIlYA(env, 7);
  if (!communes.length) return;
  const ids = communes.map((c: any) => c.id);
  const [avecEvenement, dejaEnvoyees] = await Promise.all([
    communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_3'),
  ]);
  for (const commune of communes) {
    if (avecEvenement.has(commune.id) || dejaEnvoyees.has(commune.id)) continue;
    await envoyerEtJournaliser(env, commune, 'email_3', 'onboarding_checkin_j7', MODELE_ONBOARDING_CHECKIN_J7_DEFAUT);
  }
}

async function traiterEmail4J7AvecEvenement(env: any): Promise<void> {
  const communes = await communesGratuitesCreeesIlYA(env, 7);
  if (!communes.length) return;
  const ids = communes.map((c: any) => c.id);
  const [avecEvenement, dejaEnvoyees] = await Promise.all([
    communesAvecEvenement(env, ids), communesDejaEnvoyees(env, ids, 'email_4'),
  ]);
  for (const commune of communes) {
    if (!avecEvenement.has(commune.id) || dejaEnvoyees.has(commune.id)) continue;
    await envoyerEtJournaliser(env, commune, 'email_4', 'onboarding_encouragement_j7', MODELE_ONBOARDING_ENCOURAGEMENT_J7_DEFAUT);
  }
}

// RÈGLE DURE : jamais de critère de date ici, uniquement le nombre de TYPES d'événements
// distincts atteints (peu importe quand). "3 événements" = les 3 types définis dans
// TYPES_EVENEMENTS_POUR_UPSELL, chacun observé au moins une fois pour cette commune.
async function traiterEmail5SignalFort(env: any): Promise<void> {
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
  if (!idsEligibles.length) return;

  const [communes, dejaEnvoyees] = await Promise.all([
    supabaseSelectTout(env, 'communes', {
      select: 'id,nom,slug', id: `in.(${idsEligibles.join(',')})`,
      niveau_national: 'not.is.true', forfait: 'eq.Gratuit', statut_client: 'eq.active',
    }),
    communesDejaEnvoyees(env, idsEligibles, 'email_5'),
  ]);
  for (const commune of communes) {
    if (dejaEnvoyees.has(commune.id)) continue;
    await envoyerEtJournaliser(env, commune, 'email_5', 'onboarding_upsell', MODELE_ONBOARDING_UPSELL_DEFAUT);
  }
}

export async function verifierSequenceOnboarding(env: any): Promise<void> {
  await traiterEmail2J3SansEvenement(env);
  await traiterEmail3J7SansEvenement(env);
  await traiterEmail4J7AvecEvenement(env);
  await traiterEmail5SignalFort(env);
}
