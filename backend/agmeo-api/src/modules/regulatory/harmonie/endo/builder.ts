import xml from 'xml';

import {
  buildBodenuntersuchungen,
  sharedAnbauValues,
} from '../shared/anbau.js';
import { ENNI_ENDO_VERSION } from '../shared/defaults.js';
import { buildDuengerKatalog } from '../shared/duengerKatalog.js';
import type { SharedFruchtklasse } from '../shared/fruchtklasse.js';
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
import type { Betrieb, Betriebsdaten, Duengung, ExportData } from '../types.js';
import { formatExportDate, formatExportDecimal } from '../utils.js';
import { getEffectiveEndoMetadata } from './defaults.js';
import { getFruchtartSh, isGartenbauFruchtartSh } from './fruchtartCodesSh.js';
import type {
  EndoAnbau,
  EndoDuengebedarf,
  EndoExportModel,
  EndoFruchtklasseType,
  EndoNutzungsartType,
  EndoOrgMetadata,
  EndoSchlag,
} from './types.js';

/**
 * ENDO-SH removed the Nitratkulisse from the Meldezeitraum 2026 onwards
 * (Rote Gebiete are unenforced nationwide in 2026): `n-kulisse` is only
 * filed for earlier years.
 */
export const N_KULISSE_LAST_YEAR = 2025;

