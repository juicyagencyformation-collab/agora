// frontend/js/mot-de-passe.js
// Ajoute un bouton « œil » (Afficher / Masquer) dans chaque champ mot de passe, pour que la
// personne puisse vérifier ce qu'elle tape — surtout à la création du compte, sur téléphone.
// Pages statiques : appliqué tout seul au chargement. Champs créés plus tard (modale du profil) :
// appeler window.ajouterBoutonsMotDePasse(conteneur) après les avoir insérés.
(function () {
  const OEIL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OEIL_BARRE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.1 10.1 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  // Sélecteurs plus précis que « form button » (styles des pages) pour ne pas en hériter.
  const style = document.createElement('style');
  style.textContent = `
    .mdp-champ { position: relative; display: block; }
    .mdp-champ > .mdp-oeil {
      position: absolute; top: 0; right: 0; bottom: 0; width: 44px; margin: 0; padding: 0;
      display: flex; align-items: center; justify-content: center;
      background: transparent; border: none; box-shadow: none; transform: none;
      color: #6b7280; cursor: pointer; border-radius: 0 10px 10px 0;
    }
    .mdp-champ > .mdp-oeil:hover, .mdp-champ > .mdp-oeil:focus-visible { background: transparent; color: #1f2937; }
  `;
  document.head.appendChild(style);

  function equiper(input) {
    if (input.dataset.mdpOeil) return;
    input.dataset.mdpOeil = '1';

    // La marge du champ passe sur l'enveloppe, pour que le bouton reste centré sur le champ.
    const cs = getComputedStyle(input);
    const enveloppe = document.createElement('span');
    enveloppe.className = 'mdp-champ';
    enveloppe.style.margin = cs.margin;
    input.parentNode.insertBefore(enveloppe, input);
    enveloppe.appendChild(input);
    input.style.margin = '0';
    input.style.paddingRight = '44px';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'mdp-oeil';
    const maj = () => {
      const visible = input.type === 'text';
      bouton.innerHTML = visible ? OEIL_BARRE : OEIL;
      bouton.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      bouton.setAttribute('aria-pressed', String(visible));
      bouton.title = bouton.getAttribute('aria-label');
    };
    bouton.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      maj();
    });
    maj();
    enveloppe.appendChild(bouton);
  }

  window.ajouterBoutonsMotDePasse = function (racine) {
    (racine || document).querySelectorAll('input[type="password"]').forEach(equiper);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.ajouterBoutonsMotDePasse());
  } else {
    window.ajouterBoutonsMotDePasse();
  }
})();
