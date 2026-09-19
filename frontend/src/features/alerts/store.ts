import { create } from 'zustand'
import type { RiskBand } from '@/types/domain'
import type { StreamStatus } from '@/lib/realtime/alertStream'

export type AssigneeFilter = 'ANY' | 'ME' | 'UNASSIGNED'
export type DatePreset = '24h' | '7d' | '30d' | 'ALL' | 'CUSTOM'
export type StatusScope = 'ACTIVE' | 'CLOSED' | 'ALL'

interface FilterState {
  bands: RiskBand[]
  typologies: string[]
  assignee: AssigneeFilter
  datePreset: DatePreset
  from: string | null
  to: string | null
  scope: StatusScope
  search: string
  groupByEntity: boolean
  /** Keyboard / peek focus in the grid. */
  activeId: string | null
  toggleBand: (b: RiskBand) => void
  toggleTypology: (t: string) => void
  set: (p: Partial<Omit<FilterState, 'set' | 'toggleBand' | 'toggleTypology' | 'reset'>>) => void
  reset: () => void
}

const defaults = {
  bands: [] as RiskBand[],
  typologies: [] as string[],
  assignee: 'ANY' as AssigneeFilter,
  datePreset: 'ALL' as DatePreset,
  from: null as string | null,
  to: null as string | null,
  scope: 'ACTIVE' as StatusScope,
  search: '',
  groupByEntity: true,
  activeId: null as string | null,
}

export const useAlertFilters = create<FilterState>((set) => ({
  ...defaults,
  toggleBand: (b) => set((s) => ({ bands: s.bands.includes(b) ? s.bands.filter((x) => x !== b) : [...s.bands, b] })),
  toggleTypology: (t) => set((s) => ({ typologies: s.typologies.includes(t) ? s.typologies.filter((x) => x !== t) : [...s.typologies, t] })),
  set: (p) => set(p),
  reset: () => set({ ...defaults }),
}))

interface StreamState {
  status: StreamStatus
  /** Alert ids that arrived over the stream and are not yet merged into the visible queue. */
  unread: string[]
  /** Ids merged in the last few seconds; the grid flashes these rows. */
  fresh: Record<string, number>
  setStatus: (s: StreamStatus) => void
  push: (id: string) => void
  markMerged: () => void
  pruneFresh: (olderThanMs: number) => void
}

export const useStream = create<StreamState>((set) => ({
  status: 'connecting',
  unread: [],
  fresh: {},
  setStatus: (status) => set({ status }),
  push: (id) => set((s) => (s.unread.includes(id) ? s : { unread: [...s.unread, id] })),
  markMerged: () =>
    set((s) => {
      const now = Date.now()
      const fresh = { ...s.fresh }
      s.unread.forEach((id) => (fresh[id] = now))
      return { unread: [], fresh }
    }),
  pruneFresh: (olderThanMs) =>
    set((s) => {
      const cutoff = Date.now() - olderThanMs
      const fresh = Object.fromEntries(Object.entries(s.fresh).filter(([, t]) => t > cutoff))
      return Object.keys(fresh).length === Object.keys(s.fresh).length ? s : { fresh }
    }),
}))
