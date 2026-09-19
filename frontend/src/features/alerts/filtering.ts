import type { Alert, RiskBand } from '@/types/domain'
import { BAND_ORDER } from '@/lib/risk'
import type { AssigneeFilter, DatePreset } from './store'

export interface FilterInput {
  bands: RiskBand[]
  typologies: string[]
  assignee: AssigneeFilter
  datePreset: DatePreset
  from: string | null
  to: string | null
  search: string
}

const PRESET_MS: Partial<Record<DatePreset, number>> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

function inDateRange(a: Alert, f: FilterInput, now: number) {
  const t = Date.parse(a.createdAt)
  const span = PRESET_MS[f.datePreset]
  if (span) return t >= now - span
  if (f.datePreset === 'CUSTOM') {
    if (f.from && t < Date.parse(f.from)) return false
    // "to" is a date; include the whole day
    if (f.to && t > Date.parse(f.to) + 86_400_000 - 1) return false
  }
  return true
}

/** Every facet except the risk bands, so band chips can show the count they would yield. */
function applyNonBand(alerts: Alert[], f: FilterInput, me: string | undefined, now: number): Alert[] {
  const q = f.search.trim().toLowerCase()
  return alerts.filter((a) => {
    if (f.typologies.length && !a.evidence.some((e) => f.typologies.includes(e.typology))) return false
    if (f.assignee === 'ME' && a.assignee !== me) return false
    if (f.assignee === 'UNASSIGNED' && a.assignee) return false
    if (!inDateRange(a, f, now)) return false
    if (q && !`${a.customerName} ${a.customerRef} ${a.alertRef}`.toLowerCase().includes(q)) return false
    return true
  })
}

export function applyFilters(alerts: Alert[], f: FilterInput, me: string | undefined, now = Date.now()): Alert[] {
  const base = applyNonBand(alerts, f, me, now)
  return f.bands.length ? base.filter((a) => f.bands.includes(a.severity)) : base
}

export function bandCounts(alerts: Alert[], f: FilterInput, me: string | undefined, now = Date.now()): Record<RiskBand, number> {
  const counts = Object.fromEntries(BAND_ORDER.map((b) => [b, 0])) as Record<RiskBand, number>
  for (const a of applyNonBand(alerts, f, me, now)) counts[a.severity] += 1
  return counts
}

export function activeFilterCount(f: FilterInput & { scope: string }) {
  return (
    f.bands.length +
    f.typologies.length +
    (f.assignee !== 'ANY' ? 1 : 0) +
    (f.datePreset !== 'ALL' ? 1 : 0) +
    (f.search.trim() ? 1 : 0) +
    (f.scope !== 'ACTIVE' ? 1 : 0)
  )
}
