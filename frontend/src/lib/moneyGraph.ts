import type { AMLTransaction } from '@/types/domain'

export type GraphNodeKind = 'source' | 'account' | 'intermediary' | 'beneficiary'

export interface GraphNode {
  id: string
  label: string
  sublabel: string
  kind: GraphNodeKind
  own: boolean
  country: string | null
  flagged: boolean
  totalIn: number
  totalOut: number
  count: number
  depth: number
  x: number
  y: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  count: number
  total: number
  flagged: boolean
  txnIds: string[]
}

export interface GraphPattern {
  kind: 'fan-in' | 'fan-out' | 'layering'
  label: string
  detail: string
}

export interface MoneyGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  patterns: GraphPattern[]
}

const COL_W = 320
const ROW_H = 104
const FAN_MIN = 3
const LAYERING_MIN_HOPS = 3

interface Options {
  /** Counterparties beyond this many (by volume) collapse into a single "+N others" node per direction. */
  maxCounterparties?: number
}

function cpKey(t: AMLTransaction) {
  return `cp:${t.counterpartyAccountId ?? t.counterpartyName}`
}

/**
 * Builds a directed money trail from transactions. Inbound credits point counterparty -> customer account,
 * outbound debits point account -> counterparty; a counterparty account that belongs to the customer collapses
 * onto the customer's own node so internal hops (layering) show up as chains.
 */
export function buildMoneyGraph(txns: AMLTransaction[], ownAccounts: string[], opts: Options = {}): MoneyGraph {
  const { maxCounterparties = 18 } = opts
  const own = new Set(ownAccounts)

  // Rank counterparties by volume so the long tail can collapse.
  const volume = new Map<string, number>()
  for (const t of txns) {
    if (t.counterpartyAccountId && own.has(t.counterpartyAccountId)) continue
    volume.set(cpKey(t), (volume.get(cpKey(t)) ?? 0) + Math.abs(t.amountBase))
  }
  const keep = new Set(
    [...volume.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCounterparties)
      .map(([k]) => k),
  )

  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const othersCount = { in: new Set<string>(), out: new Set<string>() }

  const ensureNode = (id: string, init: Partial<GraphNode> & Pick<GraphNode, 'label'>): GraphNode => {
    let n = nodes.get(id)
    if (!n) {
      n = {
        id,
        sublabel: '',
        kind: 'intermediary',
        own: false,
        country: null,
        flagged: false,
        totalIn: 0,
        totalOut: 0,
        count: 0,
        depth: 0,
        x: 0,
        y: 0,
        ...init,
      }
      nodes.set(id, n)
    }
    return n
  }

  for (const t of txns) {
    const ownId = `own:${t.accountId}`
    ensureNode(ownId, { label: t.accountId, sublabel: 'Customer account', own: true, kind: 'account' })

    let other: string
    if (t.counterpartyAccountId && own.has(t.counterpartyAccountId)) {
      other = `own:${t.counterpartyAccountId}`
      ensureNode(other, { label: t.counterpartyAccountId, sublabel: 'Customer account', own: true, kind: 'account' })
    } else if (keep.has(cpKey(t))) {
      other = cpKey(t)
      ensureNode(other, {
        label: t.counterpartyName,
        sublabel: `${t.counterpartyAccountId ?? 'no account ref'} · ${t.counterpartyCountry}`,
        country: t.counterpartyCountry,
      })
    } else {
      const side = t.direction === 'CREDIT' ? 'in' : 'out'
      othersCount[side].add(cpKey(t))
      other = `others:${side}`
      ensureNode(other, { label: 'Other counterparties', sublabel: '' })
    }

    const [from, to] = t.direction === 'CREDIT' ? [other, ownId] : [ownId, other]
    const id = `${from}>${to}`
    let e = edges.get(id)
    if (!e) {
      e = { id, source: from, target: to, count: 0, total: 0, flagged: false, txnIds: [] }
      edges.set(id, e)
    }
    const amt = Math.abs(t.amountBase)
    e.count += 1
    e.total += amt
    e.flagged ||= t.isFlagged
    e.txnIds.push(t.id)
    const fromNode = nodes.get(from)!
    const toNode = nodes.get(to)!
    fromNode.totalOut += amt
    toNode.totalIn += amt
    fromNode.count += 1
    toNode.count += 1
    if (t.isFlagged) {
      fromNode.flagged = true
      toNode.flagged = true
    }
  }

  for (const side of ['in', 'out'] as const) {
    const n = nodes.get(`others:${side}`)
    if (n) n.sublabel = `+${othersCount[side].size} merged`
  }

  // Classify counterparties by the direction of money through them.
  for (const n of nodes.values()) {
    if (n.own) continue
    n.kind = n.totalIn > 0 && n.totalOut === 0 ? 'beneficiary' : n.totalOut > 0 && n.totalIn === 0 ? 'source' : 'intermediary'
  }

  const edgeList = [...edges.values()]

  // Longest-path layering, capped at |V| passes so a cycle cannot loop forever.
  const ids = [...nodes.keys()]
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false
    for (const e of edgeList) {
      if (e.source === e.target) continue
      const s = nodes.get(e.source)!
      const t = nodes.get(e.target)!
      if (t.depth < s.depth + 1 && s.depth + 1 <= ids.length) {
        t.depth = s.depth + 1
        changed = true
      }
    }
    if (!changed) break
  }

  const columns = new Map<number, GraphNode[]>()
  for (const n of nodes.values()) {
    const col = columns.get(n.depth) ?? []
    col.push(n)
    columns.set(n.depth, col)
  }
  for (const [depth, col] of columns) {
    col.sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
    col.forEach((n, i) => {
      n.x = depth * COL_W
      n.y = (i - (col.length - 1) / 2) * ROW_H
    })
  }

  return { nodes: [...nodes.values()], edges: edgeList, patterns: detectPatterns([...nodes.values()], edgeList) }
}

function detectPatterns(nodes: GraphNode[], edges: GraphEdge[]): GraphPattern[] {
  const patterns: GraphPattern[] = []
  const byId = new Map(nodes.map((n) => [n.id, n]))

  for (const n of nodes) {
    if (!n.own) continue
    const inbound = edges.filter((e) => e.target === n.id && !byId.get(e.source)!.own)
    const outbound = edges.filter((e) => e.source === n.id && !byId.get(e.target)!.own)
    if (inbound.length >= FAN_MIN) {
      patterns.push({
        kind: 'fan-in',
        label: `Fan-in ×${inbound.length}`,
        detail: `${inbound.length} distinct sources converge on ${n.label}`,
      })
    }
    if (outbound.length >= FAN_MIN) {
      patterns.push({
        kind: 'fan-out',
        label: `Fan-out ×${outbound.length}`,
        detail: `${n.label} distributes to ${outbound.length} distinct beneficiaries`,
      })
    }
  }

  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth))
  if (maxDepth >= LAYERING_MIN_HOPS) {
    patterns.push({
      kind: 'layering',
      label: `Layering · ${maxDepth} hops`,
      detail: `Funds move through ${maxDepth} successive transfers before reaching the final beneficiary`,
    })
  }
  return patterns
}
