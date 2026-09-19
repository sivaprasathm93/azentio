import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import {
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronRight, ExternalLink, FolderPlus, UserCheck, XCircle } from 'lucide-react'
import type { Alert } from '@/types/domain'
import { api } from '@/lib/api'
import { alertKeys } from '@/hooks/useAlerts'
import { rowAlerts, type GridRow } from '@/lib/grouping'
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format'
import { bandVar, KYC_TIER_LABEL } from '@/lib/risk'
import { cn } from '@/lib/utils'
import { AlertStatusBadge, RiskBadge } from '@/components/RiskBadge'
import { Button } from '@/components/ui/button'
import { Badge, Skeleton, Tip } from '@/components/ui/primitives'
import { useStream } from './store'

const GRID = '136px minmax(210px,1.1fr) minmax(210px,1.3fr) 150px 170px 84px 340px'
const ROW_H = 64
const CHILD_H = 52

export interface RowHandlers {
  onOpen: (row: GridRow) => void
  onAssign: (row: GridRow) => void
  onPromote: (row: GridRow) => void
  onDismiss: (row: GridRow) => void
}

/** Amount for a row. The backend list omits it, so visible rows lazily read their detail (cached for a minute). */
function useRowAmount(row: GridRow): { amount: number | null; loading: boolean } {
  const alerts = rowAlerts(row)
  const missing = alerts.filter((a) => a.aggregatedAmount == null)
  const results = useQueries({
    queries: missing.map((a) => ({
      queryKey: alertKeys.detail(a.id),
      queryFn: () => api.getAlert(a.id),
      staleTime: 60_000,
    })),
  })
  if (!missing.length) return { amount: row.amount, loading: false }
  if (results.some((r) => r.isLoading)) return { amount: null, loading: true }
  if (results.some((r) => !r.data)) return { amount: null, loading: false }
  const fetched = results.reduce((s, r) => s + (r.data?.aggregatedAmount ?? 0), 0)
  const known = alerts.reduce((s, a) => s + (a.aggregatedAmount ?? 0), 0)
  return { amount: fetched + known, loading: false }
}

function AmountCell({ row }: { row: GridRow }) {
  const { amount, loading } = useRowAmount(row)
  if (loading) return <Skeleton className="ml-auto h-4 w-20" />
  return (
    <span className="num text-[13px] font-medium" title={amount == null ? 'Amount not available for this alert' : undefined}>
      {formatMoney(amount, row.currency)}
    </span>
  )
}

function ActionCell({ row, me, h }: { row: GridRow; me: string | undefined; h: RowHandlers }) {
  const alerts = rowAlerts(row)
  const live = alerts.filter((a) => a.status === 'OPEN' || a.status === 'UNDER_REVIEW')
  const canAssign = alerts.some((a) => a.status === 'OPEN')
  const caseId = alerts.find((a) => a.caseId)?.caseId
  const n = row.subRows ? ` (${live.length})` : ''

  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Tip label={canAssign ? 'Start review and assign to you' : me ? 'Already assigned, or not open' : 'Not open'}>
        <span>
          <Button variant="outline" size="sm" disabled={!canAssign} onClick={() => h.onAssign(row)}>
            <UserCheck /> Assign to me
          </Button>
        </span>
      </Tip>
      {live.length === 0 && caseId ? (
        <Button variant="outline" size="sm" asChild>
          <Link to={`/cases/${caseId}`}>
            <ExternalLink /> Open case
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={live.length === 0} onClick={() => h.onPromote(row)}>
          <FolderPlus /> Promote to case
        </Button>
      )}
      <Tip label="Close as false positive (reason required)">
        <span>
          <Button variant="ghost" size="sm" disabled={live.length === 0} onClick={() => h.onDismiss(row)} aria-label={`Dismiss as false positive${n}`}>
            <XCircle /> Dismiss{n}
          </Button>
        </span>
      </Tip>
    </div>
  )
}

const KYC_SHORT = { 1: 'T1', 2: 'T2', 3: 'T3' } as const

function SubjectCell({ a, child }: { a: Alert; child: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn('truncate font-semibold', child && 'text-[12.5px] font-medium text-muted')}>{child ? a.alertRef : a.customerName}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="num truncate text-[11.5px] text-muted">{child ? formatDateTime(a.createdAt) : a.customerRef}</span>
        {!child && (
          <Tip label={`KYC ${KYC_TIER_LABEL[a.kycTier]}`}>
            <Badge tone={a.kycTier === 3 ? 'high' : a.kycTier === 2 ? 'medium' : 'outline'}>KYC {KYC_SHORT[a.kycTier]}</Badge>
          </Tip>
        )}
      </div>
    </div>
  )
}

