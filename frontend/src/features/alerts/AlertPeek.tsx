import { Link } from 'react-router-dom'
import { ExternalLink, FolderPlus, XCircle } from 'lucide-react'
import type { Alert } from '@/types/domain'
import { useAlertDetail } from '@/hooks/useAlerts'
import { ungrouped, type GridRow } from '@/lib/grouping'
import { formatDateTime, formatMoney, humanizeEnum } from '@/lib/format'
import { countryName } from '@/lib/fatf'
import { AlertStatusBadge, RiskBadge } from '@/components/RiskBadge'
import { ErrorPanel } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Badge, Skeleton } from '@/components/ui/primitives'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlays'

/** Slide-over evidence preview so an analyst can decide without leaving the queue. */
export function AlertPeek({
  alert,
  onClose,
  onPromote,
  onDismiss,
}: {
  alert: Alert | null
  onClose: () => void
  onPromote: (row: GridRow) => void
  onDismiss: (row: GridRow) => void
}) {
  const detail = useAlertDetail(alert?.id, !!alert)
  const live = alert && (alert.status === 'OPEN' || alert.status === 'UNDER_REVIEW')
  const row = alert ? ungrouped([alert])[0] : null

  return (
    <Dialog open={!!alert} onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="sheet" title={alert ? `${alert.alertRef} · ${alert.customerName}` : 'Alert'} description="Evidence behind this alert">
        <DialogBody className="space-y-4">
          {alert && (
            <div className="flex items-center gap-4">
              <RiskBadge score={alert.overallScore} />
              <div className="space-y-1">
                <AlertStatusBadge status={alert.status} />
                <div className="text-[12px] text-muted">
                  {alert.customerRef} · raised {formatDateTime(alert.createdAt)}
                </div>
              </div>
            </div>
          )}

          {detail.isLoading && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {detail.isError && <ErrorPanel compact title="Could not load this alert" message={detail.error.message} onRetry={() => detail.refetch()} />}

          {detail.data && (
            <>
              <section>
                <h3 className="eyebrow mb-1.5">Why it was flagged</h3>
                <p className="rounded border border-line bg-panel2 p-3 text-[13px] leading-relaxed">{detail.data.explanation || 'No explanation was recorded.'}</p>
              </section>

              <section className="space-y-2">
                <h3 className="eyebrow">Rules triggered</h3>
                {detail.data.evidence.map((e) => (
                  <div key={e.ruleId} className="rounded border border-line p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{e.ruleName}</span>
                      <Badge tone="outline">{e.typology}</Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted">{e.explanation || '—'}</p>
                    <div className="mt-1.5 text-[11.5px] text-muted">
                      {e.triggeredTransactionIds.length} transaction{e.triggeredTransactionIds.length === 1 ? '' : 's'}
                    </div>
                  </div>
                ))}
              </section>

              <section>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <h3 className="eyebrow">Evidence transactions</h3>
                  <span className="num text-[12px] font-semibold">{formatMoney(detail.data.aggregatedAmount, detail.data.currency)}</span>
                </div>
                <div className="overflow-hidden rounded border border-line">
                  <table className="w-full text-[12px]">
                    <thead className="bg-panel2 text-left">
                      <tr>
                        <th className="eyebrow px-2 py-1.5">When</th>
                        <th className="eyebrow px-2 py-1.5">Counterparty</th>
                        <th className="eyebrow px-2 py-1.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.transactions.map((t) => (
                        <tr key={t.id} className="border-t border-line">
                          <td className="num whitespace-nowrap px-2 py-1.5">{formatDateTime(t.timestamp)}</td>
                          <td className="px-2 py-1.5">
                            <div className="truncate">{t.counterpartyName}</div>
                            <div className="text-[11px] text-muted">
                              {humanizeEnum(t.channel)} · {countryName(t.counterpartyCountry)}
                            </div>
                          </td>
                          <td className="num px-2 py-1.5 text-right">
                            <span className={t.direction === 'CREDIT' ? 'text-low' : ''}>{t.direction === 'CREDIT' ? '+' : '−'}</span>
                            {formatMoney(t.amount, t.currency)}
                            {t.currency !== detail.data.currency && <div className="text-[11px] text-muted">{formatMoney(t.amountBase, detail.data.currency)}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {alert?.caseId && (
            <Button variant="outline" asChild>
              <Link to={`/cases/${alert.caseId}`}>
                <ExternalLink /> Open case
              </Link>
            </Button>
          )}
          {live && row && (
            <>
              <Button variant="ghost" onClick={() => onDismiss(row)}>
                <XCircle /> Dismiss
              </Button>
              <Button onClick={() => onPromote(row)}>
                <FolderPlus /> Promote to case
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
