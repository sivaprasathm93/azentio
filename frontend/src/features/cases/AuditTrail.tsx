import { ArrowRight, Lock } from 'lucide-react'
import type { AuditEntry } from '@/types/domain'
import { formatDateTime, humanizeEnum } from '@/lib/format'
import { Badge } from '@/components/ui/primitives'

function label(a: AuditEntry) {
  return humanizeEnum(a.action.replace(/^(ALERT|CASE|RULE)_/, ''))
}

function detail(d: Record<string, unknown>): string | null {
  const reason = d.reason ?? d.preview
  if (typeof reason === 'string' && reason) return reason
  if (typeof d.disposition === 'string') return humanizeEnum(d.disposition)
  return null
}

/** Append-only history, oldest first. There is deliberately no sort, edit or delete control. */
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded border border-line bg-panel2 p-2.5 text-[11.5px] text-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        <span>Locked. Entries are written by the system, cannot be edited or removed, and are ordered oldest first.</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12px] text-muted">No audit entries yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line-strong pl-4">
          {entries.map((e) => {
            const note = detail(e.details)
            return (
              <li key={`${e.entityType}-${e.id}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-panel bg-line-strong" aria-hidden />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[12.5px] font-semibold">{label(e)}</span>
                  <Badge tone="outline">{e.entityType === 'ALERT' ? e.entityId : e.entityType.toLowerCase()}</Badge>
                </div>
                {(e.fromState || e.toState) && e.fromState !== e.toState && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted">
                    {e.fromState ? humanizeEnum(e.fromState) : 'New'} <ArrowRight className="size-3" /> {e.toState ? humanizeEnum(e.toState) : '—'}
                  </div>
                )}
                {note && <p className="mt-0.5 text-[12px] text-ink/80">“{note}”</p>}
                <div className="mt-0.5 text-[11px] text-muted">
                  <span className="font-medium text-ink">{e.actor}</span> · {formatDateTime(e.occurredAt)}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
