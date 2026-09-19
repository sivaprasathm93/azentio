import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertOctagon, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Names the region in the message, e.g. "money map". Lets one pane fail without taking down the cockpit. */
  region?: string
  compact?: boolean
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.region ? `:${this.props.region}` : ''}]`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <ErrorPanel title={`The ${this.props.region ?? 'page'} failed to render`} message={error.message} onRetry={this.reset} compact={this.props.compact} />
  }
}

export function ErrorPanel({
  title = 'Something went wrong',
  message,
  onRetry,
  compact,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? 'p-4' : 'p-10'}`}>
      <AlertOctagon className="size-6 text-critical" />
      <div className="display text-[14px]">{title}</div>
      {message && <p className="max-w-md text-[12px] text-muted">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 p-10 text-center">
      <div className="display text-[14px]">{title}</div>
      {hint && <p className="max-w-sm text-[12px] text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
