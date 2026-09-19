import { Quote } from 'lucide-react'
import type { AlertDetail } from '@/types/domain'
import { bandFor, bandVar } from '@/lib/risk'
import { Badge, Skeleton } from '@/components/ui/primitives'

/** Plain-language justification, assembled from the rule explanations the detection engine recorded. */
export function ExplainabilityCard({ details, loading }: { details: AlertDetail[]; loading: boolean }) {
  const ordered = [...details].sort((a, b) => b.overallScore - a.overallScore)
  const top = ordered[0]
  const color = bandVar[bandFor(top?.overallScore ?? 0)]

  return (
    <section aria-label="Why this case was raised" className="relative overflow-hidden rounded-[var(--radius)] border border-line bg-panel">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
      <div className="px-5 py-4">
        <h3 className="eyebrow mb-2 flex items-center gap-1.5">
          <Quote className="size-3" /> Why this case exists
        </h3>
        {loading && !top ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-[13px] text-muted">No explanation was recorded for the alerts in this case.</p>
        ) : (
          <div className="space-y-3">
            {ordered.map((d) => (
              <div key={d.id}>
                <p className="text-[14px] leading-relaxed">{d.explanation || 'No explanation was recorded.'}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="num text-[11.5px] text-muted">{d.alertRef}</span>
                  {d.evidence.map((e) => (
                    <Badge key={e.ruleId} tone="outline" title={e.ruleName}>
                      {e.typology}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
