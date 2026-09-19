import { create } from 'zustand'
import type { Role, Session } from '@/types/domain'
import { config } from '@/lib/config'
import { api, errorMessage } from '@/lib/api'
import { setMockUser } from '@/lib/api/mock/mockApi'
import { safeStorage } from '@/lib/utils'

/**
 * There is no sign-in screen. In live mode the dev proxy / nginx authenticates to the backend with a service
 * account and the app only asks who that is (and what it may do). In demo mode a persona switcher stands in.
 */

const KEY = 'sentinel-persona'
const MOCK_ROLES: Record<string, Role[]> = {
  analyst: ['ANALYST'],
  supervisor: ['ANALYST', 'SUPERVISOR'],
  admin: ['ANALYST', 'SUPERVISOR', 'ADMIN'],
}

type Persona = 'analyst' | 'supervisor' | 'admin'

function savedPersona(): Persona {
  const v = safeStorage('session').get(KEY)
  return v === 'supervisor' || v === 'admin' ? v : 'analyst'
}

interface AuthState {
  session: Session | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  init: () => Promise<void>
  /** Demo mode only: swap between the analyst / supervisor / admin personas. */
  switchMockUser: (persona: Persona) => void
  can: (role: Role) => boolean
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  status: 'loading',
  error: null,

  async init() {
    set({ status: 'loading', error: null })
    try {
      if (config.mode === 'mock') {
        const persona = savedPersona()
        setMockUser({ username: persona, roles: MOCK_ROLES[persona] })
      }
      set({ session: await api.whoami(), status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: errorMessage(e) })
    }
  },

  switchMockUser(persona) {
    const session: Session = { username: persona, roles: MOCK_ROLES[persona] }
    setMockUser(session)
    safeStorage('session').set(KEY, persona)
    set({ session })
  },

  can: (role) => get().session?.roles.includes(role) ?? false,
}))
