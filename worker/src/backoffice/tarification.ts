// worker/src/backoffice/tarification.ts
// Nouveau barème au nombre d'habitants (2026-08-21, décidé avec Léandre) — voir la migration
// 050_bareme_habitant.sql pour le détail de la formule et pourquoi elle coexiste avec l'ancienne
// grille par tranches (grille_tarifaire, toujours utilisée pour les devis de communes déjà
// clientes). Tout est stocké dans parametres_facturation (clé/valeur), jamais codé en dur : ce
// fichier ne fait que lire ces valeurs et appliquer la formule, exposée publiquement (sans auth)
// via GET /backoffice/tarifs-contenu pour que la landing page calcule le prix en direct côté
// client — même formule recalculée en JS dans accueil.html (voir le commentaire là-bas) ET dans
// l'aperçu live du backoffice (frontend/backoffice/js/app.js, calculerAutonomiePreview et
// consorts) : TOUTE modification de la formule ici doit être répercutée manuellement à ces DEUX
// autres endroits.
// Depuis le 2026-09-03, ce fichier porte aussi les textes des 3 offres (labels, accroches, badge,
// fonctionnalités) — voir DEFAUTS_OFFRES_TEXTE plus bas — pour que la tarification de la landing
// (chiffres ET mots) se pilote entièrement depuis le backoffice, avec aperçu fidèle avant d'enregistrer.
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';

export type BaremeTarifaire = {
  taux_base: number;
  seuil_degressif: number;
  taux_degressif: number;
  prix_plancher: number;
  supplement_accompagne: number;
  // Premium = Accompagné + prix_patrimoine_premium, mais ce montant n'est dû qu'une fois (la
  // création de la chasse au trésor) : à partir de la 2e année, seul Accompagné reste facturé.
  // Pas de calculerPrixPremium() ici — le calcul (1re année vs. années suivantes) reste
  // spécifique à l'affichage, géré directement dans accueil.html.
  prix_patrimoine_premium: number;
};

const CLES_BAREME = [
  'bareme_taux_base', 'bareme_seuil_degressif', 'bareme_taux_degressif',
  'bareme_prix_plancher', 'bareme_supplement_accompagne', 'bareme_prix_patrimoine_premium',
] as const;

// Repli si la migration n'a pas encore tourné ou qu'une clé manque — mêmes valeurs que le seed,
// pour que la landing page ne se retrouve jamais avec un prix à 0€ ou une erreur affichée.
const BAREME_DEFAUT: BaremeTarifaire = {
  taux_base: 1, seuil_degressif: 1000, taux_degressif: 0.5,
  prix_plancher: 250, supplement_accompagne: 200, prix_patrimoine_premium: 749,
};

export async function chargerBareme(env: any): Promise<BaremeTarifaire> {
  try {
    const lignes = await supabaseSelect(env, 'parametres_facturation', {
      select: 'cle,valeur', cle: `in.(${CLES_BAREME.join(',')})`,
    });
    const parValeur = new Map(lignes.map((l: any) => [l.cle, parseFloat(l.valeur)]));
    return {
      taux_base: parValeur.get('bareme_taux_base') ?? BAREME_DEFAUT.taux_base,
      seuil_degressif: parValeur.get('bareme_seuil_degressif') ?? BAREME_DEFAUT.seuil_degressif,
      taux_degressif: parValeur.get('bareme_taux_degressif') ?? BAREME_DEFAUT.taux_degressif,
      prix_plancher: parValeur.get('bareme_prix_plancher') ?? BAREME_DEFAUT.prix_plancher,
      supplement_accompagne: parValeur.get('bareme_supplement_accompagne') ?? BAREME_DEFAUT.supplement_accompagne,
      prix_patrimoine_premium: parValeur.get('bareme_prix_patrimoine_premium') ?? BAREME_DEFAUT.prix_patrimoine_premium,
    };
  } catch {
    return BAREME_DEFAUT;
  }
}

// Formule partagée — voir aussi la copie JS dans accueil.html (toute modification ici doit y
// être répercutée à la main, ce fichier n'est pas accessible depuis une page statique).
export function calculerPrixAutonomie(habitants: number, b: BaremeTarifaire): number {
  const bornes = Math.max(0, Math.floor(habitants || 0));
  const brut = Math.min(bornes, b.seuil_degressif) * b.taux_base
    + Math.max(0, bornes - b.seuil_degressif) * b.taux_degressif;
  return Math.max(brut, b.prix_plancher);
}

