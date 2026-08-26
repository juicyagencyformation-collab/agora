// worker/src/backoffice/contenu-texte.ts
// Petits textes affichés côté citoyen mais éditables depuis le backoffice sans déploiement : le
// popup « module verrouillé » (clic sur un onglet non inclus dans le forfait, voir
// frontend/js/navigation.js) et les textes de la checklist de démarrage (frontend/js/dashboard.js).
// Réutilise modeles_email (cle → corps_html) comme modele-fiche.ts le fait déjà pour la fiche
// imprimable — un seul mécanisme de contenu texte editable, plutôt qu'une table de plus. Textes
// GLOBAUX (identiques pour toutes les communes, pas de commune_id) — même raisonnement que
// parametres_facturation (tarification.ts).
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';

// popup_verrouille_corps garde {{module}} : substitué côté client (navigation.js) avec le libellé
// du module cliqué, comme avant cette refonte.
export const DEFAUTS_CONTENU_TEXTE: Record<string, string> = {
  popup_verrouille_titre: 'Ce module fait partie de l\'offre complète',
  popup_verrouille_corps:
    '<p>Le module <strong>{{module}}</strong> s\'active avec les formules Essentiel, Pro ou Premium.</p>'
    + '<p>Vous voulez voir ce que ça donnerait concrètement pour votre commune&nbsp;? Répondez à '
    + 'l\'email de bienvenue ou appelez Léandre au <a href="tel:0648061097">06 48 06 10 97</a> — '
    + 'pas de formulaire à remplir, juste une conversation.</p>',
  checklist_titre: '👋 Bien démarrer avec Plateforme-Agora',
  checklist_item_article: 'Publier un premier article',
  checklist_item_dechets: 'Renseigner le calendrier des déchets',
  checklist_item_collegue: 'Donner un accès à un collègue (Modération → Gestion des rôles)',
};

export const CLES_CONTENU_TEXTE = Object.keys(DEFAUTS_CONTENU_TEXTE);

export async function chargerContenuTexte(env: any): Promise<Record<string, string>> {
  try {
    const lignes = await supabaseSelect(env, 'modeles_email', {
      select: 'cle,corps_html', cle: `in.(${CLES_CONTENU_TEXTE.join(',')})`,
    });
    const parCle = new Map(lignes.map((l: any) => [l.cle, l.corps_html]));
    const resultat: Record<string, string> = {};
    for (const cle of CLES_CONTENU_TEXTE) resultat[cle] = parCle.get(cle) || DEFAUTS_CONTENU_TEXTE[cle];
    return resultat;
  } catch {
    return { ...DEFAUTS_CONTENU_TEXTE };
  }
}

// objet réutilisé comme simple étiquette lisible dans la table (pas un vrai objet d'email pour
// ces cles-là) — cohérent avec modele-fiche.ts qui fait de même pour cle='fiche'.
export async function enregistrerContenuTexte(env: any, cle: string, valeur: string): Promise<void> {
  const donnees = { objet: cle, corps_html: valeur, updated_at: new Date().toISOString() };
  const [existant] = await supabaseSelect(env, 'modeles_email', { select: 'cle', cle: `eq.${cle}` });
  if (existant) await supabaseUpdate(env, 'modeles_email', donnees, { cle: `eq.${cle}` });
  else await supabaseInsert(env, 'modeles_email', { cle, nom: 'Défaut', ...donnees });
}
