// worker/src/backoffice/email-commune.ts
// Email de bienvenue envoyé au maire d'une commune fraîchement onboardée : pitch + accès à son
// application déjà prête + identifiants provisoires. Utilisé par onboarding (à la création) et
// par administration (bouton « Renvoyer les accès », qui régénère un mot de passe temporaire).
import { envoyerEmail } from '../lib/email';
import { supabaseSelect } from '../db';

// Mot de passe temporaire lisible : sans caractères ambigus (0, O, o, 1, l, I, i).
export function genererMotDePasseTemporaire(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const octets = crypto.getRandomValues(new Uint8Array(10));
  return [...octets].map((b) => chars[b % chars.length]).join('');
}

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

interface DonneesBienvenue {
  nomCommune: string;
  slug: string;
  maireEmail: string;
  motDePasse: string;
  frontendUrl: string;
}

// Encart identifiants provisoires, réutilisé par l'email de bienvenue ET par l'email de
// présentation quand il active une commune gratuite à la volée (voir envoyerPresentation).
function blocIdentifiants(url: string, maireEmail: string, motDePasse: string): string {
  return `
    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:20px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin-left:auto;margin-right:auto">
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#1b2a1c">Vos identifiants provisoires</div>
      <div style="font-size:14px;line-height:1.9;color:#1b2a1c">
        Adresse&nbsp;: <a href="${url}" style="color:#2c5f2d">${echapper(url)}</a><br />
        Identifiant&nbsp;: <strong>${echapper(maireEmail)}</strong><br />
        Mot de passe&nbsp;: <strong style="font-family:monospace">${echapper(motDePasse)}</strong>
      </div>
      <div style="color:#5b6b5c;font-size:12px;margin-top:10px">
        Pensez à modifier ce mot de passe dès votre première connexion, depuis votre profil.
      </div>
    </div>`;
}

// PS qui plante la graine de l'upsell sans vendre — ajouté après la signature des DEUX emails
// qui jouent le rôle de "compte créé" selon le chemin d'activation (voir envoyerEmailBienvenue,
// utilisé par la conversion manuelle d'un prospect ; et envoyerPresentation ci-dessous, utilisé
// par l'activation automatique et gratuite). Contenu fourni tel quel, non inventé ici.
function blocPsModules(): string {
  return `
    <div style="font-size:12px;color:#5b6b5c;margin-top:14px;font-style:italic">
      PS — Vous verrez d'autres modules dans l'interface (conseil municipal, entraide entre
      voisins, mémoire du village…) : ils s'activent quand vous voulez aller plus loin. On en
      parle dès que vous êtes prêts, pas avant.
    </div>`;
}

