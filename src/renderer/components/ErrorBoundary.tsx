import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  showDetails: boolean
}

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, showDetails: false }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }))
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    const { error, showDetails } = this.state

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: 24
        }}
      >
        <div className="card" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
          {/* Icon */}
          <div style={{ marginBottom: 16 }}>
            <AlertTriangle
              size={48}
              style={{ color: 'var(--warning-color, #ff9500)' }}
            />
          </div>

          {/* Title */}
          <h2
            style={{
              fontSize: 'var(--font-size-xl, 18px)',
              fontWeight: 600,
              color: 'var(--text-primary, #1d1d1f)',
              marginBottom: 8
            }}
          >
            Something went wrong
          </h2>

          {/* Error message */}
          <p
            style={{
              fontSize: 'var(--font-size-md, 13px)',
              color: 'var(--text-secondary, #86868b)',
              lineHeight: 1.5,
              marginBottom: 20
            }}
          >
            {error?.message ?? 'An unexpected error occurred.'}
          </p>

          {/* Collapsible technical details */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={this.toggleDetails}
            style={{ marginBottom: showDetails ? 12 : 20 }}
          >
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Technical Details
          </button>

          {showDetails && (
            <pre
              className="mono"
              style={{
                textAlign: 'left',
                fontSize: 'var(--font-size-xs, 11px)',
                color: 'var(--text-secondary, #86868b)',
                backgroundColor: 'var(--bg-secondary, #f5f5f7)',
                border: '1px solid var(--border-color, #d2d2d7)',
                borderRadius: 'var(--border-radius-md, 6px)',
                padding: 12,
                overflow: 'auto',
                maxHeight: 200,
                marginBottom: 20,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {error?.stack ?? 'No stack trace available.'}
            </pre>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={this.handleReset}>
              <RefreshCw size={14} />
              Try Again
            </button>
            <button className="btn btn-primary" onClick={this.handleReload}>
              Reload App
            </button>
          </div>
        </div>
      </div>
    )
  }
}
