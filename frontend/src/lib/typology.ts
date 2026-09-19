/** Rule code -> analyst-facing name and typology tag. Unknown codes are humanised rather than hidden. */
const META: Record<string, { name: string; typology: string }> = {
  CTR_THRESHOLD: { name: 'Large transaction (CTR)', typology: 'Large cash' },
  STRUCTURING: { name: 'Structuring / smurfing', typology: 'Structuring' },
  RAPID_MOVEMENT: { name: 'Rapid movement of funds', typology: 'Layering' },
  HIGH_RISK_JURISDICTION: { name: 'High-risk jurisdiction / sanctioned party', typology: 'High-risk jurisdiction' },
  BEHAVIORAL_DEVIATION: { name: 'Behavioural deviation', typology: 'Behavioural anomaly' },
  ROUND_AMOUNT: { name: 'Repeated round amounts', typology: 'Round amounts' },
}

function humanise(code: string) {
  const s = code.toLowerCase().replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ruleMeta(code: string) {
  return META[code] ?? { name: humanise(code), typology: humanise(code) }
}

/** Typology label -> rule codes that raise it (for server-side ruleCode filtering). */
export function ruleCodesForTypology(typology: string): string[] {
  return Object.entries(META)
    .filter(([, m]) => m.typology === typology)
    .map(([code]) => code)
}

export const ALL_TYPOLOGIES = [
  'Structuring',
  'Layering',
  'High-risk jurisdiction',
  'Large cash',
  'Behavioural anomaly',
  'Round amounts',
]
