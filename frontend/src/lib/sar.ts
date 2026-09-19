import type { Alert, AMLTransaction, AmlCase, CustomerProfile } from '@/types/domain'
import { formatDate, formatDateTime, formatMoney, formatTenure, humanizeEnum } from '@/lib/format'
import { uniq } from '@/lib/utils'
import { countryName } from '@/lib/fatf'

export type FilingAuthority = 'FINCEN' | 'FIU'

export const AUTHORITY_LABEL: Record<FilingAuthority, string> = {
  FINCEN: 'FinCEN (US) — BSA SAR narrative',
  FIU: 'FIU — Suspicious Transaction Report narrative',
}

interface SarInput {
  authority: FilingAuthority
  aml: AmlCase
  customer: CustomerProfile
  alerts: Alert[]
  /** Flagged (evidence) transactions. */
  flagged: AMLTransaction[]
  preparedBy: string
  currency: string
  now?: Date
}

/**
 * Drafts the narrative from case data only: every sentence is traceable to an alert explanation, a flagged
 * transaction or a customer attribute. The analyst is expected to edit it; nothing here is submitted.
 */
export function buildSarNarrative(i: SarInput): string {
  const { authority, aml, customer, alerts, flagged, preparedBy, currency } = i
  const now = i.now ?? new Date()
  const sorted = [...flagged].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  // Transfers between the customer's own accounts move existing money; they are shown but not added to the total.
  const own = new Set(customer.accounts.map((a) => a.accountNumber))
  const total = sorted.filter((t) => !(t.counterpartyAccountId && own.has(t.counterpartyAccountId))).reduce((s, t) => s + Math.abs(t.amountBase), 0)
  const first = sorted[0]?.timestamp
  const last = sorted[sorted.length - 1]?.timestamp
  const countries = uniq(sorted.map((t) => t.counterpartyCountry)).filter((c) => c && c !== customer.country)
  const channels = uniq(sorted.map((t) => humanizeEnum(t.channel).toLowerCase()))
  const typologies = uniq(alerts.flatMap((a) => a.evidence.map((e) => e.typology)))
  const explanations = uniq(alerts.flatMap((a) => a.evidence.map((e) => e.explanation))).filter(Boolean)
  const authorityName = authority === 'FINCEN' ? 'FinCEN' : 'the Financial Intelligence Unit'
  const reportName = authority === 'FINCEN' ? 'Suspicious Activity Report (SAR)' : 'Suspicious Transaction Report (STR)'

  const lines: string[] = []
  lines.push(`${reportName.toUpperCase()} — NARRATIVE DRAFT`)
  lines.push(`Filing authority: ${authorityName}`)
  lines.push(`Case: ${aml.caseRef}   Prepared: ${formatDate(now.toISOString())}   Prepared by: ${preparedBy}`)
  lines.push('')
  lines.push('1. SUBJECT')
  lines.push(
    `${customer.fullName} (customer ref ${customer.ref}), ${customer.customerType.toLowerCase()} customer, country ${countryName(customer.country)}, ` +
      `KYC risk rating ${customer.kycRating}. Relationship tenure: ${formatTenure(customer.onboardedOn, now)}.` +
      (customer.isPep ? ' The subject is a politically exposed person.' : '') +
      (customer.sanctionsHit ? ' The subject or a counterparty matched a sanctions / watchlist entry.' : '') +
      (customer.piiMasked ? ' (Identifiers are masked in this draft; a supervisor must complete them before filing.)' : ''),
  )
  lines.push('')
  lines.push('2. SUMMARY OF SUSPICIOUS ACTIVITY')
  if (sorted.length) {
    lines.push(
      `Between ${formatDateTime(first)} and ${formatDateTime(last)}, ${sorted.length} transaction(s) totalling ` +
        `${formatMoney(total, currency)} were identified across ${uniq(sorted.map((t) => t.accountId)).length} account(s) ` +
        `via ${channels.join(', ') || 'unspecified channels'}` +
        (countries.length ? `, involving counterparties in ${countries.map(countryName).join(', ')}` : '') +
        '.',
    )
  } else {
    lines.push('No flagged transactions were attached to this case at the time of drafting.')
  }
  if (typologies.length) lines.push(`Typologies observed: ${typologies.join('; ')}.`)
  lines.push('')
  lines.push('3. WHY THE ACTIVITY IS CONSIDERED SUSPICIOUS')
  if (explanations.length) explanations.forEach((e) => lines.push(`- ${e}`))
  else lines.push('- Detection rules raised alerts but recorded no explanation text.')
  if (customer.statedMonthlyIncome != null) {
    lines.push(
      `- Stated monthly income on file is ${formatMoney(customer.statedMonthlyIncome, customer.currency)}; ` +
        `the flagged activity totals ${formatMoney(total, currency)}.`,
    )
  }
  lines.push('')
  lines.push('4. TRANSACTION DETAIL')
  sorted.slice(0, 40).forEach((t) => {
    lines.push(
      `- ${formatDateTime(t.timestamp)}  ${t.direction === 'CREDIT' ? 'IN ' : 'OUT'}  ${formatMoney(t.amount, t.currency)}  ` +
        `${humanizeEnum(t.channel)}  ${t.direction === 'CREDIT' ? 'from' : 'to'} ${t.counterpartyName} (${t.counterpartyCountry})  ref ${t.txnRef}`,
    )
  })
  if (sorted.length > 40) lines.push(`- … and ${sorted.length - 40} further transaction(s) listed in the case ledger.`)
  lines.push('')
  lines.push('5. ACTIONS TAKEN')
  lines.push(
    `Alerts ${alerts.map((a) => a.alertRef).join(', ') || '—'} were reviewed and consolidated into case ${aml.caseRef} ` +
      `(status ${aml.status}, assigned to ${aml.assignee ?? 'unassigned'}).`,
  )
  lines.push('')
  lines.push('6. CONCLUSION')
  lines.push(
    `Based on the above, the activity lacks an apparent lawful or economic purpose consistent with the customer's profile. ` +
      `This narrative is submitted to ${authorityName} for review.`,
  )
  return lines.join('\n')
}
