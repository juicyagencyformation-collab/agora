// worker/src/db.ts
export async function supabaseSelect(env: any, table: string, filtres: Record<string, string>): Promise<any[]> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ⚠️ Supabase/PostgREST plafonne CHAQUE réponse à 1000 lignes par défaut, quel que soit le
// `limit` demandé dans les filtres — un simple `supabaseSelect(...).length` ment silencieusement
// dès qu'une table dépasse 1000 lignes (piège rencontré sur /administration/apercu et
// /prospection/apercu : les compteurs semblaient "bloqués" à 1000). Pour un total exact, utiliser
// supabaseCount ci-dessous ; pour agréger sur TOUTES les lignes (ex: répartition par statut),
// paginer avec supabaseSelectTout.
export async function supabaseSelectTout(env: any, table: string, filtres: Record<string, string>): Promise<any[]> {
  const page = 1000;
  let offset = 0;
  let tout: any[] = [];
  for (;;) {
    const lignes = await supabaseSelect(env, table, { ...filtres, limit: String(page), offset: String(offset) });
    tout = tout.concat(lignes);
    if (lignes.length < page) break;
    offset += page;
  }
  return tout;
}

// Compte total de lignes correspondant aux filtres, SANS toutes les charger : PostgREST renvoie
// le total dans l'en-tête Content-Range quand on demande Prefer: count=exact + Range 0-0.
export async function supabaseCount(env: any, table: string, filtres: Record<string, string>): Promise<number> {
  const params = new URLSearchParams({ ...filtres, select: 'id' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const contentRange = res.headers.get('content-range'); // ex. "0-0/1234" ou "*/1234"
  const total = contentRange?.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

export async function supabaseInsert(env: any, table: string, donnees: object | object[]): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(donnees),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function supabaseUpdate(env: any, table: string, donnees: object, filtres: Record<string, string>): Promise<any[]> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(donnees),
  });
  if (!res.ok) throw new Error(`Supabase update ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Upsert en masse (un seul aller-retour, quel que soit le nombre de lignes) : insère les lignes
// absentes et MET À JOUR celles dont onConflict (une contrainte UNIQUE) correspond déjà.
// ⚠️ Piège vécu le 2026-08-25 : PostgREST construit ceci en INSERT ... ON CONFLICT DO UPDATE —
// Postgres valide les contraintes NOT NULL de la table AU MOMENT DE CONSTRUIRE CHAQUE LIGNE DE LA
// CLAUSE VALUES, avant même de savoir si elle ira en INSERT ou en UPDATE. Toute colonne NOT NULL
// sans DEFAULT doit donc figurer dans `donnees` avec une valeur non nulle pour CHAQUE ligne — même
// une valeur inchangée récupérée au préalable — sous peine d'échec systématique (23502) sur TOUTES
// les lignes, y compris celles qui auraient dû simplement se mettre à jour. Alternative écartée :
// boucler supabaseUpdate() par ligne — ne viole jamais de contrainte, mais explose le nombre de
// sous-requêtes par invocation Worker dès que le lot dépasse la centaine de lignes.
export async function supabaseUpsert(env: any, table: string, donnees: object[], onConflict: string): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(donnees),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function supabaseDelete(env: any, table: string, filtres: Record<string, string>): Promise<void> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: ${res.status} ${await res.text()}`);
}

// Journal d'activité MINIMAL (migration 043) : uniquement les actions à fort impact (palier
// gratuit rétroactif, grille tarifaire, statut d'une commune, anonymisation RGPD, comptes
// staff, facture soldée...). Ne doit JAMAIS faire échouer l'action réelle si l'écriture du
// journal échoue — best-effort, erreur avalée.
export async function journaliser(env: any, staffId: any, action: string, details?: string): Promise<void> {
  try {
    await supabaseInsert(env, 'journal_activite', { staff_id: staffId, action, details: details || null });
  } catch { /* le journal ne doit jamais bloquer l'action réelle */ }
}

// Événements d'activation (migration 047) : signaux qu'une commune gratuite s'approprie
// réellement l'outil (publication d'article, calendrier déchets rempli, clic sur un module
// verrouillé...), utilisés par la séquence d'onboarding/upsell (voir backoffice/onboarding-drip.ts).
// Même logique que journaliser() : ne doit jamais faire échouer l'action réelle de l'utilisateur.
export async function enregistrerEvenementActivation(env: any, communeId: any, eventType: string): Promise<void> {
  try {
    await supabaseInsert(env, 'activation_events', { commune_id: communeId, event_type: eventType });
  } catch { /* ne doit jamais bloquer l'action réelle */ }
}
