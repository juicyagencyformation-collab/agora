// worker/src/lib/regions.ts
// Région administrative (découpage 2016) à partir du code département, pour cibler les annonces
// de la plateforme. Le département d'une commune vient de communes.departement, à défaut de la
// fiche prospect liée (beaucoup de communes activées par la prospection n'ont que celui-là).
import { supabaseSelect } from '../db';

const DEPARTEMENTS_PAR_REGION: Record<string, string[]> = {
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Bretagne': ['22', '29', '35', '56'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Corse': ['2A', '2B', '20'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
  'Guadeloupe': ['971'],
  'Martinique': ['972'],
  'Guyane': ['973'],
  'La Réunion': ['974'],
  'Mayotte': ['976'],
};

export const REGIONS = Object.keys(DEPARTEMENTS_PAR_REGION);

export function regionDuDepartement(departement: unknown): string | null {
  if (departement === null || departement === undefined) return null;
  let code = String(departement).trim().toUpperCase();
  if (/^\d$/.test(code)) code = '0' + code;
  for (const [region, codes] of Object.entries(DEPARTEMENTS_PAR_REGION)) if (codes.includes(code)) return region;
  return null;
}

export async function regionDeLaCommune(env: any, commune_id: string): Promise<string | null> {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'departement', id: `eq.${commune_id}` });
  if (commune?.departement) return regionDuDepartement(commune.departement);
  const [prospect] = await supabaseSelect(env, 'prospects', { select: 'departement', commune_id: `eq.${commune_id}`, limit: '1' });
  return regionDuDepartement(prospect?.departement);
}
