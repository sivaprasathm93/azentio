import { config } from '@/lib/config'
import type { SentinelApi } from './types'
import { httpApi } from './http'
import { mockApi } from './mock/mockApi'

/** The active API implementation, chosen once at build time by VITE_API_MODE. */
export const api: SentinelApi = config.mode === 'live' ? httpApi : mockApi

export type { SentinelApi } from './types'
export { ApiError, errorMessage } from './client'
