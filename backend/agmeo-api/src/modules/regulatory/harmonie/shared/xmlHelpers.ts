/**
 * Shared XML serialization helpers for ENNI/ENDO exports
 *
 * Every Dube2.5 complex type is an `xsd:all` group, so child order is free.
 * Format-specific XML builders (buildSchlagXml, buildAnbauXml) stay in each
 * format's builder.ts; everything identical between the dialects lives here.
 */

import type xml from 'xml';

import type {
  Adresse,
  Betrieb,
  Betriebsdaten,
  Bodenuntersuchung,
  Duenger,
  Duengung,
} from '../types.js';
import { formatExportDecimal } from '../utils.js';
import type { N170Model } from './n170Builder.js';
import type { N170Transfer } from './n170Types.js';

type DuengebedarfBase = {
  bezugsjahr: string;
  duengejahrbeginn: string;
  betriebsdaten: Betriebsdaten;
  schlaege: unknown[];
};

export function buildBetriebXml(betrieb: Betrieb): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    { betriebsnummer: betrieb.betriebsnummer },
  ];

  const hasAnsprechpartner =
    betrieb.ansprechpartner?.adresse &&
    Object.values(betrieb.ansprechpartner.adresse).some((v) => v);
  children.push(
    hasAnsprechpartner
      ? {
          ansprechpartner: [
            { adresse: buildAdresseXml(betrieb.ansprechpartner!.adresse!) },
          ],
        }
      : { ansprechpartner: '' },
  );

  const hasBetriebsstaette =
    betrieb.betriebsstaette?.adresse &&
    Object.values(betrieb.betriebsstaette.adresse).some((v) => v);
  children.push(
    hasBetriebsstaette
      ? {
          betriebsstaette: [
            { adresse: buildAdresseXml(betrieb.betriebsstaette!.adresse!) },
          ],
        }
      : { betriebsstaette: '' },
  );

  return children;
}

function buildAdresseXml(adresse: Adresse): xml.XmlObject[] {
  const children: xml.XmlObject[] = [];

  if (adresse.email) children.push({ email: adresse.email });
  if (adresse.faxnummer) children.push({ faxnummer: adresse.faxnummer });
  if (adresse.firma) children.push({ firma: adresse.firma });
  if (adresse.mobilnummer) children.push({ mobilnummer: adresse.mobilnummer });
  if (adresse.nachname) children.push({ nachname: adresse.nachname });
  if (adresse.ort) children.push({ ort: adresse.ort });
  if (adresse.plz) children.push({ plz: adresse.plz });
  if (adresse.strasse) children.push({ strasse: adresse.strasse });
  if (adresse.telefonnummer)
    children.push({ telefonnummer: adresse.telefonnummer });
  if (adresse.vorname) children.push({ vorname: adresse.vorname });

  return children;
}

export function buildDuengebedarfXml(
  duengebedarf: DuengebedarfBase,
  buildSchlagXml: (schlag: never) => xml.XmlObject[],
): xml.XmlObject[] {
  const betriebsdatenChildren: xml.XmlObject[] = [
    {
      'andere-duenger-ausgebracht':
        duengebedarf.betriebsdaten['andere-duenger-ausgebracht'],
    },
    {
      'kompost-ausgebracht': duengebedarf.betriebsdaten['kompost-ausgebracht'],
    },
    {
      'duengungs-oder-beweidungseinschraenkungen':
        duengebedarf.betriebsdaten['duengungs-oder-beweidungseinschraenkungen'],
    },
  ];

  if (duengebedarf.betriebsdaten['oekologisch-zertifiziert'] !== undefined) {
    betriebsdatenChildren.push({
      'oekologisch-zertifiziert':
        duengebedarf.betriebsdaten['oekologisch-zertifiziert'],
    });
  }

  return [
    { bezugsjahr: duengebedarf.bezugsjahr },
    { duengejahrbeginn: duengebedarf.duengejahrbeginn },
    { betriebsdaten: betriebsdatenChildren },
    {
      schlaege: duengebedarf.schlaege.map((s) => ({
        schlag: buildSchlagXml(s as never),
      })),
    },
  ];
}

