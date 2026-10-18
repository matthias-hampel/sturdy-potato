import { Body, type PipeTransform, Query } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown) {
    return this.schema.parse(value ?? {});
  }
}

/** Validated request body: `@ZBody(FarmInput) input: z.output<typeof FarmInput>`. */
export const ZBody = (schema: ZodType) => Body(new ZodPipe(schema));
export const ZQuery = (schema: ZodType) => Query(new ZodPipe(schema));

export type Out<T extends ZodType> = import('zod').output<T>;
