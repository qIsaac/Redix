import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Plus, Database, Terminal, BarChart3, Wifi, WifiOff } from 'lucide-react'
import { useConnectionStore } from '../store/connectionStore'
import { useAppStore, type ActiveView } from '../store/appStore'
import { useBrowserStore } from '../store/browserStore'
import type { ConnectionStatus } from '../../shared/types'
import { DatabaseDialog } from './DatabaseDialog'
import { useI18n } from '../i18n'

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

const Sidebar: React.FC = () => {
  const t = useI18n((s) => s.t)
  const connections = useConnectionStore((s) => s.connections)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const currentDb = useConnectionStore((s) => s.currentDb)
  const selectConnection = useConnectionStore((s) => s.selectConnection)
  const deleteConnection = useConnectionStore((s) => s.deleteConnection)
  const connectToServer = useConnectionStore((s) => s.connectToServer)
  const disconnectFromServer = useConnectionStore((s) => s.disconnectFromServer)
  const selectDb = useConnectionStore((s) => s.selectDb)
  const addedDatabases = useConnectionStore((s) => s.addedDatabases)
  const addDatabase = useConnectionStore((s) => s.addDatabase)
  const removeDatabase = useConnectionStore((s) => s.removeDatabase)
  const updateDatabase = useConnectionStore((s) => s.updateDatabase)

  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const openConnectionForm = useAppStore((s) => s.openConnectionForm)
  const editConnection = useAppStore((s) => s.editConnection)
  const openBrowserCli = useAppStore((s) => s.openBrowserCli)

  const startScan = useBrowserStore((s) => s.startScan)

  // Database dialog state
  const [dbDialogOpen, setDbDialogOpen] = useState(false)
  const [dbDialogConnId, setDbDialogConnId] = useState<string | null>(null)
  const [dbDialogMode, setDbDialogMode] = useState<'add' | 'edit'>('add')
  const [dbDialogInitialDbNumber, setDbDialogInitialDbNumber] = useState<number | undefined>(undefined)
  const [dbDialogInitialAlias, setDbDialogInitialAlias] = useState<string | undefined>(undefined)

  // Track previously connected IDs to detect new connections
  const prevConnectedRef = useRef<Set<string>>(new Set())

  const handleCopyName = useCallback((name: string) => {
    navigator.clipboard.writeText(name).catch(() => {
      /* ignore */
    })
  }, [])

  // Auto-open dialog when a connection becomes connected for the first time
  useEffect(() => {
    const newlyConnected = new Set<string>()
    for (const conn of connections) {
      if (conn.status === 'connected') {
        newlyConnected.add(conn.config.id)
      }
    }

    // Find connections that just became connected (not in prevConnectedRef)
    for (const connId of newlyConnected) {
      if (!prevConnectedRef.current.has(connId)) {
        // Newly connected — open dialog if no dbs added yet
        const alreadyHasDbs = addedDatabases.some((e) => e.connectionId === connId)
        if (!alreadyHasDbs) {
          setDbDialogConnId(connId)
          setDbDialogOpen(true)
        }
      }
    }

    prevConnectedRef.current = newlyConnected
  }, [connections, addedDatabases])

  const handleOpenDbDialog = useCallback((connId: string) => {
    setDbDialogConnId(connId)
    setDbDialogMode('add')
    setDbDialogInitialDbNumber(undefined)
    setDbDialogInitialAlias(undefined)
    setDbDialogOpen(true)
  }, [])

  const handleEditDbDialog = useCallback((connId: string, dbNumber: number, alias: string) => {
    setDbDialogConnId(connId)
    setDbDialogMode('edit')
    setDbDialogInitialDbNumber(dbNumber)
    setDbDialogInitialAlias(alias)
    setDbDialogOpen(true)
  }, [])

  const handleDbDialogConfirm = useCallback(
    (dbNumber: number, alias: string) => {
      if (dbDialogConnId) {
        if (dbDialogMode === 'edit' && dbDialogInitialDbNumber !== undefined) {
          updateDatabase(dbDialogConnId, dbDialogInitialDbNumber, dbNumber, alias)
        } else {
          addDatabase({ connectionId: dbDialogConnId, dbNumber, alias })
        }
      }
      setDbDialogOpen(false)
      setDbDialogConnId(null)
    },
    [dbDialogConnId, dbDialogMode, dbDialogInitialDbNumber, addDatabase, updateDatabase]
  )

  const handleSelectDb = useCallback(
    async (connectionId: string, db: number) => {
      if (connectionId !== activeConnectionId) {
        selectConnection(connectionId)
      }
      const ok = await selectDb(connectionId, db)
      if (ok) {
        startScan(connectionId)
      }
    },
    [activeConnectionId, selectConnection, selectDb, startScan]
  )

  const handleOpenCliForDb = useCallback(
    async (connectionId: string, db: number) => {
      if (connectionId !== activeConnectionId) {
        selectConnection(connectionId)
      }
      const ok = await selectDb(connectionId, db)
      if (ok) {
        startScan(connectionId)
      }
      setActiveView('browser')
      openBrowserCli()
    },
    [activeConnectionId, openBrowserCli, selectConnection, selectDb, setActiveView, startScan]
  )

  const viewButtons: { key: ActiveView; icon: React.ReactNode; label: string }[] = [
    { key: 'browser', icon: <Database size={16} />, label: t('sidebar.browser') },
    { key: 'terminal', icon: <Terminal size={16} />, label: t('sidebar.terminal') },
    { key: 'monitor', icon: <BarChart3 size={16} />, label: t('sidebar.monitor') },
  ]

  const dbDialogConnName =
    connections.find((c) => c.config.id === dbDialogConnId)?.config.name ?? ''

  return (
    <aside className="sidebar">
      {/* Traffic light spacer */}
      <div style={{ height: 40, flexShrink: 0 }} />

      {/* New Connection button */}
      <div className="sidebar-header">
        <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={openConnectionForm}>
          <Plus size={14} />
          {t('sidebar.newConnection')}
        </button>
      </div>

      {/* Connections list */}
      <div className="sidebar-group-title">{t('sidebar.connections')}</div>

      <div className="sidebar-list">
        {connections.length === 0 && (
          <div style={{ padding: '12px 16px', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            {t('sidebar.noConnections')}
          </div>
        )}

        {connections.map((conn) => {
          const isConnected = conn.status === 'connected'
          const connAddedDbs = addedDatabases.filter((e) => e.connectionId === conn.config.id)

          return (
            <div key={conn.config.id}>
              {/* Connection header with context menu */}
              <ContextMenu.Root>
                <ContextMenu.Trigger asChild>
                  <div
                    className="sidebar-item"
                    onClick={() => {
                      selectConnection(conn.config.id)
                    }}
                    onDoubleClick={() => {
                      if (conn.status === 'disconnected' || conn.status === 'error') {
                        connectToServer(conn.config.id)
                      }
                    }}
                  >
                    <span className="sidebar-item-icon">
                      <span className={statusDotClass(conn.status)} />
                    </span>
                    <span className="sidebar-item-label">{conn.config.name}</span>
                  </div>
                </ContextMenu.Trigger>

                <ContextMenu.Portal>
                  <ContextMenu.Content className="context-menu">
                    <ContextMenu.Item
                      className="context-menu-item"
                      onSelect={() => editConnection(conn.config)}
                    >
                      {t('sidebar.editConnection')}
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      className="context-menu-item"
                      onSelect={() => handleCopyName(conn.config.name)}
                    >
                      {t('sidebar.copyConnectionName')}
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="context-menu-separator" />
                    {conn.status === 'connected' ? (
                      <>
                        <ContextMenu.Item
                          className="context-menu-item"
                          onSelect={() => handleOpenDbDialog(conn.config.id)}
                        >
                          <Plus size={14} /> {t('sidebar.addDatabase')}
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          className="context-menu-item"
                          onSelect={() => disconnectFromServer(conn.config.id)}
                        >
                          <WifiOff size={14} /> {t('sidebar.disconnect')}
                        </ContextMenu.Item>
                      </>
                    ) : (
                      <ContextMenu.Item
                        className="context-menu-item"
                        onSelect={() => connectToServer(conn.config.id)}
                      >
                        <Wifi size={14} /> {t('sidebar.connect')}
                      </ContextMenu.Item>
                    )}
                    <ContextMenu.Separator className="context-menu-separator" />
                    <ContextMenu.Item
                      className="context-menu-item danger"
                      onSelect={() => deleteConnection(conn.config.id)}
                    >
                      {t('sidebar.delete')}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>

              {/* Added database entries for this connection */}
              {isConnected &&
                connAddedDbs.map((entry) => {
                  const isCurrentDb =
                    activeConnectionId === conn.config.id && currentDb === entry.dbNumber

                  return (
                    <ContextMenu.Root key={`${entry.connectionId}-${entry.dbNumber}`}>
                      <ContextMenu.Trigger asChild>
                        <div
                          className={`sidebar-item connection-db-item${isCurrentDb ? ' active' : ''}`}
                          style={{ paddingLeft: 28 }}
                          onClick={() => handleSelectDb(conn.config.id, entry.dbNumber)}
                          title={`db${entry.dbNumber}`}
                        >
                          <Database size={12} className="connection-db-icon" />
                          <span className="sidebar-item-label">
                            {entry.alias}[db{entry.dbNumber}]
                          </span>
                        </div>
                      </ContextMenu.Trigger>

                      <ContextMenu.Portal>
                        <ContextMenu.Content className="context-menu">
                          <ContextMenu.Item
                            className="context-menu-item"
                            onSelect={() => handleOpenCliForDb(conn.config.id, entry.dbNumber)}
                          >
                            <Terminal size={14} /> {t('browser.openCli')}
                          </ContextMenu.Item>
                          <ContextMenu.Separator className="context-menu-separator" />
                          <ContextMenu.Item
                            className="context-menu-item"
                            onSelect={() => handleSelectDb(conn.config.id, entry.dbNumber)}
                          >
                            {t('sidebar.select')}
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="context-menu-item"
                            onSelect={() => handleEditDbDialog(conn.config.id, entry.dbNumber, entry.alias)}
                          >
                            {t('sidebar.edit')}
                          </ContextMenu.Item>
                          <ContextMenu.Separator className="context-menu-separator" />
                          <ContextMenu.Item
                            className="context-menu-item danger"
                            onSelect={() => removeDatabase(entry.connectionId, entry.dbNumber)}
                          >
                            {t('sidebar.remove')}
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                  )
                })}
            </div>
          )
        })}
      </div>

      {/* View switcher (bottom) */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 12px', flexShrink: 0 }}>
        {viewButtons.map((btn) => (
          <button
            key={btn.key}
            className={`btn btn-ghost btn-sm${activeView === btn.key ? ' active' : ''}`}
            style={{
              flex: 1,
              justifyContent: 'center',
              backgroundColor: activeView === btn.key ? 'var(--bg-selected)' : undefined,
              color: activeView === btn.key ? 'var(--text-accent)' : undefined,
            }}
            onClick={() => setActiveView(btn.key)}
            title={btn.label}
          >
            {btn.icon}
          </button>
        ))}
      </div>

      {/* Database Dialog */}
      <DatabaseDialog
        open={dbDialogOpen}
        onOpenChange={(open) => {
          setDbDialogOpen(open)
          if (!open) setDbDialogConnId(null)
        }}
        connectionName={dbDialogConnName}
        mode={dbDialogMode}
        initialDbNumber={dbDialogInitialDbNumber}
        initialAlias={dbDialogInitialAlias}
        onConfirm={handleDbDialogConfirm}
      />


    </aside>
  )
}

export default Sidebar
