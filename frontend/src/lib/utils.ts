import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** localStorage/sessionStorage can throw (private mode, blocked site data); never let that break rendering. */
export function safeStorage(kind: 'local' | 'session' = 'local') {
  const store = () => (kind === 'local' ? window.localStorage : window.sessionStorage)
  return {
    get(key: string): string | null {
      try {
        return store().getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string) {
      try {
        store().setItem(key, value)
      } catch {
        /* ignore */
      }
    },
    remove(key: string) {
      try {
        store().removeItem(key)
      } catch {
        /* ignore */
      }
    },
  }
}
