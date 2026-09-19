import type { AMLTransaction } from '@/types/domain'

export function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Population standard deviation. */
export function stdDev(xs: number[], mu = mean(xs)) {
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
}

export interface DeviationPoint {
  day: string
  value: number
  mean: number | null
  upper: number | null
  lower: number | null
  /** [lower, upper] for the Recharts range area; null while the baseline is warming up. */
  band: [number, number] | null
  anomalous: boolean
}

const DAY = 86_400_000

function dayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Daily transaction value against a trailing moving-average band (mu +/- k*sigma).
 * The baseline for day D uses only days before D so a spike cannot inflate its own bound.
 * Days without activity count as zero, which is what an analyst expects a "normal day" to look like.
 */
export function computeDeviation(
  txns: Pick<AMLTransaction, 'timestamp' | 'amountBase'>[],
  opts: { window?: number; k?: number; minBaseline?: number } = {},
): DeviationPoint[] {
  const { window = 14, k = 2, minBaseline = 7 } = opts
  if (txns.length === 0) return []
  const totals = new Map<string, number>()
  let min = Infinity
  let max = -Infinity
  for (const t of txns) {
    const ms = Date.parse(t.timestamp)
    if (Number.isNaN(ms)) continue
    const start = Math.floor(ms / DAY) * DAY
    min = Math.min(min, start)
    max = Math.max(max, start)
    const key = dayKey(start)
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(t.amountBase))
  }
  if (!Number.isFinite(min)) return []

  const days: number[] = []
  for (let d = min; d <= max; d += DAY) days.push(d)
  const values = days.map((d) => totals.get(dayKey(d)) ?? 0)

  return days.map((d, i) => {
    const value = values[i]
    const base = values.slice(Math.max(0, i - window), i)
    if (base.length < minBaseline) {
      return { day: dayKey(d), value, mean: null, upper: null, lower: null, band: null, anomalous: false }
    }
    const mu = mean(base)
    const sigma = stdDev(base, mu)
    const upper = mu + k * sigma
    const lower = Math.max(0, mu - k * sigma)
    return { day: dayKey(d), value, mean: mu, upper, lower, band: [lower, upper], anomalous: value > upper && value > 0 }
  })
}
