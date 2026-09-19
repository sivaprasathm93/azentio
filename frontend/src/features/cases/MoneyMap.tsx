import { memo, useMemo, useState } from 'react'
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { ArrowRightLeft, Layers, Network } from 'lucide-react'
import type { AMLTransaction } from '@/types/domain'
import { buildMoneyGraph, type GraphNode, type GraphPattern } from '@/lib/moneyGraph'
import { formatMoney } from '@/lib/format'
import { countryName } from '@/lib/fatf'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/primitives'

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  source: 'Source',
  account: 'Customer account',
  intermediary: 'Intermediary',
  beneficiary: 'Beneficiary',
}

type MapNodeData = { node: GraphNode; currency: string; highRisk: boolean }

const MapNode = memo(function MapNode({ data }: NodeProps<Node<MapNodeData>>) {
  const { node: n, currency, highRisk } = data
  const own = n.own
  return (
    <div
      className={cn(
        'w-[210px] rounded-[var(--radius)] border bg-panel px-2.5 py-2 shadow-sm',
        own ? 'border-primary border-2' : 'border-line-strong',
        highRisk && '!border-critical',
      )}
      title={`${n.label} — in ${formatMoney(n.totalIn, currency)}, out ${formatMoney(n.totalOut, currency)}`}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
      <div className="eyebrow !text-[9.5px]" style={own ? { color: 'var(--primary)' } : undefined}>
        {KIND_LABEL[n.kind]}
      </div>
      <div className="truncate text-[12.5px] font-semibold">{n.label}</div>
      {n.sublabel && <div className="num truncate text-[10.5px] text-muted">{n.sublabel}</div>}
      <div className="num mt-1 flex justify-between text-[10.5px]">
        <span className="text-low">+{formatMoney(n.totalIn, currency, true)}</span>
        <span className="text-critical">−{formatMoney(n.totalOut, currency, true)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  )
})

const nodeTypes = { account: MapNode }

const PATTERN_ICON: Record<GraphPattern['kind'], typeof Network> = { 'fan-in': Network, 'fan-out': Network, layering: Layers }

export function MoneyMap({
  flagged,
  all,
  accountNumbers,
  currency,
  riskCountries,
}: {
  flagged: AMLTransaction[]
  all: AMLTransaction[]
  accountNumbers: string[]
  currency: string
  /** Country codes on the active watchlist; their nodes get a red outline. */
  riskCountries: string[]
}) {
  const [scope, setScope] = useState<'flagged' | 'all'>('flagged')
  const source = scope === 'flagged' ? flagged : all

  const { nodes, edges, patterns } = useMemo(() => {
    const g = buildMoneyGraph(source, accountNumbers)
    const risk = new Set(riskCountries)
    const max = Math.max(1, ...g.edges.map((e) => e.total))
    const nodes: Node<MapNodeData>[] = g.nodes.map((n) => ({
      id: n.id,
      type: 'account',
      position: { x: n.x, y: n.y },
      data: { node: n, currency, highRisk: !!n.country && risk.has(n.country) },
      draggable: true,
    }))
    const edges: Edge[] = g.edges.map((e) => {
      const color = e.flagged ? 'var(--risk-critical)' : 'var(--line-strong)'
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.flagged,
        label: `${formatMoney(e.total, currency, true)}${e.count > 1 ? ` · ${e.count}×` : ''}`,
        labelStyle: { fontSize: 10.5, fontFamily: 'var(--font-mono)', fill: 'var(--ink)' },
        labelBgStyle: { fill: 'var(--panel)', fillOpacity: 0.95 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
        style: { stroke: color, strokeWidth: 1.2 + 3.8 * Math.sqrt(e.total / max) },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }
    })
    return { nodes, edges, patterns: g.patterns }
  }, [source, accountNumbers, currency, riskCountries])

  return (
    <section aria-label="Money map" className="overflow-hidden rounded-[var(--radius)] border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="eyebrow flex items-center gap-1.5">
          <ArrowRightLeft className="size-3" /> Money map
        </h3>
        <div className="flex items-center gap-2">
          {patterns.map((p) => {
            const Icon = PATTERN_ICON[p.kind]
            return (
              <Badge key={p.label} tone="critical" title={p.detail}>
                <Icon className="size-3" /> {p.label}
              </Badge>
            )
          })}
          <div role="group" aria-label="Map scope" className="flex overflow-hidden rounded border border-line-strong text-[11.5px] font-semibold">
            {(['flagged', 'all'] as const).map((s) => (
              <button
                key={s}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={cn('px-2 py-1', scope === s ? 'bg-ink text-bg' : 'bg-panel text-muted hover:text-ink')}
              >
                {s === 'flagged' ? 'Evidence' : 'All activity'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="grid h-40 place-items-center text-[12px] text-muted">No transactions to map yet.</div>
      ) : (
        <div className="h-[380px]" role="img" aria-label={`Money trail with ${nodes.length} parties and ${edges.length} transfers. ${patterns.map((p) => p.detail).join('. ')}`}>
          <ReactFlow
            key={scope}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.3}
            maxZoom={1.5}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-critical" /> Flagged transfer
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-line-strong" /> Other activity
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-primary" /> Customer account
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-critical" /> Watchlisted jurisdiction
          {riskCountries.length > 0 && <span className="text-[10.5px]">({riskCountries.slice(0, 4).map(countryName).join(', ')}…)</span>}
        </span>
        <span>Line width scales with value. Drag nodes to untangle.</span>
      </div>
    </section>
  )
}
