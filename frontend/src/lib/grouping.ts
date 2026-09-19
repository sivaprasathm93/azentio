import type { Alert } from '@/types/domain'
import { bandFor } from '@/lib/risk'
import { uniq } from '@/lib/utils'

export interface GridRow {
  /** Stable row id: the master alert's id (prefixed for groups), or the alert's own id. */
  id: string
  alert: Alert
  isChild: boolean
  groupSize: number
  score: number
  amount: number | null
  currency: string
  typologies: string[]
  latestAt: string
  subRows?: GridRow[]
}

const HOUR = 3_600_000

function typologiesOf(alerts: Alert[]) {
  return uniq(alerts.flatMap((a) => a.evidence.map((e) => e.typology)))
}

function sumAmount(alerts: Alert[]): number | null {
  let total = 0
  for (const a of alerts) {
    if (a.aggregatedAmount == null) return null
    total += a.aggregatedAmount
  }
  return total
}

function leaf(a: Alert): GridRow {
  return {
    id: a.id,
    alert: a,
    isChild: true,
    groupSize: 1,
    score: a.overallScore,
    amount: a.aggregatedAmount,
    currency: a.currency,
    typologies: typologiesOf([a]),
    latestAt: a.createdAt,
  }
}

/**
 * Folds alerts for the same entity into one master row when they fall inside a rolling temporal window
 * (each alert must start within `windowHours` of the previous alert in the cluster). The master is the
 * highest-scoring alert; the aggregate row carries the combined amount and the union of typologies.
 */
export function groupAlerts(alerts: Alert[], windowHours = 72): GridRow[] {
  const byCustomer = new Map<string, Alert[]>()
  for (const a of alerts) {
    const list = byCustomer.get(a.customerId)
    if (list) list.push(a)
    else byCustomer.set(a.customerId, [a])
  }

  const rows: GridRow[] = []
  for (const list of byCustomer.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const clusters: Alert[][] = []
    let latest = -Infinity
    for (const a of sorted) {
      const t = Date.parse(a.createdAt)
      const current = clusters[clusters.length - 1]
      if (current && t - latest <= windowHours * HOUR) current.push(a)
      else clusters.push([a])
      latest = t
    }

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        rows.push({ ...leaf(cluster[0]), isChild: false })
        continue
      }
      const master = cluster.reduce((best, a) =>
        a.overallScore > best.overallScore || (a.overallScore === best.overallScore && a.createdAt > best.createdAt) ? a : best,
      )
      rows.push({
        id: `grp:${master.id}`,
        alert: { ...master, severity: bandFor(master.overallScore) },
        isChild: false,
        groupSize: cluster.length,
        score: master.overallScore,
        amount: sumAmount(cluster),
        currency: master.currency,
        typologies: typologiesOf(cluster),
        latestAt: cluster.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), cluster[0].createdAt),
        subRows: [...cluster].sort((a, b) => b.overallScore - a.overallScore).map(leaf),
      })
    }
  }
  return rows
}

export function ungrouped(alerts: Alert[]): GridRow[] {
  return alerts.map((a) => ({ ...leaf(a), isChild: false }))
}

/** All alerts represented by a row (the alert itself, or every alert inside a group). */
export function rowAlerts(row: GridRow): Alert[] {
  return row.subRows ? row.subRows.map((r) => r.alert) : [row.alert]
}