export function emailBienvenueHtml(d: DonneesBienvenue): string {
  const url = `${d.frontendUrl}/${d.slug}/`;
  const ficheUrl = `${d.frontendUrl}/backoffice/fiche?slug=${encodeURIComponent(d.slug)}&nom=${encodeURIComponent(d.nomCommune)}`;
  const afficheUrl = `${d.frontendUrl}/backoffice/affiche-citoyens?slug=${encodeURIComponent(d.slug)}&nom=${encodeURIComponent(d.nomCommune)}`;
  const nom = echapper(d.nomCommune);
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de votre commune</div>

    <h1 style="font-size:22px;line-height:1.3">L'application de <span style="color:#2c5f2d">${nom}</span> est prête 🎉</h1>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Informez, alertez et faites participer vos habitants depuis un seul outil simple, souverain
      et 100 % français, que vous pilotez vous-même. Votre espace est déjà en ligne :
      il ne reste qu'à vous connecter.
    </p>

    <p style="margin:24px 0">
      <a href="${url}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Ouvrir mon application</a>
    </p>

    ${blocIdentifiants(url, d.maireEmail, d.motDePasse)}

    <p style="font-size:14px;color:#3a4a3b">
      Pour découvrir l'application en détail&nbsp;:
      <a href="${ficheUrl}" style="color:#2c5f2d">voir la fiche de présentation</a>.
    </p>

    <div style="background:#f4f8f4;border-radius:10px;padding:16px 18px;margin:20px 0">
      <p style="font-size:14px;color:#1b2a1c;font-weight:600;margin-bottom:4px">📋 Envie d'inviter vos administrés ?</p>
      <p style="font-size:14px;color:#3a4a3b;line-height:1.6">
        Une affiche prête à imprimer, avec le QR code de ${nom} pour que vos habitants créent leur
        compte en la scannant&nbsp;:
        <a href="${afficheUrl}" style="color:#2c5f2d">imprimer l'affiche citoyenne</a>.
      </p>
    </div>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c">
      Juicy Solutions — Léandre Sallé · plateforme-agora.fr<br />
      Une question&nbsp;? Répondez simplement à cet email.
    </div>
    ${blocPsModules()}
  </div>`;
}

export async function envoyerEmailBienvenue(env: any, d: DonneesBienvenue): Promise<void> {
  await envoyerEmail(
    env,
    d.maireEmail,
    `Votre application Agora pour ${d.nomCommune} est prête`,
    emailBienvenueHtml(d),
  );
}

// — Email de PRÉSENTATION (prospection ET communes clientes) : modèle éditable stocké en base
//   (table modeles_email, cle='presentation'), réutilisé pour tous les envois. Variables
//   substituées à l'envoi : {{commune}}, {{url}}, {{lien_fiche}}. Un défaut de secours est
//   utilisé tant qu'aucun modèle n'a été enregistré. Depuis le 2026-08-17, {{url}} pointe
//   toujours vers la VRAIE commune du prospect (activée gratuitement à l'envoi, voir
//   activerCommuneGratuite dans prospection.ts) — plus de démo partagée. La commune
//   decouverte-gratuite (migration 035) n'est plus utilisée par ce flux mais reste en base. —

export const MODELE_PRESENTATION_DEFAUT = {
  objet: 'Agora pour {{commune}} — gratuit pour commencer, conçu par un élu comme vous',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    {{logo}}
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne des communes françaises</div>

    <h1 style="font-size:22px;line-height:1.3">Et si <span style="color:#2c5f2d">{{commune}}</span> avait sa propre application citoyenne&nbsp;? 👇</h1>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Actualités, alertes, agenda, conseil municipal, entraide entre voisins, mémoire du village
      et bien plus encore&nbsp;: Agora réunit tout ce dont votre commune peut avoir besoin pour
      informer et faire participer ses habitants, dans une application mobile simple, souveraine
      et 100&nbsp;% française — que la mairie pilote seule, sans compétence technique.
    </p>

    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:22px 0">
      <div style="font-weight:700;font-size:14px;color:#2c5f2d;margin-bottom:8px">Pour découvrir, c'est gratuit — sans limite de temps, sans carte bancaire</div>
      <div style="font-size:14px;color:#3a4a3b;line-height:1.8">
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Agenda</strong> — tous les événements de la commune, à portée de clic pour vos habitants<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Alertes</strong> — une info importante envoyée en notification, directement dans la poche de chacun
      </div>
      <div style="font-size:13px;color:#5b6b5c;margin-top:10px">
        Le reste des modules (actualités, conseil municipal, entraide, mémoire du village…)
        s'active dès que votre commune est prête à aller plus loin.
      </div>
    </div>

    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Essayer Agora gratuitement</a>
    </p>

    <p style="font-size:14px;color:#3a4a3b">
      Vous préférez une présentation d'ensemble à faire circuler&nbsp;?
      <a href="{{lien_fiche}}" style="color:#2c5f2d">Découvrez la fiche de présentation</a>
      à envoyer à vos administrés (avec un QR code pour se connecter depuis leur téléphone).
    </p>

    <div style="font-size:13px;color:#3a4a3b;font-style:italic;background:#f4f8f4;border-left:3px solid #4a8c4a;padding:14px 16px;border-radius:0 8px 8px 0;margin:24px 0;line-height:1.6">
      <div style="font-weight:700;font-style:normal;color:#2c5f2d;margin-bottom:6px">Pourquoi Agora&nbsp;?</div>
      En tant que citoyen, j'ai réalisé qu'énormément de lois se votent, en France comme en
      Europe, sans que personne ne le sache vraiment. Je trouve ça anormal&nbsp;: suivre les
      textes qui nous concernent, c'est un devoir civique.<br /><br />
      En tant qu'élu, je me suis heurté à d'autres réalités&nbsp;: des communes sans moyens, des
      habitants prêts à s'investir (entretien, petits projets comme des boîtes à livres) mais
      qu'on ne sait pas mobiliser, et des aînés qui ne connaissent pas leurs droits — téléalarme,
      aide aux courses, ménage, compagnie.<br /><br />
      Tout le monde a un portable. Agora est né de cette évidence&nbsp;: connecter tout ça, au
      service d'une commune qui vit vraiment.
    </div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      D'autres solutions existent, souvent proposées «&nbsp;clé en main&nbsp;» par
      l'intercommunalité. Agora fait un autre choix&nbsp;: celui de la commune et de ses
      habitants. Ici, on ne se contente pas d'informer — on fait vivre la participation citoyenne,
      on valorise l'engagement de chacun, et on honore la mémoire des anciens avec «&nbsp;La
      mémoire du village&nbsp;». Une application pensée pour créer du lien, pas seulement pour
      diffuser des annonces.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      {{signature_photo}}
      <div style="font-size:12px;color:#5b6b5c;line-height:1.6">
        <div style="font-weight:700;font-size:13px;color:#2c5f2d;margin-bottom:4px">Qui je suis&nbsp;?</div>
        Conseiller municipal à Eaucourt-sur-Somme et fondateur de Juicy Solutions, j'ai créé Agora
        avec une conviction simple&nbsp;: les petites communes méritent des outils à la hauteur de
        leur engagement, pas des solutions clé en main pensées ailleurs. Je porte aussi «&nbsp;Le
        P'tit Journal Eaucourtois&nbsp;», le journal local — l'information de proximité, c'est un
        fil rouge chez moi.
      </div>
    </div>

    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · SIRET 882992472 · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme, je développe Agora pour les petites communes. Répondez à cet
      email, je vous rappelle avec plaisir — sinon appelez-moi directement au
      06&nbsp;48&nbsp;06&nbsp;10&nbsp;97, ou laissez-moi un SMS.
    </div>
  </div>`,
};

