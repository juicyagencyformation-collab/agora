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

export function emailBienvenueHtml(d: DonneesBienvenue): string {
  const url = `${d.frontendUrl}/${d.slug}/`;
  const ficheUrl = `${d.frontendUrl}/backoffice/fiche?slug=${encodeURIComponent(d.slug)}&nom=${encodeURIComponent(d.nomCommune)}`;
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

    <div style="background:#f4f8f4;border:1px solid #dfe7df;border-radius:10px;padding:16px 18px;margin:20px 0">
      <div style="font-weight:700;font-size:14px;margin-bottom:8px">Vos identifiants provisoires</div>
      <div style="font-size:14px;line-height:1.9">
        Adresse&nbsp;: <a href="${url}">${echapper(url)}</a><br />
        Identifiant&nbsp;: <strong>${echapper(d.maireEmail)}</strong><br />
        Mot de passe&nbsp;: <strong style="font-family:monospace">${echapper(d.motDePasse)}</strong>
      </div>
      <div style="color:#5b6b5c;font-size:12px;margin-top:10px">
        Pensez à modifier ce mot de passe dès votre première connexion, depuis votre profil.
      </div>
    </div>

    <p style="font-size:14px;color:#3a4a3b">
      Pour découvrir l'application en détail&nbsp;:
      <a href="${ficheUrl}" style="color:#2c5f2d">voir la fiche de présentation</a>.
    </p>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c">
      Juicy Solutions — Léandre Sallé · plateforme-agora.fr<br />
      Une question&nbsp;? Répondez simplement à cet email.
    </div>
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
//   substituées à l'envoi : {{commune}}, {{url}} (app ou démo), {{lien_fiche}}. Un défaut de
//   secours est utilisé tant qu'aucun modèle n'a été enregistré. —
export const DEMO_SLUG = 'eaucourt';

export const MODELE_PRESENTATION_DEFAUT = {
  objet: 'Agora — une application citoyenne pour {{commune}}',
  corps_html: `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1b2a1c;max-width:560px;margin:0 auto">
    {{logo}}
    <div style="color:#5b6b5c;font-size:14px;margin-bottom:20px">La plateforme citoyenne des communes françaises</div>

    <h1 style="font-size:22px;line-height:1.3">Et si <span style="color:#2c5f2d">{{commune}}</span> avait sa propre application citoyenne&nbsp;?</h1>
    <p style="font-size:15px;color:#3a4a3b;line-height:1.6">
      Actualités, alertes, agenda, signalements, conseil municipal, entraide entre voisins&nbsp;:
      Agora réunit tout ce dont votre commune a besoin pour informer et faire participer ses
      habitants, dans une application mobile simple, souveraine et 100 % française — que la
      mairie pilote seule, sans compétence technique.
    </p>

    <p style="margin:24px 0">
      <a href="{{url}}" style="background:#2c5f2d;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Découvrir l'application</a>
    </p>

    <p style="font-size:14px;color:#3a4a3b">
      Vous préférez une présentation d'ensemble&nbsp;?
      <a href="{{lien_fiche}}" style="color:#2c5f2d">Découvrez la fiche de présentation</a>
      (avec un QR code pour tester depuis votre téléphone).
    </p>

    <div style="font-size:13px;color:#3a4a3b;font-style:italic;background:#f4f8f4;border-left:3px solid #4a8c4a;padding:14px 16px;border-radius:0 8px 8px 0;margin:24px 0;line-height:1.6">
      <div style="font-weight:700;font-style:normal;color:#2c5f2d;margin-bottom:6px">Qui je suis</div>
      Léandre Sallé, habitant d'Eaucourt-sur-Somme. Là où d'autres solutions, souvent financées
      par l'intercommunalité, se limitent à diffuser des informations, j'ai voulu placer la
      commune et ses habitants au cœur&nbsp;: participation citoyenne, valorisation de
      l'engagement de chacun, devoir de mémoire envers les anciens avec le module
      «&nbsp;La mémoire du village&nbsp;», valorisation du territoire et de son patrimoine avec
      le module «&nbsp;Chasse au trésor&nbsp;». Une application qui crée du lien, pas seulement
      des notifications.
    </div>

    <hr style="border:none;border-top:1px solid #dfe7df;margin:24px 0" />
    <div style="font-size:12px;color:#5b6b5c;display:flex;align-items:center;gap:12px">
      {{signature_photo}}
      <div>
        Léandre Sallé — Juicy Solutions · plateforme-agora.fr<br />
        Élu à Eaucourt-sur-Somme, je développe Agora pour les petites communes. Répondez à cet
        email, je vous rappelle avec plaisir.
      </div>
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

// Charge le modèle enregistré (ou le défaut de secours si aucun n'existe / lecture échouée).
export async function chargerModelePresentation(env: any): Promise<{ objet: string; corps_html: string; signature_image_url?: string | null; logo_image_url?: string | null }> {
  try {
    const [row] = await supabaseSelect(env, 'modeles_email', {
      select: 'objet,corps_html,signature_image_url,logo_image_url', cle: 'eq.presentation',
    });
    if (row?.objet && row?.corps_html) return row;
  } catch { /* table absente ou lecture KO : on retombe sur le défaut */ }
  return MODELE_PRESENTATION_DEFAUT;
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

// Envoie l'email de présentation à partir du modèle enregistré, variables substituées (logo +
// photo de signature). Images chargées par URL (domaine authentifié) — léger, aucun risque de
// surcharge du Worker.
export async function envoyerPresentation(env: any, contactEmail: string, ctx: ContextePresentation): Promise<void> {
  const modele = await chargerModelePresentation(env);
  const ctxComplet = {
    ...ctx,
    signaturePhoto: baliseSignature(modele.signature_image_url),
    logo: baliseLogo(modele.logo_image_url),
  };
  await envoyerEmail(
    env, contactEmail,
    rendrePresentation(modele.objet, ctxComplet),
    rendrePresentation(modele.corps_html, ctxComplet),
  );
}
