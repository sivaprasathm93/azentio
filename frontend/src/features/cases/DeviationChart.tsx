import { useMemo } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity } from 'lucide-react'
import type { AMLTransaction } from '@/types/domain'
import { computeDeviation, type DeviationPoint } from '@/lib/stats'
import { formatMoney } from '@/lib/format'

const shortDay = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

function ChartTip({ active, payload, currency }: { active?: boolean; payload?: { payload: DeviationPoint }[]; currency: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded border border-line bg-panel p-2 text-[11.5px] shadow-lg">
      <div className="font-semibold">{shortDay(p.day)}</div>
      <div className="num">Value {formatMoney(p.value, currency)}</div>
      {p.mean != null && p.upper != null && (
        <>
          <div className="num text-muted">μ {formatMoney(p.mean, currency)}</div>
          <div className="num text-muted">μ+2σ {formatMoney(p.upper, currency)}</div>
        </>
      )}
      {p.anomalous && <div className="mt-0.5 font-semibold text-critical">Above the band</div>}
    </div>
  )
}

/** Daily value against a trailing 14-day mean ± 2σ band. Bars that break the band turn red. */
export function DeviationChart({ transactions, currency }: { transactions: AMLTransaction[]; currency: string }) {
  const data = useMemo(() => computeDeviation(transactions, { window: 14, k: 2 }), [transactions])
  const anomalies = data.filter((d) => d.anomalous)
  const peak = anomalies.reduce<DeviationPoint | null>((m, d) => (!m || d.value > m.value ? d : m), null)

  return (
    <section aria-label="Deviation chart" className="overflow-hidden rounded-[var(--radius)] border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="eyebrow flex items-center gap-1.5">
          <Activity className="size-3" /> Daily value vs baseline (μ ± 2σ)
        </h3>
        <span className="text-[11.5px] text-muted">
          {anomalies.length ? (
            <>
              <span className="font-semibold text-critical">{anomalies.length} day{anomalies.length === 1 ? '' : 's'}</span> above the band
            </>
          ) : (
            'Within the band'
          )}
        </span>
      </div>

      {data.length === 0 ? (
        <div className="grid h-40 place-items-center text-[12px] text-muted">No transaction history to chart.</div>
      ) : (
        <>
          <div className="h-[240px] px-2 pt-3" role="img" aria-label={`Daily transaction value over ${data.length} days. ${anomalies.length} days exceeded the upper bound${peak ? `, peaking at ${formatMoney(peak.value, currency)} on ${shortDay(peak.day)}` : ''}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10.5, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={28} />
                <YAxis tickFormatter={(v: number) => formatMoney(v, currency, true)} tick={{ fontSize: 10.5, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={58} />
                <Tooltip content={<ChartTip currency={currency} />} cursor={{ fill: 'var(--panel-2)' }} />
                <Area dataKey="band" type="monotone" stroke="none" fill="var(--chart-band)" isAnimationActive={false} connectNulls={false} />
                <Bar dataKey="value" maxBarSize={9} isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.day} fill={d.anomalous ? 'var(--risk-critical)' : 'var(--chart-line)'} fillOpacity={d.anomalous ? 1 : 0.55} />
                  ))}
                </Bar>
                <Line dataKey="mean" type="monotone" stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-line)', opacity: 0.55 }} /> Daily value
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-critical" /> Above μ + 2σ
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: 'var(--chart-band)' }} /> Expected range (μ ± 2σ)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-muted" /> 14-day mean
            </span>
            <span>Baseline uses only the 14 days before each day.</span>
          </div>
        </>
      )}
    </section>
  )
}
