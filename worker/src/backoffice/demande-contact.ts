// worker/src/backoffice/demande-contact.ts
// Formulaire de demande de la landing page (frontend/accueil.html, section #contact) : activation
// de la version gratuite, devis pour la version payante ou candidature « Commune fondatrice » —
// un élu ou une secrétaire de mairie laisse ses coordonnées, on reçoit un email sur la boîte
// contact. Remplace le mailto: nu, qui échoue chez tous ceux qui n'ont pas de logiciel de
// messagerie configuré (cas fréquent en mairie : webmail uniquement).
// Route PUBLIQUE (pas d'auth) montée dans backoffice/index.ts. Protections : validation Zod
// stricte (longueurs bornées), champ piège anti-robot (site_web, invisible pour un humain), et
// tout ce qui vient du visiteur est échappé avant d'entrer dans le HTML de l'email.
// Rien n'est écrit en base : l'email est la trace (et les réponses passent par la boîte de
// réception déjà branchée sur Resend, voir emails-recus.ts).
import { z } from 'zod';

// Type de demande choisi dans le formulaire. Facultatif : une page encore en cache chez un
// visiteur (ancien formulaire « Commune fondatrice » seul) envoie sans ce champ.
export const DEMANDES_CONTACT = { gratuit: 'Version gratuite', devis: 'Devis version payante', fondatrice: 'Commune fondatrice' } as const;

export const FONCTIONS_CONTACT = ['Maire', 'Adjoint(e)', 'Conseiller(e) municipal(e)', 'Secrétaire de mairie', 'Autre'] as const;

export const demandeContactSchema = z.object({
  demande: z.enum(Object.keys(DEMANDES_CONTACT) as [keyof typeof DEMANDES_CONTACT]).optional(),
  nom: z.string().trim().min(2).max(120),
  fonction: z.enum(FONCTIONS_CONTACT),
  commune: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  telephone: z.string().trim().max(30).regex(/^[0-9+().\s-]*$/, 'Téléphone invalide').optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  // Champ piège : caché en CSS, un humain le laisse vide, un robot de spam le remplit.
  site_web: z.string().max(200).optional().default(''),
});

export type DemandeContact = z.infer<typeof demandeContactSchema>;

const echapper = (s: string) => s.replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
)[m]);

const libelleDemande = (d: DemandeContact) => (d.demande ? DEMANDES_CONTACT[d.demande] : 'Demande de contact');

export function sujetDemandeContact(d: DemandeContact): string {
  // Sujet sur une ligne, sans caractère de contrôle (le nom de commune vient du visiteur).
  const commune = d.commune.replace(/[\r\n]+/g, ' ');
  return `${libelleDemande(d)} — ${commune} (${d.fonction})`;
}

export function emailDemandeContactHtml(d: DemandeContact): string {
  const ligne = (libelle: string, valeur: string) => valeur
    ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${libelle}</td><td style="padding:4px 0"><strong>${echapper(valeur)}</strong></td></tr>`
    : '';
  const message = d.message
    ? `<p style="margin-top:16px;color:#6b7280">Message :</p><div style="white-space:pre-wrap;background:#f8f7f4;border-radius:8px;padding:12px 14px">${echapper(d.message)}</div>`
    : '';
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1B2A4A;max-width:560px">
    <h1 style="font-size:20px;margin-bottom:12px">Nouvelle demande : ${libelleDemande(d)}</h1>
    <table style="font-size:15px;border-collapse:collapse">
      ${ligne('Commune', d.commune)}
      ${ligne('Nom', d.nom)}
      ${ligne('Fonction', d.fonction)}
      ${ligne('Email', d.email)}
      ${ligne('Téléphone', d.telephone)}
    </table>
    ${message}
    <p style="margin-top:20px;font-size:13px;color:#6b7280">Envoyé depuis le formulaire de plateforme-agora.fr. Répondre à cet email écrit directement au demandeur.</p>
  </div>`;
}
