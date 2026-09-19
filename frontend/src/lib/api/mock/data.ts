/**
 * In-browser demo database. Customers and accounts are parsed from the supplied CSVs (./seed); transactions and
 * alerts are a small hand-authored set that exercises every screen: structuring -> layering -> offshore wire,
 * fan-in/fan-out through a student account, a sanctioned counterparty, behavioural deviation, and alert grouping.
 * All timestamps are relative to "now" so the demo always looks live.
 */
import customersCsv from './seed/customers.csv?raw'
import accountsCsv from './seed/accounts.csv?raw'
import { parseCsv } from './csv'
import type {
  Alert,
  AlertDetail,
  AlertEvidence,
  AlertStatus,
  AMLTransaction,
  AmlCase,
  AuditEntry,
  CaseNote,
  CustomerProfile,
  Disposition,
  LinkedAccount,
  RuleConfig,
  TxnDirection,
  WatchlistEntry,
} from '@/types/domain'
import { bandFor, kycTierFromRating, ratingToScore } from '@/lib/risk'
import { ruleMeta } from '@/lib/typology'
import { formatMoney } from '@/lib/format'

export interface MockCase {
  case: AmlCase
  alertIds: string[]
  notes: CaseNote[]
}

export interface MockDb {
  customers: Map<string, CustomerProfile>
  txns: Map<string, AMLTransaction[]>
  alerts: Map<string, AlertDetail>
  cases: Map<string, MockCase>
  audit: AuditEntry[]
  rules: RuleConfig[]
  watchlist: WatchlistEntry[]
  seq: { txn: number; alert: number; case: number; audit: number; note: number; watch: number }
}

const H = 3_600_000
const FX: Record<string, number> = { INR: 1, USD: 83.5, EUR: 90.8, AED: 22.73 }

let db: MockDb | null = null
export function getDb(): MockDb {
  return (db ??= buildDb())
}

/* --------------------------------- helpers -------------------------------- */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const inr = (n: number) => formatMoney(n, 'INR')
const sum = (txns: AMLTransaction[]) => txns.reduce((s, t) => s + Math.abs(t.amountBase), 0)

interface TxnSpec {
  acct: string
  dir: TxnDirection
  amount: number
  cur?: string
  cp: string
  cpCountry?: string
  cpAcct?: string | null
  ch: string
  agoH: number
  branch?: string
}

function mkTxn(d: MockDb, now: number, s: TxnSpec): AMLTransaction {
  const n = ++d.seq.txn
  const cur = s.cur ?? 'INR'
  return {
    id: `T${n}`,
    txnRef: `TXN${(1_000_000 + n).toString()}`,
    accountId: s.acct,
    counterpartyAccountId: s.cpAcct === undefined ? `CP${(4_100_000_000 + n * 7919).toString()}` : s.cpAcct,
    counterpartyName: s.cp,
    counterpartyCountry: s.cpCountry ?? 'IN',
    amount: s.amount,
    currency: cur,
    amountBase: Math.round(s.amount * (FX[cur] ?? 1) * 100) / 100,
    direction: s.dir,
    channel: s.ch,
    branch: s.branch ?? null,
    timestamp: new Date(now - s.agoH * H).toISOString(),
    isFlagged: false,
    alertRefs: [],
  }
}

function pushAudit(
  d: MockDb,
  now: number,
  e: { type: string; id: string; action: string; from?: string | null; to?: string | null; actor: string; agoH: number; details?: Record<string, unknown> },
) {
  d.audit.push({
    id: String(++d.seq.audit),
    entityType: e.type,
    entityId: e.id,
    action: e.action,
    fromState: e.from ?? null,
    toState: e.to ?? null,
    actor: e.actor,
    details: e.details ?? {},
    occurredAt: new Date(now - e.agoH * H).toISOString(),
  })
}

/* ---------------------------- customers & accounts ------------------------- */

