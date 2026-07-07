import React from 'react'
import { Database } from 'lucide-react'
import Sidebar from './Sidebar'
import ServerMonitor from './ServerMonitor'
import { useConnectionStore } from '../store/connectionStore'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import type { ConnectionStatus } from '../shared/types'

function statusLabel(status: ConnectionStatus, t: (key: string) => string): string {
  switch (status) {
    case 'connected':
      return t('status.connected')
    case 'connecting':
      return t('status.connecting')
    case 'reconnecting':
      return t('status.reconnecting')
    case 'error':
      return t('status.error')
    default:
      return t('status.disconnected')
  }
}

function statusDotClass(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'statusbar-dot connected'
    case 'connecting':
    case 'reconnecting':
      return 'statusbar-dot connecting'
    case 'error':
      return 'statusbar-dot error'
    default:
      return 'statusbar-dot disconnected'
  }
}

interface AppLayoutProps {
  children?: React.ReactNode
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const connections = useConnectionStore((s) => s.connections)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const activeView = useAppStore((s) => s.activeView)
  const t = useI18n((s) => s.t)
  const locale = useI18n((s) => s.locale)
  const setLocale = useI18n((s) => s.setLocale)

  const activeConnection = connections.find((c) => c.config.id === activeConnectionId) ?? null

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar />

        <main className="app-main">
          {activeView === 'terminal' ? (
            children ?? null
          ) : activeConnection ? (
            activeView === 'monitor' ? (
              <ServerMonitor />
            ) : (
              children ?? (
                <div className="empty-state">
                  <Database className="empty-state-icon" />
                  <div className="empty-state-title">{t('layout.ready')}</div>
                  <div className="empty-state-description">
                    {t('layout.readyDesc', { name: activeConnection.config.name })}
                  </div>
                </div>
              )
            )
          ) : (
            <div className="empty-state">
              <Database className="empty-state-icon" />
              <div className="empty-state-title">{t('layout.noConnectionSelected')}</div>
              <div className="empty-state-description">
                {t('layout.noConnectionSelectedDesc')}
              </div>
            </div>
          )}
        </main>
      </div>

      <div className="statusbar">
        {activeConnection ? (
          <>
            <div className="statusbar-item">
              <span className={statusDotClass(activeConnection.status)} />
              <span>{statusLabel(activeConnection.status, t)}</span>
            </div>
            <div style={{ flex: 1 }} />
            <div className="statusbar-item">
              <span>
                {activeConnection.config.host}:{activeConnection.config.port}
              </span>
            </div>
            {activeConnection.serverInfo?.redis_version && (
              <div className="statusbar-item">
                <span>Redis {activeConnection.serverInfo.redis_version}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="statusbar-item">
              <span className="statusbar-dot disconnected" />
              <span>{t('status.noConnection')}</span>
            </div>
            <div style={{ flex: 1 }} />
          </>
        )}
        <div className="titlebar-lang-switch">
          <button
            className={`lang-btn${locale === 'en' ? ' active' : ''}`}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
          <button
            className={`lang-btn${locale === 'zh-CN' ? ' active' : ''}`}
            onClick={() => setLocale('zh-CN')}
          >
            中文
          </button>
        </div>
      </div>
    </div>
  )
}

export default AppLayout
