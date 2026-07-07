import { useEffect, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, Terminal as TerminalIcon, X } from 'lucide-react'
import AppLayout from './components/AppLayout'
import KeyBrowser from './components/KeyBrowser'
import KeyDetail from './components/KeyDetail'
import Terminal from './components/Terminal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from './components/Toast'
import ConnectionForm from './components/ConnectionForm'
import { useConnectionStore } from './store/connectionStore'
import { useAppStore } from './store/appStore'
import { useConnectionStatus } from './hooks/useIPC'

function App(): ReactElement {
  const loadConnections = useConnectionStore((s) => s.loadConnections)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connections = useConnectionStore((s) => s.connections)
  const currentDb = useConnectionStore((s) => s.currentDb)
  const activeView = useAppStore((s) => s.activeView)
  const browserCliOpen = useAppStore((s) => s.browserCliOpen)
  const browserCliCollapsed = useAppStore((s) => s.browserCliCollapsed)
  const closeBrowserCli = useAppStore((s) => s.closeBrowserCli)
  const toggleBrowserCliCollapsed = useAppStore((s) => s.toggleBrowserCliCollapsed)

  const activeConnection = connections.find((c) => c.config.id === activeConnectionId) ?? null

  // Listen for connection status changes from main process
  useConnectionStatus()

  // Load connections on mount
  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  return (
    <ErrorBoundary>
      <AppLayout>
        {activeView === 'browser' && (
          <div className="browser-workspace">
            <div className="browser-split">
              <div
                style={{
                  width: '40%',
                  minWidth: 260,
                  borderRight: '1px solid var(--border-color)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <KeyBrowser />
              </div>
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <KeyDetail />
              </div>
            </div>
            {browserCliOpen && (
              <section className={`browser-cli-panel${browserCliCollapsed ? ' collapsed' : ''}`}>
                <div className="browser-cli-header">
                  <div className="browser-cli-title">
                    <TerminalIcon size={14} />
                    <span>CLI</span>
                    <span className="browser-cli-db">db{currentDb}</span>
                    {activeConnection && (
                      <span className="browser-cli-host">
                        {activeConnection.config.host}:{activeConnection.config.port}
                      </span>
                    )}
                  </div>
                  <div className="browser-cli-actions">
                    <button
                      className="icon-button"
                      onClick={toggleBrowserCliCollapsed}
                      title={browserCliCollapsed ? 'Expand CLI' : 'Collapse CLI'}
                    >
                      {browserCliCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button className="icon-button" onClick={closeBrowserCli} title="Close CLI">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {!browserCliCollapsed && (
                  <Terminal connectionId={activeConnectionId} currentDb={currentDb} embedded />
                )}
              </section>
            )}
          </div>
        )}
        {activeView === 'terminal' && <Terminal connectionId={activeConnectionId} currentDb={currentDb} />}
      </AppLayout>
      <ConnectionForm />
      <ToastContainer />
    </ErrorBoundary>
  )
}

export default App
