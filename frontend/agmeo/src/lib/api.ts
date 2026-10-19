import { t } from '#/i18n'
import type { ApiError } from '@agmeo/contracts'
import { renewToken } from './oidc'

const BASE = '/api/v1'
const TOKEN_KEY = 'agmeo.accessToken'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => window.localStorage.setItem(TOKEN_KEY, token),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
}

type Query = Record<string, string | number | boolean | null | undefined>

function url(path: string, query?: Query) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return `${BASE}${path}${s ? `?${s}` : ''}`
}

export const SESSION_EXPIRED_EVENT = 'agmeo:session-expired'

/**
 * Fetches with the current access token. An expired Keycloak token is renewed once with the
 * refresh token before the request counts as unauthenticated.
 */
async function authedFetch(input: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const send = () => {
    const token = tokenStore.get()
    return fetch(input, { ...init, headers: { ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  }
  const res = await send()
  if (res.status !== 401 || !tokenStore.get()) return res
  const fresh = await renewToken()
  if (!fresh) return res
  tokenStore.set(fresh)
  return send()
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const res = await authedFetch(url(path, query), {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>
    if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new ApiRequestError(res.status, err.code ?? 'error', err.message ?? res.statusText, err.details)
  }
  return data as T
}

export const api = {
  /** Uploads a file as multipart form data. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    const res = await authedFetch(url(path), { method: 'POST', body: form })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      const err = (data ?? {}) as Partial<ApiError>
      if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      throw new ApiRequestError(res.status, err.code ?? 'error', err.message ?? res.statusText, err.details)
    }
    return data as T
  },
  /** Fetches a file response as a Blob with the current credentials (previews). */
  async blob(path: string, query?: Query): Promise<Blob> {
    const res = await authedFetch(url(path, query))
    if (!res.ok) throw new ApiRequestError(res.status, 'download_failed', t('apiError.download_failed'))
    return res.blob()
  },
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  /** Downloads a file response (e.g. CSV export) with the current credentials; `filename` is used when the response names none. */
  async download(path: string, query?: Query, filename = 'export') {
    const res = await authedFetch(url(path, query))
    if (!res.ok) throw new ApiRequestError(res.status, 'download_failed', t('apiError.download_failed'))
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? filename
    saveBlob(await res.blob(), name)
  },
  /** POSTs a JSON body and saves the file response (e.g. a batch export); returns the file name. */
  async downloadPost(path: string, body: unknown, filename = 'export') {
    const res = await authedFetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new ApiRequestError(res.status, 'download_failed', t('apiError.download_failed'))
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? filename
    saveBlob(await res.blob(), name)
    return name
  },
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/**
 * Human-readable message for an error, including validation details. API errors carry a
 * stable `code`; the UI shows `apiError.<code>` and falls back to the API's English message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'validation_failed' && Array.isArray(error.details)) {
      const details = (error.details as { path: string; message: string }[]).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')
      return `${t('apiError.validation_failed')} ${details}`
    }
    if (error.code === 'not_found') {
      const what = /^(.+) not found$/.exec(error.message)?.[1]
      if (what) return t('apiError.not_found_entity', { entity: t(`apiError.entity.${what}`, { defaultValue: what }) })
    }
    return t(`apiError.${error.code}`, { defaultValue: error.message })
  }
  return error instanceof Error ? error.message : t('common.error')
}