export function buildDuengungXml(duengung: Duengung): xml.XmlObject[] {
  const children: xml.XmlObject[] = [{ aufbringdatum: duengung.aufbringdatum }];

  if (duengung['duenger-bezeichnung'] !== undefined) {
    children.push({ 'duenger-bezeichnung': duengung['duenger-bezeichnung'] });
  }

  children.push({
    'duenger-bezeichnung-betrieb': duengung['duenger-bezeichnung-betrieb'],
  });
  children.push({ naehrstofftraegerart: duengung.naehrstofftraegerart });
  children.push({
    'menge-in-einheit-naehrstofftraeger-pro-ha':
      duengung['menge-in-einheit-naehrstofftraeger-pro-ha'],
  });

  if (duengung.mistduengung !== undefined) {
    children.push({ mistduengung: duengung.mistduengung });
  }

  return children;
}

export function buildBodenuntersuchungXml(
  sample: Bodenuntersuchung,
): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    { analysedatum: sample.analysedatum },
    { analysenr: sample.analysenr },
    { bodenartgruppe: sample.bodenartgruppe },
    { humusklasse: sample.humusklasse },
  ];
  const optional: (keyof Bodenuntersuchung)[] = [
    'gehalt-p',
    'gehalt-p2o5',
    'gehalt-k',
    'gehalt-k2o',
    'gehalt-mg',
    'gehalt-mgo',
    'humusgehalt',
    'ph-wert',
    'labor',
  ];
  for (const key of optional) {
    const value = sample[key];
    if (value !== undefined) children.push({ [key]: value });
  }
  return children;
}

/**
 * The two root sections shared by the ENNI and ENDO documents. Only the
 * N-170 block differs between the dialects: ENDO files the dairy yield
 * (Milchleistung), ENNI does not.
 */
export function buildRootSectionsXml(
  model: { dokumentationDerDuengung: Duenger[]; n170: N170Model },
  dialect: 'enni' | 'endo',
): xml.XmlObject[] {
  return [
    {
      'dokumentation-der-duengung': buildDuengerKatalogXml(
        model.dokumentationDerDuengung,
      ),
    },
    { 'n-170-begrenzung': buildN170Xml(model.n170, dialect === 'endo') },
  ];
}

function buildDuengerKatalogXml(duenger: Duenger[]): xml.XmlObject[] {
  return [
    {
      duengemittel: duenger.map((d) => {
        const children: xml.XmlObject[] = [
          { 'duenger-bezeichnung': d['duenger-bezeichnung'] },
          { naehrstofftraegerart: d.naehrstofftraegerart },
          { 'art-der-werte': d['art-der-werte'] },
          { einheit: d.einheit },
          { 'gehalt-P2O5': d['gehalt-P2O5'] },
          { 'gehalt-N-gesamt': d['gehalt-N-gesamt'] },
        ];
        if (d['duenger-bezeichnung-betrieb'])
          children.push({
            'duenger-bezeichnung-betrieb': d['duenger-bezeichnung-betrieb'],
          });
        if (d.dunggruppe) children.push({ dunggruppe: d.dunggruppe });
        if (d.mineralduengergruppe)
          children.push({ mineralduengergruppe: d.mineralduengergruppe });
        if (d['gehalt-NH4']) children.push({ 'gehalt-NH4': d['gehalt-NH4'] });
        if (d['verfuegbar-N'])
          children.push({ 'verfuegbar-N': d['verfuegbar-N'] });
        if (d['anteil-trockensubstanz'])
          children.push({
            'anteil-trockensubstanz': d['anteil-trockensubstanz'],
          });
        return { duenger: children };
      }),
    },
  ];
}

function buildTransferXml(transfer: N170Transfer): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    {
      duenger: [
        { 'duenger-bezeichnung': transfer.duengerBezeichnung },
        { naehrstofftraegerart: transfer.naehrstofftraegerart },
      ],
    },
    { lieferdatum: transfer.lieferdatum },
    { 'beteiligter-betrieb': transfer.beteiligterBetrieb },
    { menge: formatExportDecimal(transfer.menge) },
    { 'gehalt-n-gesamt': formatExportDecimal(transfer.gehaltNGesamt) },
    { 'gehalt-p2o5': formatExportDecimal(transfer.gehaltP2o5) },
  ];
  if (transfer.lieferscheinBezeichnung) {
    children.push({
      'lieferschein-bezeichnung': transfer.lieferscheinBezeichnung.slice(0, 80),
    });
  }
  return children;
}

