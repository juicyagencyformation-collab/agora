// worker/src/lib/comptes-inactifs.ts
// Durée de conservation des comptes habitants (migration 110, validé par Léandre le 2026-11-20,
// guide CNIL des collectivités 2026, réflexe 4) : 3 ans sans connexion → anonymisation, comme
// « Supprimer mon compte » (anonymiserComptes : les publications restent, sans nom). Un email
// prévient 30 jours avant ; se connecter suffit à garder le compte (la dernière connexion redevient
// récente, le compte sort des deux sélections). Durées annoncées dans confidentialite.html,
// fiche-registre.html et le registre du backoffice : les changer ensemble.
//
// Seulement le rôle citoyen : les comptes de la mairie sont gérés par elle (CGU 10.9). Jamais les
// communes de démonstration (acces_libre) ni nationales (Explorateurs : purge à 12 mois à part).
// « Dernière connexion » = derniere_connexion_streak (posée à chaque ouverture de l'app, une fois
// par jour), à défaut created_at.
//
// Lancée chaque heure par petits lots : 2 avertissements (48 emails/jour au plus, sous le quota
// Resend du plan gratuit) et les comptes d'une seule commune à anonymiser (3 au plus), soit une
// quinzaine de requêtes, loin de la limite de 50 sous-requêtes par exécution du cron.
import { supabaseSelect, supabaseUpdate } from '../db';
import { envoyerEmail } from './email';
import { anonymiserComptes } from '../auth';

const JOUR = 24 * 3600 * 1000;
export const DUREE_INACTIVITE_MS = Math.round(3 * 365.25 * JOUR);
export const PREAVIS_MS = 30 * JOUR;

const echapper = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

// Filtres communs : habitant, compte actif, hors démo et hors communes nationales (jointure sur communes).
const FILTRES_HABITANTS = {
  role: 'eq.citoyen',
  compte_supprime_le: 'is.null',
  compte_visiteur_demo: 'not.is.true',
  'communes.acces_libre': 'not.is.true',
  'communes.niveau_national': 'not.is.true',
};

// Inactif depuis avant `seuil` : dernière connexion antérieure, ou jamais connecté et créé avant.
const inactifDepuis = (seuil: Date) =>
  `or(derniere_connexion_streak.lt.${seuil.toISOString().slice(0, 10)},and(derniere_connexion_streak.is.null,created_at.lt.${seuil.toISOString()}))`;

export async function purgerHabitantsInactifs(env: any, maintenant = new Date()): Promise<void> {
  await avertirHabitantsInactifs(env, maintenant);
  await anonymiserHabitantsInactifs(env, maintenant);
}

async function avertirHabitantsInactifs(env: any, maintenant: Date) {
  // Averti quand il ne reste que le préavis ; un ancien avertissement (cycle d'inactivité précédent,
  // avant une reconnexion) est antérieur au seuil et ne compte plus.
  const seuil = new Date(maintenant.getTime() - DUREE_INACTIVITE_MS + PREAVIS_MS);
  const aAvertir = await supabaseSelect(env, 'users', {
    select: 'id,email,prenom,commune_id,communes!inner(nom,slug,acces_libre,niveau_national)',
    ...FILTRES_HABITANTS,
    and: `(${inactifDepuis(seuil)},or(avertissement_inactivite_le.is.null,avertissement_inactivite_le.lt.${seuil.toISOString()}))`,
    order: 'created_at.asc',
    limit: '2',
  });
  const dateSuppression = new Date(maintenant.getTime() + PREAVIS_MS)
    .toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
  for (const u of aAvertir) {
    const commune = Array.isArray(u.communes) ? u.communes[0] : u.communes;
    const lien = `${env.FRONTEND_URL || 'https://plateforme-agora.fr'}/${commune?.slug ?? ''}/`;
    // Posé même si l'email ne part pas (adresse morte) : sinon ces comptes reviendraient en tête
    // de liste à chaque passage et bloqueraient tous les autres. Le préavis de 30 jours court quand même.
    await envoyerEmail(env, u.email, `Votre compte sur l'application de ${commune?.nom ?? 'votre commune'}`, `
      <p>Bonjour ${echapper(u.prenom)},</p>
      <p>Vous ne vous êtes pas connecté(e) à l'application de la commune de <strong>${echapper(commune?.nom)}</strong>
        depuis près de 3 ans. Pour protéger vos données, les comptes inutilisés depuis 3 ans sont supprimés.</p>
      <p><strong>Pour garder votre compte, il suffit de vous connecter avant le ${dateSuppression}</strong> :
        <a href="${lien}">${lien}</a></p>
      <p>Sinon, votre compte sera supprimé à cette date : vos informations personnelles seront effacées et
        vos publications resteront visibles sans votre nom.</p>
      <p>L'équipe Plateforme-Agora, pour la mairie de ${echapper(commune?.nom)}</p>`);
    await supabaseUpdate(env, 'users', { avertissement_inactivite_le: maintenant.toISOString() }, { id: `eq.${u.id}` });
  }
}

async function anonymiserHabitantsInactifs(env: any, maintenant: Date) {
  const seuil = new Date(maintenant.getTime() - DUREE_INACTIVITE_MS);
  // Averti il y a plus de 30 jours, pendant l'inactivité en cours (avertissement postérieur au
  // seuil de 3 ans), et toujours pas reconnecté depuis.
  const aSupprimer = await supabaseSelect(env, 'users', {
    select: 'id,commune_id,communes!inner(acces_libre,niveau_national)',
    ...FILTRES_HABITANTS,
    and: `(${inactifDepuis(seuil)},avertissement_inactivite_le.lt.${new Date(maintenant.getTime() - PREAVIS_MS).toISOString()},avertissement_inactivite_le.gt.${seuil.toISOString()})`,
    order: 'commune_id.asc',
    limit: '3',
  });
  if (!aSupprimer.length) return;
  // anonymiserComptes travaille commune par commune : la première ici, les suivantes au prochain passage.
  const commune_id = aSupprimer[0].commune_id;
  await anonymiserComptes(env, commune_id, aSupprimer.filter((u: any) => u.commune_id === commune_id).map((u: any) => u.id));
}
