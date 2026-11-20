// worker/src/lib/cgu.ts
// Preuve d'acceptation, par la mairie, de l'accord de sous-traitance RGPD (art. 28) intégré aux
// CGU (article 10 de frontend/conditions-utilisation.html) — migration 108. Le RGPD exige un
// contrat écrit, la forme électronique suffit (art. 28.9) : en offre gratuite, aucune signature
// manuscrite, la preuve est le journal acceptations_cgu + le texte exact archivé dans versions_cgu.
//
// CHANGER LES CGU : modifier conditions-utilisation.html (date « Version du … » + balise
// <meta name="version-cgu">). Si le changement touche les engagements de la mairie ou de
// l'éditeur, passer AUSSI VERSION_CGU ci-dessous à la même date : chaque compte mairie devra
// alors ré-accepter une fois (fenêtre « Avant de continuer », frontend/js/navigation.js).
// Une simple correction de forme : ne pas toucher VERSION_CGU (personne n'est redérangé).
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseUpsert } from '../db';
import { hasherSha256Hex } from './hash';
import { ipClient } from './securite';
import { envoyerEmail } from './email';

export const VERSION_CGU = '2026-11-20';

// Seuls ces rôles engagent juridiquement la commune ; un citoyen n'a rien à accepter ici.
export const ROLES_DECIDEURS = ['admin', 'elu', 'maire', 'superadmin'];

export async function doitAccepterCgu(env: any, user_id: string, role: string): Promise<boolean> {
  if (!ROLES_DECIDEURS.includes(role)) return false;
  const deja = await supabaseSelect(env, 'acceptations_cgu', {
    select: 'id', user_id: `eq.${user_id}`, version: `eq.${VERSION_CGU}`, limit: '1',
  });
  return deja.length === 0;
}

// Archive le texte des CGU tel qu'il est servi à cet instant (ce que la personne a pu lire) et
// renvoie son empreinte. Dédoublonné par empreinte : une version n'est stockée qu'une fois.
// null si le site ne répond pas : l'acceptation est quand même enregistrée (version + date).
async function archiverTexteCgu(env: any): Promise<string | null> {
  try {
    const url = `${env.FRONTEND_URL || 'https://plateforme-agora.fr'}/conditions-utilisation`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.includes('Sous-traitance de données personnelles')) return null; // pas la bonne page
    const empreinte = await hasherSha256Hex(html);
    const version = html.match(/<meta name="version-cgu" content="([^"]+)"/)?.[1] ?? 'inconnue';
    await supabaseUpsert(env, 'versions_cgu', [{ empreinte_sha256: empreinte, version, texte_html: html, url_source: url }], 'empreinte_sha256');
    return empreinte;
  } catch (e) {
    console.error('Archivage des CGU impossible', e);
    return null;
  }
}

const LIBELLES_ROLES: Record<string, string> = { maire: 'maire', elu: 'élu(e)', admin: 'administrateur (mairie)', superadmin: 'éditeur' };

