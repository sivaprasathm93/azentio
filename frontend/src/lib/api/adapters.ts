/** Backend DTO -> UI domain. The only module (with http.ts) that knows the wire format. */
import type {
  Alert,
  AlertDetail,
  AlertEvidence,
  AlertStatus,
  AMLTransaction,
  AmlCase,
  AuditEntry,
  CaseDetail,
  CaseNote,
  CaseStatus,
  CustomerProfile,
  Disposition,
  RuleConfig,
  WatchlistEntry,
} from '@/types/domain'
import type {
  BeAccount,
  BeAlertDetail,
  BeAlertSummary,
  BeAuditLog,
  BeCase,
  BeCaseDetail,
  BeCaseNote,
  BeCustomerView,
  BeEvidenceTxn,
  BeRuleConfig,
  BeTimelineTxn,
  BeWatchlistEntry,
} from '@/types/backend'
import { bandFor, kycTierFromRating, ratingToScore } from '@/lib/risk'
import { ruleMeta } from '@/lib/typology'
import { config } from '@/lib/config'

const HIGH_RISK_RULE = 'HIGH_RISK_JURISDICTION'

/** List rows carry rule codes only; explanations and transaction ids are hydrated by the detail call. */
function evidenceStubs(codes: string[]): AlertEvidence[] {
  return codes.map((code) => ({
    ruleId: code,
    ruleName: ruleMeta(code).name,
    typology: ruleMeta(code).typology,
    explanation: '',
    triggeredTransactionIds: [],
    metadata: {},
  }))
}

export function toAlert(s: BeAlertSummary): Alert {
  return {
    id: String(s.id),
    alertRef: s.alertRef,
    customerId: String(s.customerId),
    customerRef: s.customerRef,
    customerName: s.customerName,
    kycTier: kycTierFromRating(s.customerRiskRating),
    customerRiskScore: ratingToScore(s.customerRiskRating),
    overallScore: s.riskScore,
    severity: bandFor(s.riskScore),
    status: s.status as AlertStatus,
    assignee: s.assignee,
    caseId: s.caseId == null ? null : String(s.caseId),
    evidence: evidenceStubs(s.ruleCodes),
    aggregatedAmount: null,
    currency: config.baseCurrency,
    hitCount: s.hitCount,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }
}

export function toAccount(a: BeAccount) {
  return {
    id: String(a.id),
    accountNumber: a.accountNumber,
    accountType: a.accountType,
    currency: a.currency,
    status: a.status,
    openedOn: a.openedOn,
    riskRating: a.riskRating,
  }
}

export function toCustomerProfile(v: BeCustomerView, accounts: BeAccount[] = [], sanctionsHit = false): CustomerProfile {
  const opened = accounts.map((a) => a.openedOn).filter((d): d is string => !!d).sort()
  return {
    id: String(v.id),
    ref: v.externalRef,
    fullName: v.fullName,
    nationalId: v.nationalId,
    dateOfBirth: v.dateOfBirth,
    customerType: v.customerType,
    country: v.country,
    kycTier: kycTierFromRating(v.kycRiskRating),
    kycRating: v.kycRiskRating,
    isPep: null, // not held by the backend
    sanctionsHit,
    onboardedOn: opened[0] ?? null, // earliest account opening is the best available proxy
    statedMonthlyIncome: null, // not held by the backend
    currency: config.baseCurrency,
    accounts: accounts.map(toAccount),
    piiMasked: v.piiMasked,
  }
}

export function toEvidenceTxn(t: BeEvidenceTxn): AMLTransaction {
  return {
    id: String(t.transactionId),
    txnRef: t.txnRef,
    accountId: t.accountNumber,
    counterpartyAccountId: null,
    counterpartyName: t.counterpartyName,
    counterpartyCountry: t.counterpartyCountry,
    amount: t.amount,
    currency: t.currency,
    amountBase: t.amountBase,
    direction: t.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
    channel: t.channel,
    timestamp: t.occurredAt,
    isFlagged: true,
    alertRefs: [],
  }
}

