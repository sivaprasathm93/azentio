import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useCase } from '@/hooks/useCases'
import { useCaseEvidence } from '@/hooks/useCaseEvidence'
import { useWatchlist } from '@/hooks/useRules'
import { config } from '@/lib/config'
import { CaseStatusBadge } from '@/components/RiskBadge'
import { EmptyState, ErrorBoundary, ErrorPanel } from '@/components/ErrorBoundary'
import { Badge, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { errorMessage, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AnomalousLedger } from './AnomalousLedger'
import { DeviationChart } from './DeviationChart'
import { DispositionPane } from './DispositionPane'
import { EntityDossier } from './EntityDossier'
import { ExplainabilityCard } from './ExplainabilityCard'
import { MoneyMap } from './MoneyMap'

const PRIORITY_TONE: Record<string, 'critical' | 'high' | 'medium' | 'outline'> = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium' }

function Pane({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className={cn('scroll-thin min-h-0 overflow-y-auto bg-panel', className)}>
      {children}
    </section>
  )
}

function WorkbenchSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading case">
      <div className="border-b border-line bg-panel px-5 py-4">
        <Skeleton className="h-6 w-80" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[25%_50%_25%]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 border-r border-line p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CaseWorkbench() {
  const { id } = useParams()
  const caseQ = useCase(id)
  const ev = useCaseEvidence(caseQ.data)
  const watch = useWatchlist()

  const riskCountries = useMemo(() => (watch.data ?? []).filter((w) => w.entryType === 'COUNTRY' && w.active).map((w) => w.value), [watch.data])
  const accountNumbers = useMemo(() => caseQ.data?.customer.accounts.map((a) => a.accountNumber) ?? [], [caseQ.data])

  if (caseQ.isLoading) return <WorkbenchSkeleton />
  if (caseQ.isError) {
    if (caseQ.error instanceof ApiError && caseQ.error.isNotFound) {
      return (
        <EmptyState
          title="Case not found"
          hint="It may have been removed, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/cases">Back to cases</Link>
            </Button>
          }
        />
      )
    }
    return <ErrorPanel title="The case could not be loaded" message={errorMessage(caseQ.error)} onRetry={() => caseQ.refetch()} />
  }

  const detail = caseQ.data!
  const c = detail.case
  const currency = config.baseCurrency

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-5 py-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to cases">
          <Link to="/cases">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="num text-[12px] font-semibold text-muted">{c.caseRef}</span>
            <CaseStatusBadge status={c.status} />
            <Badge tone={PRIORITY_TONE[c.priority] ?? 'outline'}>{c.priority}</Badge>
          </div>
          <h1 className="display truncate text-[18px] leading-tight">{c.title}</h1>
        </div>
        <div className="ml-auto text-right text-[12px] text-muted">
          <div>
            Assigned to <span className="font-semibold text-ink">{c.assignee ?? 'nobody'}</span>
          </div>
          <div>Opened by {c.createdBy}</div>
        </div>
      </header>

      {/* Fixed-height cockpit: each pane scrolls on its own so nothing pushes the others out of view. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-x divide-line overflow-y-auto lg:grid-cols-[25%_50%_25%] lg:overflow-hidden">
        <Pane label="Entity dossier" className="lg:min-w-0">
          <ErrorBoundary region="dossier" compact>
            <EntityDossier customer={detail.customer} alerts={detail.alerts} transactions={ev.transactions} flagged={ev.flagged} currency={currency} />
          </ErrorBoundary>
        </Pane>

        <Pane label="Visual evidence and ledger" className="!bg-bg">
          <div className="space-y-3 p-3">
            <ErrorBoundary region="explanation" compact>
              <ExplainabilityCard details={ev.details} loading={ev.loading} />
            </ErrorBoundary>
            {ev.error && <ErrorPanel compact title="Some evidence could not be loaded" message={ev.error.message} />}
            <ErrorBoundary region="money map" compact>
              <MoneyMap flagged={ev.flagged} all={ev.transactions.filter((t) => Date.parse(t.timestamp) >= Date.now() - 30 * 86_400_000)} accountNumbers={accountNumbers} currency={currency} riskCountries={riskCountries} />
            </ErrorBoundary>
            <ErrorBoundary region="ledger" compact>
              <AnomalousLedger transactions={ev.transactions} currency={currency} />
            </ErrorBoundary>
            <ErrorBoundary region="deviation chart" compact>
              <DeviationChart transactions={ev.transactions} currency={currency} />
            </ErrorBoundary>
          </div>
        </Pane>

        <Pane label="Disposition and audit" className="flex flex-col overflow-hidden">
          <ErrorBoundary region="disposition" compact>
            <DispositionPane detail={detail} evidence={ev} currency={currency} />
          </ErrorBoundary>
        </Pane>
      </div>
    </div>
  )
}
