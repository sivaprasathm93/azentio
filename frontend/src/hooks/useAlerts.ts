import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { Alert, AlertAction, AlertStatus } from '@/types/domain'
import { useStream, type StatusScope } from '@/features/alerts/store'
import { useAlertFilters } from '@/features/alerts/store'

export const alertKeys = {
  all: ['alerts'] as const,
  list: (scope: StatusScope) => ['alerts', 'list', scope] as const,
  detail: (id: string) => ['alerts', 'detail', id] as const,
  history: (id: string) => ['alerts', 'history', id] as const,
}

const SCOPE_STATUSES: Record<StatusScope, AlertStatus[] | undefined> = {
  ACTIVE: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'],
  CLOSED: ['CLOSED'],
  ALL: undefined,
}

/** Polls faster when the push channel is down; the stream makes polling a safety net rather than the mechanism. */
export function useAlertList() {
  const scope = useAlertFilters((s) => s.scope)
  const status = useStream((s) => s.status)
  return useQuery({
    queryKey: alertKeys.list(scope),
    queryFn: async () => (await api.listAlerts({ statuses: SCOPE_STATUSES[scope], size: 200 })).content,
    refetchInterval: status === 'live' ? 60_000 : 15_000,
    staleTime: 5_000,
  })
}

export function useAlertDetail(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: alertKeys.detail(id ?? ''),
    queryFn: () => api.getAlert(id!),
    enabled: !!id && enabled,
    staleTime: 60_000,
  })
}

export function useAlertHistory(id: string | undefined) {
  return useQuery({ queryKey: alertKeys.history(id ?? ''), queryFn: () => api.getAlertHistory(id!), enabled: !!id })
}

export interface BulkResult {
  ok: number
  failed: number
  firstError?: string
}

export function useAlertActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: alertKeys.all })

  const act = useMutation({
    mutationFn: async ({ alerts, action }: { alerts: Alert[]; action: AlertAction }): Promise<BulkResult> => {
      const results = await Promise.allSettled(alerts.map((a) => api.actOnAlert(a.id, action)))
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      return { ok: results.length - failed.length, failed: failed.length, firstError: failed[0] ? errorMessage(failed[0].reason) : undefined }
    },
    onSettled: done,
  })

  const promote = useMutation({
    mutationFn: ({ alerts, title, reason }: { alerts: Alert[]; title: string; reason: string }) =>
      api.createCase(alerts.map((a) => a.id), title, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
    onSettled: done,
    onError: (e) => toast.error(errorMessage(e)),
  })

  return { act, promote }
}
