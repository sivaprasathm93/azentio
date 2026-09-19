import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RuleUpdate, SimulationRequest } from '@/types/domain'

export const ruleKeys = { rules: ['rules'] as const, watchlist: ['watchlist'] as const }

export function useRules() {
  return useQuery({ queryKey: ruleKeys.rules, queryFn: () => api.listRules() })
}

export function useWatchlist() {
  return useQuery({ queryKey: ruleKeys.watchlist, queryFn: () => api.listWatchlist() })
}

export function useSimulateRule() {
  return useMutation({ mutationFn: (req: SimulationRequest) => api.simulateRule(req) })
}

export function useCommitRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, update }: { code: string; update: RuleUpdate }) => api.updateRule(code, update),
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.rules }),
  })
}

/** Applies a set of country codes to the jurisdiction watchlist: activate/add the new, deactivate the removed. */
export function useCommitCountries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ next, reason }: { next: string[]; reason: string }) => {
      const current = await api.listWatchlist()
      const countries = current.filter((w) => w.entryType === 'COUNTRY')
      const want = new Set(next)
      const ops: Promise<unknown>[] = []
      for (const w of countries) {
        if (w.active && !want.has(w.value)) ops.push(api.setWatchlistActive(w.id, false, reason))
        if (!w.active && want.has(w.value)) ops.push(api.setWatchlistActive(w.id, true, reason))
      }
      const known = new Set(countries.map((w) => w.value))
      for (const code of next) if (!known.has(code)) ops.push(api.addWatchlistCountry(code, 'INTERNAL_WATCHLIST', reason))
      await Promise.all(ops)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ruleKeys.watchlist }),
  })
}
