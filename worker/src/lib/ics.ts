// worker/src/lib/ics.ts
interface EventIcs {
  id: string; titre: string; description: string | null;
  lieu: string | null; date_debut: string; date_fin: string;
}

function formatIcsDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function echapperTexte(txt: string): string {
  return txt.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
}

export function genererIcs(event: EventIcs): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agora//FR',
    'BEGIN:VEVENT',
    `UID:${event.id}@plateforme-agora.fr`,
    `DTSTAMP:${formatIcsDate(new Date().toISOString())}`,
    `DTSTART:${formatIcsDate(event.date_debut)}`,
    `DTEND:${formatIcsDate(event.date_fin)}`,
    `SUMMARY:${echapperTexte(event.titre)}`,
    event.description ? `DESCRIPTION:${echapperTexte(event.description)}` : '',
    event.lieu ? `LOCATION:${echapperTexte(event.lieu)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
