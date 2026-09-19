import type { ApiErrorBody } from '@/types/backend'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: { field: string; message: string }[]

  constructor(status: number, code: string, message: string, fieldErrors: { field: string; message: string }[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }

  get isForbidden() {
    return this.status === 403
  }
  get isNotFound() {
    return this.status === 404
  }
  get isConflict() {
    return this.status === 409
  }
}

let authHeader: (() => string | null) | null = null
let onUnauthorized: (() => void) | null = null

export function configureClient(opts: { authHeader: () => string | null; onUnauthorized: () => void }) {
  authHeader = opts.authHeader
  onUnauthorized = opts.onUnauthorized
}

export function basicAuth(username: string, password: string) {
  // btoa is Latin-1 only; encode to UTF-8 bytes first so non-ASCII passwords work.
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return `Basic ${btoa(bin)}`
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | string[] | undefined | null>
  body?: unknown
  /** Explicit Authorization header (used by login before a session exists). */
  authorization?: string
  signal?: AbortSignal
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v == null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
    else url.searchParams.set(k, String(v))
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  const auth = opts.authorization ?? authHeader?.()
  if (auth) headers.Authorization = auth
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'NETWORK', 'Cannot reach the Sentinel API. Check that the backend is running and try again.')
  }

  if (res.status === 401 && !opts.authorization) onUnauthorized?.()

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {}
    try {
      body = (await res.json()) as Partial<ApiErrorBody>
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, body.code ?? `HTTP_${res.status}`, body.message ?? res.statusText ?? 'Request failed', body.fieldErrors)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong'
}