export function toTimelineTxn(t: BeTimelineTxn): AMLTransaction {
  return {
    id: String(t.id),
    txnRef: t.txnRef,
    accountId: t.accountNumber,
    counterpartyAccountId: null,
    counterpartyName: t.counterpartyName,
    counterpartyCountry: t.counterpartyCountry,
    amount: t.amount,
    currency: t.currency,
    amountBase: t.amountBase,
    direction: t.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
    channel: t.channel,
    timestamp: t.occurredAt,
    isFlagged: t.alertRefs.length > 0,
    alertRefs: t.alertRefs,
  }
}

export function toAlertDetail(d: BeAlertDetail): AlertDetail {
  const base = toAlert(d.summary)
  const txns = d.evidence.map(toEvidenceTxn)
  const evidence: AlertEvidence[] = d.summary.ruleCodes.map((code) => {
    const rd = d.ruleDetails?.[code]
    return {
      ruleId: code,
      ruleName: ruleMeta(code).name,
      typology: ruleMeta(code).typology,
      explanation: rd?.explanation ?? '',
      triggeredTransactionIds: d.evidence.filter((e) => e.ruleCodes.includes(code)).map((e) => String(e.transactionId)),
      metadata: rd ? { severity: rd.severity, hits: rd.hits, ruleVersion: rd.ruleVersion, weight: rd.weight, lastTxnRef: rd.lastTxnRef } : {},
    }
  })
  const seen = new Set<string>()
  const distinct = d.evidence.filter((e) => (seen.has(e.txnRef) ? false : (seen.add(e.txnRef), true)))
  return {
    ...base,
    evidence,
    aggregatedAmount: distinct.reduce((s, e) => s + Math.abs(e.amountBase), 0),
    explanation: d.explanation ?? '',
    disposition: (d.disposition as Disposition | null) ?? null,
    dispositionReason: d.dispositionReason,
    disposedBy: d.disposedBy,
    disposedAt: d.disposedAt,
    caseRef: d.caseRef,
    customer: toCustomerProfile(d.customer, [], d.summary.ruleCodes.includes(HIGH_RISK_RULE)),
    transactions: txns.map((t) => ({ ...t, alertRefs: [d.summary.alertRef] })),
  }
}

export function toCase(c: BeCase): AmlCase {
  return {
    id: String(c.id),
    caseRef: c.caseRef,
    customerId: String(c.customerId),
    title: c.title,
    status: c.status as CaseStatus,
    priority: c.priority,
    assignee: c.assignee,
    outcome: c.outcome,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

export function toNote(n: BeCaseNote): CaseNote {
  return { id: String(n.id), author: n.author, body: n.body, createdAt: n.createdAt }
}

export function toAudit(a: BeAuditLog): AuditEntry {
  return {
    id: String(a.id),
    entityType: a.entityType,
    entityId: a.entityId,
    action: a.action,
    fromState: a.fromState,
    toState: a.toState,
    actor: a.actor,
    details: a.details ?? {},
    occurredAt: a.occurredAt,
  }
}

export function toCaseDetail(d: BeCaseDetail, accounts: BeAccount[]): CaseDetail {
  const alerts = d.alerts.map(toAlert)
  return {
    case: toCase(d.caseInfo),
    customer: toCustomerProfile(d.customer, accounts, d.alerts.some((a) => a.ruleCodes.includes(HIGH_RISK_RULE))),
    alerts,
    notes: d.notes.map(toNote),
    audit: d.history.map(toAudit),
  }
}

export function toRule(r: BeRuleConfig): RuleConfig {
  return {
    code: r.ruleCode,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    weight: r.weight,
    params: r.params,
    version: r.version,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }
}

export function toWatchlist(w: BeWatchlistEntry): WatchlistEntry {
  return { id: String(w.id), entryType: w.entryType, value: w.value, listName: w.listName, reason: w.reason, active: w.active }
}
