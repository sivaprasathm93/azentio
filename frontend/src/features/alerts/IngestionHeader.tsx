import { useEffect, useState } from 'react'
import { BellRing, RefreshCw } from 'lucide-react'
import type { Alert } from '@/types/domain'
import { useStream } from './store'
import type { StreamStatus } from '@/lib/realtime/alertStream'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const STATUS: Record<StreamStatus, { label: string; hint: string; color: string; pulse: boolean }> = {
  live: { label: 'Live', hint: 'Receiving alerts over WebSocket', color: 'var(--ok)', pulse: true },
  connecting: { label: 'Connecting', hint: 'Opening the alert stream…', color: 'var(--risk-medium)', pulse: true },
  reconnecting: { label: 'Reconnecting', hint: 'Stream dropped; retrying. The queue refreshes every 15 s meanwhile.', color: 'var(--risk-medium)', pulse: true },
  polling: { label: 'Polling', hint: 'No WebSocket broker reachable; the queue refreshes every 15 s.', color: 'var(--risk-medium)', pulse: false },
  offline: { label: 'Offline', hint: 'The stream was rejected. Check your sign-in and the backend.', color: 'var(--risk-critical)', pulse: false },
}

function Counter({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="min-w-24 border-l border-line pl-3 first:border-l-0 first:pl-0">
      <div className="eyebrow">{label}</div>
      <div className="num text-[22px] font-semibold leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  )
}

export function IngestionHeader({
  alerts,
  updatedAt,
  fetching,
  onRefresh,
  onMerge,
}: {
  alerts: Alert[]
  updatedAt: number
  fetching: boolean
  onRefresh: () => void
  onMerge: () => void
}) {
  const status = useStream((s) => s.status)
  const unread = useStream((s) => s.unread.length)
  const s = STATUS[status]

  // Re-render the "updated Xs ago" label without refetching.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const active = alerts.filter((a) => a.status !== 'CLOSED')
  const critical = active.filter((a) => a.severity === 'CRITICAL').length
  const unassigned = active.filter((a) => !a.assignee && a.status === 'OPEN').length
  const review = active.filter((a) => a.status === 'UNDER_REVIEW').length

  return (
    <header className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <h1 className="display text-[22px] leading-none">Alert queue</h1>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2 py-0.5 font-semibold text-ink"
                title={s.hint}
                role="status"
                aria-live="polite"
              >
                <span className={cn('size-1.5 rounded-full', s.pulse && 'pulse-dot')} style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
              <span>Updated {formatRelative(new Date(updatedAt || Date.now()).toISOString())}</span>
              <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh queue">
                <RefreshCw className={cn(fetching && 'animate-spin')} />
              </Button>
            </div>
          </div>
          <div className="flex gap-3">
            <Counter label="Active" value={active.length} />
            <Counter label="Critical" value={critical} tone={critical ? 'var(--risk-critical)' : undefined} />
            <Counter label="Unassigned" value={unassigned} />
            <Counter label="In review" value={review} />
          </div>
        </div>
      </div>

      {unread > 0 && (
        <div role="status" className="flex items-center justify-between gap-3 border-t border-primary/30 bg-primary/10 px-5 py-1.5 text-[12.5px]">
          <span className="flex items-center gap-2 font-semibold text-primary">
            <BellRing className="size-3.5" />
            {unread} new alert{unread === 1 ? '' : 's'} arrived
          </span>
          <Button size="sm" onClick={onMerge}>
            Show in queue
          </Button>
        </div>
      )}
    </header>
  )
}
