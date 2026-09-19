import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AlertDetail, AMLTransaction, AuditEntry, CaseDetail } from '@/types/domain'
import { alertKeys } from './useAlerts'
import { useCustomerTransactions } from './useCases'

export interface CaseEvidence {
  loading: boolean
  error: Error | null
  details: AlertDetail[]
  /** Every transaction for the customer (baseline + flagged). */
  transactions: AMLTransaction[]
  /** Transactions that are evidence for an alert in this case. */
  flagged: AMLTransaction[]
  /** Case audit merged with each alert's history, oldest first. */
  audit: AuditEntry[]
}

/** Gathers what the three panes need from a case: alert details, the ledger, and a merged audit trail. */
export function useCaseEvidence(c: CaseDetail | undefined): CaseEvidence {
  const alerts = c?.alerts ?? []
  const detailQs = useQueries({
    queries: alerts.map((a) => ({ queryKey: alertKeys.detail(a.id), queryFn: () => api.getAlert(a.id), staleTime: 30_000 })),
  })
  const historyQs = useQueries({
    queries: alerts.map((a) => ({ queryKey: alertKeys.history(a.id), queryFn: () => api.getAlertHistory(a.id), staleTime: 15_000 })),
  })
  const txns = useCustomerTransactions(c?.case.customerId)

  const details = useMemo(() => detailQs.map((q) => q.data).filter((d): d is AlertDetail => !!d), [detailQs])

  const transactions = useMemo(() => {
    const byId = new Map<string, AMLTransaction>()
    for (const t of txns.data ?? []) byId.set(t.id, t)
    // Evidence not inside the timeline window is still part of the case.
    for (const d of details) for (const t of d.transactions) if (!byId.has(t.id)) byId.set(t.id, t)
    return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }, [txns.data, details])

  const flagged = useMemo(() => {
    const refs = new Set(alerts.map((a) => a.alertRef))
    const evidenceIds = new Set(details.flatMap((d) => d.transactions.map((t) => t.id)))
    return transactions.filter((t) => t.alertRefs.some((r) => refs.has(r)) || evidenceIds.has(t.id)).map((t) => ({ ...t, isFlagged: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, details, c])

  const audit = useMemo(() => {
    const all = [...(c?.audit ?? []), ...historyQs.flatMap((q) => q.data ?? [])]
    const seen = new Set<string>()
    return all
      .filter((e) => (seen.has(`${e.entityType}:${e.id}`) ? false : (seen.add(`${e.entityType}:${e.id}`), true)))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || Number(a.id) - Number(b.id))
  }, [c, historyQs])

  return {
    loading: detailQs.some((q) => q.isLoading) || txns.isLoading,
    error: (txns.error as Error | null) ?? (detailQs.find((q) => q.error)?.error as Error | undefined) ?? null,
    details,
    transactions,
    flagged,
    audit,
  }
}
