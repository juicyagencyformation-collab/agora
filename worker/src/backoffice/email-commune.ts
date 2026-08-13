// worker/src/backoffice/email-commune.ts
// Email de bienvenue envoyé au maire d'une commune fraîchement onboardée : pitch + accès à son
// application déjà prête + identifiants provisoires. Utilisé par onboarding (à la création) et
// par administration (bouton « Renvoyer les accès », qui régénère un mot de passe temporaire).
import { envoyerEmail } from '../lib/email';

// Mot de passe temporaire lisible (sans caractères ambigus 0/O/1/l/I).
export function genererMotDePasseTemporaire(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
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
