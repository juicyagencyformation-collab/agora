// worker/src/backoffice/documents-pdf.ts
// PDF des documents de prospection d'une commune, pour les joindre à un brouillon Outlook (2026-11-25) :
// les pages imprimables du backoffice (Fiche + QR, affiches, stickers, dossier conseil, plaquette)
// sont ouvertes dans le navigateur Chrome de Cloudflare (Browser Run, binding BROWSER, comme le
// journal papier) et enregistrées en PDF, telles qu'elles s'impriment.
// Offre Workers gratuite : 10 min de navigateur par jour et un nouveau navigateur toutes les 20 s au
// plus → UN seul navigateur pour tous les documents d'un même email, une page après l'autre.
// La plaquette lit une route réservée au staff : le navigateur reçoit un jeton de session de 2
// minutes signé par le Worker (jamais transmis ailleurs), pour la seule durée de la fabrication.
import puppeteer from '@cloudflare/puppeteer';
import { sign } from '@tsndr/cloudflare-worker-jwt';

export const DOCUMENTS_PDF = ['fiche', 'affiche', 'explorez', 'stickers', 'dossier', 'plaquette'] as const;
export type DocumentPdf = typeof DOCUMENTS_PDF[number];

// Nom du fichier joint et adresse de la page (relative au site). slug requis pour tous sauf la plaquette.
const DOCUMENTS: Record<DocumentPdf, { titre: string; chemin: (d: { slug: string; nom: string; prospectId: string }) => string; slugRequis: boolean }> = {
  fiche: { titre: 'Fiche et QR code', slugRequis: true, chemin: (d) => `/backoffice/fiche?slug=${encodeURIComponent(d.slug)}&nom=${encodeURIComponent(d.nom)}` },
  affiche: { titre: 'Affiche pour les habitants', slugRequis: true, chemin: (d) => `/backoffice/affiche-citoyens?slug=${encodeURIComponent(d.slug)}` },
  explorez: { titre: 'Affiche Explorez le village', slugRequis: true, chemin: (d) => `/backoffice/stickers?type=jeux&n=1&slug=${encodeURIComponent(d.slug)}` },
  stickers: { titre: 'Stickers', slugRequis: true, chemin: (d) => `/backoffice/stickers?slug=${encodeURIComponent(d.slug)}` },
  dossier: { titre: 'Dossier pour le conseil municipal', slugRequis: true, chemin: (d) => `/backoffice/dossier-conseil?programme=fondatrice&slug=${encodeURIComponent(d.slug)}` },
  plaquette: { titre: 'Plaquette Plateforme-Agora', slugRequis: false, chemin: (d) => `/backoffice/plaquette?prospect=${encodeURIComponent(d.prospectId)}` },
};

export function documentDisponible(doc: DocumentPdf, slug: string | null): boolean {
  return !DOCUMENTS[doc].slugRequis || !!slug;
}

export class ErreurPdf extends Error {}

export async function fabriquerPdfDocuments(
  env: any, staffId: string, cible: { slug: string | null; nom: string; prospectId: string }, documents: DocumentPdf[],
): Promise<{ nom: string; type: string; contenu: Uint8Array }[]> {
  if (!documents.length) return [];
  if (!env.BROWSER) throw new ErreurPdf('Fabrication des PDF indisponible sur ce serveur.');
  const base = String(env.FRONTEND_URL || 'https://plateforme-agora.fr').replace(/\/$/, '');
  const pieces: { nom: string; type: string; contenu: Uint8Array }[] = [];
  let navigateur: any;
  try {
    navigateur = await puppeteer.launch(env.BROWSER);
    const page = await navigateur.newPage();
    if (documents.includes('plaquette')) {
      const jeton = await sign({ staff_id: staffId, scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 120 }, env.JWT_SECRET);
      await page.setCookie({ name: 'agora_bo', value: jeton, domain: new URL(base).hostname, path: '/', secure: true, httpOnly: true });
    }
    for (const doc of documents) {
      const d = DOCUMENTS[doc];
      await page.goto(base + d.chemin({ slug: cible.slug ?? '', nom: cible.nom, prospectId: cible.prospectId }), { waitUntil: 'networkidle0', timeout: 30000 });
      // Les pages se remplissent en JavaScript (données, QR code) : petite marge après le réseau.
      await new Promise((r) => setTimeout(r, 800));
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, timeout: 60000 });
      pieces.push({ nom: `${d.titre} - ${cible.nom}.pdf`, type: 'application/pdf', contenu: new Uint8Array(pdf) });
    }
    return pieces;
  } catch (err: any) {
    if (err instanceof ErreurPdf) throw err;
    console.error('Documents PDF : échec', err);
    const message = String(err?.message ?? '');
    throw new ErreurPdf(/exceeded for today/i.test(message)
      ? 'Le quota quotidien du navigateur Cloudflare est atteint : réessayez demain, ou préparez l\'email sans pièce jointe.'
      : /429|rate limit|too many/i.test(message)
        ? 'Trop de PDF demandés d\'affilée : attendez une trentaine de secondes et réessayez.'
        : 'La fabrication des PDF a échoué. Réessayez dans un instant.');
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
  }
}
