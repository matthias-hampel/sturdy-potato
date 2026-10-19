/**
 * Speech-to-text for voice drafts over an OpenAI-compatible transcription endpoint
 * (`POST {VOICE_STT_URL}/audio/transcriptions`, multipart `file`, `model`, `language`). The
 * reference uses Mistral Voxtral on its EU endpoint, which speaks the same protocol.
 */
import { config } from '../../config.js';

export class SttError extends Error {}

export const sttConfigured = () => config.voice.sttUrl !== '';

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/** File name with an extension the service recognizes the container by. */
export const audioFileName = (mime: string) => `dictation.${EXTENSIONS[mime.split(';')[0].trim()] ?? 'webm'}`;

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  if (!sttConfigured()) throw new SttError('Speech-to-text is not configured (VOICE_STT_URL)');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime.split(';')[0] }), audioFileName(mime));
  form.append('model', config.voice.sttModel);
  if (config.voice.language) form.append('language', config.voice.language);
  form.append('response_format', 'json');
  const res = await fetch(`${config.voice.sttUrl}/audio/transcriptions`, {
    method: 'POST',
    body: form,
    headers: config.voice.sttApiKey ? { authorization: `Bearer ${config.voice.sttApiKey}` } : {},
    signal: AbortSignal.timeout(config.voice.timeoutMs),
  });
  if (!res.ok) throw new SttError(`Speech-to-text answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { text?: unknown };
  if (typeof body.text !== 'string') throw new SttError('Speech-to-text answered without text');
  return body.text.trim();
}
