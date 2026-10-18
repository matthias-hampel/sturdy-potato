import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@agmeo/contracts';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** A business-rule violation with a stable machine-readable code. */
export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new DomainError(409, code, message, details);
export const badRequest = (code: string, message: string, details?: unknown) => new DomainError(400, code, message, details);
export const forbidden = (message = 'You do not have permission to do this') => new DomainError(403, 'forbidden', message);

// PostgreSQL error codes that map to client errors.
const PG_ERRORS: Record<string, [number, string, string]> = {
  '23505': [409, 'duplicate', 'A record with these values already exists'],
  '23503': [400, 'invalid_reference', 'A referenced record does not exist or is still in use'],
  '23514': [400, 'constraint_violation', 'The values violate a data rule'],
  '23P01': [409, 'overlapping_period', 'The time period overlaps an existing one'],
  '22P02': [400, 'invalid_value', 'Invalid value'],
  '42501': [403, 'forbidden', 'Access denied'],
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(e: unknown): ApiError {
    if (e instanceof DomainError) {
      return { statusCode: e.statusCode, code: e.code, message: e.message, details: e.details };
    }
    if (e instanceof ZodError) {
      return {
        statusCode: 400,
        code: 'validation_failed',
        message: 'The request is invalid',
        details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return { statusCode: status, code: HttpStatus[status]?.toLowerCase() ?? 'error', message: e.message };
    }
    const pgCode = (e as { code?: unknown })?.code;
    if (typeof pgCode === 'string' && PG_ERRORS[pgCode]) {
      const [statusCode, code, message] = PG_ERRORS[pgCode];
      return { statusCode, code, message, details: { constraint: (e as { constraint?: string }).constraint } };
    }
    return { statusCode: 500, code: 'internal_error', message: 'Unexpected server error' };
  }
}
