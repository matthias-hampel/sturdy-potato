import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { config } from '../../config.js';

/** One decision as the language model sees it: the rule set's output plus names for context. */
export interface ExplainItem {
  key: string;
  kind: string;
  action: string;
  operationType: string | null;
  field: string;
  crop: string | null;
  operation: string | null;
  zoneNos: number[] | null;
  windowFrom: string | null;
  windowTo: string | null;
  priority: string;
  confidence: number;
  evidence: { code: string; params: Record<string, unknown> }[];
}

export interface Explanation {
  briefing: string | null;
  texts: Map<string, string>;
  model: string;
}

const INSTRUCTIONS = `Du bist der Ackerbau-Assistent von agmeo und schreibst für Landwirtinnen und Landwirte in Deutschland.
Du bekommst Empfehlungen, die ein festes Regelwerk aus Kalender, Wettervorhersage, Satellitendaten (NDVI) und DüV-/Pflanzenschutzregeln berechnet hat.

Regeln:
- Erkläre nur die gelieferten Empfehlungen. Erfinde keine neuen Maßnahmen, Produkte, Mengen, Termine oder Messwerte.
- Nutze ausschließlich die Werte aus "evidence". Datumsangaben sind bereits formatiert (z. B. "Fr., 23.10."): übernimm sie wörtlich und berechne keine Wochentage selbst.
- Pro Empfehlung 1–2 kurze Sätze: was zu tun ist und warum. Fachlich, sachlich, ohne Floskeln und ohne Anrede.
- Nenne "confidence" nie als Zahl. Liegt sie unter 0,7, schreibe nur, dass die Vorhersage noch unsicher ist.
- Zahlen mit Dezimalkomma (37,8 km/h).
- Bedeutung von "action": do_now = wie geplant am "windowFrom" durchführen; postpone = vom geplanten Tag auf "windowFrom" verlegen (früher oder später); catch_up = überfällige Arbeit am "windowFrom" nachholen; inspect = Feldbegehung zwischen "windowFrom" und "windowTo"; plan_operation = Arbeit fehlt im Plan, frühestens passend am "windowFrom"; review = geplante Arbeit vor der Durchführung prüfen; create_vra_map = Aufwandmengen je Produktivitätszone festlegen. Ein Spritzfenster ist ein günstiger Zeitraum, keine Frist.
- Rechtliche Hinweise (DüV, Pflanzenschutz) als Prüfhinweis formulieren, nicht als rechtliche Bewertung.
- "briefing": 1–3 Sätze Tagesüberblick über alle Empfehlungen, das Dringendste zuerst. Leerer String, wenn es keine Empfehlungen gibt.
- Gib für jeden "key" genau einen Eintrag zurück.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['briefing', 'items'],
  properties: {
    briefing: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text'],
        properties: { key: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
};

const MAX_TEXT = 600;

/**
 * Phrases the reasons of the rule set's decisions with an OpenAI model (structured output).
 * The model only writes text for the keys it was given; anything else is dropped.
 */
@Injectable()
export class ExplainerService {
  private readonly logger = new Logger(ExplainerService.name);
  private readonly client = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey, timeout: config.openai.timeoutMs, maxRetries: 1 }) : null;

  get enabled() {
    return this.client != null;
  }

  async explain(today: string, items: ExplainItem[]): Promise<Explanation | null> {
    if (!this.client || !items.length) return null;
    const response = await this.client.responses.create({
      model: config.openai.model,
      instructions: INSTRUCTIONS,
      input: JSON.stringify(localizeDates({ heute: today, empfehlungen: items })),
      text: { format: { type: 'json_schema', name: 'field_recommendations', schema: SCHEMA, strict: true } },
      ...(config.openai.reasoningEffort ? { reasoning: { effort: config.openai.reasoningEffort as 'low' } } : {}),
      // Recommendations name fields and crops; they are not kept for training or later retrieval.
      store: false,
    });
    const parsed = JSON.parse(response.output_text) as { briefing: string; items: { key: string; text: string }[] };
    const keys = new Set(items.map((i) => i.key));
    const texts = new Map<string, string>();
    for (const item of parsed.items) {
      if (keys.has(item.key) && item.text.trim()) texts.set(item.key, item.text.trim().slice(0, MAX_TEXT));
    }
    const dropped = parsed.items.length - texts.size;
    if (dropped) this.logger.warn(`Dropped ${dropped} explanation(s) for unknown keys`);
    return { briefing: parsed.briefing.trim().slice(0, MAX_TEXT * 2) || null, texts, model: response.model };
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** "2026-10-23" → "Fr., 23.10."; the model copies dates instead of working out weekdays (it gets them wrong). */
export function germanDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** Replaces ISO dates and local date-times anywhere in the payload with German labels. */
export function localizeDates<T>(value: T): T {
  if (typeof value === 'string') {
    if (DAY.test(value)) return germanDate(value) as T;
    const m = DAY_TIME.exec(value);
    return (m ? `${germanDate(m[1])} ${m[2]} Uhr` : value) as T;
  }
  if (Array.isArray(value)) return value.map(localizeDates) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeDates(v)])) as T;
  return value;
}
