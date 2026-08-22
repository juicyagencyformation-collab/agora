// worker/src/backoffice/tarification.ts
// Nouveau barème au nombre d'habitants (2026-08-21, décidé avec Léandre) — voir la migration
// 050_bareme_habitant.sql pour le détail de la formule et pourquoi elle coexiste avec l'ancienne
// grille par tranches (grille_tarifaire, toujours utilisée pour les devis de communes déjà
// clientes). Tout est stocké dans parametres_facturation (clé/valeur), jamais codé en dur : ce
// fichier ne fait que lire ces valeurs et appliquer la formule, exposée publiquement (sans auth)
// via GET /backoffice/tarifs-contenu pour que la landing page calcule le prix en direct côté
// client — même formule recalculée en JS dans accueil.html (voir le commentaire là-bas), donc
// TOUTE modification de la formule ici doit être répercutée manuellement à cet unique autre
// endroit.
import { supabaseSelect } from '../db';

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
