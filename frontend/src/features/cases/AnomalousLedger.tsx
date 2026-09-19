import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Table2 } from 'lucide-react'
import type { AMLTransaction } from '@/types/domain'
import { formatDateTime, formatMoney, humanizeEnum } from '@/lib/format'
import { countryName } from '@/lib/fatf'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Row = AMLTransaction & { multiple: number | null }

const col = createColumnHelper<Row>()

export function AnomalousLedger({ transactions, currency }: { transactions: AMLTransaction[]; currency: string }) {
  const [scope, setScope] = useState<'flagged' | 'all'>('flagged')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'time', desc: true }])

  // Baseline = what this customer normally does, i.e. every transaction that is *not* evidence, by direction.
  const { rows, base } = useMemo(() => {
    const normal = transactions.filter((t) => !t.isFlagged)
    const base = { CREDIT: median(normal.filter((t) => t.direction === 'CREDIT').map((t) => t.amountBase)), DEBIT: median(normal.filter((t) => t.direction === 'DEBIT').map((t) => t.amountBase)), n: normal.length }
    const rows: Row[] = transactions.map((t) => ({ ...t, multiple: base[t.direction] > 0 ? t.amountBase / base[t.direction] : null }))
    return { rows, base }
  }, [transactions])

  const data = useMemo(() => (scope === 'flagged' ? rows.filter((r) => r.isFlagged) : rows), [rows, scope])

  const columns = useMemo(
    () => [
      col.accessor((r) => Date.parse(r.timestamp), {
        id: 'time',
        header: 'When',
        cell: (c) => <span className="num whitespace-nowrap">{formatDateTime(c.row.original.timestamp)}</span>,
      }),
      col.accessor('accountId', { header: 'Account', enableSorting: false, cell: (c) => <span className="num text-[11.5px]">{c.getValue()}</span> }),
      col.accessor('counterpartyName', {
        header: 'Counterparty',
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{c.getValue()}</div>
            <div className="text-[11px] text-muted">
              {countryName(c.row.original.counterpartyCountry)} · {humanizeEnum(c.row.original.channel)}
              {c.row.original.branch ? ` · ${c.row.original.branch}` : ''}
            </div>
          </div>
        ),
      }),
      col.accessor((r) => (r.direction === 'CREDIT' ? r.amountBase : -r.amountBase), {
        id: 'amount',
        header: 'Amount',
        meta: { right: true },
        cell: (c) => {
          const t = c.row.original
          return (
            <div className="num text-right">
              <span className={t.direction === 'CREDIT' ? 'text-low' : ''}>{t.direction === 'CREDIT' ? '+' : '−'}</span>
              {formatMoney(t.amount, t.currency)}
              {t.currency !== currency && <div className="text-[11px] text-muted">{formatMoney(t.amountBase, currency)}</div>}
            </div>
          )
        },
      }),
      col.accessor((r) => r.multiple ?? 0, {
        id: 'multiple',
        header: 'vs baseline',
        meta: { right: true },
        cell: (c) => {
          const m = c.row.original.multiple
          if (m == null) return <span className="text-muted">—</span>
          const hot = m >= 5
          return (
            <span className={cn('num font-semibold', hot ? 'text-critical' : m >= 2 ? 'text-high' : 'text-muted')} title={`${m.toFixed(1)}× this customer's median ${c.row.original.direction.toLowerCase()}`}>
              {m >= 10 ? Math.round(m) : m.toFixed(1)}×
            </span>
          )
        },
      }),
      col.display({
        id: 'flag',
        header: '',
        cell: (c) => (c.row.original.isFlagged ? <Badge tone="critical">Evidence</Badge> : null),
      }),
    ],
    [currency],
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
    autoResetPageIndex: true,
  })

  return (
    <section aria-label="Anomalous ledger" className="overflow-hidden rounded-[var(--radius)] border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="eyebrow flex items-center gap-1.5">
          <Table2 className="size-3" /> Anomalous ledger
        </h3>
        <div role="group" aria-label="Ledger scope" className="flex overflow-hidden rounded border border-line-strong text-[11.5px] font-semibold">
          {(['flagged', 'all'] as const).map((s) => (
            <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)} className={cn('px-2 py-1', scope === s ? 'bg-ink text-bg' : 'bg-panel text-muted hover:text-ink')}>
              {s === 'flagged' ? `Offending (${rows.filter((r) => r.isFlagged).length})` : `All (${rows.length})`}
            </button>
          ))}
        </div>
      </div>
      <div className="border-b border-line bg-panel2 px-4 py-1.5 text-[11.5px] text-muted">
        Baseline from {base.n} ordinary transactions: median credit <span className="num text-ink">{formatMoney(base.CREDIT, currency)}</span>, median debit{' '}
        <span className="num text-ink">{formatMoney(base.DEBIT, currency)}</span>.
      </div>

      {data.length === 0 ? (
        <div className="p-6 text-center text-[12px] text-muted">No transactions in this view.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="bg-panel2">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const dir = h.column.getIsSorted()
                    const right = (h.column.columnDef.meta as { right?: boolean } | undefined)?.right
                    return (
                      <th key={h.id} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('px-3 py-1.5 text-left', right && 'text-right')}>
                        {h.column.getCanSort() ? (
                          <button className="eyebrow inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {dir === 'asc' ? <ArrowUp className="size-3" /> : dir === 'desc' ? <ArrowDown className="size-3" /> : null}
                          </button>
                        ) : (
                          <span className="eyebrow">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr key={r.id} className={cn('border-t border-line', r.original.isFlagged && 'bg-critical/5')} style={r.original.isFlagged ? { boxShadow: 'inset 3px 0 0 var(--risk-critical)' } : undefined}>
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className="px-3 py-2 align-top">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[12px] text-muted">
          <span>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