/**
 * The supplied accounts.csv holds two accounts, both for CUST_00001. CUST_00002 (Anika Fernandes) has none, and a
 * money trail needs one, so a single clearly-synthetic savings account is added for her.
 */
const SYNTHETIC_ACCOUNTS = [
  'ACC_000003,CUST_00002,SAVINGS,ACTIVE,INR,2020-06-15,,BR120,Gurugram,8420.55,6110.2,0.0,0.0,N,CLASSIC,0,1,Y,2026-09-10,12,BASIC',
]

function loadCustomers(): { customers: Map<string, CustomerProfile>; monthlyTxns: Map<string, number> } {
  const accountRows = parseCsv(
    accountsCsv.trimEnd() + '\n' + SYNTHETIC_ACCOUNTS.join('\n'),
  )
  const monthlyTxns = new Map<string, number>()
  const byCustomer = new Map<string, LinkedAccount[]>()
  for (const r of accountRows) {
    const acc: LinkedAccount = {
      id: r.account_id,
      accountNumber: r.account_id,
      accountType: r.account_type,
      currency: r.currency,
      status: r.account_status,
      openedOn: r.open_date || null,
      riskRating: null,
      balance: Number(r.current_balance),
      branch: `${r.branch_city} (${r.branch_code})`,
    }
    monthlyTxns.set(acc.accountNumber, Number(r.avg_monthly_txn_count) || 12)
    byCustomer.set(r.customer_id, [...(byCustomer.get(r.customer_id) ?? []), acc])
  }

  const customers = new Map<string, CustomerProfile>()
  for (const r of parseCsv(customersCsv)) {
    customers.set(r.customer_id, {
      id: r.customer_id,
      ref: r.customer_id,
      fullName: `${r.first_name} ${r.last_name}`,
      nationalId: null,
      dateOfBirth: r.date_of_birth || null,
      customerType: r.customer_segment || 'RETAIL',
      country: r.country || 'IN',
      kycTier: kycTierFromRating(r.risk_rating),
      kycRating: r.risk_rating,
      isPep: r.is_politically_exposed === '1',
      sanctionsHit: false,
      onboardedOn: r.customer_since || null,
      statedMonthlyIncome: r.annual_income ? Math.round(Number(r.annual_income) / 12) : null,
      currency: 'INR',
      segment: r.customer_segment,
      city: r.city,
      age: Number(r.age) || null,
      accounts: byCustomer.get(r.customer_id) ?? [],
      piiMasked: false,
    })
  }
  return { customers, monthlyTxns }
}

const MERCHANTS: [string, string][] = [
  ['BigBasket', 'UPI'],
  ['Reliance Fresh', 'CARD'],
  ['Swiggy', 'UPI'],
  ['IRCTC', 'CARD'],
  ['Airtel Postpaid', 'UPI'],
  ['Amazon Pay', 'CARD'],
  ['BESCOM Electricity', 'NEFT'],
]

/** Ninety days of ordinary activity, sized from the account's avg_monthly_txn_count and the customer's income. */
function baseline(d: MockDb, now: number, cust: CustomerProfile, acct: LinkedAccount, perMonth: number, seed: number) {
  const rng = mulberry32(seed)
  const income = cust.statedMonthlyIncome ?? 20_000
  const median = (income * 0.5) / Math.max(perMonth, 1)
  const out: AMLTransaction[] = []
  for (let day = 90; day >= 3; day--) {
    if (rng() < perMonth / 30) {
      const [name, ch] = MERCHANTS[Math.floor(rng() * MERCHANTS.length)]
      const receipt = rng() < 0.2
      out.push(
        mkTxn(d, now, {
          acct: acct.accountNumber,
          dir: receipt ? 'CREDIT' : 'DEBIT',
          amount: Math.round(median * (0.6 + rng() * 0.8)),
          cp: receipt ? 'UPI receipt' : name,
          cpAcct: receipt ? 'UPI_RECEIPT' : `MERCH_${name.slice(0, 4).toUpperCase()}`,
          ch: receipt ? 'UPI' : ch,
          agoH: day * 24 - rng() * 20,
        }),
      )
    }
  }
  return out
}

