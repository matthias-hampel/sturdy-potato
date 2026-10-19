import { Logger } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import type { DB } from '../db/schema.js';
import { enqueue } from '../jobs/queue.js';
import { type Job, PermanentJobError } from '../jobs/runner.js';
import { type MailLocale, type MailTemplate, type MailTemplates, mailLocale, renderMail } from './templates.js';

export const SEND_EMAIL = 'email.send';

interface SendEmailPayload<K extends MailTemplate = MailTemplate> {
  to: string;
  template: K;
  locale: MailLocale;
  params: MailTemplates[K];
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

/**
 * Queues an e-mail. It is rendered and sent by the worker after the transaction commits,
 * and retried with backoff when the mail server is unavailable.
 */
export function queueEmail<K extends MailTemplate>(
  trx: Kysely<DB> | Transaction<DB>,
  mail: { to: string; template: K; locale: string | null | undefined; params: MailTemplates[K]; organizationId?: string; dedupeKey?: string; headers?: Record<string, string> },
) {
  const payload: SendEmailPayload<K> = { to: mail.to, template: mail.template, locale: mailLocale(mail.locale), params: mail.params, headers: mail.headers };
  return enqueue(trx, { kind: SEND_EMAIL, payload: { ...payload }, organizationId: mail.organizationId, dedupeKey: mail.dedupeKey });
}

/** Job handler for `email.send`. */
export function sendEmailHandler(transport: Transporter = nodemailer.createTransport(config.mail.smtpUrl)) {
  const logger = new Logger('Mail');
  return async (job: Job) => {
    const payload = job.payload as unknown as SendEmailPayload;
    if (!payload.to || !payload.template) throw new PermanentJobError('E-mail job without recipient or template');
    let rendered;
    try {
      rendered = renderMail(payload.template, payload.locale, payload.params);
    } catch (e) {
      throw new PermanentJobError((e as Error).message);
    }
    await transport.sendMail({ from: config.mail.from, to: payload.to, subject: rendered.subject, text: rendered.text, html: rendered.html, headers: payload.headers });
    logger.log(`Sent ${payload.template} e-mail (job #${job.id})`);
  };
}
