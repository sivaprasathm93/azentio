import { Link } from 'react-router-dom'
import { useCaseList } from '@/hooks/useCases'
import { errorMessage } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { CaseStatusBadge } from '@/components/RiskBadge'
import { EmptyState, ErrorPanel } from '@/components/ErrorBoundary'
import { Badge, Skeleton } from '@/components/ui/primitives'

export default function CasesPage() {
  const q = useCaseList()
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-panel px-5 py-4">
        <h1 className="display text-[22px] leading-none">Cases</h1>
        <p className="mt-1.5 text-[12px] text-muted">Open an investigation to see the full evidence, SAR draft and audit trail.</p>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-panel">
        {q.isLoading && (
          <div className="space-y-2 p-5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {q.isError && <ErrorPanel message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <EmptyState title="No cases yet" hint="Promote an alert from the queue to open one." />}
        {q.data && q.data.length > 0 && (
          <table className="w-full text-[13px]">
            <thead className="bg-panel2 text-left">
              <tr>
                {['Case', 'Title', 'Status', 'Priority', 'Assignee', 'Updated'].map((h) => (
                  <th key={h} className="eyebrow px-5 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id} className="border-t border-line hover:bg-primary/5">
                  <td className="num px-5 py-2.5 font-semibold">
                    <Link to={`/cases/${c.id}`} className="text-primary hover:underline">
                      {c.caseRef}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5">{c.title}</td>
                  <td className="px-5 py-2.5">
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge tone={c.priority === 'CRITICAL' ? 'critical' : c.priority === 'HIGH' ? 'high' : 'medium'}>{c.priority}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-muted">{c.assignee ?? 'Unassigned'}</td>
                  <td className="px-5 py-2.5 text-muted">{formatRelative(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
