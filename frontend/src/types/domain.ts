/**
 * UI domain model. Both the mock API and the Spring Boot adapter produce these shapes, so no component ever
 * touches a raw backend DTO. Money is a number in the currency named on the same object.
 */

export type RiskBand = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type Severity = RiskBand
export type AlertStatus = 'OPEN' | 'UNDER_REVIEW' | 'ESCALATED' | 'CLOSED'
export type CaseStatus = 'OPEN' | 'INVESTIGATING' | 'SAR_FILED' | 'CLOSED'
export type Disposition = 'FALSE_POSITIVE' | 'TRUE_POSITIVE' | 'NO_FURTHER_ACTION'
export type KycTier = 1 | 2 | 3
export type Role = 'ANALYST' | 'SUPERVISOR' | 'ADMIN'
export type TxnDirection = 'CREDIT' | 'DEBIT'

export interface AlertEvidence {
  ruleId: string
  ruleName: string
  typology: string
  explanation: string
  triggeredTransactionIds: string[]
  metadata: Record<string, unknown>
}

export interface Alert {
  id: string
  alertRef: string
  customerId: string
  customerRef: string
  customerName: string
  kycTier: KycTier
  /** 0-100. Derived from the KYC rating when the backend does not hold a numeric customer score. */
  customerRiskScore: number
  overallScore: number
  severity: Severity
  status: AlertStatus
  assignee: string | null
  caseId: string | null
  evidence: AlertEvidence[]
  /** Sum of evidence transactions in `currency`. null until the backend detail has been loaded. */
  aggregatedAmount: number | null
  currency: string
  hitCount: number
  windowStart: string
  windowEnd: string
  createdAt: string
  updatedAt: string
}

export interface AMLTransaction {
  id: string
  txnRef: string
  accountId: string
  counterpartyAccountId: string | null
  counterpartyName: string
  counterpartyCountry: string
  amount: number
  currency: string
  /** Amount in the bank's base currency, used for aggregation and baselines. */
  amountBase: number
  direction: TxnDirection
  channel: string
  /** Branch name for cash / counter channels, when the source system records it. */
  branch?: string | null
  timestamp: string
  isFlagged: boolean
  alertRefs: string[]
}

export interface LinkedAccount {
  id: string
  accountNumber: string
  accountType: string
  currency: string
  status: string
  openedOn: string | null
  riskRating: string | null
}

export interface CustomerProfile {
  id: string
  ref: string
  fullName: string
  nationalId: string | null
  dateOfBirth: string | null
  customerType: string
  country: string
  kycTier: KycTier
  kycRating: string
  isPep: boolean | null
  sanctionsHit: boolean
  onboardedOn: string | null
  statedMonthlyIncome: number | null
  currency: string
  accounts: LinkedAccount[]
  piiMasked: boolean
}

export interface AlertDetail extends Alert {
  explanation: string
  disposition: Disposition | null
  dispositionReason: string | null
  disposedBy: string | null
  disposedAt: string | null
  caseRef: string | null
  customer: CustomerProfile
  transactions: AMLTransaction[]
}

export interface AmlCase {
  id: string
  caseRef: string
  customerId: string
  title: string
  status: CaseStatus
  priority: string
  assignee: string | null
  outcome: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CaseNote {
  id: string
  author: string
  body: string
  createdAt: string
}

export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  fromState: string | null
  toState: string | null
  actor: string
  details: Record<string, unknown>
  occurredAt: string
}

export interface CaseDetail {
  case: AmlCase
  customer: CustomerProfile
  alerts: Alert[]
  notes: CaseNote[]
  audit: AuditEntry[]
}

/* ---------------------------------- rules --------------------------------- */

export interface RuleConfig {
  code: string
  name: string
  description: string
  enabled: boolean
  weight: number
  params: Record<string, unknown>
  version: number
  updatedBy: string | null
  updatedAt: string | null
}

export interface WatchlistEntry {
  id: string
  entryType: 'COUNTRY' | 'COUNTERPARTY'
  value: string
  listName: string
  reason: string | null
  active: boolean
}

export interface RuleUpdate {
  enabled?: boolean
  weight?: number
  params?: Record<string, unknown>
}

export interface SimulationRequest {
  code: string
  params: Record<string, unknown>
  /** Country codes that would be active on the jurisdiction watchlist after the change. */
  countries?: string[]
}

export interface SimulationResult {
  code: string
  windowDays: number
  currentAlerts: number
  projectedAlerts: number
  newlyRaised: number
  suppressed: number
  criticalDelta: number
  /** 'backend' when the API computed it, 'estimate' when the client modelled it. */
  source: 'backend' | 'estimate'
  samples: { alertRef: string; customerName: string; change: 'NEW' | 'SUPPRESSED'; score: number }[]
}

/* ---------------------------------- misc ---------------------------------- */

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface Session {
  username: string
  roles: Role[]
}

export interface AlertQuery {
  statuses?: AlertStatus[]
  minScore?: number
  ruleCode?: string
  assignee?: string
  page?: number
  size?: number
}

export type AlertAction =
  | { action: 'START_REVIEW' }
  | { action: 'CLOSE'; disposition: Disposition; reason: string }
  | { action: 'ESCALATE'; reason: string; caseId?: string }
  | { action: 'REOPEN'; reason: string }

export interface CaseTransition {
  status: CaseStatus
  reason?: string
  disposition?: Disposition
}

export interface DashboardMetrics {
  openQueue: number
  criticalOpen: number
  openCases: number
  falsePositiveRatePct: number | null
  avgHoursToDisposition: number | null
}