/* --------------------------------- alerts --------------------------------- */

interface EvidenceSpec {
  rule: string
  explanation: string
  txns: AMLTransaction[]
  metadata?: Record<string, unknown>
}

interface AlertSpec {
  customer: CustomerProfile
  score: number
  status: AlertStatus
  createdAgoH: number
  evidence: EvidenceSpec[]
  assignee?: string | null
  caseId?: string | null
  disposition?: Disposition
  dispositionReason?: string
  disposedAgoH?: number
}

export function addAlert(d: MockDb, now: number, s: AlertSpec): AlertDetail {
  const n = ++d.seq.alert
  const id = String(n)
  const ref = `ALT-${100_000 + n}`
  const flagged = new Map<string, AMLTransaction>()
  s.evidence.forEach((e) => e.txns.forEach((t) => flagged.set(t.id, t)))
  const all = [...flagged.values()]
  all.forEach((t) => {
    t.isFlagged = true
    if (!t.alertRefs.includes(ref)) t.alertRefs.push(ref)
  })
  const times = all.map((t) => Date.parse(t.timestamp))
  const evidence: AlertEvidence[] = s.evidence.map((e) => ({
    ruleId: e.rule,
    ruleName: ruleMeta(e.rule).name,
    typology: ruleMeta(e.rule).typology,
    explanation: e.explanation,
    triggeredTransactionIds: e.txns.map((t) => t.id),
    metadata: { hits: e.txns.length, ruleVersion: 1, ...e.metadata },
  }))
  const createdAt = new Date(now - s.createdAgoH * H).toISOString()
  const detail: AlertDetail = {
    id,
    alertRef: ref,
    customerId: s.customer.id,
    customerRef: s.customer.ref,
    customerName: s.customer.fullName,
    kycTier: s.customer.kycTier,
    customerRiskScore: ratingToScore(s.customer.kycRating),
    overallScore: s.score,
    severity: bandFor(s.score),
    status: s.status,
    assignee: s.assignee ?? null,
    caseId: s.caseId ?? null,
    evidence,
    aggregatedAmount: sum(all.filter((t) => !t.counterpartyAccountId?.startsWith('ACC_'))), // internal legs are not new money
    currency: 'INR',
    hitCount: all.length,
    windowStart: new Date(Math.min(...times)).toISOString(),
    windowEnd: new Date(Math.max(...times)).toISOString(),
    createdAt,
    updatedAt: createdAt,
    explanation: evidence.map((e) => e.explanation).join(' '),
    disposition: s.disposition ?? null,
    dispositionReason: s.dispositionReason ?? null,
    disposedBy: s.disposition ? (s.assignee ?? 'analyst') : null,
    disposedAt: s.disposedAgoH != null ? new Date(now - s.disposedAgoH * H).toISOString() : null,
    caseRef: s.caseId ? (d.cases.get(s.caseId)?.case.caseRef ?? null) : null,
    customer: s.customer,
    transactions: [], // resolved on read from the ledger
  }
  d.alerts.set(id, detail)

  pushAudit(d, now, {
    type: 'ALERT',
    id: ref,
    action: 'ALERT_CREATED',
    to: 'OPEN',
    actor: 'detection-engine',
    agoH: s.createdAgoH,
    details: { rules: s.evidence.map((e) => e.rule), riskScore: s.score },
  })
  if (s.status !== 'OPEN') {
    pushAudit(d, now, {
      type: 'ALERT',
      id: ref,
      action: 'ALERT_START_REVIEW',
      from: 'OPEN',
      to: 'UNDER_REVIEW',
      actor: s.assignee ?? 'analyst',
      agoH: Math.max(0, s.createdAgoH - 0.4),
    })
  }
  if (s.status === 'CLOSED') {
    pushAudit(d, now, {
      type: 'ALERT',
      id: ref,
      action: 'ALERT_CLOSE',
      from: 'UNDER_REVIEW',
      to: 'CLOSED',
      actor: s.assignee ?? 'analyst',
      agoH: s.disposedAgoH ?? 0,
      details: { disposition: s.disposition, reason: s.dispositionReason },
    })
  }
  if (s.status === 'ESCALATED') {
    pushAudit(d, now, {
      type: 'ALERT',
      id: ref,
      action: 'ALERT_ESCALATE',
      from: 'UNDER_REVIEW',
      to: 'ESCALATED',
      actor: s.assignee ?? 'analyst',
      agoH: Math.max(0, s.createdAgoH - 1),
    })
  }
  return detail
}