/** `includeMilchleistung` — only the ENDO XSD knows `milchleistung-kg-ecm`. */
function buildN170Xml(
  model: N170Model,
  includeMilchleistung: boolean,
): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    {
      flaechen: [
        { 'flaeche-ackerbau': model.flaechen['flaeche-ackerbau'] },
        { 'flaeche-gruenland': model.flaechen['flaeche-gruenland'] },
        { 'flaeche-gartenbau': model.flaechen['flaeche-gartenbau'] },
        { 'flaechensumme-n-170': model.flaechen['flaechensumme-n-170'] },
      ],
    },
  ];

  if (model.tierhaltungen.length > 0) {
    children.push({
      tierhaltungen: model.tierhaltungen.map((t) => {
        const tier: xml.XmlObject[] = [
          { 'tier-bezeichnung': t.tierBezeichnung },
          { 'anzahl-tiere': Math.round(t.anzahlTiere) },
        ];
        if (t.weidefaktor !== undefined)
          tier.push({ weidefaktor: formatExportDecimal(t.weidefaktor, 2) });
        if (t.weidetage !== undefined)
          tier.push({ weidetage: Math.round(t.weidetage) });
        if (includeMilchleistung && t.milchleistungKgEcm !== undefined) {
          tier.push({
            'milchleistung-kg-ecm': formatExportDecimal(
              t.milchleistungKgEcm,
              2,
            ),
          });
        }
        return { tierhaltung: tier };
      }),
    });
  }

  if (model.organischeDuengerAufnahmen.length > 0) {
    children.push({
      'organische-duenger-aufnahmen': model.organischeDuengerAufnahmen.map(
        (t) => ({
          'organische-duenger-aufnahme': buildTransferXml(t),
        }),
      ),
    });
  }
  if (model.organischeDuengerAbgaben.length > 0) {
    children.push({
      'organische-duenger-abgaben': model.organischeDuengerAbgaben.map((t) => ({
        'organische-duenger-abgabe': buildTransferXml(t),
      })),
    });
  }
  if (model.hofeigeneBiogasanlage !== undefined) {
    children.push({
      betriebsdaten: [
        { 'hofeigene-biogasanlage': model.hofeigeneBiogasanlage },
      ],
    });
  }

  return children;
}

export function generateExportFilename(
  prefix: string,
  betriebsnummer: string,
  year: number,
): string {
  const sanitized = betriebsnummer.replace(/[^a-zA-Z0-9]/g, '_');
  return `${prefix}_${sanitized}_${year}.xml`;
}

/**
 * Dube2.5 `schlagnummer` per field: the numeric Parzellennummer when it is
 * unique, otherwise the smallest free integer — deterministic for a given
 * field order, so a re-export after fixing one number keeps the others.
 * Fields with a non-numeric or colliding Parzellennummer are reported by the
 * preflight (`schlagnummer_not_integer`, `schlagnummer_duplicate`).
 */
export function assignSchlagnummern(
  fields: { id: string; parcelId: string | null }[],
): Map<string, string> {
  const wanted = fields.map((f) => {
    const numeric = f.parcelId ? parseInt(f.parcelId, 10) : NaN;
    return !isNaN(numeric) && numeric > 0 ? numeric : null;
  });
  const claimed = new Set<number>();
  const assigned = new Map<string, string>();
  fields.forEach((f, i) => {
    const nr = wanted[i];
    if (nr === null || claimed.has(nr)) return;
    claimed.add(nr);
    assigned.set(f.id, nr.toString());
  });
  let next = 1;
  for (const f of fields) {
    if (assigned.has(f.id)) continue;
    while (claimed.has(next)) next += 1;
    claimed.add(next);
    assigned.set(f.id, next.toString());
  }
  return assigned;
}
