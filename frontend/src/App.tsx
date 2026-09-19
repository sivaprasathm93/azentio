import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { EmptyState, ErrorBoundary, ErrorPanel } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/features/auth/authStore'

const AlertsPage = lazy(() => import('@/features/alerts/AlertsPage'))
const CasesPage = lazy(() => import('@/features/cases/CasesPage'))
const CaseWorkbench = lazy(() => import('@/features/cases/CaseWorkbench'))
const RulesPage = lazy(() => import('@/features/rules/RulesPage'))

function RouteFallback() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

/** Holds the app until the session (roles of the acting account) is known, so role-gated buttons never flicker. */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { status, error, init } = useAuth()
  useEffect(() => {
    void init()
  }, [init])

  if (status === 'loading') return <RouteFallback />
  if (status === 'error') return <ErrorPanel title="Sentinel could not reach the backend" message={error ?? undefined} onRetry={() => void init()} />
  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary region="application">
      <SessionGate>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/alerts" replace />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/cases" element={<CasesPage />} />
              <Route path="/cases/:id" element={<CaseWorkbench />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    title="Page not found"
                    hint="That address does not match anything in Sentinel."
                    action={
                      <Button asChild>
                        <Link to="/alerts">Go to the alert queue</Link>
                      </Button>
                    }
                  />
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </SessionGate>
    </ErrorBoundary>
  )
}