/* ---------------------------------- build --------------------------------- */

function buildDb(): MockDb {
  const now = Date.now()
  const d: MockDb = {
    customers: new Map(),
    txns: new Map(),
    alerts: new Map(),
    cases: new Map(),
    audit: [],
    rules: [],
    watchlist: [],
    seq: { txn: 0, alert: 0, case: 0, audit: 0, note: 0, watch: 0 },
  }

  const { customers, monthlyTxns } = loadCustomers()
  d.customers = customers
  const krishna = customers.get('CUST_00001')!
  const anika = customers.get('CUST_00002')!

  // Ordinary history for every account.
  let seed = 7
  for (const c of customers.values()) {
    const list: AMLTransaction[] = []
    for (const a of c.accounts) list.push(...baseline(d, now, c, a, monthlyTxns.get(a.accountNumber) ?? 12, seed++))
    d.txns.set(c.id, list)
  }
  const baseAvg = new Map([...customers.keys()].map((id) => [id, sum(d.txns.get(id) ?? []) / 90]))
  const avgDaily = (cid: string) => baseAvg.get(cid) ?? 0
  const times = (x: number) => (x >= 100 ? 'over 100' : String(Math.round(x)))

  /* --- Krishna Sharma: structured cash -> own accounts -> offshore wire --------------------------------------- */
  const SAV = 'ACC_000002'
  const NRE = 'ACC_000001'
  const deposits = (
    [
      [44, 785_000, 'Gurugram Sec-14'],
      [31, 810_000, 'Delhi Nehru Place'],
      [17, 762_000, 'Noida Sec-18'],
      [8, 825_000, 'Gurugram Sec-14'],
    ] as const
  ).map(([agoH, amount, branch]) =>
    mkTxn(d, now, { acct: SAV, dir: 'CREDIT', amount, cp: 'Cash deposit', cpAcct: null, ch: 'CASH_DEPOSIT', agoH, branch }),
  )
  const cashTotal = sum(deposits)
  const xferOut = mkTxn(d, now, { acct: SAV, dir: 'DEBIT', amount: 3_100_000, cp: 'Self transfer', cpAcct: NRE, ch: 'INTERNAL', agoH: 6 })
  const xferIn = mkTxn(d, now, { acct: NRE, dir: 'CREDIT', amount: 3_100_000, cp: 'Self transfer', cpAcct: SAV, ch: 'INTERNAL', agoH: 6 })
  const wire = mkTxn(d, now, {
    acct: NRE,
    dir: 'DEBIT',
    amount: 34_500,
    cur: 'USD',
    cp: 'Orion Shell Holdings Ltd',
    cpCountry: 'CY',
    cpAcct: 'CY72002001280000001200527600',
    ch: 'SWIFT_WIRE',
    agoH: 3.5,
  })
  const kTxns = [...deposits, xferOut, xferIn, wire]
  d.txns.set(krishna.id, [...(d.txns.get(krishna.id) ?? []), ...kTxns])

  // Case first, so the alerts can reference it.
  const caseId = String(++d.seq.case)
  const caseRef = `CASE-${2000 + Number(caseId)}`
  d.cases.set(caseId, {
    case: {
      id: caseId,
      caseRef,
      customerId: krishna.id,
      title: 'Structured cash deposits routed offshore — Krishna Sharma',
      status: 'INVESTIGATING',
      priority: 'CRITICAL',
      assignee: 'analyst',
      outcome: null,
      createdBy: 'analyst',
      createdAt: new Date(now - 2.5 * H).toISOString(),
      updatedAt: new Date(now - 1.2 * H).toISOString(),
    },
    alertIds: [],
    notes: [
      {
        id: String(++d.seq.note),
        author: 'analyst',
        body: 'Customer is a Tier-2 PREMIUM retail account holder with ₹2.95L stated monthly income. Deposits are ~27x that in 40 hours. Requesting source-of-funds documents from the RM.',
        createdAt: new Date(now - 1.2 * H).toISOString(),
      },
    ],
  })

  const structAlert = addAlert(d, now, {
    customer: krishna,
    score: 94,
    status: 'ESCALATED',
    createdAgoH: 3.3,
    assignee: 'analyst',
    caseId,
    evidence: [
      {
        rule: 'STRUCTURING',
        txns: deposits,
        explanation:
          `Customer executed ${deposits.length} cash deposits totalling ${inr(cashTotal)} across 3 branches within 36h, each just below the ₹8.35L (USD 10,000) reporting threshold (band ₹7.51L–₹8.35L).`,
        metadata: { severity: 0.8, weight: 45, lowerAmount: 751_500, upperAmount: 834_916 },
      },
      {
        rule: 'RAPID_MOVEMENT',
        txns: [xferIn, xferOut, wire],
        explanation:
          `${inr(xferIn.amountBase)} moved from savings to NRE and ${inr(wire.amountBase)} (${Math.round((wire.amountBase / xferIn.amountBase) * 100)}%) left by SWIFT wire to Orion Shell Holdings Ltd (CY) within 2.5h — an immediate cross-border wire after the cash placement.`,
        metadata: { severity: 0.93, weight: 40, outflowRatio: wire.amountBase / xferIn.amountBase },
      },
    ],
  })

  const devDay = deposits.slice(0, 2)
  const behavAlert = addAlert(d, now, {
    customer: krishna,
    score: 71,
    status: 'ESCALATED',
    createdAgoH: 30.5,
    assignee: 'analyst',
    caseId,
    evidence: [
      {
        rule: 'BEHAVIORAL_DEVIATION',
        txns: devDay,
        explanation: `Daily transaction value of ${inr(sum(devDay))} is ${times(sum(devDay) / avgDaily(krishna.id))}× the customer's 90-day daily average of ${inr(Math.round(avgDaily(krishna.id)))} (rule: > 3×).`,
        metadata: { severity: 0.9, weight: 30, multiplier: 3 },
      },
    ],
  })
  d.cases.get(caseId)!.alertIds = [structAlert.id, behavAlert.id]
  d.cases.get(caseId)!.case.updatedAt = new Date(now - 1.2 * H).toISOString()
  pushAudit(d, now, { type: 'CASE', id: caseRef, action: 'CASE_OPENED', to: 'OPEN', actor: 'analyst', agoH: 2.5, details: { alerts: 2 } })
  pushAudit(d, now, { type: 'CASE', id: caseRef, action: 'CASE_INVESTIGATING', from: 'OPEN', to: 'INVESTIGATING', actor: 'analyst', agoH: 2.4 })
  pushAudit(d, now, { type: 'CASE', id: caseRef, action: 'CASE_NOTE_ADDED', from: 'INVESTIGATING', to: 'INVESTIGATING', actor: 'analyst', agoH: 1.2 })

  // Older closed false positive (monthly rent), and an unrelated cash deposit that is still open.
  const rent = [12.6, 12.2, 11.8].map((h) =>
    mkTxn(d, now, { acct: SAV, dir: 'DEBIT', amount: 50_000, cp: 'Sharma Estates', cpAcct: 'CP8800001100', ch: 'UPI', agoH: h * 24 }),
  )
  d.txns.set(krishna.id, [...d.txns.get(krishna.id)!, ...rent])
  addAlert(d, now, {
    customer: krishna,
    score: 44,
    status: 'CLOSED',
    createdAgoH: 11.7 * 24,
    assignee: 'analyst',
    disposition: 'FALSE_POSITIVE',
    dispositionReason: 'Monthly rent instalments to the registered landlord; tenancy agreement on file.',
    disposedAgoH: 11.5 * 24,
    evidence: [
      {
        rule: 'ROUND_AMOUNT',
        txns: rent,
        explanation: `${rent.length} transactions of exactly ${inr(50_000)} to the same counterparty within 24 days (round-amount unit ₹1,000).`,
      },
    ],
  })

  const bigCash = mkTxn(d, now, { acct: SAV, dir: 'CREDIT', amount: 920_000, cp: 'Cash deposit', cpAcct: null, ch: 'CASH_DEPOSIT', agoH: 5 * 24, branch: 'Gurugram Sec-14' })
  d.txns.set(krishna.id, [...d.txns.get(krishna.id)!, bigCash])
  addAlert(d, now, {
    customer: krishna,
    score: 52,
    status: 'OPEN',
    createdAgoH: 5 * 24 - 0.1,
    evidence: [
      {
        rule: 'CTR_THRESHOLD',
        txns: [bigCash],
        explanation: `Single cash deposit of ${inr(bigCash.amountBase)} meets the currency-transaction-report threshold (USD 10,000 ≈ ${inr(835_000)}).`,
      },
    ],
  })

  /* --- Anika Fernandes: student account used as a pass-through (fan-in / fan-out) ------------------------------- */
  const AN = 'ACC_000003'
  const senders = [
    ['Rohit Verma', 58, 24_000],
    ['Simran Kaur', 52, 18_500],
    ['Aditya Nair', 47, 41_000],
    ['Pooja Iyer', 40, 29_500],
    ['Manish Gupta', 36, 36_000],
    ['Tanvi Shah', 32, 22_000],
  ] as const
  const credits = senders.map(([name, agoH, amount], i) =>
    mkTxn(d, now, { acct: AN, dir: 'CREDIT', amount, cp: name, cpAcct: `CP71000000${i + 1}`, ch: i % 2 ? 'IMPS' : 'UPI', agoH }),
  )
  const outs = (
    [
      ['Rohan Malhotra', 30, 62_000, 'IN', 'IMPS'],
      ['Zoya Traders', 29, 45_500, 'IN', 'NEFT'],
      ['Al Noor General Trading LLC', 28, 39_000, 'AE', 'SWIFT_WIRE'],
      ['Kabir Enterprises', 26.5, 21_000, 'IN', 'IMPS'],
    ] as const
  ).map(([name, agoH, amount, country, ch], i) =>
    mkTxn(d, now, { acct: AN, dir: 'DEBIT', amount, cp: name, cpCountry: country, cpAcct: `CP72000000${i + 1}`, ch, agoH }),
  )
  const salaryLike = mkTxn(d, now, { acct: AN, dir: 'CREDIT', amount: 200_000, cp: 'Vikram Rao', cpAcct: 'CP7100000099', ch: 'IMPS', agoH: 6.5 })
  const sanctioned = mkTxn(d, now, {
    acct: AN,
    dir: 'DEBIT',
    amount: 192_000,
    cp: 'Blue Lagoon Trading FZE',
    cpCountry: 'AE',
    cpAcct: 'AE070331234567890123456',
    ch: 'SWIFT_WIRE',
    agoH: 5,
  })
  d.txns.set(anika.id, [...d.txns.get(anika.id)!, ...credits, ...outs, salaryLike, sanctioned])

  const inflow = sum(credits)
  const outflow = sum(outs)
  addAlert(d, now, {
    customer: anika,
    score: 63,
    status: 'UNDER_REVIEW',
    createdAgoH: 57.5,
    assignee: 'analyst',
    evidence: [
      {
        rule: 'BEHAVIORAL_DEVIATION',
        txns: credits.slice(0, 1),
        explanation: `Inbound value of ${inr(sum(credits.slice(0, 1)))} is ${times(sum(credits.slice(0, 1)) / avgDaily(anika.id))}× this customer's 90-day daily average of ${inr(Math.round(avgDaily(anika.id)))}; annual income on file is ${inr(101_869)}.`,
        metadata: { severity: 0.7, weight: 30, multiplier: 3 },
      },
    ],
  })
  addAlert(d, now, {
    customer: anika,
    score: 91,
    status: 'OPEN',
    createdAgoH: 26.4,
    evidence: [
      {
        rule: 'RAPID_MOVEMENT',
        txns: [...credits, ...outs],
        explanation:
          `Fan-in then fan-out: ${credits.length} unrelated senders credited ${inr(inflow)} in 26h and ${inr(outflow)} (${Math.round((outflow / inflow) * 100)}%) left to ${outs.length} beneficiaries within 6h, one of them in AE. Account holder is an 18-year-old on a ${inr(101_869)} annual income.`,
        metadata: { severity: 0.98, weight: 40, outflowRatio: outflow / inflow },
      },
    ],
  })
  addAlert(d, now, {
    customer: anika,
    score: 97,
    status: 'OPEN',
    createdAgoH: 4.9,
    evidence: [
      {
        rule: 'HIGH_RISK_JURISDICTION',
        txns: [sanctioned],
        explanation: `Outgoing debit of ${inr(sanctioned.amountBase)} via SWIFT wire: counterparty 'Blue Lagoon Trading FZE' matches a SANCTIONS watchlist entry.`,
        metadata: { severity: 1, weight: 60, list: 'SANCTIONS' },
      },
    ],
  })
  anika.sanctionsHit = true

  /* --- rules & watchlist mirror the backend's seed migration ---------------------------------------------------- */
  const rule = (code: string, description: string, weight: number, params: Record<string, unknown>): RuleConfig => ({
    code,
    name: ruleMeta(code).name,
    description,
    enabled: true,
    weight,
    params,
    version: 1,
    updatedBy: 'system',
    updatedAt: new Date(now - 30 * 24 * H).toISOString(),
  })
  d.rules = [
    rule('CTR_THRESHOLD', 'Any single transaction at or above the currency transaction reporting threshold.', 30, { thresholdAmount: 10000, thresholdCurrency: 'USD' }),
    rule('STRUCTURING', 'Several transactions on one account inside a short window, each just below the reporting threshold.', 45, {
      lowerAmount: 9000,
      upperAmount: 9999.99,
      currency: 'USD',
      minCount: 3,
      windowHours: 24,
    }),
    rule('RAPID_MOVEMENT', 'Funds credited to an account and largely moved out again within a short window (layering).', 40, {
      windowHours: 48,
      outflowRatio: 0.8,
      minInflowAmount: 5000,
      currency: 'USD',
    }),
    rule('HIGH_RISK_JURISDICTION', 'Counterparty country, jurisdiction or name is on an active watchlist. Always alerts regardless of amount.', 60, { matchCounterpartyName: true }),
    rule('BEHAVIORAL_DEVIATION', 'Customer daily transaction value exceeds a multiple of the rolling daily average.', 30, {
      multiplier: 3,
      lookbackDays: 90,
      minHistoryDays: 30,
      minDailyAmount: 2500,
      minDailyCount: 10,
      currency: 'USD',
    }),
    rule('ROUND_AMOUNT', 'Repeated transactions in suspiciously round amounts on one account inside a window.', 20, {
      roundingUnit: 1000,
      minAmount: 1000,
      currency: 'USD',
      minCount: 3,
      windowHours: 168,
    }),
  ]
  const w = (entryType: 'COUNTRY' | 'COUNTERPARTY', value: string, listName: string, reason: string): WatchlistEntry => ({
    id: String(++d.seq.watch),
    entryType,
    value,
    listName,
    reason,
    active: true,
  })
  d.watchlist = [
    w('COUNTRY', 'KP', 'FATF_BLACKLIST', 'FATF call for action'),
    w('COUNTRY', 'IR', 'FATF_BLACKLIST', 'FATF call for action'),
    w('COUNTRY', 'MM', 'FATF_BLACKLIST', 'FATF call for action'),
    w('COUNTRY', 'SY', 'SANCTIONS', 'Comprehensive sanctions programme'),
    w('COUNTRY', 'YE', 'FATF_GREYLIST', 'Increased monitoring'),
    w('COUNTRY', 'AF', 'SANCTIONS', 'Targeted sanctions'),
    w('COUNTERPARTY', 'ORION SHELL HOLDINGS LTD', 'INTERNAL_WATCHLIST', 'Shell entity used in demo data'),
    w('COUNTERPARTY', 'BLUE LAGOON TRADING FZE', 'SANCTIONS', 'Sanctioned trading house used in demo data'),
  ]

  return d
}

