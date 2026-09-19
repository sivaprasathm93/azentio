import type { SentinelApi } from '../types'
import type {
  Alert,
  AlertDetail,
  AmlCase,
  CaseDetail,
  CaseStatus,
  Disposition,
  Role,
  Session,
} from '@/types/domain'
import { ApiError } from '../client'
import { baselineFromAlerts, estimateImpact } from '../simulation'
import { sleep } from '@/lib/utils'
import { getDb, type MockDb } from './data'

/* The mock behaves like the real backend: same state machines, same role gates, same guardrail messages. */

let user: Session = { username: 'analyst', roles: ['ANALYST'] }
export function setMockUser(s: Session) {
  user = s
}

const has = (r: Role) => user.roles.includes(r)
const latency = () => sleep(90 + Math.random() * 160)
const clone = <T,>(v: T): T => structuredClone(v)

const CASE_MOVES: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ['INVESTIGATING', 'CLOSED'],
  INVESTIGATING: ['SAR_FILED', 'CLOSED'],
  SAR_FILED: ['CLOSED'],
  CLOSED: [],
}

function alertOf(d: MockDb, id: string): AlertDetail {
  const a = d.alerts.get(id)
  if (!a) throw new ApiError(404, 'NOT_FOUND', `Alert ${id} not found`)
  return a
}

function resolved(d: MockDb, a: AlertDetail): AlertDetail {
  const txns = (d.txns.get(a.customerId) ?? []).filter((t) => t.alertRefs.includes(a.alertRef))
  return clone({ ...a, customer: d.customers.get(a.customerId)!, transactions: txns.sort((x, y) => x.timestamp.localeCompare(y.timestamp)) })
}

function summary(a: AlertDetail): Alert {
  const { explanation, disposition, dispositionReason, disposedBy, disposedAt, caseRef, customer, transactions, ...rest } = a
  return clone(rest)
}

function audit(d: MockDb, type: string, id: string, action: string, from: string | null, to: string | null, details: Record<string, unknown> = {}) {
  d.audit.push({
    id: String(++d.seq.audit),
    entityType: type,
    entityId: id,
    action,
    fromState: from,
    toState: to,
    actor: user.username,
    details,
    occurredAt: new Date().toISOString(),
  })
}

function requireReason(reason: string | undefined) {
  if (!reason || reason.trim().length < 3) throw new ApiError(422, 'REASON_REQUIRED', 'A reason is required for this action')
}

function requiresSupervisor(a: AlertDetail) {
  return a.overallScore >= 80 || a.evidence.some((e) => e.ruleId === 'HIGH_RISK_JURISDICTION')
}

