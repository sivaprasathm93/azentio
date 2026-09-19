import type { SentinelApi } from './types'
import type {
  BeAlertDetail,
  BeAlertSummary,
  BeAuditLog,
  BeCase,
  BeCaseDetail,
  BeCaseNote,
  BeCustomerDetail,
  BeDashboardSummary,
  BeRuleConfig,
  BePage,
  BeTimelineTxn,
  BeWatchlistEntry,
} from '@/types/backend'
import type { Role, Session, SimulationResult } from '@/types/domain'
import { ApiError, basicAuth, request } from './client'
import {
  toAlert,
  toAlertDetail,
  toAudit,
  toCase,
  toCaseDetail,
  toCustomerProfile,
  toNote,
  toRule,
  toTimelineTxn,
  toWatchlist,
} from './adapters'
import { estimateImpact } from './simulation'
import { ruleCodesForTypology } from '@/lib/typology'

const page = <A, B>(p: BePage<A>, f: (a: A) => B) => ({ ...p, content: p.content.map(f) })

async function customerAccounts(customerId: string | number) {
  const d = await request<BeCustomerDetail>(`/customers/${customerId}`)
  return d
}

async function fullCaseDetail(id: string | number): Promise<ReturnType<typeof toCaseDetail>> {
  const d = await request<BeCaseDetail>(`/cases/${id}`)
  const cust = await customerAccounts(d.caseInfo.customerId)
  return toCaseDetail(d, cust.accounts)
}

export const httpApi: SentinelApi = {
  mode: 'live',

  async login(username, password): Promise<Session> {
    const authorization = basicAuth(username, password)
    // /rules is readable by every authenticated role, so it doubles as the credential check.
    await request('/rules', { authorization })

    // There is no /me endpoint. Probe two endpoints whose *authorisation* differs by role; neither has side effects.
    const roles: Role[] = ['ANALYST']
    try {
      await request('/audit', { authorization })
      roles.push('SUPERVISOR')
    } catch (e) {
      if (!(e instanceof ApiError && e.isForbidden)) throw e
    }
    if (roles.includes('SUPERVISOR')) {
      try {
        // Security config gates /detection/** to ADMIN by URL, so a non-admin gets 403 before routing.
        await request('/detection/whoami', { authorization })
      } catch (e) {
        if (e instanceof ApiError && !e.isForbidden && e.status !== 401 && e.status !== 0) roles.push('ADMIN')
      }
    }
    return { username, roles }
  },

  async listAlerts(q = {}) {
    const p = await request<BePage<BeAlertSummary>>('/alerts', {
      query: {
        status: q.statuses,
        minScore: q.minScore,
        ruleCode: q.ruleCode,
        assignee: q.assignee,
        page: q.page ?? 0,
        size: q.size ?? 200,
        sort: 'riskScore',
        direction: 'desc',
      },
    })
    return page(p, toAlert)
  },

  async getAlert(id) {
    return toAlertDetail(await request<BeAlertDetail>(`/alerts/${id}`))
  },

  async getAlertHistory(id) {
    return (await request<BeAuditLog[]>(`/alerts/${id}/history`)).map(toAudit)
  },

  async actOnAlert(id, a) {
    const body =
      a.action === 'CLOSE'
        ? { action: a.action, disposition: a.disposition, reason: a.reason }
        : a.action === 'ESCALATE'
          ? { action: a.action, reason: a.reason, caseId: a.caseId ? Number(a.caseId) : undefined }
          : a.action === 'REOPEN'
            ? { action: a.action, reason: a.reason }
            : { action: a.action }
    return toAlertDetail(await request<BeAlertDetail>(`/alerts/${id}/actions`, { method: 'POST', body }))
  },

  async listCases(statuses) {
    const p = await request<BePage<BeCase>>('/cases', { query: { status: statuses, size: 200 } })
    return page(p, toCase)
  },

  async createCase(alertIds, title, reason) {
    const d = await request<BeCaseDetail>('/cases', {
      method: 'POST',
      body: { alertIds: alertIds.map(Number), title, reason },
    })
    return fullCaseDetail(d.caseInfo.id)
  },

  getCase: (id) => fullCaseDetail(id),

  async transitionCase(id, t) {
    await request(`/cases/${id}/transition`, { method: 'POST', body: t })
    return fullCaseDetail(id)
  },

  async assignCase(id, assignee) {
    await request(`/cases/${id}/assign`, { method: 'POST', body: { assignee } })
    return fullCaseDetail(id)
  },

  async addCaseNote(id, body) {
    return toNote(await request<BeCaseNote>(`/cases/${id}/notes`, { method: 'POST', body: { body } }))
  },

  async getCustomer(id) {
    const d = await customerAccounts(id)
    return toCustomerProfile(d.customer, d.accounts)
  },

  async getCustomerTransactions(customerId) {
    const rows = await request<BeTimelineTxn[]>(`/customers/${customerId}/transactions`, { query: { limit: 3000 } })
    return rows.map(toTimelineTxn)
  },

  async listRules() {
    return (await request<BeRuleConfig[]>('/rules')).map(toRule)
  },

  async updateRule(code, update) {
    return toRule(await request<BeRuleConfig>(`/rules/${code}`, { method: 'PATCH', body: update }))
  },

  async listWatchlist() {
    return (await request<BeWatchlistEntry[]>('/watchlist')).map(toWatchlist)
  },

  async addWatchlistCountry(code, listName, reason) {
    return toWatchlist(
      await request<BeWatchlistEntry>('/watchlist', {
        method: 'POST',
        body: { entryType: 'COUNTRY', value: code.toUpperCase(), listName, reason },
      }),
    )
  },

  async setWatchlistActive(id, active, reason) {
    return toWatchlist(await request<BeWatchlistEntry>(`/watchlist/${id}`, { method: 'PATCH', body: { active, reason } }))
  },

  async simulateRule(req): Promise<SimulationResult> {
    // Prefer a server-side replay if the backend offers one.
    try {
      return await request<SimulationResult>(`/rules/${req.code}/simulate`, { method: 'POST', body: req })
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 405)) throw e
    }
    const [rule, alerts, watch] = await Promise.all([
      request<BeRuleConfig>(`/rules/${req.code}`),
      this.listAlerts({ ruleCode: req.code, size: 200 }),
      this.listWatchlist(),
    ])
    const activeCountries = watch.filter((w) => w.entryType === 'COUNTRY' && w.active).length
    return estimateImpact(
      req.code,
      rule.params,
      { ...rule.params, ...req.params },
      alerts.content.map((a) => ({ ...a, evidence: a.evidence.length ? a.evidence : [] })),
      { before: activeCountries, after: req.countries?.length ?? activeCountries },
    )
  },

  async getMetrics() {
    const d = await request<BeDashboardSummary>('/dashboard/summary')
    return {
      openQueue: d.metrics.open_queue,
      criticalOpen: d.metrics.critical_open,
      openCases: d.metrics.open_cases,
      falsePositiveRatePct: d.metrics.false_positive_rate_pct,
      avgHoursToDisposition: d.metrics.avg_hours_to_disposition,
    }
  },
}

/** Rule codes to query for a typology filter, or undefined when the filter matches more than one code. */
export function singleRuleCodeForTypology(typology: string): string | undefined {
  const codes = ruleCodesForTypology(typology)
  return codes.length === 1 ? codes[0] : undefined
}