function echapper(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

type Signataire = {
  commune_id: string; user_id: string | null; role: string;
  nom_affiche: string | null; email: string | null;
  canal: 'application' | 'lien_mairie';
};

// Cœur commun aux deux façons d'accepter (application connectée, lien envoyé au maire) : archive
// le texte servi, journalise, envoie l'accusé de réception. Renvoie la ligne créée, ou null si
// elle existait déjà (double clic, contrainte UNIQUE (user_id, version)).
export async function journaliserAcceptationCgu(c: any, s: Signataire): Promise<any | null> {
  const env = c.env;
  const [[commune], empreinte] = await Promise.all([
    supabaseSelect(env, 'communes', { select: 'nom,slug,email_mairie,contact_email', id: `eq.${s.commune_id}` }),
    archiverTexteCgu(env),
  ]);
  let acceptation: any = null;
  try {
    [acceptation] = await supabaseInsert(env, 'acceptations_cgu', {
      commune_id: s.commune_id, user_id: s.user_id, role: s.role, version: VERSION_CGU, empreinte_sha256: empreinte,
      nom_affiche: s.nom_affiche, email: s.email,
      // Colonne de la migration 109 : envoyée seulement hors application (valeur par défaut sinon),
      // pour que l'acceptation dans l'app ne dépende jamais de cette migration.
      ...(s.canal !== 'application' ? { canal: s.canal } : {}),
      ip: ipClient(c),
      user_agent: (c.req.header('User-Agent') || '').slice(0, 400) || null,
    });
  } catch (e) {
    if (!String(e).includes('23505')) throw e;
    return null;
  }
  if (acceptation?.id) await envoyerAccuseReception(env, acceptation, commune, s.nom_affiche, s.role);
  return acceptation ?? null;
}

export async function enregistrerAcceptationCgu(c: any, user_id: string, commune_id: string, role: string): Promise<void> {
  const [moi] = await supabaseSelect(c.env, 'users', { select: 'nom,prenom,email', id: `eq.${user_id}` });
  await journaliserAcceptationCgu(c, {
    commune_id, user_id, role, canal: 'application',
    nom_affiche: [moi?.prenom, moi?.nom].filter(Boolean).join(' ') || null,
    email: moi?.email ?? null,
  });
  // Compatibilité (export de la commune, ancienne colonne de la migration 080).
  await supabaseUpdate(c.env, 'users', { cgu_sous_traitance_acceptee_le: new Date().toISOString() }, { id: `eq.${user_id}` });
}

// Accusé de réception : une copie de la preuve chez la mairie (et dans le journal d'envoi de Resend),
// donc hors de la seule base de l'éditeur. Une fois par acceptation, jamais bloquant : un échec
// d'envoi (quota Resend du plan gratuit, adresse invalide) laisse l'acceptation valable.
async function envoyerAccuseReception(env: any, acceptation: any, commune: any, nomAffiche: string | null, role: string): Promise<void> {
  try {
    const destinataires = [...new Set([acceptation.email, commune?.email_mairie || commune?.contact_email]
      .filter(Boolean).map((e: string) => e.trim().toLowerCase()))];
    if (!destinataires.length) return;
    const quand = new Date(acceptation.created_at || Date.now())
      .toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Paris' });
    const site = env.FRONTEND_URL || 'https://plateforme-agora.fr';
    const lienCommune = commune?.slug ? `${site}/${commune.slug}` : site;
    const versionFr = new Date(`${VERSION_CGU}T12:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
    const html = `
      <p>Bonjour,</p>
      <p>Nous accusons réception de l'acceptation, au nom de la commune de <strong>${echapper(commune?.nom)}</strong>,
        des conditions générales d'utilisation de Plateforme-Agora (version du ${versionFr}), dont l'article 10 constitue
        l'accord de sous-traitance de données personnelles prévu par l'article 28 du RGPD.</p>
      <ul>
        <li>Acceptée par : ${echapper(nomAffiche || 'compte sans nom')} (${echapper(LIBELLES_ROLES[role] || role)}), ${echapper(acceptation.email || '')}</li>
        <li>Le : ${quand} (heure de Paris)</li>
        <li>Empreinte du texte accepté (SHA-256) : ${echapper(acceptation.empreinte_sha256 || 'non disponible')}</li>
      </ul>
      <p>Texte des conditions : <a href="${lienCommune}/conditions-utilisation.html">${lienCommune}/conditions-utilisation.html</a><br>
        Fiche à reporter dans le registre des traitements de la mairie : <a href="${lienCommune}/fiche-registre.html">${lienCommune}/fiche-registre.html</a></p>
      <p>Conservez cet email avec les documents de la commune. Si vous n'êtes pas à l'origine de cette acceptation,
        ou si la personne ci-dessus n'est pas habilitée à engager la commune, répondez simplement à ce message.</p>
      <p>Léandre Sallé, entrepreneur individuel, éditeur de Plateforme-Agora</p>`;
    const id = await envoyerEmail(env, destinataires as any,
      `Accusé de réception — conditions d'utilisation et accord RGPD, commune de ${commune?.nom ?? ''}`, html);
    if (id) {
      await supabaseUpdate(env, 'acceptations_cgu', { accuse_envoye_a: destinataires.join(', '), accuse_email_id: id }, { id: `eq.${acceptation.id}` });
    }
  } catch (e) {
    console.error('Accusé de réception des CGU non envoyé', e);
  }
}