/* ------------------------------ live simulation ---------------------------- */

const LIVE_SCENARIOS = ['CTR', 'ROUND', 'STRUCTURING'] as const

/** Raises one fresh alert for the demo stream. Returns the new alert (list shape). */
export function spawnLiveAlert(d: MockDb): Alert {
  const now = Date.now()
  const customers = [...d.customers.values()].filter((c) => c.accounts.length)
  const customer = customers[Math.floor(Math.random() * customers.length)]
  const acct = customer.accounts[Math.floor(Math.random() * customer.accounts.length)].accountNumber
  const kind = LIVE_SCENARIOS[Math.floor(Math.random() * LIVE_SCENARIOS.length)]
  const jitter = (lo: number, hi: number) => Math.round((lo + Math.random() * (hi - lo)) / 500) * 500

  let detail: AlertDetail
  if (kind === 'CTR') {
    const t = mkTxn(d, now, { acct, dir: 'CREDIT', amount: jitter(850_000, 990_000), cp: 'Cash deposit', cpAcct: null, ch: 'CASH_DEPOSIT', agoH: 0.02, branch: 'Gurugram Sec-14' })
    d.txns.get(customer.id)!.push(t)
    detail = addAlert(d, now, {
      customer,
      score: 46 + Math.floor(Math.random() * 12),
      status: 'OPEN',
      createdAgoH: 0,
      evidence: [{ rule: 'CTR_THRESHOLD', txns: [t], explanation: `Single cash deposit of ${inr(t.amountBase)} meets the currency-transaction-report threshold.` }],
    })
  } else if (kind === 'ROUND') {
    const ts = [26, 14, 1].map((h) => mkTxn(d, now, { acct, dir: 'DEBIT', amount: 25_000, cp: 'Quick Remit Services', cpAcct: 'CP8800002200', ch: 'UPI', agoH: h }))
    d.txns.get(customer.id)!.push(...ts)
    detail = addAlert(d, now, {
      customer,
      score: 38 + Math.floor(Math.random() * 10),
      status: 'OPEN',
      createdAgoH: 0,
      evidence: [{ rule: 'ROUND_AMOUNT', txns: ts, explanation: `3 transfers of exactly ${inr(25_000)} to the same counterparty within 26h.` }],
    })
  } else {
    const ts = [20, 9, 0.2].map((h) => mkTxn(d, now, { acct, dir: 'CREDIT', amount: jitter(770_000, 830_000), cp: 'Cash deposit', cpAcct: null, ch: 'CASH_DEPOSIT', agoH: h, branch: ['Noida Sec-18', 'Delhi Nehru Place', 'Gurugram Sec-14'][Math.floor(Math.random() * 3)] }))
    d.txns.get(customer.id)!.push(...ts)
    detail = addAlert(d, now, {
      customer,
      score: 76 + Math.floor(Math.random() * 8),
      status: 'OPEN',
      createdAgoH: 0,
      evidence: [{ rule: 'STRUCTURING', txns: ts, explanation: `3 cash deposits totalling ${inr(sum(ts))} within 20h, each just below the reporting threshold.` }],
    })
  }
  return detail
}