export interface ContextePresentation {
  commune: string;         // nom de la commune
  url: string;             // URL de l'app (client) ou de la démo (prospect)
  lienFiche: string;       // lien vers la fiche de présentation
  signaturePhoto?: string; // balise <img> de la photo de signature, ou '' (injecté à l'envoi)
  logo?: string;           // balise <img> du logo d'en-tête, ou repli texte (injecté à l'envoi)
}

// Substitue les variables du modèle. {{commune}} est échappé (contenu utilisateur) ; les autres
// (url, lien_fiche, signature_photo, logo) sont construits côté serveur, insérés tels quels.
export function rendrePresentation(modele: string, ctx: ContextePresentation): string {
  return modele
    .replace(/\{\{commune\}\}/g, echapper(ctx.commune))
    .replace(/\{\{url\}\}/g, ctx.url)
    .replace(/\{\{lien_fiche\}\}/g, ctx.lienFiche)
    .replace(/\{\{signature_photo\}\}/g, ctx.signaturePhoto || '')
    .replace(/\{\{logo\}\}/g, ctx.logo || baliseLogo(null));
}

type ModelePresentation = {
  objet: string; corps_html: string; nom?: string;
  preview_text?: string | null; signature_image_url?: string | null; logo_image_url?: string | null;
};

const SELECT_MODELE_PRESENTATION = 'objet,corps_html,nom,preview_text,signature_image_url,logo_image_url';