export function buildEndoFromExportData(
  data: ExportData,
  metadataOverrides?: EndoOrgMetadata,
): EndoExportModel {
  const metadata: EndoOrgMetadata = {
    ...data.integrations.endo,
    ...metadataOverrides,
  };
  const effectiveMetadata = getEffectiveEndoMetadata(metadata);

  const betrieb: Betrieb = {
    betriebsnummer: effectiveMetadata.betriebsnummer,
    ansprechpartner: effectiveMetadata.ansprechpartner,
    betriebsstaette: effectiveMetadata.betriebsstaette || {},
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

  const schlaege: EndoSchlag[] = [];
  const schlagnummern = assignSchlagnummern(data.fields);
  const gartenbauFieldIds = new Set<string>();

  for (const field of data.fields) {
    const klassen = classifyCultivations(field.cultivations);
    const folge = kulturfolge(field.cultivations);
    let hasGartenbau = false;

    const anbauten: EndoAnbau[] = field.cultivations.map((cult, cultIdx) => {
      const fruchtart = getFruchtartSh(
        cult.crop,
        effectiveMetadata.cropCodeOverrides,
      );
      const vorfrucht = cult.previousCrop
        ? getFruchtartSh(cult.previousCrop, effectiveMetadata.cropCodeOverrides)
        : undefined;
      if (isGartenbauFruchtartSh(fruchtart?.code)) hasGartenbau = true;

      const duengungen: Duengung[] = cult.fertilizations.map((fert) => ({
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

      const anbau: EndoAnbau = {
        fruchtklasse: fruchtklasseName(
          klassen[cultIdx],
          'endo',
        ) as EndoFruchtklasseType,
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
          'endo',
          cult.harvest !== null,
        );
        if (phrase) anbau.aussaattermin = phrase;
      }

      if (duengungen.length > 0) {
        anbau.duengungen = duengungen;
      }

      return anbau;
    });

    if (hasGartenbau) gartenbauFieldIds.add(field.id);

    const schlag: EndoSchlag = {
      schlagnummer: schlagnummern.get(field.id) ?? '',
      schlagname: field.name,
      naturraum: effectiveMetadata.naturraum,
      flaeche: formatExportDecimal(field.areaInHa, 4),
      nutzungsart: endoNutzungsart(klassen, hasGartenbau),
      'p-kulisse': false,
    };
    // A Schlag without cultivation is filed as KEINE-AUFZEICHNUNGSPFLICHT and carries no anbauten.
    if (anbauten.length > 0) schlag.anbauten = anbauten;
    if (data.year <= N_KULISSE_LAST_YEAR)
      schlag['n-kulisse'] = field.nitrateSensitiveZone;

    if (field.flik && field.flik.length <= 16) {
      schlag.flik = field.flik;
    }

    const bodenuntersuchungen = buildBodenuntersuchungen(field);
    if (bodenuntersuchungen.length > 0)
      schlag.bodenuntersuchungen = bodenuntersuchungen;

    schlaege.push(schlag);
  }

  const duengebedarf: EndoDuengebedarf = {
    bezugsjahr: data.year.toString(),
    duengejahrbeginn: effectiveMetadata.duengejahrbeginn,
    betriebsdaten,
    schlaege,
  };

  return {
    betrieb,
    duengebedarf,
    dokumentationDerDuengung: buildDuengerKatalog(data),
    n170: buildN170(data, getN170Betriebsdaten(data), gartenbauFieldIds),
  };
}

/** Grassland and arable crops on one Schlag are ACKER-GRUENLAND; horticulture flags the Gartenbau variants. */
function endoNutzungsart(
  klassen: SharedFruchtklasse[],
  hasGartenbau: boolean,
): EndoNutzungsartType {
  const hasGrassland = klassen.includes('GRUENLAND');
  const hasArable = klassen.some((k) => k !== 'GRUENLAND');
  if (hasGrassland && hasGartenbau) return 'GRUENLAND-GARTENBAU';
  if (hasGrassland && hasArable) return 'ACKER-GRUENLAND';
  if (hasGrassland) return 'GRUENLAND';
  if (hasGartenbau) return hasArable ? 'ACKER-GARTENBAU' : 'GARTENBAU';
  if (hasArable) return 'ACKER';
  return 'KEINE-AUFZEICHNUNGSPFLICHT';
}

export function serializeEndoXml(model: EndoExportModel): string {
  const xmlObj = [
    {
      endo: [
        { _attr: { version: ENNI_ENDO_VERSION } },
        { betrieb: buildBetriebXml(model.betrieb) },
        {
          duengebedarf: buildDuengebedarfXml(
            model.duengebedarf,
            buildSchlagXml,
          ),
        },
        // Both root sections describe the filed Anbauten — a Düngebedarf without any has neither.
        ...(model.duengebedarf.schlaege.some((s) => s.anbauten)
          ? buildRootSectionsXml(model, 'endo')
          : []),
      ],
    },
  ];

  return xml(xmlObj, { declaration: true, indent: '   ' });
}

function buildSchlagXml(schlag: EndoSchlag): xml.XmlObject[] {
  const children: xml.XmlObject[] = [
    { schlagnummer: schlag.schlagnummer },
    { schlagname: schlag.schlagname },
  ];

  if (schlag.naturraum) {
    children.push({ naturraum: schlag.naturraum });
  }

  children.push({ flaeche: schlag.flaeche });

  if (schlag.flik) {
    children.push({ flik: schlag.flik });
  }

  children.push({ nutzungsart: schlag.nutzungsart });

  if (schlag['n-kulisse'] !== undefined) {
    children.push({ 'n-kulisse': schlag['n-kulisse'] });
  }
  if (schlag['p-kulisse'] !== undefined) {
    children.push({ 'p-kulisse': schlag['p-kulisse'] });
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

function buildAnbauXml(anbau: EndoAnbau): xml.XmlObject[] {
  const children: xml.XmlObject[] = [];

  const ordered: (keyof EndoAnbau)[] = [
    'aussaattermin',
    'anbau-im-fremdbetrieb',
    'anbauflaeche',
    'bezugszeitraum',
    'ernterueckstand',
    'ertrag',
    'folie',
    'fruchtart',
    'fruchtart-bezeichnung',
    'fruchtklasse',
    'kulturfolge',
    'lfd-nr',
    'n-min',
    'nmin-probenahmetiefe',
    'rp-gehalt-prozent',
    'vorfruchtart',
  ];
  for (const key of ordered) {
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

export function generateEndoFilename(
  betriebsnummer: string,
  year: number,
): string {
  return generateExportFilename('ENDO', betriebsnummer, year);
}
