import { describe, expect, it } from 'vitest'
import { mockApi } from '@/lib/api/mock/mockApi'
import { groupAlerts } from '@/lib/grouping'
import { buildMoneyGraph } from '@/lib/moneyGraph'
import { computeDeviation } from '@/lib/stats'
import { buildSarNarrative } from '@/lib/sar'
import { bandFor } from '@/lib/risk'

describe('demo data path', () => {
  it('loads customers from the CSVs and builds alerts, groups, case, graph, chart, SAR', async () => {
    const list = (await mockApi.listAlerts()).content
    console.log('alerts', list.map((a) => `${a.alertRef} ${a.customerName} ${a.overallScore} ${a.status} ${a.evidence.map((e) => e.typology)}`))
    expect(list.length).toBe(7)
    expect(list[0].overallScore).toBe(97)

    const rows = groupAlerts(list, 72)
    console.log('rows', rows.map((r) => `${r.alert.customerName} x${r.groupSize} score${r.score} amt${Math.round(r.amount ?? 0)}`))
    expect(rows.some((r) => r.groupSize >= 2)).toBe(true)

    const cases = (await mockApi.listCases()).content
    const cd = await mockApi.getCase(cases[0].id)
    expect(cd.customer.fullName).toBe('Krishna Sharma')
    expect(cd.customer.accounts.map((a) => a.accountNumber)).toEqual(['ACC_000001', 'ACC_000002'])
    expect(cd.customer.statedMonthlyIncome).toBe(29587)

    const txns = await mockApi.getCustomerTransactions(cd.case.customerId)
    const flagged = txns.filter((t) => t.isFlagged)
    const g = buildMoneyGraph(flagged, cd.customer.accounts.map((a) => a.accountNumber))
    console.log('graph', g.nodes.length, 'nodes', g.edges.length, 'edges', g.patterns.map((p) => p.label))
    expect(g.patterns.some((p) => p.kind === 'layering')).toBe(true)

    const dev = computeDeviation(txns)
    console.log('anomalous days', dev.filter((d) => d.anomalous).map((d) => d.day), 'of', dev.length)
    expect(dev.some((d) => d.anomalous)).toBe(true)

    const details = await Promise.all(cd.alerts.map((a) => mockApi.getAlert(a.id)))
    const sar = buildSarNarrative({ authority: 'FINCEN', aml: cd.case, customer: cd.customer, alerts: details, flagged, preparedBy: 'analyst', currency: 'INR' })
    console.log(sar.slice(0, 1400))
    expect(sar).toContain('cash deposits')
    expect(bandFor(94)).toBe('CRITICAL')

    const anika = list.find((a) => a.customerName === 'Anika Fernandes')!
    const ad = await mockApi.getAlert(anika.id)
    expect(ad.customer.accounts.length).toBe(1)
  })

  it('enforces the four-eyes close rule like the backend', async () => {
    const top = (await mockApi.listAlerts()).content[0]
    await expect(mockApi.actOnAlert(top.id, { action: 'CLOSE', disposition: 'FALSE_POSITIVE', reason: 'looks fine to me' })).rejects.toThrow(/supervisor/)
  })

  it('rejects a rule change that breaches the regulatory floor', async () => {
    const { setMockUser } = await import('@/lib/api/mock/mockApi')
    setMockUser({ username: 'admin', roles: ['ANALYST', 'SUPERVISOR', 'ADMIN'] })
    await expect(mockApi.updateRule('STRUCTURING', { params: { minCount: 6 } })).rejects.toThrow(/may not exceed 3/)
    const sim = await mockApi.simulateRule({ code: 'STRUCTURING', params: { minCount: 2, lowerAmount: 8000, upperAmount: 9999.99 } })
    console.log('sim', sim.currentAlerts, '->', sim.projectedAlerts)
    expect(sim.projectedAlerts).toBeGreaterThan(sim.currentAlerts)
  })
})