// Charge la variante ACTIVE (ou le défaut de secours si aucune n'existe / lecture échouée).
// Plusieurs variantes peuvent exister pour cle='presentation' (A/B testing, voir migration 037
// et /administration/modeles-presentation) : une seule a actif=true à la fois.
export async function chargerModelePresentation(env: any): Promise<ModelePresentation> {
  try {
    const [row] = await supabaseSelect(env, 'modeles_email', {
      select: SELECT_MODELE_PRESENTATION, cle: 'eq.presentation', actif: 'eq.true',
    });
    if (row?.objet && row?.corps_html) return row;
  } catch { /* table absente ou lecture KO : on retombe sur le défaut */ }
  return MODELE_PRESENTATION_DEFAUT;
}

// Charge une variante précise par id, quel que soit son statut actif — pour l'envoi de test
// depuis l'éditeur (« tester cette variante », pas forcément celle en production). Retombe sur
// le défaut si l'id est introuvable, plutôt que d'échouer l'envoi.
export async function chargerVarianteParId(env: any, id: string): Promise<ModelePresentation> {
  try {
    const [row] = await supabaseSelect(env, 'modeles_email', {
      select: SELECT_MODELE_PRESENTATION, cle: 'eq.presentation', id: `eq.${id}`,
    });
    if (row?.objet && row?.corps_html) return row;
  } catch { /* lecture KO : on retombe sur le défaut */ }
  return MODELE_PRESENTATION_DEFAUT;
}

// Preview text (preheader) affiché par Gmail/Outlook sous l'objet : injecté à la volée au
// rendu final, jamais stocké dans corps_html (voir migration 046) — pour ne plus jamais avoir
// à taper le bloc caché ni l'espaceur anti-logo à la main. Le bloc espaceur (caractères
// invisibles répétés) empêche le client mail de compléter avec le texte alt de la 1ère image.
function injecterPreviewText(html: string, previewText?: string | null): string {
  if (!previewText) return html;
  const style = 'display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all';
  const cache = `<div style="${style}">${echapper(previewText)}</div>`;
  const espaceur = `<div style="${style}">${'&zwnj;&nbsp;'.repeat(15)}</div>`;
  return cache + espaceur + html;
}

type ModeleGenerique = { objet: string; corps_html: string; nom?: string; preview_text?: string | null };

// Version générique de chargerModelePresentation, pour les modèles d'email plus simples
// (pas de logo/signature) gérés via /administration/modeles-email/:cle — voir onboarding.ts.
export async function chargerModeleParCle(
  env: any, cle: string, defaut: { objet: string; corps_html: string },
): Promise<ModeleGenerique> {
  try {
    const [row] = await supabaseSelect(env, 'modeles_email', {
      select: 'objet,corps_html,nom,preview_text', cle: `eq.${cle}`, actif: 'eq.true',
    });
    if (row?.objet && row?.corps_html) return row;
  } catch { /* table absente ou lecture KO : on retombe sur le défaut */ }
  return defaut;
}

// Équivalent de chargerVarianteParId, mais pour les modèles génériques (bienvenue_inscription,
// relance_inactivite) — charge une variante précise par id, quel que soit son statut actif,
// pour l'envoi de test depuis l'éditeur.
export async function chargerVarianteGeneriqueParId(
  env: any, cle: string, id: string, defaut: { objet: string; corps_html: string },
): Promise<ModeleGenerique> {
  try {
    const [row] = await supabaseSelect(env, 'modeles_email', {
      select: 'objet,corps_html,nom,preview_text', cle: `eq.${cle}`, id: `eq.${id}`,
    });
    if (row?.objet && row?.corps_html) return row;
  } catch { /* lecture KO : on retombe sur le défaut */ }
  return defaut;
}

