import type { Alert, KycTier, RiskBand } from '@/types/domain'

/**
 * Single source of truth for score -> band. Note the backend's own `riskBand` uses CRITICAL >= 80; the UI
 * follows the product spec (CRITICAL 90-100) and always derives the band from the numeric score.
 */
export const RISK_BANDS: { band: RiskBand; min: number; max: number; label: string }[] = [
  { band: 'CRITICAL', min: 90, max: 100, label: 'Critical' },
  { band: 'HIGH', min: 70, max: 89, label: 'High' },
  { band: 'MEDIUM', min: 40, max: 69, label: 'Medium' },
  { band: 'LOW', min: 0, max: 39, label: 'Low' },
]

export const BAND_ORDER: RiskBand[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function bandFor(score: number): RiskBand {
  for (const b of RISK_BANDS) if (score >= b.min) return b.band
  return 'LOW'
}

export function bandRange(band: RiskBand) {
  return RISK_BANDS.find((b) => b.band === band)!
}

export function bandLabel(band: RiskBand) {
  return bandRange(band).label
}

/** CSS custom property references defined in index.css. */
export const bandVar: Record<RiskBand, string> = {
  CRITICAL: 'var(--risk-critical)',
  HIGH: 'var(--risk-high)',
  MEDIUM: 'var(--risk-medium)',
  LOW: 'var(--risk-low)',
}

export function kycTierFromRating(rating: string | null | undefined): KycTier {
  switch ((rating ?? '').toUpperCase()) {
    case 'HIGH':
      return 3
    case 'MEDIUM':
      return 2
    default:
      return 1
  }
}

/** The backend stores a categorical KYC rating only; this gives the queue a comparable 0-100 figure. */
export function ratingToScore(rating: string | null | undefined): number {
  switch ((rating ?? '').toUpperCase()) {
    case 'HIGH':
      return 80
    case 'MEDIUM':
      return 50
    default:
      return 20
  }
}

export const KYC_TIER_LABEL: Record<KycTier, string> = {
  1: 'Tier 1 · Standard',
  2: 'Tier 2 · Enhanced',
  3: 'Tier 3 · High-risk EDD',
}

/** Mirrors the backend four-eyes guardrail: score >= 80 or any sanctions/high-risk-jurisdiction hit needs a supervisor to close. */
export const SUPERVISOR_CLOSE_SCORE = 80

export function requiresSupervisor(a: Pick<Alert, 'overallScore' | 'evidence'>) {
  return a.overallScore >= SUPERVISOR_CLOSE_SCORE || a.evidence.some((e) => e.ruleId === 'HIGH_RISK_JURISDICTION')
}
