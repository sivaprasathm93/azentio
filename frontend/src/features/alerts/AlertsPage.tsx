import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Alert } from '@/types/domain'
import { useAlertActions, useAlertList, type BulkResult } from '@/hooks/useAlerts'
import { useAuth } from '@/features/auth/authStore'
import { config } from '@/lib/config'
import { errorMessage } from '@/lib/api'
import { groupAlerts, rowAlerts, ungrouped, type GridRow } from '@/lib/grouping'
import { ErrorPanel, EmptyState } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { AlertFilters } from './AlertFilters'
import { AlertGrid, type RowHandlers } from './AlertGrid'
import { AlertPeek } from './AlertPeek'
import { DismissDialog, eligibleAlerts, PromoteDialog } from './AlertDialogs'
import { IngestionHeader } from './IngestionHeader'
import { applyFilters } from './filtering'
import { useAlertFilters, useStream } from './store'

function report(verb: string, r: BulkResult) {
  if (r.failed === 0) toast.success(`${verb} ${r.ok} alert${r.ok === 1 ? '' : 's'}`)
  else if (r.ok === 0) toast.error(r.firstError ?? `Could not ${verb.toLowerCase()} the alert`)
  else toast.warning(`${verb} ${r.ok}, ${r.failed} failed: ${r.firstError}`)
}

export default function AlertsPage() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.session?.username)
  const isSupervisor = useAuth((s) => s.can('SUPERVISOR'))
  const list = useAlertList()
  const filters = useAlertFilters()
  const { act, promote } = useAlertActions()

  const [peek, setPeek] = useState<Alert | null>(null)
  const [dismissRow, setDismissRow] = useState<GridRow | null>(null)
  const [promoteRow, setPromoteRow] = useState<GridRow | null>(null)

  const all = list.data ?? []
  const filtered = useMemo(() => applyFilters(all, filters, me), [all, filters, me])
  const rows = useMemo(
    () => (filters.groupByEntity ? groupAlerts(filtered, config.aggregationWindowHours) : ungrouped(filtered)),
    [filtered, filters.groupByEntity],
  )

  const merge = useCallback(() => {
    useStream.getState().markMerged()
    void list.refetch()
  }, [list])

  const handlers = useMemo<RowHandlers>(
    () => ({
      onOpen: (row) => {
        filters.set({ activeId: row.id })
        setPeek(row.alert)
      },
      onAssign: async (row) => {
        const open = rowAlerts(row).filter((a) => a.status === 'OPEN')
        report('Assigned to you:', await act.mutateAsync({ alerts: open, action: { action: 'START_REVIEW' } }))
      },
      onPromote: setPromoteRow,
      onDismiss: setDismissRow,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act],
  )

  async function confirmDismiss(reason: string) {
    if (!dismissRow) return
    const r = await act.mutateAsync({
      alerts: eligibleAlerts(dismissRow),
      action: { action: 'CLOSE', disposition: 'FALSE_POSITIVE', reason },
    })
    report('Dismissed', r)
    if (r.ok > 0) {
      setDismissRow(null)
      setPeek(null)
    }
  }

  async function confirmPromote(title: string, reason: string) {
    if (!promoteRow) return
    try {
      const d = await promote.mutateAsync({ alerts: eligibleAlerts(promoteRow), title, reason })
      toast.success(`${d.case.caseRef} opened`)
      setPromoteRow(null)
      setPeek(null)
      navigate(`/cases/${d.case.id}`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <IngestionHeader alerts={all} updatedAt={list.dataUpdatedAt} fetching={list.isFetching} onRefresh={() => list.refetch()} onMerge={merge} />
      <AlertFilters alerts={all} me={me} shown={filtered.length} />
      {list.isError ? (
        <ErrorPanel title="The alert queue could not be loaded" message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <AlertGrid
          rows={rows}
          me={me}
          handlers={handlers}
          activeId={filters.activeId}
          onActive={(id) => filters.set({ activeId: id })}
          loading={list.isLoading}
          empty={
            <EmptyState
              title={all.length ? 'No alerts match these filters' : 'The queue is clear'}
              hint={all.length ? 'Widen the risk bands or date range, or clear the filters.' : 'New alerts appear here as they are raised.'}
              action={all.length ? <Button variant="outline" onClick={filters.reset}>Clear filters</Button> : undefined}
            />
          }
        />
      )}

      <AlertPeek alert={peek} onClose={() => setPeek(null)} onPromote={setPromoteRow} onDismiss={setDismissRow} />
      <DismissDialog row={dismissRow} onClose={() => setDismissRow(null)} onConfirm={confirmDismiss} busy={act.isPending} isSupervisor={isSupervisor} />
      <PromoteDialog row={promoteRow} onClose={() => setPromoteRow(null)} onConfirm={confirmPromote} busy={promote.isPending} />
    </div>
  )
}