// — Email de bienvenue à la première inscription citoyenne (distinct de envoyerEmailBienvenue,
//   qui accompagne la création du compte Maire avec ses identifiants) : envoyé quand quelqu'un
//   crée VOLONTAIREMENT un compte citoyen dans une commune issue de la prospection — le signal
//   d'engagement le plus fort après l'email de présentation (voir déclenchement dans auth.ts). —
export const MODELE_BIENVENUE_INSCRIPTION_DEFAUT = {
  objet: 'Merci de tester Agora à {{commune}} !',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      Je vois que vous venez de créer un compte sur Agora pour <strong>{{commune}}</strong> —
      merci d'avoir pris le temps d'essayer !
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Je suis moi-même élu (Eaucourt-sur-Somme) et j'ai conçu Agora avec cette double casquette :
      je sais ce qui sert vraiment au quotidien dans une petite mairie, et ce qui n'est que du
      superflu.
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Le compte Maire que vous avez reçu donne déjà tous les droits. Si d'autres personnes de
      l'équipe (adjoint, secrétaire de mairie…) doivent aussi publier, vous pouvez leur créer un
      accès directement depuis l'onglet <strong>Modération → Gestion des rôles</strong>.
    </p>
    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:20px 0">
      <div style="font-weight:700;font-size:14px;color:#2c5f2d;margin-bottom:8px">Deux idées pour démarrer vite</div>
      <div style="font-size:14px;color:#3a4a3b;line-height:1.8">
        <span style="color:#4a8c4a;font-weight:700">✓</span> Publier un premier article (une actu, un événement à venir)<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> Renseigner le calendrier de collecte des déchets — c'est souvent ce qui déclenche le plus d'inscriptions
      </div>
    </div>
    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Retourner sur Agora</a>
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Je reste disponible pour la moindre question — et si vous préférez qu'on en discute par
      téléphone plutôt que par écrit, dites-le-moi simplement en répondant à cet email.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme · 06 48 06 10 97
    </div>
  </div>`,
};

// — Relance douce si le compte s'est connecté une fois puis n'est jamais revenu (voir
//   verifierRelanceInactivite dans cron.ts) : signal inverse au précédent, tout aussi utile. —
export const MODELE_RELANCE_INACTIVITE_DEFAUT = {
  objet: 'Toujours partant pour Agora à {{commune}} ?',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      Vous aviez jeté un œil à Agora pour <strong>{{commune}}</strong> il y a quelques jours —
      je me permets un petit signe, sans insister : si le moment n'est pas le bon, aucun souci,
      votre espace reste disponible quand vous voudrez.
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Si en revanche vous avez eu une question, un doute, ou pas eu le temps — dites-le-moi, je
      réponds volontiers par email ou par téléphone (06 48 06 10 97), et je peux même vous faire
      une démonstration rapide en visio si ça vous aide à vous décider.
    </p>
    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Retourner sur Agora</a>
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme
    </div>
  </div>`,
};

// — Séquence d'onboarding/upsell des communes gratuites (voir backoffice/onboarding-drip.ts),
//   déclenchée par activation_events plutôt que par un simple délai — sauf ces 4 messages qui
//   restent ancrés sur communes.created_at (J+3/J+7), CE contenu a été fourni intégralement par
//   Léandre (pas inventé ici), seule la mise en HTML suit le style déjà en place. —

