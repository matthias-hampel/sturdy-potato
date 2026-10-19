import { buildZip } from './zip.js';

/** The slice of JSZip's API the ported tests use, on top of buildZip. */
export class TestZip {
  private readonly files: Record<string, Buffer | string> = {};

  file(name: string, content: Buffer | string): this {
    this.files[name] = content;
    return this;
  }

  async generateAsync(_options?: unknown): Promise<Buffer> {
    return buildZip(this.files);
  }
}
