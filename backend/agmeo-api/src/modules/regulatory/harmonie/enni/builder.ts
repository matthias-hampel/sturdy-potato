import xml from 'xml';

import {
  buildBodenuntersuchungen,
  sharedAnbauValues,
} from '../shared/anbau.js';
import { ENNI_ENDO_VERSION } from '../shared/defaults.js';
import { buildDuengerKatalog } from '../shared/duengerKatalog.js';
import {
  getFruchtart,
  isGartenbauFruchtart,
} from '../shared/fruchtartCodes.js';
import {
  aussaatterminPhrase,
  classifyCultivations,
  fruchtklasseName,
  kulturfolge,
} from '../shared/fruchtklasse.js';
import { buildN170, getN170Betriebsdaten } from '../shared/n170Builder.js';
import {
  assignSchlagnummern,
  buildBetriebXml,
  buildBodenuntersuchungXml,
  buildDuengebedarfXml,
  buildDuengungXml,
  buildRootSectionsXml,
  generateExportFilename,
} from '../shared/xmlHelpers.js';
import type { Betrieb, Betriebsdaten, ExportData } from '../types.js';
import { formatExportDate, formatExportDecimal } from '../utils.js';
import {
  ENNI_DATENHERKUNFT,
  ENNI_SOFTWARE_HERSTELLER,
  getEffectiveEnniMetadata,
} from './defaults.js';
import type {
  EnniAnbau,
  EnniDuengebedarf,
  EnniDuengung,
  EnniExportModel,
  EnniOrgMetadata,
  EnniSchlag,
  FruchtklasseType,
  NutzungsartType,
} from './types.js';