// J+3, aucune activation détectée : rappel simple, sans culpabiliser.
export const MODELE_ONBOARDING_RELANCE_J3_DEFAUT = {
  objet: '{{commune}} : 2 minutes pour débloquer le plus utile',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      Petit rappel amical : votre espace <strong>{{commune}}</strong> est prêt, mais encore vide
      pour vos habitants.
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Deux actions, 2 minutes chacune, qui font toute la différence :
    </p>
    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:20px 0">
      <div style="font-size:14px;color:#3a4a3b;line-height:1.8">
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Publier un premier article</strong> — même une actu simple suffit à donner vie à l'appli<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Renseigner le calendrier de collecte des déchets</strong> — c'est souvent ce qui déclenche le plus d'inscriptions côté habitants
      </div>
    </div>
    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Retourner sur Agora</a>
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Une question, un blocage technique ? Répondez à cet email ou appelez-moi directement.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme · 06 48 06 10 97
    </div>
  </div>`,
};

// J+7, toujours aucune activation : on arrête le "conseil produit", place à l'humain. Volontairement
// SANS bouton — l'objectif est une réponse par email/téléphone, pas un clic vers l'appli.
export const MODELE_ONBOARDING_CHECKIN_J7_DEFAUT = {
  objet: '{{commune}}, un frein en particulier ?',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      Je vois que vous n'avez pas encore eu l'occasion de démarrer sur Agora — ce n'est pas une
      relance automatique de plus, je me pose juste la question : y a-t-il un frein en
      particulier ? Manque de temps, une question technique, besoin de valider en interne avant
      d'aller plus loin ?
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Dites-le-moi simplement en répondant à cet email, ou appelez-moi directement au
      06&nbsp;48&nbsp;06&nbsp;10&nbsp;97 — je préfère qu'on règle ça en 5 minutes au téléphone
      plutôt que de vous laisser un compte qui prend la poussière.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme
    </div>
  </div>`,
};

// J+7, au moins une activation détectée : encouragement + graine upsell douce (pas de prix ici).
export const MODELE_ONBOARDING_ENCOURAGEMENT_J7_DEFAUT = {
  objet: '{{commune}} a bien démarré 👍',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      <strong>{{commune}}</strong> a franchi le pas — votre espace est en ligne et vos habitants
      peuvent déjà le consulter. Bien joué.
    </p>
    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Voir mon espace Agora</a>
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Pour la suite, à votre rythme, l'accès découverte reste gratuit sans limite de temps. Si un
      jour vous voulez activer les modules plus poussés — conseil municipal en ligne, entraide
      entre voisins, mémoire du village, alertes ciblées par quartier — je vous montre volontiers
      ce que ça donne concrètement pour {{commune}}. Aucune urgence, aucune obligation.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme · 06 48 06 10 97
    </div>
  </div>`,
};

// Déclenché par signal fort (3 types d'événements distincts atteints), jamais par une date seule
// — seul email de toute la séquence où le prix apparaît. Le bloc tarifs ci-dessous diffère
// volontairement du contenu fourni : Agora n'a pas de paliers nommés "Essentiel/Pro/Premium" à
// prix fixes, le vrai tarif dépend de la population (grille éditable dans Réglages) — un montant
// inventé ici serait faux pour la commune qui le recevrait. Le CTA renvoie vers {{lien_fiche}}
// (pas de {{lien_offre}}, variable inexistante dans le projet) : la fiche de présentation liste
// déjà tous les modules, c'est ce qu'il y a de plus proche d'une page "formules" aujourd'hui.
export const MODELE_ONBOARDING_UPSELL_DEFAUT = {
  objet: '{{commune}} : ce que la version complète changerait concrètement',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de {{commune}}</div>

    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Bonjour,<br /><br />
      <strong>{{commune}}</strong> utilise déjà bien l'espace gratuit — c'est exactement pour ça
      que je vous écris maintenant plutôt qu'au premier jour, quand vous n'aviez pas encore vu ce
      qu'Agora pouvait apporter concrètement.
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Voici ce qui s'activerait avec une formule payante, très concrètement pour votre commune :
    </p>
    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:20px 0">
      <div style="font-size:14px;color:#3a4a3b;line-height:1.8">
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Conseil municipal en ligne</strong> — comptes-rendus, ordre du jour, participation citoyenne facilitée<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Entraide entre voisins</strong> — mobiliser les habitants prêts à donner un coup de main (entretien, petits projets)<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Mémoire du village</strong> — valoriser la parole des anciens, l'histoire locale<br />
        <span style="color:#4a8c4a;font-weight:700">✓</span> <strong>Alertes ciblées</strong> par quartier ou zone géographique
      </div>
    </div>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Le tarif dépend simplement de la taille de {{commune}}, sans surprise — je vous fais un
      chiffrage exact sur demande.
    </p>
    <p style="margin:24px 0">
      <a href="{{lien_fiche}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Voir le détail des modules pour {{commune}}</a>
    </p>
    <div style="background:#f4f8f4;border-radius:10px;padding:16px 18px;margin:20px 0">
      <p style="font-size:14px;color:#1b2a1c;font-weight:600;margin-bottom:4px">📞 On en discute ?</p>
      <p style="font-size:14px;color:#3a4a3b;line-height:1.6">
        Le plus simple&nbsp;: répondez directement à cet email, ou appelez-moi au
        <a href="tel:+33648061097" style="color:#2c5f2d;font-weight:600">06&nbsp;48&nbsp;06&nbsp;10&nbsp;97</a> —
        je réponds vite, et je peux vous faire un chiffrage exact adapté à {{commune}}
        (avec la remise sur un engagement 3&nbsp;ans).
      </p>
    </div>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;line-height:1.7">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Élu à Eaucourt-sur-Somme · 06 48 06 10 97
    </div>
  </div>`,
};

