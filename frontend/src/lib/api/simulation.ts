import type { Alert, SimulationResult } from '@/types/domain'

type Params = Record<string, unknown>

function num(p: Params, key: string, fallback: number): number {
  const v = Number(p[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Relative alert volume after the change (1 = unchanged). This is a transparent sensitivity model, not a replay:
 * loosening a threshold scales alert volume up, tightening scales it down. The backend has no simulate endpoint
 * yet, so results are labelled "estimate" in the UI. When one exists, http.ts prefers it.
 */
export function impactFactor(code: string, before: Params, after: Params, countriesBefore: number, countriesAfter: number): number {
  const ratio = (a: number, b: number) => (b === 0 ? 1 : a / b)
  switch (code) {
    case 'STRUCTURING': {
      const widthB = num(before, 'upperAmount', 9999.99) - num(before, 'lowerAmount', 9000)
      const widthA = num(after, 'upperAmount', 9999.99) - num(after, 'lowerAmount', 9000)
      return (
        Math.pow(ratio(widthA, widthB), 0.8) *
        ratio(num(before, 'minCount', 3), num(after, 'minCount', 3)) *
        Math.pow(ratio(num(after, 'windowHours', 24), num(before, 'windowHours', 24)), 0.5)
      )
    }
    case 'RAPID_MOVEMENT':
      return (
        Math.pow(ratio(num(before, 'outflowRatio', 0.8), num(after, 'outflowRatio', 0.8)), 1.5) *
        Math.pow(ratio(num(after, 'windowHours', 48), num(before, 'windowHours', 48)), 0.6) *
        Math.pow(ratio(num(before, 'minInflowAmount', 5000), num(after, 'minInflowAmount', 5000)), 0.3)
      )
    case 'HIGH_RISK_JURISDICTION':
      return ratio(countriesAfter + 1, countriesBefore + 1)
    default:
      return 1
  }
}

export function estimateImpact(
  code: string,
  before: Params,
  after: Params,
  alerts: Alert[],
  countries: { before: number; after: number },
  windowDays = 30,
): SimulationResult {
  const cutoff = Date.now() - windowDays * 86_400_000
  const relevant = alerts.filter((a) => Date.parse(a.createdAt) >= cutoff && a.evidence.some((e) => e.ruleId === code))
  const current = relevant.length
  const factor = impactFactor(code, before, after, countries.before, countries.after)
  const projected = Math.max(0, Math.round(current * factor))
  const suppressed = Math.max(0, current - projected)
  const newlyRaised = Math.max(0, projected - current)
  const critShare = current ? relevant.filter((a) => a.severity === 'CRITICAL').length / current : 0

  const samples = [...relevant]
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, Math.min(suppressed, 5))
    .map((a) => ({ alertRef: a.alertRef, customerName: a.customerName, change: 'SUPPRESSED' as const, score: a.overallScore }))

  return {
    code,
    windowDays,
    currentAlerts: current,
    projectedAlerts: projected,
    newlyRaised,
    suppressed,
    criticalDelta: Math.round((projected - current) * critShare),
    source: 'estimate',
    samples,
  }
}