export function buildEnniFromExportData(
  data: ExportData,
  metadataOverrides?: EnniOrgMetadata,
): EnniExportModel {
  const metadata: EnniOrgMetadata = {
    ...data.integrations.enni,
    ...metadataOverrides,
  };
  const effectiveMetadata = getEffectiveEnniMetadata(metadata);

  const betrieb: Betrieb = {
    betriebsnummer: effectiveMetadata.betriebsnummer,
    ansprechpartner: effectiveMetadata.ansprechpartner,
    betriebsstaette: effectiveMetadata.betriebsstaette,
  };

  const betriebsdaten: Betriebsdaten = {
    'andere-duenger-ausgebracht':
      effectiveMetadata.betriebsdatenOverrides?.[
        'andere-duenger-ausgebracht'
      ] ?? false,
    'kompost-ausgebracht':
      effectiveMetadata.betriebsdatenOverrides?.['kompost-ausgebracht'] ??
      false,
    'duengungs-oder-beweidungseinschraenkungen':
      effectiveMetadata.betriebsdatenOverrides?.[
        'duengungs-oder-beweidungseinschraenkungen'
      ] ?? false,
  };

  if (
    effectiveMetadata.betriebsdatenOverrides?.['oekologisch-zertifiziert'] !==
    undefined
  ) {
    betriebsdaten['oekologisch-zertifiziert'] =
      effectiveMetadata.betriebsdatenOverrides['oekologisch-zertifiziert'];
  }

  const schlaege: EnniSchlag[] = [];
  const schlagnummern = assignSchlagnummern(data.fields);
  const gartenbauFieldIds = new Set<string>();

  for (const field of data.fields) {
    const klassen = classifyCultivations(field.cultivations);
    const folge = kulturfolge(field.cultivations);
    let hasGartenbau = false;

    const anbauten: EnniAnbau[] = field.cultivations.map((cult, cultIdx) => {
      const fruchtart = getFruchtart(
        cult.crop,
        effectiveMetadata.cropCodeOverrides,
      );
      const vorfrucht = cult.previousCrop
        ? getFruchtart(cult.previousCrop, effectiveMetadata.cropCodeOverrides)
        : undefined;
      if (isGartenbauFruchtart(fruchtart?.code)) hasGartenbau = true;

      const duengungen: EnniDuengung[] = cult.fertilizations.map((fert) => ({
        aufbringdatum: formatExportDate(fert.date),
        'duenger-bezeichnung': fert.fertilizerName,
        'duenger-bezeichnung-betrieb': fert.fertilizerName,
        naehrstofftraegerart: fert.naehrstofftraegerart,
        'menge-in-einheit-naehrstofftraeger-pro-ha': formatExportDecimal(
          fert.carrierAmountPerHa,
          4,
        ),
        mistduengung: fert.isMistDuengung,
      }));

      const anbau: EnniAnbau = {
        fruchtklasse: fruchtklasseName(
          klassen[cultIdx],
          'enni',
        ) as FruchtklasseType,
        'lfd-nr': cultIdx + 1,
        bezugszeitraum: data.year.toString(),
        'anbau-im-fremdbetrieb': false,
        kulturfolge: folge[cultIdx],
        ...sharedAnbauValues(cult, field),
      };

      if (fruchtart) {
        anbau.fruchtart = fruchtart.code;
        anbau['fruchtart-bezeichnung'] = fruchtart.bezeichnung;
      }
      if (vorfrucht) anbau.vorfruchtart = vorfrucht.code;

      if (klassen[cultIdx] === 'HERBSTANSAAT' && cult.cropRole !== 'UNDERSOW') {
        const phrase = aussaatterminPhrase(
          cult.sowingDate,
          'enni',
          cult.harvest !== null,
        );
        if (phrase) anbau.aussaattermin = phrase;
      }

      if (duengungen.length > 0) {
        anbau.duengungen = duengungen;
      }

      return anbau;
    });

    const hasGrassland = klassen.includes('GRUENLAND');
    const hasArable = klassen.some((k) => k !== 'GRUENLAND');
    if (hasGartenbau) gartenbauFieldIds.add(field.id);

    const schlag: EnniSchlag = {
      schlagnummer: schlagnummern.get(field.id) ?? '',
      schlagname: field.name,
      bodenklimaraum: effectiveMetadata.bodenklimaraum,
      flaeche: formatExportDecimal(field.areaInHa, 4),
      nutzungsart: enniNutzungsart(hasGrassland, hasArable, hasGartenbau),
      // Rote Gebiete (§13a) are unenforced in 2026; the Kulisse is filed only when the farm opts in.
      'n-kulisse': effectiveMetadata.nKulisse
        ? field.nitrateSensitiveZone
        : false,
      'n-kulisse-alt': false,
      'p-kulisse': false,
      'p-kulisse-alt': false,
    };
    // A Schlag without cultivation is filed as KEINE-AUFZEICHNUNGSPFLICHT and carries no anbauten.
    if (anbauten.length > 0) schlag.anbauten = anbauten;

    if (field.flik && field.flik.length <= 16) {
      schlag.flik = field.flik;
    }

    const bodenuntersuchungen = buildBodenuntersuchungen(field);
    if (bodenuntersuchungen.length > 0)
      schlag.bodenuntersuchungen = bodenuntersuchungen;

    schlaege.push(schlag);
  }

  const duengebedarf: EnniDuengebedarf = {
    bezugsjahr: data.year.toString(),
    duengejahrbeginn: effectiveMetadata.duengejahrbeginn,
    betriebsdaten,
    schlaege,
  };

  return {
    softwarehersteller: ENNI_SOFTWARE_HERSTELLER,
    datenherkunft: ENNI_DATENHERKUNFT,
    betrieb,
    duengebedarf,
    dokumentationDerDuengung: buildDuengerKatalog(data),
    n170: buildN170(data, getN170Betriebsdaten(data), gartenbauFieldIds),
  };
}

function enniNutzungsart(
  hasGrassland: boolean,
  hasArable: boolean,
  hasGartenbau: boolean,
): NutzungsartType {
  if (hasGrassland) return 'GRUENLAND';
  if (hasGartenbau) return hasArable ? 'ACKER-GARTENBAU' : 'GARTENBAU';
  if (hasArable) return 'ACKER';
  return 'KEINE-AUFZEICHNUNGSPFLICHT';
}