function caseDetail(d: MockDb, id: string): CaseDetail {
  const c = d.cases.get(id)
  if (!c) throw new ApiError(404, 'NOT_FOUND', `Case ${id} not found`)
  const audits = d.audit.filter((e) => e.entityType === 'CASE' && e.entityId === c.case.caseRef)
  return clone({
    case: c.case,
    customer: d.customers.get(c.case.customerId)!,
    alerts: c.alertIds.map((aid) => summary(alertOf(d, aid))),
    notes: [...c.notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    audit: audits.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  })
}

function openCase(d: MockDb, alertIds: string[], title: string, reason: string): string {
  const alerts = alertIds.map((id) => alertOf(d, id))
  if (new Set(alerts.map((a) => a.customerId)).size > 1) {
    throw new ApiError(422, 'MIXED_CUSTOMERS', 'All alerts in a case must belong to the same customer')
  }
  if (alerts.some((a) => a.status === 'CLOSED')) throw new ApiError(409, 'INVALID_STATE', 'Closed alerts cannot be added to a case')
  const id = String(++d.seq.case)
  const ref = `CASE-${2000 + Number(id)}`
  const now = new Date().toISOString()
  const top = Math.max(...alerts.map((a) => a.overallScore))
  const c: AmlCase = {
    id,
    caseRef: ref,
    customerId: alerts[0].customerId,
    title: title || `Investigation — ${alerts[0].customerName}`,
    status: 'OPEN',
    priority: top >= 90 ? 'CRITICAL' : top >= 70 ? 'HIGH' : 'MEDIUM',
    assignee: user.username,
    outcome: null,
    createdBy: user.username,
    createdAt: now,
    updatedAt: now,
  }
  d.cases.set(id, { case: c, alertIds: alerts.map((a) => a.id), notes: [] })
  audit(d, 'CASE', ref, 'CASE_OPENED', null, 'OPEN', { alerts: alerts.map((a) => a.alertRef), reason })
  for (const a of alerts) {
    audit(d, 'ALERT', a.alertRef, 'ALERT_ESCALATE', a.status, 'ESCALATED', { reason, case: ref })
    a.status = 'ESCALATED'
    a.caseId = id
    a.caseRef = ref
    a.assignee ??= user.username
    a.updatedAt = now
  }
  return id
}

/** Illustrative 30-day alert volumes for a mid-size bank, so a dry run has something to scale on a two-customer demo. */
const DEMO_PORTFOLIO: Record<string, { count: number; criticalShare: number }> = {
  STRUCTURING: { count: 38, criticalShare: 0.29 },
  RAPID_MOVEMENT: { count: 61, criticalShare: 0.23 },
  HIGH_RISK_JURISDICTION: { count: 24, criticalShare: 0.5 },
}

function guardrails(code: string, enabled: boolean, weight: number, p: Record<string, unknown>): string[] {
  const v: string[] = []
  const mandated = ['CTR_THRESHOLD', 'STRUCTURING', 'RAPID_MOVEMENT', 'HIGH_RISK_JURISDICTION', 'BEHAVIORAL_DEVIATION']
  if (!mandated.includes(code)) return v
  if (!enabled) v.push(`${code} is a mandated rule and cannot be disabled`)
  if (weight < 10) v.push(`${code} weight must be at least 10`)
  if (code === 'STRUCTURING') {
    if (Number(p.lowerAmount) > 9000) v.push('structuring band must start at or below USD 9,000 equivalent')
    if (Number(p.upperAmount) < 9999) v.push('structuring band must extend to at least USD 9,999 equivalent')
    if (Number(p.minCount) > 3) v.push('structuring minCount may not exceed 3')
    if (Number(p.windowHours) < 24) v.push('structuring window may not be shorter than 24h')
  }
  if (code === 'RAPID_MOVEMENT') {
    if (Number(p.outflowRatio) > 0.8) v.push('rapid-movement outflowRatio may not exceed 0.80')
    if (Number(p.windowHours) < 48) v.push('rapid-movement window may not be shorter than 48h')
  }
  if (code === 'HIGH_RISK_JURISDICTION' && p.matchCounterpartyName === false) v.push('sanctioned counterparty name matching may not be switched off')
  return v
}

export const mockApi: SentinelApi = {
  mode: 'mock',

  async whoami() {
    await latency()
    return user
  },

  async listAlerts(q = {}) {
    await latency()
    const d = getDb()
    let rows = [...d.alerts.values()]
    if (q.statuses?.length) rows = rows.filter((a) => q.statuses!.includes(a.status))
    if (q.minScore != null) rows = rows.filter((a) => a.overallScore >= q.minScore!)
    if (q.ruleCode) rows = rows.filter((a) => a.evidence.some((e) => e.ruleId === q.ruleCode))
    if (q.assignee) rows = rows.filter((a) => a.assignee === q.assignee)
    rows.sort((a, b) => b.overallScore - a.overallScore || b.createdAt.localeCompare(a.createdAt))
    const content = rows.map(summary)
    return { content, page: 0, size: content.length, totalElements: content.length, totalPages: 1 }
  },

  async getAlert(id) {
    await latency()
    const d = getDb()
    return resolved(d, alertOf(d, id))
  },

  async getAlertHistory(id) {
    await latency()
    const d = getDb()
    const ref = alertOf(d, id).alertRef
    return clone(d.audit.filter((e) => e.entityType === 'ALERT' && e.entityId === ref).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)))
  },

  async actOnAlert(id, act) {
    await latency()
    const d = getDb()
    const a = alertOf(d, id)
    const from = a.status
    const bad = () => new ApiError(409, 'INVALID_STATE', `${act.action} is not allowed while the alert is ${from}`)
    const now = new Date().toISOString()

    switch (act.action) {
      case 'START_REVIEW':
        if (from !== 'OPEN') throw bad()
        a.status = 'UNDER_REVIEW'
        a.assignee = user.username
        audit(d, 'ALERT', a.alertRef, 'ALERT_START_REVIEW', from, a.status)
        break
      case 'CLOSE':
        if (from !== 'OPEN' && from !== 'UNDER_REVIEW') throw bad()
        requireReason(act.reason)
        if (requiresSupervisor(a) && !has('SUPERVISOR')) {
          throw new ApiError(403, 'FORBIDDEN', `Alert ${a.alertRef} (score ${a.overallScore}) can only be closed by a supervisor`)
        }
        a.status = 'CLOSED'
        a.disposition = act.disposition as Disposition
        a.dispositionReason = act.reason
        a.disposedBy = user.username
        a.disposedAt = now
        audit(d, 'ALERT', a.alertRef, 'ALERT_CLOSE', from, 'CLOSED', { disposition: act.disposition, reason: act.reason })
        break
      case 'ESCALATE': {
        if (from === 'CLOSED' || from === 'ESCALATED') throw bad()
        requireReason(act.reason)
        if (act.caseId) {
          const c = d.cases.get(act.caseId)
          if (!c) throw new ApiError(404, 'NOT_FOUND', `Case ${act.caseId} not found`)
          c.alertIds.push(a.id)
          a.caseId = c.case.id
          a.caseRef = c.case.caseRef
          a.status = 'ESCALATED'
          audit(d, 'ALERT', a.alertRef, 'ALERT_ESCALATE', from, 'ESCALATED', { reason: act.reason, case: c.case.caseRef })
        } else {
          openCase(d, [a.id], '', act.reason)
        }
        break
      }
      case 'REOPEN':
        if (!has('SUPERVISOR')) throw new ApiError(403, 'FORBIDDEN', 'Only supervisors can reopen alerts')
        if (from !== 'CLOSED') throw bad()
        requireReason(act.reason)
        a.status = 'UNDER_REVIEW'
        a.assignee = user.username
        a.disposition = null
        a.dispositionReason = null
        a.disposedBy = null
        a.disposedAt = null
        audit(d, 'ALERT', a.alertRef, 'ALERT_REOPEN', from, a.status, { reason: act.reason })
        break
    }
    a.updatedAt = now
    return resolved(d, a)
  },

  async listCases(statuses) {
    await latency()
    const d = getDb()
    let rows = [...d.cases.values()].map((c) => c.case)
    if (statuses?.length) rows = rows.filter((c) => statuses.includes(c.status))
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return clone({ content: rows, page: 0, size: rows.length, totalElements: rows.length, totalPages: 1 })
  },

  async createCase(alertIds, title, reason) {
    await latency()
    const d = getDb()
    requireReason(reason)
    return caseDetail(d, openCase(d, alertIds, title, reason))
  },

  async getCase(id) {
    await latency()
    return caseDetail(getDb(), id)
  },

  async transitionCase(id, t) {
    await latency()
    const d = getDb()
    const c = d.cases.get(id)
    if (!c) throw new ApiError(404, 'NOT_FOUND', `Case ${id} not found`)
    const from = c.case.status
    if (!CASE_MOVES[from].includes(t.status)) throw new ApiError(409, 'INVALID_TRANSITION', `Case cannot move from ${from} to ${t.status}`)
    if ((t.status === 'SAR_FILED' || t.status === 'CLOSED') && !has('SUPERVISOR')) {
      throw new ApiError(403, 'FORBIDDEN', 'Filing a SAR and closing a case are supervisor decisions')
    }
    if (t.status === 'CLOSED') requireReason(t.reason)
    c.case.status = t.status
    c.case.updatedAt = new Date().toISOString()
    if (t.status === 'INVESTIGATING') c.case.assignee ??= user.username
    if (t.status === 'CLOSED') {
      c.case.outcome = t.disposition ?? 'NO_FURTHER_ACTION'
      for (const aid of c.alertIds) {
        const a = alertOf(d, aid)
        if (a.status === 'ESCALATED') {
          a.status = 'CLOSED'
          a.disposition = (t.disposition ?? 'NO_FURTHER_ACTION') as Disposition
          a.dispositionReason = t.reason ?? null
          a.disposedBy = user.username
          a.disposedAt = c.case.updatedAt
          audit(d, 'ALERT', a.alertRef, 'ALERT_CLOSED_WITH_CASE', 'ESCALATED', 'CLOSED', { case: c.case.caseRef })
        }
      }
    }
    audit(d, 'CASE', c.case.caseRef, `CASE_${t.status}`, from, t.status, { reason: t.reason })
    return caseDetail(d, id)
  },

  async assignCase(id, assignee) {
    await latency()
    const d = getDb()
    const c = d.cases.get(id)
    if (!c) throw new ApiError(404, 'NOT_FOUND', `Case ${id} not found`)
    audit(d, 'CASE', c.case.caseRef, 'CASE_ASSIGNED', c.case.status, c.case.status, { from: c.case.assignee, to: assignee })
    c.case.assignee = assignee
    c.case.updatedAt = new Date().toISOString()
    return caseDetail(d, id)
  },

  async addCaseNote(id, body) {
    await latency()
    const d = getDb()
    const c = d.cases.get(id)
    if (!c) throw new ApiError(404, 'NOT_FOUND', `Case ${id} not found`)
    const note = { id: String(++d.seq.note), author: user.username, body, createdAt: new Date().toISOString() }
    c.notes.push(note)
    audit(d, 'CASE', c.case.caseRef, 'CASE_NOTE_ADDED', c.case.status, c.case.status, { preview: body.slice(0, 80) })
    return clone(note)
  },

  async getCustomer(id) {
    await latency()
    const c = getDb().customers.get(id)
    if (!c) throw new ApiError(404, 'NOT_FOUND', `Customer ${id} not found`)
    return clone(c)
  },

  async getCustomerTransactions(customerId) {
    await latency()
    const rows = getDb().txns.get(customerId) ?? []
    return clone([...rows].sort((a, b) => b.timestamp.localeCompare(a.timestamp)))
  },

  async listRules() {
    await latency()
    return clone(getDb().rules)
  },

  async updateRule(code, update) {
    await latency()
    const d = getDb()
    if (!has('ADMIN')) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
    const r = d.rules.find((x) => x.code === code)
    if (!r) throw new ApiError(404, 'NOT_FOUND', `Rule ${code} not found`)
    const params = { ...r.params, ...(update.params ?? {}) }
    const enabled = update.enabled ?? r.enabled
    const weight = update.weight ?? r.weight
    const v = guardrails(code, enabled, weight, params)
    if (v.length) throw new ApiError(422, 'GUARDRAIL_VIOLATION', v.join('; '))
    audit(d, 'RULE', code, 'RULE_CONFIG_UPDATED', `v${r.version}`, `v${r.version + 1}`, { before: r.params, after: params })
    Object.assign(r, { params, enabled, weight, version: r.version + 1, updatedBy: user.username, updatedAt: new Date().toISOString() })
    return clone(r)
  },

  async listWatchlist() {
    await latency()
    return clone(getDb().watchlist)
  },

  async addWatchlistCountry(code, listName, reason) {
    await latency()
    const d = getDb()
    if (!has('ADMIN')) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
    const value = code.toUpperCase()
    const existing = d.watchlist.find((w) => w.entryType === 'COUNTRY' && w.value === value)
    if (existing) {
      existing.active = true
      return clone(existing)
    }
    const w = { id: String(++d.seq.watch), entryType: 'COUNTRY' as const, value, listName, reason, active: true }
    d.watchlist.push(w)
    audit(d, 'WATCHLIST', value, 'WATCHLIST_ADDED', null, 'ACTIVE', { listName })
    return clone(w)
  },

  async setWatchlistActive(id, active, reason) {
    await latency()
    const d = getDb()
    if (!has('ADMIN')) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
    const w = d.watchlist.find((x) => x.id === id)
    if (!w) throw new ApiError(404, 'NOT_FOUND', `Watchlist entry ${id} not found`)
    w.active = active
    audit(d, 'WATCHLIST', w.value, active ? 'WATCHLIST_ACTIVATED' : 'WATCHLIST_DEACTIVATED', null, null, { reason })
    return clone(w)
  },

  async simulateRule(req) {
    await sleep(500 + Math.random() * 400) // a real replay is not instant; let the UI show its progress state
    const d = getDb()
    const r = d.rules.find((x) => x.code === req.code)
    if (!r) throw new ApiError(404, 'NOT_FOUND', `Rule ${req.code} not found`)
    const own = baselineFromAlerts(req.code, [...d.alerts.values()].map(summary))
    const demo = DEMO_PORTFOLIO[req.code] ?? { count: own.count, criticalShare: own.criticalShare }
    const active = d.watchlist.filter((w) => w.entryType === 'COUNTRY' && w.active).length
    return estimateImpact(
      req.code,
      r.params,
      { ...r.params, ...req.params },
      { count: demo.count, criticalShare: demo.criticalShare, alerts: own.alerts },
      { before: active, after: req.countries?.length ?? active },
    )
  },

  async getMetrics() {
    await latency()
    const alerts = [...getDb().alerts.values()]
    const open = alerts.filter((a) => a.status === 'OPEN' || a.status === 'UNDER_REVIEW')
    const closed = alerts.filter((a) => a.status === 'CLOSED')
    return {
      openQueue: open.length,
      criticalOpen: open.filter((a) => a.severity === 'CRITICAL').length,
      openCases: [...getDb().cases.values()].filter((c) => c.case.status !== 'CLOSED').length,
      falsePositiveRatePct: closed.length ? Math.round((closed.filter((a) => a.disposition === 'FALSE_POSITIVE').length / closed.length) * 1000) / 10 : null,
      avgHoursToDisposition: null,
    }
  },
}