export async function envoyerBienvenueInscription(
  env: any, contactEmail: string, ctx: ContextePresentation, varianteId?: string,
): Promise<{ variante: string | null; resendEmailId: string | null }> {
  const modele = varianteId
    ? await chargerVarianteGeneriqueParId(env, 'bienvenue_inscription', varianteId, MODELE_BIENVENUE_INSCRIPTION_DEFAUT)
    : await chargerModeleParCle(env, 'bienvenue_inscription', MODELE_BIENVENUE_INSCRIPTION_DEFAUT);
  const corps = injecterPreviewText(rendrePresentation(modele.corps_html, ctx), modele.preview_text);
  const resendEmailId = await envoyerEmail(env, contactEmail, rendrePresentation(modele.objet, ctx), corps);
  return { variante: modele.nom || null, resendEmailId };
}

export async function envoyerRelanceInactivite(
  env: any, contactEmail: string, ctx: ContextePresentation, varianteId?: string,
): Promise<{ variante: string | null; resendEmailId: string | null }> {
  const modele = varianteId
    ? await chargerVarianteGeneriqueParId(env, 'relance_inactivite', varianteId, MODELE_RELANCE_INACTIVITE_DEFAUT)
    : await chargerModeleParCle(env, 'relance_inactivite', MODELE_RELANCE_INACTIVITE_DEFAUT);
  const corps = injecterPreviewText(rendrePresentation(modele.corps_html, ctx), modele.preview_text);
  const resendEmailId = await envoyerEmail(env, contactEmail, rendrePresentation(modele.objet, ctx), corps);
  return { variante: modele.nom || null, resendEmailId };
}

// Version paramétrée par cle de envoyerBienvenueInscription/envoyerRelanceInactivite ci-dessus —
// mêmes deux fonctions existantes intentionnellement laissées telles quelles (ne pas retoucher
// ce qui marche déjà) ; celle-ci sert aux 4 nouveaux modèles de la séquence d'onboarding/upsell
// (voir backoffice/onboarding-drip.ts) plutôt que d'écrire 4 fonctions de plus, identiques.
export async function envoyerModeleGenerique(
  env: any, cle: string, defaut: { objet: string; corps_html: string },
  contactEmail: string, ctx: ContextePresentation, varianteId?: string,
): Promise<{ variante: string | null; resendEmailId: string | null }> {
  const modele = varianteId
    ? await chargerVarianteGeneriqueParId(env, cle, varianteId, defaut)
    : await chargerModeleParCle(env, cle, defaut);
  const corps = injecterPreviewText(rendrePresentation(modele.corps_html, ctx), modele.preview_text);
  const resendEmailId = await envoyerEmail(env, contactEmail, rendrePresentation(modele.objet, ctx), corps);
  return { variante: modele.nom || null, resendEmailId };
}

// Repli texte du logo (titre « Agora. ») quand aucun logo n'est configuré.
function baliseLogo(url: string | null | undefined): string {
  if (!url) return `<div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>`;
  return `<img src="${url}" alt="Agora" style="max-width:200px;height:auto;display:block;margin-bottom:4px" />`;
}

