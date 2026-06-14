import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary caught]', error)
    console.error('[Component stack]', info?.componentStack)
  }

  reset() {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="rounded-xl border-2 px-5 py-4 text-sm"
             style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
          <p className="font-semibold mb-1">렌더링 오류</p>
          <p className="text-xs font-mono break-all mb-2" style={{ color: 'var(--danger-text)', opacity: 0.85 }}>
            {String(this.state.error)}
          </p>
          <button
            onClick={() => this.reset()}
            className="text-xs hover:underline"
            style={{ color: 'var(--danger-text)' }}
          >
            다시 시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
