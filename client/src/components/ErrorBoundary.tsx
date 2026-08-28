import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render-time crashes and puts them on the page.
 *
 * Without this, any error thrown during the first render unmounts the whole
 * tree and leaves an empty <div id="root">, which is indistinguishable from a
 * build that produced nothing. A visible error is always more useful than a
 * blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[Policy Prism] render failed:', error, info);
    this.setState({ info });
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#E9EDEF',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          color: '#0E1C26',
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: '100%',
            background: '#fff',
            border: '1px solid #D5DEE1',
            borderRadius: 6,
            padding: '28px 30px',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18 }}>Policy Prism could not start</h1>
          <p style={{ marginTop: 8, fontSize: 13, color: '#72838C' }}>
            The interface hit an error while rendering. The details below are what to act on.
          </p>

          <div
            style={{
              marginTop: 18,
              background: '#F7E6E1',
              borderLeft: '3px solid #9E3823',
              padding: '12px 14px',
              borderRadius: '0 4px 4px 0',
              fontSize: 13,
              color: '#7C2B1B',
              fontFamily: 'ui-monospace, monospace',
              wordBreak: 'break-word',
            }}
          >
            <b>{error.name}:</b> {error.message}
          </div>

          {(error.stack || info?.componentStack) && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#3C4F5A' }}>
                Stack trace
              </summary>
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: '#F5F8F9',
                  border: '1px solid #E5EBED',
                  borderRadius: 4,
                  fontSize: 11,
                  lineHeight: 1.5,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  color: '#3C4F5A',
                }}
              >
                {error.stack}
                {info?.componentStack}
              </pre>
            </details>
          )}

          <div style={{ marginTop: 20, fontSize: 12.5, color: '#72838C', lineHeight: 1.7 }}>
            <b style={{ color: '#0E1C26' }}>Most common causes</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              <li>
                The shared package was never built. Run <code>npm run build:shared</code> from the
                repository root, then restart the dev server.
              </li>
              <li>
                The API is not reachable. Check <code>curl http://localhost:4000/health</code>.
              </li>
              <li>
                On a deployed build, <code>VITE_API_URL</code> was set after the build ran. Vite
                inlines it at build time, so a redeploy is required.
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              background: '#0E1C26',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
