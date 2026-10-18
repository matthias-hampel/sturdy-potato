/**
 * XSD validation of the generated Dube2.5 files against the authorities' schemas
 * (copies in this folder). Uses xmllint compiled to WASM — no native binary
 * needed in CI.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateXML } from 'xmllint-wasm';

const ENNI_XSD = fileURLToPath(
  new URL(
    './ENNI_2025_DBE+DdD+170N_Import_Schema_Definition_2025_09_09.xsd',
    import.meta.url,
  ),
);
const ENDO_XSD = fileURLToPath(new URL('./Dube2.5.xsd', import.meta.url));

export type XsdResult = { valid: boolean; errors: string[] };

async function validate(xml: string, xsdPath: string): Promise<XsdResult> {
  const result = await validateXML({
    xml: [{ fileName: 'export.xml', contents: xml }],
    schema: [
      { fileName: 'schema.xsd', contents: readFileSync(xsdPath, 'utf-8') },
    ],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((e) => e.rawMessage),
  };
}

export const validateEnniXsd = (xml: string): Promise<XsdResult> =>
  validate(xml, ENNI_XSD);
export const validateEndoXsd = (xml: string): Promise<XsdResult> =>
  validate(xml, ENDO_XSD);
