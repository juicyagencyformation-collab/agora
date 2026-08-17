// worker/src/backoffice/modele-fiche.ts
// Contenu (HTML) de la fiche de présentation imprimable, éditable depuis le backoffice et
// stocké dans modeles_email (cle='fiche', colonne corps_html). Le design/print reste figé dans
// frontend/backoffice/fiche.html ; seul ce contenu varie. Variables substituées côté client
// (fiche.js) : {{logo}}, {{commune}}, {{qr}}, {{url}}. Le logo réutilise celui de l'email
// (modeles_email cle='presentation', logo_image_url).
import { supabaseSelect } from '../db';

export const MODELE_FICHE_DEFAUT = `
    <header>
      <div>
        {{logo}}
        <div class="baseline">La plateforme citoyenne de votre commune</div>
      </div>
      <div class="editeur">
        Édité par <strong>Juicy Solutions</strong><br />
        Léandre Sallé
      </div>
    </header>

    <div class="hero">
      <h1>Une application mobile <em>rien que pour</em> {{commune}}</h1>
      <p>Informer, alerter et faire participer vos habitants — depuis un seul outil simple,
         souverain et 100 % français, que la mairie pilote elle-même sans compétence technique.</p>
    </div>

    <div class="grille">
      <div class="mod"><h3><span class="puce"></span>Agenda &amp; points citoyens</h3><p>Le calendrier de la vie locale — réunions, chantiers, ateliers — avec des points de participation vérifiés sur place.</p></div>
      <div class="mod"><h3><span class="puce"></span>Coups de main entre voisins</h3><p>Bricolage, jardinage, garde d'enfants, transport : l'entraide de proximité organisée simplement.</p></div>
      <div class="mod"><h3><span class="puce"></span>Conseil municipal</h3><p>Délibérations, comptes-rendus et trombinoscope des élus, en toute transparence.</p></div>
      <div class="mod"><h3><span class="puce"></span>Alertes &amp; signalements</h3><p>Coupure d'eau, route barrée, dépôt sauvage : informez et recevez les signalements citoyens.</p></div>
      <div class="mod"><h3><span class="puce"></span>Annuaire local</h3><p>Commerces, artisans et associations, enfin réunis en un seul endroit pour vos habitants.</p></div>
      <div class="mod"><h3><span class="puce"></span>Patrimoine &amp; mémoire</h3><p>Chasse au trésor géolocalisée et « La mémoire du village » pour honorer les anciens.</p></div>
      <div class="mod"><h3><span class="puce"></span>Actualités &amp; bulletin</h3><p>Publiez les nouvelles de la commune, elles arrivent directement sur le téléphone des habitants.</p></div>
      <div class="mod"><h3><span class="puce"></span>Veille législative</h3><p>Suivi automatique des textes adoptés à l'Assemblée nationale et au Parlement européen.</p></div>
    </div>

    <div class="atouts">
      <div class="atout"><b>Souverain</b><span>Vos données restent les vôtres</span></div>
      <div class="atout"><b>RGPD</b><span>Conforme, hébergé en Europe</span></div>
      <div class="atout"><b>Sans engagement technique</b><span>Géré par la mairie seule</span></div>
      <div class="atout"><b>Mobile-first</b><span>Aucune installation lourde</span></div>
    </div>

    <div class="acces">
      <div class="acces__qr">{{qr}}</div>
      <div class="acces__txt">
        <h2>Découvrez l'application en direct</h2>
        <p>Scannez ce QR code avec l'appareil photo de votre téléphone pour ouvrir immédiatement l'application de la commune.</p>
        <span class="acces__url">{{url}}</span>
      </div>
    </div>

    <footer>
      <span>Juicy Solutions — plateforme-agora.fr</span>
      <span>Contact : juicy.agency.formation@gmail.com</span>
    </footer>`;

// Renvoie le contenu de la fiche (stocké ou défaut) + l'URL du logo (partagé avec l'email).
export async function chargerFiche(env: any): Promise<{ contenu_html: string; logo_url: string | null }> {
  try {
    const rows = await supabaseSelect(env, 'modeles_email', {
      select: 'cle,corps_html,logo_image_url', cle: 'in.(fiche,presentation)',
    });
    const fiche = rows.find((r: any) => r.cle === 'fiche');
    const presentation = rows.find((r: any) => r.cle === 'presentation');
    return {
      contenu_html: fiche?.corps_html || MODELE_FICHE_DEFAUT,
      logo_url: presentation?.logo_image_url || null,
    };
  } catch {
    return { contenu_html: MODELE_FICHE_DEFAUT, logo_url: null };
  }
}