const GridRowView = memo(function GridRowView({
  row,
  top,
  height,
  index,
  active,
  fresh,
  me,
  handlers,
}: {
  row: Row<GridRow>
  top: number
  height: number
  index: number
  active: boolean
  fresh: boolean
  me: string | undefined
  handlers: RowHandlers
}) {
  const g = row.original
  const a = g.alert
  const child = row.depth > 0
  const expanded = row.getIsExpanded()
  const color = bandVar[a.severity]

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-expanded={row.getCanExpand() ? expanded : undefined}
      data-active={active || undefined}
      onClick={() => handlers.onOpen(g)}
      className={cn(
        'absolute left-0 grid w-full cursor-pointer items-center gap-x-3 border-b border-line pr-4 hover:bg-primary/5',
        child ? 'bg-panel2' : 'bg-panel',
        active && 'bg-primary/10 outline outline-2 -outline-offset-2 outline-primary/60',
        fresh && 'flash-new',
        a.status === 'CLOSED' && 'opacity-70',
      )}
      style={{ top, height, gridTemplateColumns: GRID, borderLeft: `4px solid ${child ? 'var(--line-strong)' : color}` }}
    >
      <div role="cell" className={cn('flex items-center gap-1.5 pl-2', child && 'pl-7')}>
        {row.getCanExpand() ? (
          <button
            aria-label={expanded ? 'Collapse group' : `Expand ${g.groupSize} alerts`}
            className="grid size-5 place-items-center rounded hover:bg-line"
            onClick={(e) => {
              e.stopPropagation()
              row.toggleExpanded()
            }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-5" />
        )}
        <RiskBadge score={g.score} />
        {row.getCanExpand() && (
          <Tip label={`${g.groupSize} alerts for this entity inside one 72-hour window`}>
            <Badge tone="primary" className="num">
              ×{g.groupSize}
            </Badge>
          </Tip>
        )}
      </div>

      <div role="cell" className="min-w-0">
        <SubjectCell a={a} child={child} />
      </div>

      <div role="cell" className="flex min-w-0 flex-wrap gap-1">
        {g.typologies.slice(0, 3).map((t) => (
          <Badge key={t} tone="outline" className="!text-ink">
            {t}
          </Badge>
        ))}
        {g.typologies.length > 3 && (
          <Tip label={g.typologies.slice(3).join(', ')}>
            <Badge tone="outline">+{g.typologies.length - 3}</Badge>
          </Tip>
        )}
      </div>

      <div role="cell" className="text-right">
        <AmountCell row={g} />
      </div>

      <div role="cell" className="min-w-0">
        <AlertStatusBadge status={a.status} />
        <div className="mt-0.5 truncate text-[11.5px] text-muted">{a.assignee ? (a.assignee === me ? 'You' : a.assignee) : 'Unassigned'}</div>
      </div>

      <div role="cell" className="text-[12px] text-muted" title={formatDateTime(g.latestAt)}>
        {formatRelative(g.latestAt)}
      </div>

      <div role="cell">
        <ActionCell row={g} me={me} h={handlers} />
      </div>
    </div>
  )
})

const HEADERS: { id: string; label: string; sortable: boolean; right?: boolean }[] = [
  { id: 'risk', label: 'Risk', sortable: true },
  { id: 'subject', label: 'Subject', sortable: true },
  { id: 'typologies', label: 'Typologies triggered', sortable: false },
  { id: 'amount', label: 'Aggregate amount', sortable: true, right: true },
  { id: 'status', label: 'Status · Assignee', sortable: true },
  { id: 'age', label: 'Age', sortable: true },
  { id: 'actions', label: 'Quick actions', sortable: false, right: true },
]

