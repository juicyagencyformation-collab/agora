// worker/src/backoffice/modele-affiche.ts
// Contenu (HTML) de l'affiche citoyenne imprimable — à ne pas confondre avec la fiche de
// présentation commerciale (modele-fiche.ts, destinée à convaincre une mairie pas encore
// cliente). Celle-ci est pour une commune DÉJÀ cliente : le maire l'imprime et l'affiche/la
// distribue à ses administrés pour qu'ils scannent le QR et créent leur compte. Ton et logo
// diffèrent donc : on s'adresse directement à l'habitant (pas "vos habitants" comme à un maire),
// et le logo mis en avant est celui de LA COMMUNE elle-même (pas la marque Agora), une commune
// n'a pas encore forcément de logo -> repli textuel avec le nom de la commune.
// Design/print : frontend/backoffice/affiche-citoyens.html (mise en page en miroir de fiche.html,
// mêmes classes CSS). Variables substituées côté client (affiche-citoyens.js) : {{logo}},
// {{commune}}, {{qr}}, {{url}}.
import { supabaseSelect } from '../db';

export const MODELE_AFFICHE_CITOYENS_DEFAUT = `
    <header>
      <div>
        <div class="logo-halo">{{logo}}</div>
        <div class="logo-texte">
          <div class="baseline">L'application citoyenne de votre commune</div>
        </div>
      </div>
    </header>

    <div class="hero">
      <h1>Restez informé de la vie de <em>{{commune}}</em></h1>
      <p>Actualités, alertes, agenda, entraide entre voisins... tout ce qui se passe dans votre
         commune, directement sur votre téléphone. Gratuit, sans publicité.</p>
    </div>

    <div class="grille">
      <div class="mod"><h3><span class="puce"></span>Actualités &amp; agenda</h3><p>Les nouvelles de la commune et les événements à venir, sans les manquer.</p></div>
      <div class="mod"><h3><span class="puce"></span>Alertes</h3><p>Coupure d'eau, route barrée : soyez prévenu directement, et signalez un problème vous-même.</p></div>
      <div class="mod"><h3><span class="puce"></span>Coups de main entre voisins</h3><p>Bricolage, jardinage, garde d'enfants : proposez ou demandez de l'aide autour de vous.</p></div>
      <div class="mod"><h3><span class="puce"></span>Conseil municipal</h3><p>Suivez les décisions de vos élus en toute transparence.</p></div>
      <div class="mod"><h3><span class="puce"></span>Annuaire local</h3><p>Retrouvez facilement les commerces, artisans et associations de la commune.</p></div>
      <div class="mod"><h3><span class="puce"></span>Mur citoyen</h3><p>Un espace d'échange entre habitants, pour la vie de tous les jours.</p></div>
    </div>

    <div class="atouts">
      <div class="atout"><b>Gratuit</b><span>Pour tous les habitants</span></div>
      <div class="atout"><b>Sans publicité</b><span>Ni revente de données</span></div>
      <div class="atout"><b>2 minutes</b><span>Pour créer votre compte</span></div>
      <div class="atout"><b>Mobile-first</b><span>Aucune installation lourde</span></div>
    </div>

    <div class="acces">
      <div class="acces__qr">{{qr}}</div>
      <div class="acces__txt">
        <h2>Créez votre compte en scannant ce code</h2>
        <p>Scannez ce QR code avec l'appareil photo de votre téléphone pour ouvrir l'application
           et créer votre compte citoyen.</p>
        <span class="acces__url">{{url}}</span>
        <div class="installation">
          <div class="installation__titre">Pour l'installer comme une vraie application</div>
          <ol class="installation__etapes">
            <li>Scannez le QR code avec l'appareil photo de votre téléphone.</li>
            <li>Ouvrez le lien qui s'affiche, puis créez votre compte.</li>
            <li><strong>iPhone</strong>&nbsp;: bouton Partager, puis « Sur l'écran d'accueil ». <strong>Android</strong>&nbsp;: menu ⋮, puis « Ajouter à l'écran d'accueil ».</li>
          </ol>
        </div>
      </div>
    </div>

    <footer>
      <span>{{commune}} sur Agora</span>
      <span>plateforme-agora.fr</span>
    </footer>`;

// Renvoie le contenu (stocké ou défaut), le nom et le logo de LA COMMUNE demandée (pas la marque
// Agora — voir le commentaire d'en-tête). Résilient : commune introuvable -> nom/logo vides,
// le client affiche quand même la page avec le nom passé en paramètre d'URL en repli.
export async function chargerAfficheCitoyens(
  env: any, slug: string,
): Promise<{ contenu_html: string; commune_nom: string | null; logo_url: string | null }> {
  const [commune] = await supabaseSelect(env, 'communes', {
    select: 'nom,logo_url', slug: `eq.${slug}`,
  }).catch(() => [] as any[]);

  let contenu_html = MODELE_AFFICHE_CITOYENS_DEFAUT;
  try {
    const [modele] = await supabaseSelect(env, 'modeles_email', {
      select: 'corps_html', cle: 'eq.affiche_citoyens', actif: 'eq.true',
    });
    if (modele?.corps_html) contenu_html = modele.corps_html;
  } catch { /* table absente ou lecture KO : on garde le défaut */ }

  return {
    contenu_html,
    commune_nom: commune?.nom || null,
    logo_url: commune?.logo_url || null,
  };
}
