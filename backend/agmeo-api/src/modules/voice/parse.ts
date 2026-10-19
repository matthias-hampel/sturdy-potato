/**
 * Transcript → OperationDraft without a language model.
 *
 * The reference (AGVOLUTION/agmeo src/lib/voice/extract.ts) sends the transcript to an LLM with
 * the voice spike's prompt. Here the same rules are applied directly to German farm dictation:
 * the organization's own field and product names are matched first (with inflected forms), then
 * the spike's rules for quantities and units, self-corrections, self-doubt, date, BBCH, wind,
 * temperature, partial areas and the operator. What is not captured goes to `freeText`; core
 * fields that are absent or doubted go to `missing`, which sets the confidence.
 */
import {
  DRAFT_OPERATION_TYPE,
  type OperationDraft,
  type OperationDraftCategory,
  type OperationDraftKind,
  type OperationDraftUnit,
  type VoiceDraftResolution,
} from '@agmeo/contracts';

export interface VoiceVocabulary {
  fields: { id: string; name: string }[];
  products: { id: string; name: string; category: string; baseUnit: string }[];
}

export interface ParsedDictation {
  draft: OperationDraft;
  resolved: VoiceDraftResolution;
}

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

/** Lowercase ASCII-folded text: umlauts spelled out, punctuation as spaces, decimal comma as dot. */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/m³/g, 'm3')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9./%-]+/g, ' ')
    .replace(/(^|\s)[.\-/]+(?=\s|$)/g, ' ')
    .replace(/\.(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNITS: Record<string, number> = {
  null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6,
  sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
};
const TENS: Record<string, number> = { zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
/** Articles count as one only inside compounds and before a unit, not as words of their own. */
const ARTICLES = new Set(['ein', 'eine', 'einen', 'einem', 'einer']);

function below100(w: string): number | null {
  if (w in UNITS) return UNITS[w];
  if (w in TENS) return TENS[w];
  const m = /^(ein|zwei|drei|vier|fuenf|sechs|sieben|acht|neun)und(zwanzig|dreissig|vierzig|fuenfzig|sechzig|siebzig|achtzig|neunzig)$/.exec(w);
  return m ? (m[1] === 'ein' ? 1 : UNITS[m[1]]) + TENS[m[2]] : null;
}

/** A German number word ("zweihundertfünfzig" folded to "zweihundertfuenfzig"), or null. */
export function numberWord(w: string): number | null {
  if (!w) return null;
  const k = w.indexOf('tausend');
  if (k >= 0) {
    const head = w.slice(0, k);
    const tail = w.slice(k + 7);
    const h = head ? numberWord(head) : 1;
    const t = tail ? numberWord(tail) : 0;
    return h == null || t == null ? null : h * 1000 + t;
  }
  const i = w.indexOf('hundert');
  if (i >= 0) {
    const head = w.slice(0, i);
    const tail = w.slice(i + 7).replace(/^und/, '');
    const h = head ? (head === 'ein' ? 1 : below100(head)) : 1;
    const t = tail ? below100(tail) : 0;
    return h == null || t == null ? null : h * 100 + t;
  }
  return below100(w);
}

/** Replaces spoken numbers by digits: "zwei komma fünf" → 2.5, "anderthalb" → 1.5, "einhalb" → 0.5. */
export function spokenNumbers(normalized: string): string {
  const words = normalized.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'anderthalb') {
      out.push('1.5');
      continue;
    }
    if (w === 'einhalb' || w === 'halben' || w === 'halber' || w === 'halbe' || w === 'halb') {
      // "zwei einhalb" → 2.5, "ein halber hektar" → 0.5
      const prev = out[out.length - 1];
      if (prev && /^\d+$/.test(prev) && w === 'einhalb') out[out.length - 1] = String(Number(prev) + 0.5);
      else if (ARTICLES.has(words[i - 1]) && (prev === '1' || prev === words[i - 1])) out[out.length - 1] = '0.5';
      else out.push('0.5');
      continue;
    }
    const n = ARTICLES.has(w) ? null : numberWord(w);
    if (n != null) {
      out.push(String(n));
      continue;
    }
    // "ein Liter", "einen Hektar": the article is a one before a unit word.
    if (ARTICLES.has(w) && UNIT_WORD.test(words[i + 1] ?? '')) {
      out.push('1');
      continue;
    }
    if (w === 'komma' && /^\d+$/.test(out[out.length - 1] ?? '') && /^\d+$/.test(String(numberWord(words[i + 1] ?? '') ?? words[i + 1] ?? ''))) {
      const next = numberWord(words[i + 1]) ?? Number(words[i + 1]);
      out[out.length - 1] = `${out[out.length - 1]}.${next}`;
      i++;
      continue;
    }
    out.push(w);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// Name matching (fields, products) with inflected forms
// ---------------------------------------------------------------------------

/** Rough German stem for matching "vom Langen Streifen" with "Langer Streifen". */
const stem = (w: string) => (w.length > 4 ? w.replace(/(en|er|es|em|e|n|s)$/, '') : w);
const tokens = (s: string) => normalize(s).split(' ').filter(Boolean);

interface NameMatch<T> {
  item: T;
  /** Index of the first matched token and the token count, in the dictation's tokens. */
  at: number;
  length: number;
}

/** The longest name whose tokens appear consecutively in the dictation (stem-wise). */
function matchName<T extends { name: string }>(items: T[], words: string[]): NameMatch<T> | null {
  const stems = words.map(stem);
  let best: NameMatch<T> | null = null;
  for (const item of items) {
    const name = tokens(item.name).map(stem);
    if (!name.length || name.join('').length < 3) continue;
    for (let i = 0; i + name.length <= stems.length; i++) {
      if (name.every((n, j) => stems[i + j] === n)) {
        const chars = name.join('').length;
        if (!best || chars > tokens(best.item.name).join('').length) best = { item, at: i, length: name.length };
        break;
      }
    }
  }
  return best;
}

/**
 * A product named by part of its name: the first word ("KAS" for "KAS 27") or the end of a
 * compound ("Gülle" for "Rindergülle"). Only a single candidate counts.
 */
function partialProduct<T extends { name: string }>(items: T[], words: string[]): T | null {
  const spoken = new Set(words.filter((w) => w.length >= 3 && !/^\d/.test(w)).map(stem));
  const hits = items.filter((item) => {
    const name = tokens(item.name);
    if (!name.length) return false;
    if (spoken.has(stem(name[0])) && name[0].length >= 3) return true;
    return [...spoken].some((w) => w.length >= 4 && name.length === 1 && name[0].length > w.length && stem(name[0]).endsWith(w));
  });
  return hits.length === 1 ? hits[0] : null;
}

// ---------------------------------------------------------------------------
// Vocabulary of the rules (spike prompt rules 6–15)
// ---------------------------------------------------------------------------

const UNIT_WORD = /^(milliliter|ml|liter|litern|l|kilogramm|kilo|kg|tonnen|tonne|t|doppelzentner|dt|kubikmeter|kubik|m3|stueck|stk|koerner|korn|gramm|g|zentimeter|cm)$/;

const VERBS: [OperationDraftCategory, RegExp][] = [
  ['plantProtection', /\b(gespritzt|spritzen|spritze|gesprueht|pflanzenschutz|fungizid|herbizid|insektizid|wachstumsregler|behandelt)\b/],
  ['fertilization', /\b(gestreut|streuen|geduengt|duengen|duengung|geguellt|guellen|kopfduengung|gekalkt|kalken)\b/],
  ['sowing', /\b(gedrillt|drillen|gesaet|saeen|aussaat|ausgesaet|gelegt|legen|eingesaet)\b/],
  ['tillage', /\b(gegrubbert|grubbern|grubber|gepfluegt|pfluegen|pflug|geeggt|eggen|gewalzt|walzen|gestriegelt|striegeln|gemulcht|mulchen|scheibenegge|bodenbearbeitung|kreiselegge)\b/],
  ['harvest', /\b(geerntet|ernten|ernte|gedroschen|dreschen|gehaeckselt|haeckseln|gemaeht|maehen|gepresst)\b/],
  ['irrigation', /\b(beregnet|beregnen|beregnung|bewaessert|bewaessern)\b/],
];

/** Well-known products when the organization has none of that name (spike rule 10). */
const KNOWN_ARTICLES: [RegExp, string, OperationDraftCategory][] = [
  [/\bkas\b/, 'KAS', 'fertilization'],
  [/\bahl( ?28)?\b/, 'AHL', 'fertilization'],
  [/\bass\b/, 'ASS', 'fertilization'],
  [/\bssa\b/, 'SSA', 'fertilization'],
  [/\bharnstoff\b/, 'Harnstoff', 'fertilization'],
  [/\b(rinder|schweine)?guelle\b/, 'Gülle', 'fertilization'],
  [/\bgaerrest(e)?\b/, 'Gärrest', 'fertilization'],
  [/\b(stall)?mist\b/, 'Mist', 'fertilization'],
  [/\bkalk\b/, 'Kalk', 'fertilization'],
  [/\bkali\b/, 'Kali', 'fertilization'],
  [/\bdap\b/, 'DAP', 'fertilization'],
  [/\bnpk\b/, 'NPK', 'fertilization'],
  [/\bkarate zeon\b/, 'Karate Zeon', 'plantProtection'],
  [/\bherold( sc)?\b/, 'Herold SC', 'plantProtection'],
  [/\bu ?46( m fluid)?\b/, 'U46 M-Fluid', 'plantProtection'],
  [/\bcirkon\b/, 'Cirkon', 'plantProtection'],
  [/\bfandango\b/, 'Fandango', 'plantProtection'],
  [/\bbroadway\b/, 'Broadway', 'plantProtection'],
  [/\bprosaro\b/, 'Prosaro', 'plantProtection'],
  [/\b(glyphosat|roundup)\b/, 'Glyphosat', 'plantProtection'],
  [/\bmoddus\b/, 'Moddus', 'plantProtection'],
  [/\bccc\b/, 'CCC', 'plantProtection'],
];

const OBSERVATION = /\b(befall|befallen|krankheit|schaedling|schaedlinge|schaden|septoria|gelbrost|braunrost|rost|mehltau|blattlaeuse|blattlaus|rapsglanzkaefer|erdfloh|schnecken|wildschaden|lager|lagert|unkraut|ausfall|auswinterung|nass|staunaesse|trockenschaden|symptome|vergilbt|fusarium)\b/;
const CORRECTION = /\b(nee|nein|quatsch|warte|korrektur|korrigiere|mein ich|ich mein|ich meine|meinte ich|sorry)\b/;
const DOUBT = /\b(weiss (ich )?(nicht|nimmer|nich)( mehr| genau)?|keine ahnung|nicht mehr genau|weiss nicht wie ?viel|unsicher)\b/;

const MONTHS = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

interface Quantity {
  quantity: number | null;
  unit: OperationDraftUnit | null;
  /** The phrase as spoken, for freeText when the unit is not supported. */
  phrase: string;
  index: number;
}

const QUANTITY = /(\d+(?:\.\d+)?)\s*(milliliter|ml|litern|liter|l|kilogramm|kilo|kg|tonnen|tonne|t|doppelzentner|dt|kubikmeter|kubik|m3|stueck|stk|koerner|korn|gramm|g|zentimeter|cm)\b(?:\s*(?:pro|je|per|auf den|auf dem|\/)\s*(?:hektar|ha|quadratmeter|m2|qm))?/g;

function quantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(QUANTITY)) {
    const n = Number(m[1]);
    const u = m[2];
    const perM2 = /quadratmeter|m2|qm/.test(m[0]);
    const q = (quantity: number | null, unit: OperationDraftUnit | null) => out.push({ quantity, unit, phrase: m[0], index: m.index! });
    if (perM2 || /^(koerner|korn|gramm|g|zentimeter|cm)$/.test(u)) q(null, null);
    else if (u === 'milliliter' || u === 'ml') q(round(n / 1000, 4), 'l/ha');
    else if (/^(litern|liter|l)$/.test(u)) q(n, 'l/ha');
    else if (/^(kilogramm|kilo|kg)$/.test(u)) q(n, 'kg/ha');
    else if (/^(tonnen|tonne|t)$/.test(u)) q(n, 't/ha');
    else if (u === 'doppelzentner' || u === 'dt') q(round(n / 10, 4), 't/ha');
    else if (/^(kubikmeter|kubik|m3)$/.test(u)) q(n, 'm3/ha');
    else q(n, 'stk/ha');
  }
  return out;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'heute', 'gestern' or an ISO date (spike rule 13); `today` is the ISO day of the dictation. */
function spokenDate(text: string, today: string): string | null {
  if (/\bvorgestern\b/.test(text)) return addDays(today, -2);
  if (/\bgestern\b/.test(text)) return 'gestern';
  if (/\bheute\b/.test(text)) return 'heute';
  const year = Number(today.slice(0, 4));
  const pad = (v: number) => String(v).padStart(2, '0');
  const iso = (d: number, m: number, y?: string) => {
    const yy = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : year;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${yy}-${pad(m)}-${pad(d)}`;
  };
  // A bare "1.5" is a decimal number: dates need "am" or a year.
  const numeric = /\bam (\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?\b/.exec(text) ?? /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text);
  if (numeric) return iso(Number(numeric[1]), Number(numeric[2]), numeric[3]);
  const named = new RegExp(`\\b(\\d{1,2})\\.? (${MONTHS.join('|')})(?: (\\d{4}))?\\b`).exec(text);
  if (named) return iso(Number(named[1]), MONTHS.indexOf(named[2]) + 1, named[3]);
  return null;
}

function sentences(transcript: string): string[] {
  return transcript
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const clean = (s: string) =>
  s
    .replace(/\b(äh|ähm|öh|hm|sozusagen|jo)\b[,]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/** Parses a dictation into the draft contract and resolves it against the organization's names. */
export function parseDictation(transcript: string, vocabulary: VoiceVocabulary, today: string): ParsedDictation {
  const base = normalize(transcript);
  const text = spokenNumbers(base);
  const words = text.split(' ').filter(Boolean);
  const missing: string[] = [];
  const free: string[] = [];

  // Field: the organization's names first, then "Schlag 12" or a field-like word after a preposition.
  const fieldMatch = matchName(vocabulary.fields, words);
  let fieldName: string | null = fieldMatch?.item.name ?? null;
  if (!fieldName) {
    const m =
      /\b(?:auf|am|im|vom|von|beim|in|bei)\s+(?:dem|der|den|die|das)?\s*((?:Schlag|Feld|Koppel|Parzelle)\s+\d+[a-z]?|[A-ZÄÖÜ][\wäöüß-]*(?:feld|schlag|koppel|acker|kamp|breite|wiese|stück|land|grund|berg|stücke|streifen))\b/u.exec(transcript) ??
      /\b((?:Schlag|Feld|Koppel|Parzelle)\s+\d+[a-z]?)\b/u.exec(transcript);
    fieldName = m ? m[1] : null;
  }

  // Product: the organization's names first, then well-known ones, then "X gefahren".
  const productWords = fieldMatch ? words.map((w, i) => (i >= fieldMatch.at && i < fieldMatch.at + fieldMatch.length ? '' : w)) : words;
  const product = matchName(vocabulary.products, productWords)?.item ?? partialProduct(vocabulary.products, productWords);
  let articleName: string | null = product?.name ?? null;
  let articleCategory: OperationDraftCategory | null = product ? productCategory(product.category) : null;
  if (!articleName) {
    const known = KNOWN_ARTICLES.find(([re]) => re.test(text));
    if (known) {
      articleName = known[1];
      articleCategory = known[2];
    }
  }
  if (!articleName) {
    const m = /\b([A-ZÄÖÜ][\wäöüß-]*(?:\s+[A-Z0-9][\w-]*)?)\s+(?:gefahren|gespritzt|ausgebracht|gestreut)\b/u.exec(transcript);
    if (m && m[1] !== fieldName && !/^(Heute|Gestern|Dann|Wir|Ich|Er|Sie|Und|Auch|Noch|Schon)$/.test(m[1].split(/\s+/)[0])) articleName = m[1];
  }

  // Category: the verb, else what the product is.
  const verb = VERBS.find(([, re]) => re.test(text))?.[0] ?? null;
  let category: OperationDraftCategory | null = articleCategory ?? verb;

  // Kind (spike rule 9).
  let kind: OperationDraftKind;
  if (/\bnotiz\b/.test(text)) kind = 'note';
  else if (/\bbeobachtung\b/.test(text)) kind = 'observation';
  else if (verb || articleName || /\b(gefahren|ausgebracht)\b/.test(text)) kind = 'operation';
  else if (OBSERVATION.test(text)) kind = 'observation';
  else kind = 'note';
  if (kind === 'operation' && !category) category = 'other';
  if (kind !== 'operation' && !verb && !articleCategory) category = null;

  // Quantity: a correction takes the last value (rule 5), otherwise the first; others go to freeText.
  const qs = quantities(text);
  let picked: Quantity | null = null;
  if (qs.length) {
    const corrected = qs.length > 1 && CORRECTION.test(text.slice(qs[0].index));
    picked = corrected ? qs[qs.length - 1] : qs[0];
    if (!corrected) for (const q of qs.slice(1)) free.push(q.phrase);
  }
  const doubt = DOUBT.test(text);
  let quantity = picked?.quantity ?? null;
  let unit = picked?.unit ?? null;
  if (picked && picked.unit == null) free.push(picked.phrase);
  if (doubt) {
    quantity = null;
    unit = null;
  }

  const bbchMatch = /\b(?:bbch|ec)\s*(\d{1,2})\b/.exec(text);
  const bbch = bbchMatch ? Number(bbchMatch[1]) : null;

  let windMs: number | null = null;
  const wind = /\bwind\b\D{0,25}?(\d+(?:\.\d+)?)\s*(km\/h|kmh|kilometer|stundenkilometer|meter|m\/s|m)?/.exec(text) ?? /(\d+(?:\.\d+)?)\s*(km\/h|kmh|kilometer|stundenkilometer|meter pro sekunde|meter|m\/s)\s*wind\b/.exec(text);
  if (wind) windMs = /km|kilometer/.test(wind[2] ?? '') ? round(Number(wind[1]) / 3.6, 1) : Number(wind[1]);
  const temp = /(-?\d+(?:\.\d+)?)\s*grad\b/.exec(text);
  const tempC = temp ? Number(temp[1]) : null;

  const date = spokenDate(text, today);

  const partialArea = /\b(teilflaeche|teilweise|nur (?:die |den |das |eine |ein )?(?:ecke|hang|haelfte|teil|vorgewende|senke|kuppe|streifen|stueck))\b/.test(text) || /\b\d+(?:\.\d+)? (?:hektar|ha) (?:betroffen|davon)\b/.test(text);
  const partialHa = /\b(\d+(?:\.\d+)?) (?:hektar|ha)\b(?= betroffen| davon)/.exec(text);
  const partialAreaHa = partialArea && partialHa ? Number(partialHa[1]) : null;

  let operatorHint: string | null = null;
  const role = /\b(der|die|unser|unsere)\s+(lehrling|azubi|auszubildende|praktikant|praktikantin|chef|chefin|vater|sohn|tochter|mitarbeiter|lohnunternehmer|kollege)\b/.exec(text);
  if (role) operatorHint = `${role[1]} ${role[2][0].toUpperCase()}${role[2].slice(1)}`;
  else {
    const named = /\b([A-ZÄÖÜ][a-zäöüß]+)\s+(?:ist|hat)\s+(?:\w+\s+)?(?:gefahren|gespritzt|gemacht|gestreut|gedrillt)\b/u.exec(transcript);
    if (named && named[1] !== fieldName && named[1] !== articleName && !/^(Heute|Gestern|Das|Der|Die|Er|Sie|Es|Wer)$/.test(named[1])) operatorHint = named[1];
  }

  // freeText: observations, vague places and everything not captured (rules 8, 11, 15).
  if (kind === 'operation') {
    for (const s of sentences(transcript)) {
      const n = normalize(s);
      if (OBSERVATION.test(n)) free.push(clean(s));
      else if (!fieldName && /\b(hinterm|hinter dem|unten|oben|neben|am bach|am wald|irgendein)\b/.test(n)) free.push(clean(s));
    }
  } else {
    const body = clean(transcript.replace(/^\s*(notiz|beobachtung)\s*[:,.-]?\s*/i, ''));
    if (body) free.push(body);
  }
  const freeText = [...new Set(free.map((f) => f.trim()).filter(Boolean))].join(' ').trim();

  // missing[] and confidence (rules 4, 6, 16).
  if (kind === 'operation') {
    if (!fieldName) missing.push('fieldName');
    if (!articleName && (category === 'plantProtection' || category === 'fertilization' || category === 'sowing')) missing.push('articleName');
    const needsAmount = category === 'plantProtection' || category === 'fertilization' || category === 'sowing' || category === 'irrigation';
    if (quantity == null && (needsAmount || doubt || picked)) missing.push('quantity');
    if (unit == null && (needsAmount || doubt || picked)) missing.push('unit');
  }
  const confidence = doubt || (kind === 'operation' && missing.length >= 3) ? 'low' : missing.length ? 'medium' : 'high';

  const draft: OperationDraft = {
    kind,
    fieldName,
    category,
    articleName,
    quantity,
    unit,
    bbch: bbch != null && bbch <= 99 ? bbch : null,
    partialArea,
    partialAreaHa,
    windMs,
    tempC,
    date,
    operatorHint,
    freeText,
    missing,
    confidence,
  };
  return { draft, resolved: resolve(draft, vocabulary, today) };
}

function productCategory(category: string): OperationDraftCategory | null {
  if (category === 'crop_protection') return 'plantProtection';
  if (category === 'fertilizer') return 'fertilization';
  if (category === 'seed') return 'sowing';
  return null;
}

/** Spoken rate → the product's base unit per hectare, or null when the units do not convert. */
export function rateInBaseUnit(quantity: number | null, unit: OperationDraftUnit | null, baseUnit: string): number | null {
  if (quantity == null || unit == null) return null;
  const table: Record<OperationDraftUnit, Record<string, number>> = {
    'l/ha': { l: 1, m3: 0.001 },
    'kg/ha': { kg: 1, t: 0.001 },
    't/ha': { t: 1, kg: 1000 },
    'm3/ha': { m3: 1, l: 1000 },
    'stk/ha': { unit: 1 },
  };
  const f = table[unit][baseUnit];
  return f == null ? null : round(quantity * f, 4);
}

/** The draft in the organization's terms: field and product ids, operation type, rate and day. */
export function resolve(draft: OperationDraft, vocabulary: VoiceVocabulary, today: string): VoiceDraftResolution {
  const byName = <T extends { name: string }>(items: T[], name: string | null) => {
    if (!name) return null;
    const exact = items.find((i) => normalize(i.name) === normalize(name));
    return exact ?? matchName(items, tokens(name))?.item ?? null;
  };
  const field = byName(vocabulary.fields, draft.fieldName);
  const product = byName(vocabulary.products, draft.articleName);
  const operationType =
    draft.kind === 'operation' ? DRAFT_OPERATION_TYPE[draft.category ?? 'other'] : draft.kind === 'observation' ? 'inspection' : 'other';
  const performedOn = draft.date === 'heute' ? today : draft.date === 'gestern' ? addDays(today, -1) : draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : null;
  return {
    fieldId: field?.id ?? null,
    fieldName: field?.name ?? null,
    productId: product?.id ?? null,
    productName: product?.name ?? null,
    operationType,
    ratePerHa: product ? rateInBaseUnit(draft.quantity, draft.unit, product.baseUnit) : null,
    performedOn,
  };
}
