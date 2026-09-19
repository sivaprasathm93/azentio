import type { AlertStatus, CaseStatus, RiskBand } from '@/types/domain'
import { bandFor, bandLabel, bandVar } from '@/lib/risk'
import { Badge } from '@/components/ui/primitives'
import { humanizeEnum } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Score with a segmented meter and its band name: colour is never the only carrier of meaning. */
export function RiskBadge({ score, className }: { score: number; className?: string }) {
  const band = bandFor(score)
  const color = bandVar[band]
  return (
    <span className={cn('inline-flex w-[52px] flex-col items-stretch', className)} aria-label={`Risk score ${score}, ${bandLabel(band)}`}>
      <span className="num text-center text-[17px] font-semibold leading-none" style={{ color }}>
        {score}
      </span>
      <span className="mt-1 flex h-[3px] gap-px" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-full flex-1 rounded-[1px]" style={{ background: score >= (i + 1) * 20 - 10 ? color : 'var(--line)' }} />
        ))}
      </span>
      <span className="eyebrow mt-0.5 text-center !text-[9px]" style={{ color }}>
        {band}
      </span>
    </span>
  )
}

export function BandDot({ band, className }: { band: RiskBand; className?: string }) {
  return <span className={cn('inline-block size-2 rounded-full', className)} style={{ background: bandVar[band] }} aria-hidden />
}

const ALERT_TONE: Record<AlertStatus, 'primary' | 'medium' | 'high' | 'neutral'> = {
  OPEN: 'primary',
  UNDER_REVIEW: 'medium',
  ESCALATED: 'high',
  CLOSED: 'neutral',
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  return <Badge tone={ALERT_TONE[status]}>{humanizeEnum(status)}</Badge>
}

const CASE_TONE: Record<CaseStatus, 'primary' | 'medium' | 'high' | 'neutral'> = {
  OPEN: 'primary',
  INVESTIGATING: 'medium',
  SAR_FILED: 'high',
  CLOSED: 'neutral',
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone={CASE_TONE[status]}>{humanizeEnum(status)}</Badge>
}