export function AlertGrid({
  rows,
  me,
  handlers,
  activeId,
  onActive,
  loading,
  empty,
}: {
  rows: GridRow[]
  me: string | undefined
  handlers: RowHandlers
  activeId: string | null
  onActive: (id: string | null) => void
  loading: boolean
  empty: React.ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'risk', desc: true }])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const fresh = useStream((s) => s.fresh)
  const scrollRef = useRef<HTMLDivElement>(null)

  const columns = useMemo<ColumnDef<GridRow>[]>(
    () => [
      { id: 'risk', accessorFn: (r) => r.score },
      { id: 'subject', accessorFn: (r) => r.alert.customerName.toLowerCase() },
      { id: 'typologies', accessorFn: (r) => r.typologies.join(), enableSorting: false },
      { id: 'amount', accessorFn: (r) => r.amount ?? -1, sortUndefined: 'last' },
      { id: 'status', accessorFn: (r) => r.alert.status },
      { id: 'age', accessorFn: (r) => Date.parse(r.latestAt) },
      { id: 'actions', accessorFn: () => '', enableSorting: false },
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getSubRows: (r) => r.subRows,
    getRowId: (r) => r.id,
    getRowCanExpand: (r) => !!r.original.subRows?.length,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetExpanded: false,
    enableSortingRemoval: false,
  })

  const tableRows = table.getRowModel().rows
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (tableRows[i]?.depth ? CHILD_H : ROW_H),
    overscan: 8,
  })

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button,a,input,select,[role=dialog]')) return
      const idx = tableRows.findIndex((r) => r.id === activeId)
      const move = (to: number) => {
        const next = tableRows[Math.max(0, Math.min(tableRows.length - 1, to))]
        if (!next) return
        onActive(next.id)
        virtualizer.scrollToIndex(tableRows.indexOf(next), { align: 'auto' })
      }
      const cur = tableRows[idx]
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          move(idx + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          move(idx < 0 ? 0 : idx - 1)
          break
        case 'ArrowRight':
          if (cur?.getCanExpand() && !cur.getIsExpanded()) {
            e.preventDefault()
            cur.toggleExpanded(true)
          }
          break
        case 'ArrowLeft':
          if (cur?.getIsExpanded()) {
            e.preventDefault()
            cur.toggleExpanded(false)
          }
          break
        case 'Enter':
          if (cur) {
            e.preventDefault()
            handlers.onOpen(cur.original)
          }
          break
      }
    },
    [tableRows, activeId, onActive, virtualizer, handlers],
  )

  // Precompute offsets so rows of two heights position correctly without measuring.
  const items = virtualizer.getVirtualItems()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-auto bg-panel" tabIndex={0} onKeyDown={onKeyDown} aria-label="Alerts. Use arrow keys to move, Enter to open.">
        <div role="table" aria-label="Alert queue" aria-rowcount={tableRows.length + 1} className="min-w-[1240px]">
          <div role="row" className="sticky top-0 z-10 grid items-center gap-x-3 border-b border-line-strong bg-panel2 py-2 pl-[22px] pr-4" style={{ gridTemplateColumns: GRID }}>
            {HEADERS.map((h) => {
              const col = table.getColumn(h.id)!
              const dir = col.getIsSorted()
              return (
                <div key={h.id} role="columnheader" aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(h.right && 'text-right')}>
                  {h.sortable ? (
                    <button className={cn('eyebrow inline-flex items-center gap-1 hover:text-ink', dir && '!text-ink')} onClick={col.getToggleSortingHandler()}>
                      {h.label}
                      {dir === 'asc' ? <ArrowUp className="size-3" /> : dir === 'desc' ? <ArrowDown className="size-3" /> : null}
                    </button>
                  ) : (
                    <span className="eyebrow">{h.label}</span>
                  )}
                </div>
              )
            })}
          </div>

          {loading ? (
            <div aria-busy="true" aria-label="Loading alerts">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="grid items-center gap-x-3 border-b border-line py-3 pl-[22px] pr-4" style={{ gridTemplateColumns: GRID, height: ROW_H }}>
                  <Skeleton className="h-9 w-14" />
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="ml-auto h-4 w-20" />
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="ml-auto h-7 w-64" />
                </div>
              ))}
            </div>
          ) : tableRows.length === 0 ? (
            empty
          ) : (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((v) => {
                const row = tableRows[v.index]
                const g = row.original
                const ids = rowAlerts(g).map((a) => a.id)
                return (
                  <GridRowView
                    key={row.id}
                    row={row}
                    index={v.index}
                    top={v.start}
                    height={v.size}
                    active={activeId === row.id}
                    fresh={ids.some((id) => fresh[id])}
                    me={me}
                    handlers={handlers}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
