// frontend/backoffice/js/document.js — rend un devis ou une facture (?type=devis|facture&id=...)
// à partir des informations légales de l'entreprise (Réglages) et des données du document.
// Mentions volontairement complètes (SIRET, TVA ou exonération, numéro séquentiel, désignation,
// délai/pénalités de retard) — voir worker/src/backoffice/facturation.ts pour le contexte légal
// (une facture adressée à une commune doit ensuite être déposée sur Chorus Pro).
(async function () {
  const params = new URLSearchParams(location.search);
  const type = ['facture', 'contrat-dpa', 'convention', 'dossier', 'preuve-cgu', 'registre-rgpd'].includes(params.get('type')) ? params.get('type') : 'devis';
  const id = params.get('id');

  const echapper = (s) => (s || '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
  const euros = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = (s) => s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  const feuille = document.getElementById('feuille');
  if (!id) { feuille.textContent = 'Document introuvable (id manquant).'; return; }

  // Le contrat DPA est déjà entièrement rendu côté Worker (voir contrat-dpa.ts) — pas de table
  // montants/mentions à construire ici, juste l'afficher tel quel.
  // La convention « Commune fondatrice » est elle aussi rendue côté Worker (convention-document.ts).
  if (type === 'convention') {
    try {
      const doc = await boFetch('/conventions/' + id + '/document');
      document.title = 'Convention Commune fondatrice — ' + (doc.commune_nom || '') + ' — Backoffice Plateforme-Agora';
      feuille.innerHTML = doc.html;
      if (doc.modifiable && !doc.signee_par_prestataire) initEditionConvention(doc);
    } catch (e) {
      feuille.textContent = 'Impossible de charger la convention : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  // Texte de la convention réécrit à la main pour cette commune (2026-11-20, PUT /conventions/:id/texte) :
  // le corps (titre → article 6) devient modifiable sur place ; signatures et DPA restent générés.
  // Le Worker nettoie le HTML (liste blanche de balises) avant de l'enregistrer.
  function initEditionConvention(doc) {
    const corps = feuille.querySelector('[data-corps-convention]');
    const barre = document.querySelector('.barre-actions');
    if (!corps || !barre) return;
    const bouton = (texte, sec, action) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (sec ? ' btn--sec' : ''); b.textContent = texte;
      b.addEventListener('click', action);
      return b;
    };
    const info = document.createElement('div');
    info.className = 'info-edition';
    const majInfo = (texte, erreur) => { info.textContent = texte; info.classList.toggle('erreur', !!erreur); };
    if (doc.texte_personnalise_le) {
      const apres = doc.formulaire_rempli_le && doc.formulaire_rempli_le > doc.texte_personnalise_le;
      majInfo('Texte personnalisé le ' + new Date(doc.texte_personnalise_le).toLocaleString('fr-FR')
        + ' : les champs de la fiche ne le modifient plus.'
        + (apres ? ' ⚠️ La mairie a transmis des informations depuis : vérifiez qu’elles figurent dans le texte.' : ''), apres);
    }
    const enregistrer = async (texte) => {
      try {
        await boFetch('/conventions/' + id + '/texte', { method: 'PUT', body: JSON.stringify({ texte }) });
        location.reload();
      } catch (e) {
        majInfo('Échec : ' + (e.message || 'erreur inconnue'), true);
      }
    };
    const modifier = bouton('✏️ Modifier le texte', true, () => {
      corps.contentEditable = 'true';
      corps.classList.add('en-edition');
      corps.focus();
      modifier.replaceWith(annuler, valider);
      majInfo('Cliquez dans le texte pour le modifier (Ctrl+B : gras, Ctrl+I : italique). Les signatures et le DPA restent générés automatiquement.');
    });
    const annuler = bouton('Annuler', true, () => location.reload());
    const valider = bouton('Enregistrer le texte', false, () => enregistrer(corps.innerHTML));
    barre.prepend(modifier);
    if (doc.texte_personnalise_le) {
      barre.prepend(bouton('Revenir au texte automatique', true, () => {
        if (confirm('Revenir au texte automatique ? Vos modifications du texte seront perdues.')) enregistrer(null);
      }));
    }
    barre.after(info);
  }

  // Registre des activités de traitement de l'éditeur (?type=registre-rgpd&id=plateforme), article 30 du
  // RGPD : partie 1 en tant que responsable du traitement, partie 2 en tant que sous-traitant des communes
  // (liste tenue à jour automatiquement, backoffice/preuves-cgu.ts GET /registre). Le texte fixe est ICI :
  // à mettre à jour à chaque nouveau traitement (nouveau module, nouveau prestataire, nouvelle donnée).
  if (type === 'registre-rgpd') {
    try {
      const { editeur, communes, nb_espaces_citoyens } = await boFetch('/preuves-cgu/registre');
      document.title = 'Registre des traitements RGPD — Backoffice Plateforme-Agora';
      const fiche = (titre, lignes) => `
        <h2 class="dossier-titre">${titre}</h2>
        <table class="dossier-fiche registre">${lignes.map(([lib, val]) => `<tr><th>${lib}</th><td>${val}</td></tr>`).join('')}</table>`;
      const SOUS_TRAITANTS = 'Cloudflare (hébergement de l\'application, fichiers dans l\'UE, anti-robot, modération d\'images par IA si activée), '
        + 'Supabase (base de données, Paris), Resend (envoi des emails).';
      const TRANSFERTS = 'Données hébergées dans l\'UE. Transferts ponctuels possibles vers les États-Unis (Cloudflare, Resend), encadrés par le '
        + 'cadre de protection des données UE–États-Unis et/ou les clauses contractuelles types.';
      const SECURITE = 'Cloisonnement des données par commune contrôlé par le serveur ; mots de passe hachés et salés (PBKDF2) ; limitation '
        + 'des tentatives de connexion ; double authentification des comptes de la mairie (code par email sur tout nouvel appareil) ; HTTPS ; accès au backoffice réservé à l\'éditeur et à son assistant, tenus à la confidentialité, '
        + 'avec double authentification quotidienne (code par email) et journal des actions ; fichiers et documents signés dans des espaces de stockage UE, les documents signés sans adresse publique.';
      feuille.innerHTML = `
        <header>
          <div>
            <div class="marque">Plateforme-Agora</div>
            <div class="emetteur">Léandre Sallé, entrepreneur individuel${editeur.entreprise_siret ? ' · SIRET ' + echapper(editeur.entreprise_siret) : ''}<br>
              ${echapper(editeur.entreprise_adresse || '')} ${echapper(editeur.entreprise_cp_ville || '')}<br>
              ${echapper(editeur.entreprise_email || 'contact@plateforme-agora.fr')}${editeur.entreprise_telephone ? ' · ' + echapper(editeur.entreprise_telephone) : ''}</div>
          </div>
          <div class="titre-doc">
            <h1>Registre des traitements</h1>
            <div class="numero">Article 30 du RGPD</div>
            <div class="numero">Édité le ${dateFr(new Date().toISOString())}</div>
          </div>
        </header>
        <p class="preuve-intro">Délégué à la protection des données : non désigné (non obligatoire au regard de l'article 37 du RGPD :
          ni autorité publique, ni suivi régulier et systématique à grande échelle, ni données sensibles). Contact pour toute question :
          ${echapper(editeur.entreprise_email || 'contact@plateforme-agora.fr')}.</p>

        <h2 class="dossier-titre" style="font-size:17px;margin-top:26px">Partie 1 — Traitements dont l'éditeur est responsable (article 30.1)</h2>
        ${fiche('1. Espaces citoyens (communes dont la mairie n\'a pas adopté l\'espace)', [
          ['Finalité', 'Permettre aux habitants d\'échanger et de s\'informer avant l\'adoption de l\'espace par leur mairie'],
          ['Base légale', 'Consentement à l\'inscription (6.1.a) ; intérêt légitime pour la protection anti-robot (6.1.f)'],
          ['Personnes', 'Habitants inscrits (' + Number(nb_espaces_citoyens || 0).toLocaleString('fr-FR') + ' espaces citoyens ouverts)'],
          ['Données', 'Identité, email, contenus publiés, position ponctuelle si autorisée, données techniques de connexion'],
          ['Destinataires', 'Autres habitants (contenus publiés) ; sous-traitants : ' + SOUS_TRAITANTS],
          ['Durées', 'Tant que le compte existe ; anonymisation à la suppression du compte, ou après 3 ans sans connexion (email '
            + 'd\'avertissement 30 jours avant) ; contenus éphémères purgés automatiquement. '
            + 'À l\'adoption par la mairie, celle-ci devient responsable du traitement.'],
          ['Transferts', TRANSFERTS], ['Sécurité', SECURITE],
        ])}
        ${fiche('2. Comptes Explorateurs (visiteurs de passage)', [
          ['Finalité', 'Jouer aux chasses au trésor et énigmes photo des villages'],
          ['Base légale', 'Consentement à l\'inscription (6.1.a)'],
          ['Personnes', 'Touristes et visiteurs inscrits'],
          ['Données', 'Prénom, nom, email, réussites et points, position ponctuelle lors de la validation d\'une étape'],
          ['Destinataires', 'Communes visitées (nom selon le réglage d\'affichage, dans les classements) ; sous-traitants : ' + SOUS_TRAITANTS],
          ['Durées', 'Anonymisation après 12 mois sans connexion ; comptes jamais utilisés supprimés après 30 jours'],
          ['Transferts', TRANSFERTS], ['Sécurité', SECURITE],
        ])}
        ${fiche('3. Prospection et relation avec les mairies', [
          ['Finalité', 'Présenter le service aux communes, suivre les échanges (appels, emails, demandes du site)'],
          ['Base légale', 'Intérêt légitime à la prospection auprès de collectivités (6.1.f)'],
          ['Personnes', 'Maires, élus et agents de mairie ; personnes ayant rempli le formulaire du site'],
          ['Données', 'Nom, civilité et fonction, email et téléphone professionnels de la mairie, notes d\'échange, '
            + 'ouvertures et clics des emails de prospection. Source : annuaires publics (dont service-public.fr) et formulaire du site'],
          ['Destinataires', 'Éditeur et son assistant ; sous-traitants : Supabase, Resend, Cloudflare'],
          ['Durées', '3 ans après le dernier échange si la commune ne devient pas cliente ; désinscription des emails respectée immédiatement'],
          ['Transferts', TRANSFERTS], ['Sécurité', SECURITE],
        ])}
        ${fiche('4. Gestion des communes clientes (conventions, devis, factures, preuves d\'acceptation)', [
          ['Finalité', 'Conclure et exécuter les contrats, facturer, prouver l\'acceptation des conditions et de l\'accord de sous-traitance'],
          ['Base légale', 'Exécution du contrat (6.1.b) ; obligation légale comptable (6.1.c) ; intérêt légitime à la preuve (6.1.f)'],
          ['Personnes', 'Signataires et contacts des communes ; personnes ayant accepté les CGU au nom d\'une commune'],
          ['Données', 'Nom, fonction, coordonnées professionnelles, signatures ; pour les acceptations : date, adresse IP, navigateur'],
          ['Destinataires', 'Éditeur ; Chorus Pro (factures) ; sous-traitants : Supabase, Cloudflare, Resend'],
          ['Durées', 'Pièces comptables : 10 ans (article L123-22 du Code de commerce) ; contrats et preuves d\'acceptation : '
            + 'durée de la relation + 5 ans (prescription, article 2224 du Code civil)'],
          ['Transferts', TRANSFERTS], ['Sécurité', SECURITE],
        ])}

        <h2 class="dossier-titre annexe-cgu" style="font-size:17px">Partie 2 — Traitements effectués pour le compte des communes (article 30.2)</h2>
        ${fiche('Catégories de traitements', [
          ['Responsables du traitement', 'Les ' + communes.length + ' communes dont l\'espace est officiel (liste ci-dessous)'],
          ['Traitements', 'Hébergement et fonctionnement de l\'application citoyenne : information municipale (actualités, agenda, alertes), '
            + 'comptes des habitants, signalements, modération et, selon les modules activés, sondages, entraide, annuaire, jeux, patrimoine'],
          ['Cadre', 'Article 10 des conditions générales d\'utilisation (accord de sous-traitance), et contrat signé pour les communes en convention'],
          ['Sous-traitants ultérieurs', SOUS_TRAITANTS],
          ['Transferts', TRANSFERTS], ['Sécurité', SECURITE],
        ])}
        <table class="lignes preuve">
          <thead><tr><th>N°</th><th>Commune (responsable du traitement)</th><th>Département</th><th>DPO de la commune</th></tr></thead>
          <tbody>${communes.map((cm, i) => `<tr><td>${i + 1}</td><td>${echapper(cm.nom)}</td><td>${echapper(cm.departement || '')}</td>
            <td>${cm.dpo ? echapper(cm.dpo) : '<span class="preuve-tech">non renseigné</span>'}</td></tr>`).join('')}</tbody>
        </table>
        <footer>Plateforme-Agora — Léandre Sallé, entrepreneur individuel · Registre à présenter à la CNIL sur demande (article 30.4).</footer>
      `;
    } catch (e) {
      feuille.textContent = 'Impossible de charger le registre : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  // Attestation d'acceptation des CGU + accord de sous-traitance RGPD (?type=preuve-cgu&id=<commune_id>) :
  // journal des acceptations (backoffice/preuves-cgu.ts, migration 108) + texte exact accepté en annexe,
  // dont l'empreinte SHA-256 est recalculée ici à l'ouverture (contrôle que l'archive n'a pas bougé).
  if (type === 'preuve-cgu') {
    try {
      const { commune, acceptations, versions } = await boFetch('/preuves-cgu/' + id);
      document.title = 'Attestation CGU et sous-traitance RGPD — ' + commune.nom + ' — Backoffice Plateforme-Agora';
      const dateHeure = (s) => new Date(s).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Paris' });
      const versionFr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? dateFr(v + 'T12:00:00') : echapper(v);
      const ROLES = { maire: 'Maire', elu: 'Élu(e)', admin: 'Administrateur (mairie)', superadmin: 'Éditeur (superadmin)' };
      const sha256 = async (texte) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)))]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      // Texte archivé : notre propre page, rendue sans scripts ni styles ni attributs d'événement.
      const texteLisible = (html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, link, meta, noscript, iframe, object, embed, .retour').forEach((n) => n.remove());
        doc.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => {
          if (/^on/i.test(a.name) || a.name === 'style') n.removeAttribute(a.name);
        }));
        return doc.body.innerHTML;
      };
      const numeroAnnexe = Object.fromEntries(versions.map((v, i) => [v.empreinte_sha256, i + 1]));
      const verifications = await Promise.all(versions.map(async (v) => (await sha256(v.texte_html)) === v.empreinte_sha256));

      feuille.innerHTML = `
        <header>
          <div>
            <div class="marque">Plateforme-Agora</div>
            <div class="emetteur">Léandre Sallé, entrepreneur individuel<br>contact@plateforme-agora.fr</div>
          </div>
          <div class="titre-doc">
            <h1>Attestation d'acceptation</h1>
            <div class="numero">CGU et accord de sous-traitance RGPD</div>
            <div class="numero">Commune de ${echapper(commune.nom)}</div>
          </div>
        </header>
        <p class="preuve-intro">L'éditeur de Plateforme-Agora atteste que les personnes ci-dessous, disposant d'un compte
          d'administration de l'espace de la commune de <b>${echapper(commune.nom)}</b> (plateforme-agora.fr/${echapper(commune.slug)}),
          ont accepté en ligne, au nom de la commune, les conditions générales d'utilisation du service. Leur article 10
          constitue l'accord de sous-traitance de données personnelles prévu à l'article 28 du RGPD, conclu sous forme
          électronique comme l'admet l'article 28.9, y compris lorsque le service est gratuit.</p>
        <p class="preuve-intro">Chaque acceptation résulte soit d'une case cochée puis d'un clic sur « Continuer » dans
          l'application, après connexion personnelle au compte, soit d'un clic sur le bouton « J'accepte au nom de la commune,
          en qualité de maire » d'une page ouverte depuis un lien personnel à usage unique, envoyé à l'adresse email de la
          mairie. Elle est horodatée par le serveur, conservée dans un journal
          qu'aucune fonction du service ne permet de modifier, et rattachée au texte exact servi à cet instant (annexes).</p>
        ${acceptations.length ? '' : '<div class="preuve-alerte">Aucune acceptation enregistrée pour cette commune à ce jour. Elle sera demandée au premier compte mairie qui ouvrira l\'application.</div>'}
        <table class="lignes preuve">
          <thead><tr><th>N°</th><th>Date et heure (Paris)</th><th>Personne</th><th>Texte accepté</th><th>Données techniques</th></tr></thead>
          <tbody>
            ${acceptations.map((a, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${dateHeure(a.created_at)}</td>
                <td><b>${echapper(a.nom_affiche || 'Compte anonymisé')}</b><br>${echapper(a.email || '')}<br>${echapper(ROLES[a.role] || a.role)}
                  <br><span class="preuve-tech">${a.canal === 'lien_mairie' ? 'Par le lien personnel envoyé à cette adresse de la mairie' : 'Dans l\'application, compte connecté'}</span></td>
                <td>CGU, version du ${versionFr(a.version)}<br>${a.empreinte_sha256 ? 'Annexe ' + numeroAnnexe[a.empreinte_sha256] : '<span class="preuve-tech">texte non archivé (site injoignable à cet instant)</span>'}</td>
                <td class="preuve-tech">IP : ${echapper(a.ip || 'inconnue')}<br>${echapper(a.user_agent || '')}
                  <br>${a.accuse_email_id ? 'Accusé de réception envoyé à ' + echapper(a.accuse_envoye_a) + ' (réf. ' + echapper(a.accuse_email_id) + ')' : 'Accusé de réception : non envoyé'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="mentions">
          <p>Attestation établie le ${dateHeure(new Date().toISOString())} depuis le backoffice de Plateforme-Agora.</p>
          <p>L'empreinte SHA-256 d'une annexe identifie son texte de façon unique : toute modification, même d'un caractère,
            la change. Elle est recalculée à chaque édition de cette attestation et comparée à celle enregistrée au moment de l'acceptation.</p>
        </div>
        ${versions.map((v, i) => `
          <section class="annexe-cgu">
            <h2 class="dossier-titre">Annexe ${i + 1} — Conditions générales d'utilisation, version du ${versionFr(v.version)}</h2>
            <p class="preuve-tech">Archivée le ${dateHeure(v.created_at)} depuis ${echapper(v.url_source)}</p>
            <p class="preuve-tech">Empreinte SHA-256 : <span class="preuve-empreinte">${echapper(v.empreinte_sha256)}</span>
              — ${verifications[i] ? '✔ vérifiée : le texte ci-dessous est identique à celui accepté' : '✘ ÉCART : le texte archivé ne correspond plus à son empreinte'}</p>
            <div class="texte">${texteLisible(v.texte_html)}</div>
          </section>`).join('')}
        <footer>Plateforme-Agora — Léandre Sallé, entrepreneur individuel · Document de preuve, à conserver avec le dossier de la commune.</footer>
      `;
    } catch (e) {
      feuille.textContent = 'Impossible de charger l\'attestation : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  // Page de garde du dossier papier d'une commune (?type=dossier&id=<commune_id>) : identité, abonnement
  // et sommaire des documents signés archivés (backoffice/documents-commune.ts), avec une case à cocher
  // par pièce pour suivre ce qui est déjà classé dans le classeur.
  if (type === 'dossier') {
    try {
      const [{ commune }, { documents, types }] = await Promise.all([
        boFetch('/administration/communes/' + id),
        boFetch('/documents/communes/' + id),
      ]);
      document.title = 'Dossier — ' + commune.nom + ' — Backoffice Plateforme-Agora';
      const ligne = (lib, val) => val ? `<tr><th>${lib}</th><td>${echapper(String(val))}</td></tr>` : '';
      const pieces = [...documents].sort((a, b) => (a.signe_le || a.created_at).localeCompare(b.signe_le || b.created_at));
      feuille.innerHTML = `
        <header>
          <div>
            <div class="marque">Plateforme-Agora</div>
            <div class="emetteur">Dossier commune — document interne, confidentiel</div>
          </div>
          <div class="titre-doc">
            <h1>${echapper(commune.nom)}</h1>
            <div class="numero">Imprimé le ${dateFr(new Date().toISOString())}</div>
          </div>
        </header>
        <div class="meta dossier-blocs">
          <table class="dossier-fiche">
            <caption>Commune</caption>
            ${ligne('Application', 'plateforme-agora.fr/' + commune.slug)}
            ${ligne('Population', commune.population ? commune.population.toLocaleString('fr-FR') + ' habitants' : '')}
            ${ligne('Email', commune.email_mairie || commune.contact_email)}
            ${ligne('Téléphone', commune.telephone_mairie)}
          </table>
          <table class="dossier-fiche">
            <caption>Abonnement</caption>
            ${ligne('Forfait', commune.forfait)}
            ${ligne('Formule', commune.formule)}
            ${ligne('Statut', { active: 'Active', suspendue: 'Suspendue', resiliee: 'Résiliée' }[commune.statut_client] || commune.statut_client)}
            ${ligne('Cliente depuis', dateFr(commune.created_at))}
            ${ligne('Prochaine échéance', commune.prochaine_echeance ? dateFr(commune.prochaine_echeance) : '')}
          </table>
        </div>
        <h2 class="dossier-titre">Sommaire des pièces</h2>
        <table class="lignes">
          <thead><tr><th>N°</th><th>Pièce</th><th>Signée le</th><th>Archivée le</th><th>Classée</th></tr></thead>
          <tbody>
            ${pieces.length ? pieces.map((d, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><b>${echapper(types[d.type] || d.type)}</b>${d.libelle ? `<br><span style="color:var(--gris);font-size:12.5px">${echapper(d.libelle)}</span>` : ''}</td>
                <td>${d.signe_le ? dateFr(d.signe_le) : '—'}</td>
                <td>${dateFr(d.created_at)}</td>
                <td class="case">☐</td>
              </tr>`).join('') : '<tr><td colspan="5" style="color:var(--gris)">Aucune pièce archivée dans le backoffice pour l’instant.</td></tr>'}
            <tr><td></td><td style="color:var(--gris)">Autre pièce : ………………………………………</td><td></td><td></td><td class="case">☐</td></tr>
          </tbody>
        </table>
        <h2 class="dossier-titre">Notes</h2>
        <div class="dossier-notes"></div>
        <footer>Plateforme-Agora — Léandre Sallé · Dossier confidentiel : contient des engagements contractuels et des données de la commune.</footer>
      `;
    } catch (e) {
      feuille.textContent = 'Impossible de charger le dossier : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  if (type === 'contrat-dpa') {
    try {
      await initContratDpa(id);
    } catch (e) {
      feuille.textContent = 'Impossible de charger le contrat : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  // Contrat DPA + panneau « Informations à compléter » : chaque trou du document ([● …],
  // span.a-completer[data-champ]) correspond à un champ du panneau. Seuls les champs modifiés
  // sont enregistrés : un champ laissé tel quel continue de suivre sa source (convention,
  // annuaire…). Valeurs posées via .value, jamais injectées en HTML.
  async function initContratDpa(communeId) {
    const AIDES = {
      habilitation: "Ce qui autorise le signataire : délibération du conseil, ou délégation générale du maire.",
      telephone_alerte: 'Appelé en cas de fuite de données (article 10), en plus du courriel.',
      dpo: 'Obligatoire pour une commune : souvent le DPO mutualisé du centre de gestion (CDG) ou de l\'intercommunalité.',
      dpa_plafond_responsabilite: 'Montant minimum de votre responsabilité (article 17.2), en euros.',
      entreprise_siret: 'Valable pour toutes les communes, comme les champs suivants.',
    };
    const RACCOURCIS_HABILITATION = [
      ['Délibération', 'la délibération n° … du …'],
      ['Délégation L2122-22', "la délégation consentie par le conseil municipal en application de l'article L2122-22 du CGCT"],
    ];
    const panneau = document.createElement('aside');
    panneau.className = 'panneau';
    panneau.setAttribute('aria-label', 'Informations à compléter');
    document.body.insertBefore(panneau, feuille);
    document.body.classList.add('avec-panneau');
    let manquants = 0;
    let initiales = {};

    const boutonImprimer = document.querySelector('.barre-actions .btn:not(.btn--sec)');
    boutonImprimer.onclick = () => {
      if (manquants && !confirm(`Il reste ${manquants} information(s) à compléter (en rouge). Imprimer quand même ?`)) return;
      window.print();
    };

    const surligner = (cle) => {
      feuille.querySelectorAll('.a-completer.actif').forEach((s) => s.classList.remove('actif'));
      const cibles = feuille.querySelectorAll(`.a-completer[data-champ="${cle}"]`);
      cibles.forEach((s) => s.classList.add('actif'));
      if (cibles[0]) cibles[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    feuille.addEventListener('click', (e) => {
      const trou = e.target.closest('.a-completer');
      const champ = trou && panneau.querySelector(`[name="${trou.dataset.champ}"]`);
      if (!champ) return;
      champ.focus();
      surligner(champ.name);
      champ.classList.remove('flash'); void champ.offsetWidth; champ.classList.add('flash');
    });

    const dessiner = (champs) => {
      const bloc = (groupe, titre) => `<h3>${titre}</h3>` + champs.filter((ch) => ch.groupe === groupe).map((ch) => `
        <div class="champ${ch.valeur ? '' : ' vide'}">
          <label for="dpa-${ch.cle}"><span><span class="point"></span>${echapper(ch.libelle)}</span>${ch.source ? `<span class="source">repris : ${echapper(ch.source)}</span>` : ''}</label>
          ${ch.cle === 'dpa_assurance'
            ? `<select id="dpa-${ch.cle}" name="${ch.cle}"><option value="">— à choisir —</option><option value="titulaire">Déjà souscrite</option><option value="engagement">À souscrire (engagement)</option></select>`
            : `<input id="dpa-${ch.cle}" name="${ch.cle}" type="text" maxlength="300" autocomplete="off"${ch.cle === 'dpa_plafond_responsabilite' ? ' inputmode="numeric" placeholder="ex. 10 000"' : ''}>`}
          ${ch.cle === 'habilitation' ? `<div class="raccourcis">${RACCOURCIS_HABILITATION.map(([lib], i) => `<button type="button" data-raccourci="${i}">${lib}</button>`).join('')}</div>` : ''}
          ${AIDES[ch.cle] ? `<div class="aide">${AIDES[ch.cle]}</div>` : ''}
        </div>`).join('');
      panneau.innerHTML = `
        <div class="panneau__tete">
          <h2>Informations à compléter</h2>
          <span class="pastille ${manquants ? 'pastille--manque' : 'pastille--ok'}">${manquants ? `● ${manquants} manquante${manquants > 1 ? 's' : ''}` : '✓ Contrat complet'}</span>
        </div>
        <form class="panneau__corps" novalidate>
          ${bloc('commune', 'La commune')}
          ${bloc('prestataire', 'Vous (Prestataire)')}
        </form>
        <div class="panneau__pied">
          <button type="button" class="btn" id="dpa-enregistrer">Enregistrer</button>
          <div class="panneau__message" role="status"></div>
        </div>`;
      initiales = {};
      for (const ch of champs) { panneau.querySelector(`[name="${ch.cle}"]`).value = ch.valeur; initiales[ch.cle] = ch.valeur; }
      panneau.querySelectorAll('input, select').forEach((el) => {
        el.addEventListener('focus', () => surligner(el.name));
        el.addEventListener('input', () => el.closest('.champ').classList.toggle('vide', !el.value.trim()));
      });
      panneau.querySelectorAll('[data-raccourci]').forEach((b) => b.addEventListener('click', () => {
        const champ = panneau.querySelector('[name="habilitation"]');
        champ.value = RACCOURCIS_HABILITATION[b.dataset.raccourci][1];
        champ.dispatchEvent(new Event('input'));
        champ.focus();
        const pos = champ.value.indexOf('…');
        if (pos >= 0) champ.setSelectionRange(pos, pos + 1);
      }));
      panneau.querySelector('#dpa-enregistrer').addEventListener('click', enregistrer);
      panneau.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); enregistrer(); });
    };

    const charger = async () => {
      const d = await boFetch('/administration/contrat-dpa/' + communeId);
      document.title = 'Contrat DPA — ' + d.commune_nom + ' — Backoffice Plateforme-Agora';
      feuille.innerHTML = d.html;
      manquants = d.manquants;
      dessiner(d.champs);
    };

    async function enregistrer() {
      const message = panneau.querySelector('.panneau__message');
      const corps = {};
      panneau.querySelectorAll('input, select').forEach((el) => {
        if (el.value.trim() !== (initiales[el.name] || '')) corps[el.name] = el.value.trim();
      });
      if (!Object.keys(corps).length) { message.className = 'panneau__message'; message.textContent = 'Aucune modification.'; return; }
      const bouton = panneau.querySelector('#dpa-enregistrer');
      bouton.disabled = true;
      try {
        await boFetch('/administration/contrat-dpa/' + communeId, { method: 'PUT', body: JSON.stringify(corps) });
        const y = window.scrollY;
        await charger();
        window.scrollTo(0, y);
        const m = panneau.querySelector('.panneau__message');
        m.className = 'panneau__message ok';
        m.textContent = manquants ? 'Enregistré.' : 'Enregistré — le contrat est complet.';
      } catch (e) {
        message.className = 'panneau__message erreur';
        message.textContent = e.message || "L'enregistrement a échoué.";
        bouton.disabled = false;
      }
    }

    await charger();
  }

  let entreprise, doc;
  try {
    entreprise = (await boFetch('/administration/parametres-entreprise')).parametres;
    const chemin = type === 'facture' ? '/administration/factures/' + id : '/administration/devis/' + id;
    doc = (await boFetch(chemin))[type];
  } catch (e) {
    feuille.textContent = 'Impossible de charger le document : ' + (e.message || 'erreur inconnue');
    return;
  }

  document.title = `${type === 'facture' ? 'Facture' : 'Devis'} ${doc.numero} — Backoffice Plateforme-Agora`;

  const montantTva = doc.montant_ttc - doc.montant_ht;
  const ligneTva = doc.taux_tva > 0
    ? `<tr><td class="lib">TVA (${doc.taux_tva}&nbsp;%)</td><td class="val">${euros(montantTva)}</td></tr>`
    : '';

  const mentionsCommunes = `
    <p><strong>${echapper(entreprise.entreprise_raison_sociale)}</strong>${entreprise.entreprise_forme_juridique ? ' — ' + echapper(entreprise.entreprise_forme_juridique) : ''} —
    SIRET&nbsp;: ${echapper(entreprise.entreprise_siret) || '—'}</p>
    <p>${echapper(entreprise.entreprise_adresse)}${entreprise.entreprise_adresse ? ', ' : ''}${echapper(entreprise.entreprise_cp_ville)}</p>
    <p>${echapper(entreprise.entreprise_mention_tva) || 'TVA non applicable, art. 293 B du CGI'}</p>`;

  const blocDroite = type === 'facture'
    ? `<div class="meta__bloc" style="text-align:right">
         <b>Date d'émission</b>${dateFr(doc.date_emission)}<br /><br />
         <b>Date d'échéance</b>${dateFr(doc.date_echeance)}
       </div>`
    : `<div class="meta__bloc" style="text-align:right">
         <b>Date</b>${dateFr(doc.created_at)}<br /><br />
         <b>Validité</b>${doc.validite_jours} jours
       </div>`;

  const mentionsBas = type === 'facture'
    ? `<p><strong>Conditions de règlement</strong> — paiement à réception, délai de ${echapper(entreprise.entreprise_delai_paiement_jours) || '30'} jours à compter de la date d'émission.</p>
       <p><strong>Pénalités de retard</strong> — ${echapper(entreprise.entreprise_taux_penalites) || 'taux légal en vigueur'} ; indemnité forfaitaire pour frais de recouvrement de 40&nbsp;€ en cas de retard de paiement.</p>
       ${entreprise.entreprise_iban ? `<p><strong>Règlement</strong> — IBAN&nbsp;: ${echapper(entreprise.entreprise_iban)}${entreprise.entreprise_bic ? ' · BIC : ' + echapper(entreprise.entreprise_bic) : ''}</p>` : ''}
       <p>Facture adressée à une administration publique : dépôt sur Chorus Pro requis en complément de ce document.</p>`
    : `<p>Devis valable ${doc.validite_jours} jours à compter de sa date d'émission. Bon pour accord à retourner signé, ou par bon de commande.</p>`;

  const signature = type === 'devis'
    ? `<div class="signature"><div class="signature__bloc"><b>Bon pour accord</b>Date et signature</div></div>`
    : '';

  feuille.innerHTML = `
    <header>
      <div>
        <div class="marque">Plateforme-Agora</div>
        <div class="emetteur">
          ${echapper(entreprise.entreprise_raison_sociale)}<br />
          ${echapper(entreprise.entreprise_adresse)}<br />
          ${echapper(entreprise.entreprise_cp_ville)}<br />
          SIRET ${echapper(entreprise.entreprise_siret) || '—'}<br />
          ${echapper(entreprise.entreprise_email)} ${entreprise.entreprise_telephone ? '· ' + echapper(entreprise.entreprise_telephone) : ''}
        </div>
      </div>
      <div class="titre-doc">
        <h1>${type === 'facture' ? 'FACTURE' : 'DEVIS'}</h1>
        <div class="numero">N° ${echapper(doc.numero)}</div>
      </div>
    </header>

    <div class="meta">
      <div class="dest">
        <b>${echapper(doc.nom_destinataire)}</b>
        <span>${echapper(doc.adresse_destinataire) || ''}</span>
      </div>
      ${blocDroite}
    </div>

    <table class="lignes">
      <thead><tr><th>Désignation</th><th class="montant">Montant HT</th></tr></thead>
      <tbody>
        <tr><td>${echapper(doc.objet)}${doc.duree_engagement_mois ? `<br /><span style="color:var(--gris);font-size:12px">Engagement ${doc.duree_engagement_mois} mois</span>` : ''}</td><td class="montant">${euros(doc.montant_ht)}</td></tr>
      </tbody>
    </table>

    <div class="totaux">
      <table>
        <tr><td class="lib">Total HT</td><td class="val">${euros(doc.montant_ht)}</td></tr>
        ${ligneTva}
        <tr class="total"><td class="lib">Total ${type === 'facture' ? 'à payer' : ''} TTC</td><td class="val">${euros(doc.montant_ttc)}</td></tr>
      </table>
    </div>

    ${signature}

    <div class="mentions">
      ${mentionsCommunes}
      ${mentionsBas}
    </div>

    <footer>${echapper(entreprise.entreprise_raison_sociale)} · plateforme-agora.fr</footer>
  `;
})();