export function serializeEnniXml(model: EnniExportModel): string {
  const xmlObj = [
    {
      enni: [
        { _attr: { version: ENNI_ENDO_VERSION } },
        { softwarehersteller: model.softwarehersteller },
        { datenherkunft: model.datenherkunft },
        { betrieb: buildBetriebXml(model.betrieb) },
        {
          duengebedarf: buildDuengebedarfXml(
            model.duengebedarf,
            buildSchlagXml,
          ),
        },
        // Both root sections describe the filed Anbauten — a Düngebedarf without any has neither.
        ...(model.duengebedarf.schlaege.some((s) => s.anbauten)
          ? buildRootSectionsXml(model, 'enni')
          : []),
      ],
    },
  ];

  return xml(xmlObj, { declaration: true, indent: '   ' });
}

function buildSchlagXml(schlag: EnniSchlag): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    { schlagnummer: schlag.schlagnummer },
    { schlagname: schlag.schlagname },
  ];

  if (schlag.bodenklimaraum) {
    children.push({ bodenklimaraum: schlag.bodenklimaraum });
  }

  children.push({ flaeche: schlag.flaeche });

  if (schlag.flik) {
    children.push({ flik: schlag.flik });
  }

  children.push({ nutzungsart: schlag.nutzungsart });

  if (schlag['n-kulisse'] !== undefined) {
    children.push({ 'n-kulisse': schlag['n-kulisse'] });
  }
  if (schlag['n-kulisse-alt'] !== undefined) {
    children.push({ 'n-kulisse-alt': schlag['n-kulisse-alt'] });
  }
  if (schlag['p-kulisse'] !== undefined) {
    children.push({ 'p-kulisse': schlag['p-kulisse'] });
  }
  if (schlag['p-kulisse-alt'] !== undefined) {
    children.push({ 'p-kulisse-alt': schlag['p-kulisse-alt'] });
  }

  if (schlag.bodenuntersuchungen && schlag.bodenuntersuchungen.length > 0) {
    children.push({
      bodenuntersuchungen: schlag.bodenuntersuchungen.map((b) => ({
        bodenuntersuchung: buildBodenuntersuchungXml(b),
      })),
    });
  }

  if (schlag.anbauten) {
    children.push({
      anbauten: schlag.anbauten.map((a) => ({ anbau: buildAnbauXml(a) })),
    });
  }

  return children;
}

function buildAnbauXml(anbau: EnniAnbau): xml.XmlObject[] {
  const children: xml.XmlObject[] = [{ fruchtklasse: anbau.fruchtklasse }];

  if (anbau['anbau-im-fremdbetrieb'] !== undefined) {
    children.push({ 'anbau-im-fremdbetrieb': anbau['anbau-im-fremdbetrieb'] });
  }

  children.push({ 'lfd-nr': anbau['lfd-nr'] });

  if (anbau.fruchtart) {
    children.push({ fruchtart: anbau.fruchtart });
  }
  if (anbau['fruchtart-bezeichnung']) {
    children.push({ 'fruchtart-bezeichnung': anbau['fruchtart-bezeichnung'] });
  }

  children.push({ bezugszeitraum: anbau.bezugszeitraum });

  const optional: (keyof EnniAnbau)[] = [
    'aussaattermin',
    'vorfruchtart',
    'kulturfolge',
    'anbauflaeche',
    'n-min',
    'nmin-probenahmetiefe',
    'n-min-vor-mehr-als-4-wochen',
    'ernterueckstand',
    'ertrag',
    'rp-gehalt-prozent',
    'folie',
  ];
  for (const key of optional) {
    const value = anbau[key];
    if (value !== undefined) children.push({ [key]: value } as xml.XmlObject);
  }

  if (anbau.duengungen && anbau.duengungen.length > 0) {
    children.push({
      duengungen: anbau.duengungen.map((d) => ({
        duengung: buildDuengungXml(d),
      })),
    });
  }

  return children;
}

export function generateEnniFilename(
  betriebsnummer: string,
  year: number,
): string {
  return generateExportFilename('ENNI', betriebsnummer, year);
}
