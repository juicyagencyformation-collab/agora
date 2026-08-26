// worker/src/routes/liens_courts.ts
// Liens courts pour QR code (voir CLAUDE.md, piège "générateur QR maison plafonné à 42
// caractères") : le générateur QR du Worker (lib/qrcode.ts) ne peut pas encoder l'URL complète
// de l'app d'une commune (plateforme-agora.fr/<slug>/ dépasse la limite pour la plupart des noms
// de commune), donc on encode à la place un code court qui redirige — plateforme-agora.fr/q/<code>
// (36 caractères avec le code, largement sous la limite). Routes publiques, hors résolution de
// tenant (comme /decouverte et /backoffice, voir index.ts) : "q" n'est pas un slug de commune.
import { Hono } from 'hono';
import { supabaseSelect } from '../db';
import { genererQrSvg } from '../lib/qrcode';

const app = new Hono();

// GET /q/:code — redirige vers l'app de la commune. 404 sobre plutôt qu'une erreur technique si
// le code est invalide ou n'a jamais été généré (lien copié à la main, faute de frappe...).
app.get('/:code', async (c) => {
  const code = c.req.param('code');
  const [commune] = await supabaseSelect(c.env, 'communes', {
    select: 'slug', code_court: `eq.${code}`,
  });
  if (!commune?.slug) return c.text('Lien introuvable.', 404);
  return c.redirect(`${c.env.FRONTEND_URL}/${commune.slug}/`, 302);
});

// GET /q/:code/qr.svg — le QR lui-même, généré à la volée (pas de stockage R2 : genererQrSvg est
// un simple calcul, pas besoin de mise en cache). Ne vérifie pas que le code existe réellement :
// un QR pour un code invalide est inoffensif (mènerait juste à la 404 ci-dessus au scan), inutile
// de payer une lecture Supabase supplémentaire à chaque affichage de l'image dans un email.
app.get('/:code/qr.svg', (c) => {
  const code = c.req.param('code');
  const svg = genererQrSvg(`${c.env.FRONTEND_URL}/q/${code}`, 200);
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
});

export default app;
