/**
 * A small, dependency-free XML reader for WFS responses: elements, attributes and text, with
 * namespace prefixes kept in the names (`gml:posList`). Comments, processing instructions, the
 * DOCTYPE and CDATA markers are handled; DTD entities other than the five predefined ones and
 * numeric references are left as they are.
 */
export interface XmlElement {
  /** Qualified name as written, e.g. `cp:CadastralParcel`. */
  name: string;
  /** Name without the namespace prefix. */
  local: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text directly inside this element. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref] ?? m;
  });
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1);
const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
    } else if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end < 0 ? n : end + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt + 2);
      const name = xml.slice(lt + 2, end).trim();
      // Close up to the matching element; tolerate unbalanced markup instead of failing.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
    } else {
      // Find the tag end, skipping '>' inside quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      const selfClosing = xml[j - 1] === '/';
      const body = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      const space = body.search(/\s/);
      const name = space < 0 ? body : body.slice(0, space);
      const attrs: Record<string, string> = {};
      if (space >= 0) {
        for (const m of body.slice(space).matchAll(ATTR)) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
      }
      const el: XmlElement = { name, local: localName(name), attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  return root;
}

/** Depth-first search for elements by local name (namespace prefix ignored, case-insensitive). */
export function findAll(el: XmlElement, local: string, out: XmlElement[] = []): XmlElement[] {
  const target = local.toLowerCase();
  for (const c of el.children) {
    if (c.local.toLowerCase() === target) out.push(c);
    else findAll(c, local, out);
  }
  return out;
}

export function findFirst(el: XmlElement, local: string): XmlElement | null {
  const target = local.toLowerCase();
  for (const c of el.children) {
    if (c.local.toLowerCase() === target) return c;
    const hit = findFirst(c, local);
    if (hit) return hit;
  }
  return null;
}