export function calculerPrixAccompagne(habitants: number, b: BaremeTarifaire): number {
  return calculerPrixAutonomie(habitants, b) + b.supplement_accompagne;
}

// Textes des 3 offres affichées sur la landing (label, accroche, badge, liste de fonctionnalités)
// — demandé par Léandre le 2026-09-03 pour ne plus avoir à toucher au HTML d'accueil.html pour un
// changement de wording. Même mécanisme que contenu-texte.ts (clé/valeur dans modeles_email,
// réutilisé comme table de petits textes génériques plutôt qu'une table dédiée de plus) : une
// clé plate par champ, les fonctionnalités étant une liste stockée en une chaîne à une ligne par
// item (correspond à un <textarea>, pas de JSON à parser côté client backoffice).
export const DEFAUTS_OFFRES_TEXTE: Record<string, string> = {
  offre_autonomie_label: 'Autonomie',
  offre_autonomie_titre: 'Vous pilotez seul',
  offre_autonomie_features: 'Tous les modules citoyens\nModération assurée par la mairie\nSupport email\nValorisation du patrimoine en option, sur devis',
  offre_accompagne_label: 'Accompagné',
  offre_accompagne_titre: 'On s\'occupe du quotidien',
  offre_accompagne_badge: 'Le plus demandé',
  offre_accompagne_features: 'Tout Autonomie, plus :\nModération automatique des photos\nQuestionnaires « thermomètre » publiés chaque semaine\nSupport prioritaire',
  offre_premium_label: 'Premium',
  offre_premium_titre: 'Patrimoine & découverte',
  offre_premium_features: 'Tout Accompagné, plus :\nChasse au trésor numérique de valorisation du patrimoine local',
};

export const CLES_OFFRES_TEXTE = Object.keys(DEFAUTS_OFFRES_TEXTE);

export async function chargerOffresTexte(env: any): Promise<Record<string, string>> {
  try {
    const lignes = await supabaseSelect(env, 'modeles_email', {
      select: 'cle,corps_html', cle: `in.(${CLES_OFFRES_TEXTE.join(',')})`,
    });
    const parCle = new Map(lignes.map((l: any) => [l.cle, l.corps_html]));
    const resultat: Record<string, string> = {};
    for (const cle of CLES_OFFRES_TEXTE) resultat[cle] = parCle.get(cle) || DEFAUTS_OFFRES_TEXTE[cle];
    return resultat;
  } catch {
    return { ...DEFAUTS_OFFRES_TEXTE };
  }
}

export async function enregistrerOffreTexte(env: any, cle: string, valeur: string): Promise<void> {
  const donnees = { objet: cle, corps_html: valeur, updated_at: new Date().toISOString() };
  const [existant] = await supabaseSelect(env, 'modeles_email', { select: 'cle', cle: `eq.${cle}` });
  if (existant) await supabaseUpdate(env, 'modeles_email', donnees, { cle: `eq.${cle}` });
  else await supabaseInsert(env, 'modeles_email', { cle, nom: 'Défaut', ...donnees });
}

export type OffreTexte = { label: string; titre: string; badge?: string; features: string[] };

// Transforme le stockage plat (édition côté backoffice) en objet structuré consommé par
// accueil.html — une fonctionnalité par ligne non vide.
export function structurerOffresTexte(brut: Record<string, string>): Record<'autonomie' | 'accompagne' | 'premium', OffreTexte> {
  const enListe = (s: string) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    autonomie: {
      label: brut.offre_autonomie_label, titre: brut.offre_autonomie_titre,
      features: enListe(brut.offre_autonomie_features),
    },
    accompagne: {
      label: brut.offre_accompagne_label, titre: brut.offre_accompagne_titre,
      badge: brut.offre_accompagne_badge, features: enListe(brut.offre_accompagne_features),
    },
    premium: {
      label: brut.offre_premium_label, titre: brut.offre_premium_titre,
      features: enListe(brut.offre_premium_features),
    },
  };
}
