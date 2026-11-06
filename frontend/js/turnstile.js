// frontend/js/turnstile.js — protection anti-robots des formulaires d'inscription (2026-11-06) :
// inscription habitant (connexion.html), Explorateur (jouer.html) et « Rejoindre ma commune »
// (rejoindre.html). Vérifiée côté serveur par worker/src/lib/anti-robots.ts.
// - Cloudflare Turnstile : captcha INVISIBLE (rien à cocher pour un humain), exception à la règle
//   n°3 validée par Léandre le 2026-11-06 — le script vient de challenges.cloudflare.com, il ne
//   peut pas être vendoré. Clé de site PUBLIQUE ci-dessous ; vide = pas de captcha (avant la
//   création du widget), et le serveur ne l'exige pas tant que TURNSTILE_SECRET n'est pas posé.
// - Temps de saisie : envoyé avec le formulaire (un robot remplit en quelques millisecondes).
const TURNSTILE_SITEKEY = '';

// conteneur : élément où placer le widget (invisible sauf défi exceptionnel) ; action : même nom
// que celui attendu par le serveur ('inscription' ou 'rejoindre').
// Renvoie { champs() → { turnstile, duree_saisie_ms } à ajouter au corps JSON, reinitialiser() à
// appeler après un échec (un jeton ne sert qu'une fois), redemarrerChrono() quand le formulaire
// s'affiche réellement (étapes masquées) }.
function protegerFormulaire(conteneur, action) {
  let debut = Date.now();
  let idWidget = null;
  if (TURNSTILE_SITEKEY && conteneur) {
    const rendre = () => {
      idWidget = window.turnstile.render(conteneur, { sitekey: TURNSTILE_SITEKEY, action, appearance: 'interaction-only', size: 'flexible' });
    };
    if (window.turnstile) {
      rendre();
    } else {
      (window.__rappelsTurnstile ||= []).push(rendre);
      if (!document.getElementById('script-turnstile')) {
        window.__turnstilePret = () => window.__rappelsTurnstile.splice(0).forEach((f) => f());
        const script = document.createElement('script');
        script.id = 'script-turnstile';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__turnstilePret';
        script.async = true;
        document.head.appendChild(script);
      }
    }
  }
  return {
    champs: () => ({
      duree_saisie_ms: Date.now() - debut,
      ...(idWidget != null ? { turnstile: window.turnstile.getResponse(idWidget) || undefined } : {}),
    }),
    reinitialiser: () => { if (idWidget != null) window.turnstile.reset(idWidget); },
    redemarrerChrono: () => { debut = Date.now(); },
  };
}