// Balise <img> de signature à partir de l'URL stockée (vide si aucune photo). Images chargées
// par URL (le domaine étant authentifié DKIM/SPF, elles s'affichent chez la plupart des clients).
function baliseSignature(url: string | null | undefined): string {
  if (!url) return '';
  return `<img src="${url}" alt="" width="56" height="56" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0" />`;
}

// Construit le contexte de variables pour une commune (client → son app ; prospect → la démo).
export function contextePresentation(frontendUrl: string, nomCommune: string, slug: string): ContextePresentation {
  return {
    commune: nomCommune,
    url: `${frontendUrl}/${slug}/`,
    lienFiche: `${frontendUrl}/backoffice/fiche?slug=${encodeURIComponent(slug)}&nom=${encodeURIComponent(nomCommune)}`,
  };
}

// Envoie l'email de présentation à partir du modèle enregistré (variante active), variables
// substituées (logo + photo de signature). Images chargées par URL (domaine authentifié) —
// léger, aucun risque de surcharge du Worker. Si `identifiants` est fourni (commune gratuite
// activée à la volée pour ce prospect, voir prospection.ts), l'encart identifiants provisoires
// est ajouté après le corps — un seul email, immédiatement exploitable, décision du 2026-08-17.
export async function envoyerPresentation(
  env: any, contactEmail: string, ctx: ContextePresentation,
  identifiants?: { maireEmail: string; motDePasse: string },
  varianteId?: string,
): Promise<{ variante: string | null; resendEmailId: string | null }> {
  const modele = varianteId ? await chargerVarianteParId(env, varianteId) : await chargerModelePresentation(env);
  const ctxComplet = {
    ...ctx,
    signaturePhoto: baliseSignature(modele.signature_image_url),
    logo: baliseLogo(modele.logo_image_url),
  };
  let corps = rendrePresentation(modele.corps_html, ctxComplet);
  if (identifiants) corps += blocIdentifiants(ctx.url, identifiants.maireEmail, identifiants.motDePasse) + blocPsModules();
  corps = injecterPreviewText(corps, modele.preview_text);
  const resendEmailId = await envoyerEmail(env, contactEmail, rendrePresentation(modele.objet, ctxComplet), corps);
  return { variante: modele.nom || null, resendEmailId };
}

// — Email de rappel d'échéance d'abonnement (envoyé ~60 jours avant, voir cron.ts). Simple et
// factuel : ce n'est pas une facture (pas de mentions légales/SIRET/TVA), juste un rappel qui
// invite la mairie à recontacter Juicy Solutions pour le renouvellement (règlement par mandat
// administratif, hors app). —
export async function envoyerEmailEcheance(env: any, d: {
  nomCommune: string; destinataire: string; echeance: string; montant: number | null;
}): Promise<void> {
  const dateAffichee = new Date(d.echeance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const montantAffiche = d.montant != null ? `${d.montant.toLocaleString('fr-FR')} € TTC` : 'à confirmer';
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    <div style="font-size:26px;font-weight:800;color:#2c5f2d">Agora<span style="color:#4a8c4a">.</span></div>
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne de votre commune</div>

    <h1 style="font-size:20px;line-height:1.3">Renouvellement de votre abonnement Agora</h1>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      L'abonnement de <strong>${echapper(d.nomCommune)}</strong> arrive à échéance le
      <strong>${dateAffichee}</strong> (${montantAffiche} pour la période suivante).
    </p>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      N'hésitez pas à répondre à cet email pour organiser le renouvellement — aucune démarche
      en ligne n'est nécessaire, le règlement se fait comme d'habitude par mandat administratif.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c">
      Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
      Une question&nbsp;? Répondez simplement à cet email.
    </div>
  </div>`;
  await envoyerEmail(env, d.destinataire, `Agora — Renouvellement de l'abonnement de ${d.nomCommune}`, html);
}
