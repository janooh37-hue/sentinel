/**
 * ErrorBoundary — catches React render errors and shows a fallback
 * with diagnostic info + clipboard copy button.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@/lib/appVersion'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
    void api.postCrashReport({
      message: error.message.slice(0, 1024),
      stack: (error.stack ?? info.componentStack ?? null)?.slice(0, 65536) ?? null,
      browser: navigator.userAgent,
      timestamp: new Date().toISOString(),
      severity: 'error',
    }).catch(() => {
      // Fire-and-forget — don't let a crash-report failure cascade.
    })
  }

  private copyDiagnostic = (): void => {
    const blob = {
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      browser: navigator.userAgent,
      error: this.state.error?.message,
      stack: this.state.error?.stack,
    }
    void copyToClipboard(JSON.stringify(blob, null, 2))
  }

  private reload = (): void => {
    this.setState({ error: null })
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive text-2xl">
            ⚠
          </div>
          <div className="max-w-lg">
            <h1 className="text-base font-semibold text-foreground">Something went wrong</h1>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {this.state.error.message}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={this.copyDiagnostic}>
              Copy diagnostic
            </Button>
            <Button size="sm" onClick={this.reload}>
              Reload
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">GSSG Manager {APP_VERSION}</p>
        </div>
      )
    }
    return this.props.children
  }
}
