/** Wire shapes of the Spring Boot API (`/api/v1`). Only lib/api/adapters.ts should import these. */

export interface ApiErrorBody {
  timestamp: string
  status: number
  error: string
  code: string
  message: string
  path: string
  fieldErrors?: { field: string; message: string }[]
}

export interface BePage<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface BeAlertSummary {
  id: number
  alertRef: string
  customerId: number
  customerRef: string
  customerName: string
  customerRiskRating: string
  status: string
  riskScore: number
  riskBand: string
  ruleCodes: string[]
  hitCount: number
  windowStart: string
  windowEnd: string
  assignee: string | null
  caseId: number | null
  createdAt: string
  updatedAt: string
}

export interface BeRuleDetail {
  severity: number
  hits: number
  ruleVersion: number
  weight: number
  explanation: string
  lastTxnRef: string | null
}

export interface BeEvidenceTxn {
  transactionId: number
  txnRef: string
  accountNumber: string
  direction: string
  amount: number
  currency: string
  amountBase: number
  counterpartyName: string
  counterpartyCountry: string
  channel: string
  jurisdiction: string | null
  occurredAt: string
  ruleCodes: string[]
}

export interface BeCustomerView {
  id: number
  externalRef: string
  fullName: string
  nationalId: string | null
  dateOfBirth: string | null
  customerType: string
  country: string
  kycRiskRating: string
  piiMasked: boolean
}

export interface BeAlertDetail {
  summary: BeAlertSummary
  explanation: string
  ruleDetails: Record<string, BeRuleDetail>
  disposition: string | null
  dispositionReason: string | null
  disposedBy: string | null
  disposedAt: string | null
  caseRef: string | null
  customer: BeCustomerView
  evidence: BeEvidenceTxn[]
}

export interface BeAccount {
  id: number
  accountNumber: string
  customerId: number
  accountType: string
  currency: string
  openedOn: string | null
  riskRating: string | null
  status: string
}

export interface BeCustomerDetail {
  customer: BeCustomerView
  accounts: BeAccount[]
}

export interface BeTimelineTxn {
  id: number
  txnRef: string
  accountNumber: string
  direction: string
  amount: number
  currency: string
  amountBase: number
  counterpartyName: string
  counterpartyCountry: string
  channel: string
  occurredAt: string
  alertRefs: string[]
}

export interface BeCase {
  id: number
  caseRef: string
  customerId: number
  title: string
  status: string
  priority: string
  assignee: string | null
  outcome: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface BeCaseNote {
  id: number
  caseId: number
  author: string
  body: string
  createdAt: string
}

export interface BeAuditLog {
  id: number
  entityType: string
  entityId: string
  action: string
  fromState: string | null
  toState: string | null
  actor: string
  details: Record<string, unknown> | null
  occurredAt: string
}

export interface BeCaseDetail {
  caseInfo: BeCase
  customer: BeCustomerView
  alerts: BeAlertSummary[]
  notes: BeCaseNote[]
  history: BeAuditLog[]
}

export interface BeRuleConfig {
  ruleCode: string
  name: string
  description: string
  enabled: boolean
  weight: number
  params: Record<string, unknown>
  version: number
  updatedBy: string | null
  updatedAt: string | null
}

export interface BeWatchlistEntry {
  id: number
  entryType: 'COUNTRY' | 'COUNTERPARTY'
  value: string
  listName: string
  reason: string | null
  active: boolean
}

export interface BeDashboardSummary {
  metrics: {
    open_queue: number
    critical_open: number
    open_cases: number
    false_positive_rate_pct: number | null
    avg_hours_to_disposition: number | null
  }
}
