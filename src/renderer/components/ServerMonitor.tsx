import React, { useState, useCallback, useEffect } from 'react'
import { Activity, Cpu, HardDrive, Users, Zap, Clock, RefreshCw, Monitor } from 'lucide-react'
import { useConnectionStore } from '../store/connectionStore'
import { useInterval } from '../hooks/useIPC'
import { useI18n } from '../i18n'
import type { ServerMetrics, SlowLogEntry } from '../../shared/types'
import type { IPCResponse } from '../../shared/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ServerInfoData {
  [section: string]: Record<string, string>
}

function parseInfoString(raw: string): ServerInfoData {
  const result: ServerInfoData = {}
  let currentSection = ''
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      const m = trimmed.match(/^#\s+(\w+)/)
      if (m) {
        currentSection = m[1].toLowerCase()
        if (!result[currentSection]) result[currentSection] = {}
      }
      continue
    }
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx)
    const value = trimmed.slice(colonIdx + 1)
    if (currentSection) {
      if (!result[currentSection]) result[currentSection] = {}
      result[currentSection][key] = value
    }
  }
  return result
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

interface KeyspaceRow {
  db: string
  keys: number
  expires: number
  avgTtl: number
}

function parseKeyspace(keyspace: Record<string, string>): KeyspaceRow[] {
  return Object.entries(keyspace).map(([db, value]) => {
    const parts: Record<string, number> = {}
    value.split(',').forEach((p) => {
      const [k, v] = p.split('=')
      if (k && v) parts[k] = parseInt(v, 10) || 0
    })
    return {
      db,
      keys: parts['keys'] ?? 0,
      expires: parts['expires'] ?? 0,
      avgTtl: parts['avg_ttl'] ?? 0,
    }
  })
}

// ─── Component ──────────────────────────────────────────────────────────────

const ServerMonitor: React.FC = () => {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const t = useI18n((s) => s.t)

  const [metrics, setMetrics] = useState<ServerMetrics | null>(null)
  const [infoData, setInfoData] = useState<ServerInfoData | null>(null)
  const [slowLogs, setSlowLogs] = useState<SlowLogEntry[]>([])
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false)
  const [isLoadingSlowlog, setIsLoadingSlowlog] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    if (!activeConnectionId) return
    setIsLoadingMetrics(true)
    try {
      const res = (await window.electronAPI.server.metrics(activeConnectionId)) as IPCResponse<ServerMetrics>
      if (res.success && res.data) {
        setMetrics(res.data)
        setError(null)
      } else if (!res.success) {
        setError(res.error?.message ?? t('monitor.failedMetrics'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitor.failedMetrics'))
    } finally {
      setIsLoadingMetrics(false)
    }
  }, [activeConnectionId])

  const fetchInfo = useCallback(async () => {
    if (!activeConnectionId) return
    try {
      const res = (await window.electronAPI.server.info(activeConnectionId)) as IPCResponse<string>
      if (res.success && res.data) {
        setInfoData(parseInfoString(res.data))
      }
    } catch {
      // non-critical — info section will just show dashes
    }
  }, [activeConnectionId])

  const fetchSlowlog = useCallback(async () => {
    if (!activeConnectionId) return
    setIsLoadingSlowlog(true)
    try {
      const res = (await window.electronAPI.server.slowlog(activeConnectionId, 20)) as IPCResponse<SlowLogEntry[]>
      if (res.success && res.data) {
        setSlowLogs(res.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('monitor.failedSlowlog'))
    } finally {
      setIsLoadingSlowlog(false)
    }
  }, [activeConnectionId])

  // Initial load and connection change
  useEffect(() => {
    if (activeConnectionId) {
      setError(null)
      setMetrics(null)
      setInfoData(null)
      setSlowLogs([])
      fetchMetrics()
      fetchInfo()
      fetchSlowlog()
    } else {
      setMetrics(null)
      setInfoData(null)
      setSlowLogs([])
      setError(null)
    }
  }, [activeConnectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh metrics + info every 3 s
  useInterval(
    () => {
      fetchMetrics()
      fetchInfo()
    },
    autoRefresh && activeConnectionId ? 3000 : null,
  )

  // Auto-refresh slowlog every 10 s
  useInterval(() => {
    fetchSlowlog()
  }, autoRefresh && activeConnectionId ? 10000 : null)

  // ── Empty state ──────────────────────────────────────────────────────────

  if (!activeConnectionId) {
    return (
      <div className="empty-state">
        <Monitor className="empty-state-icon" />
        <div className="empty-state-title">{t('monitor.selectConnection')}</div>
        <div className="empty-state-description">
          {t('monitor.selectConnectionDesc')}
        </div>
      </div>
    )
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const keyspaceRows = infoData ? parseKeyspace(infoData['keyspace'] ?? {}) : []
  const serverSection = infoData?.['server'] ?? {}
  const clientsSection = infoData?.['clients'] ?? {}

  const infoFields: { label: string; value: string }[] = [
    { label: t('monitor.redisVersion'), value: serverSection['redis_version'] ?? '-' },
    { label: t('monitor.mode'), value: serverSection['redis_mode'] ?? '-' },
    { label: t('monitor.os'), value: serverSection['os'] ?? '-' },
    { label: t('monitor.uptime'), value: metrics ? formatUptime(metrics.uptimeInSeconds) : '-' },
    { label: t('monitor.pid'), value: serverSection['process_id'] ?? '-' },
    { label: t('monitor.tcpPort'), value: serverSection['tcp_port'] ?? '-' },
    { label: t('monitor.connectedClients'), value: clientsSection['connected_clients'] ?? (metrics ? String(metrics.connectedClients) : '-') },
    { label: t('monitor.maxClients'), value: clientsSection['maxclients'] ?? '-' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={20} style={{ color: 'var(--accent-color)' }} />
          <span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('monitor.title')}
          </span>
        </div>
        <button
          className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setAutoRefresh((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={12} />
          {t('monitor.autoRefresh')}
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: autoRefresh ? '#34c759' : 'var(--text-tertiary)',
            }}
          />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="card"
          style={{ borderColor: 'var(--danger-color)', color: 'var(--danger-color)', flexShrink: 0 }}
        >
          {error}
        </div>
      )}

      {/* ── Metric Cards ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          flexShrink: 0,
        }}
      >
        {(
          [
            { icon: <HardDrive size={18} />, label: t('monitor.memory'), value: metrics?.usedMemoryHuman ?? '-', color: '#007aff' },
            { icon: <Users size={18} />, label: t('monitor.clients'), value: metrics ? String(metrics.connectedClients) : '-', color: '#34c759' },
            { icon: <Zap size={18} />, label: t('monitor.hitRate'), value: metrics ? `${metrics.hitRate.toFixed(1)}%` : '-', color: '#ff9500' },
            { icon: <Cpu size={18} />, label: t('monitor.opsPerSec'), value: metrics ? String(metrics.instantaneousOpsPerSec) : '-', color: '#af52de' },
          ] as const
        ).map((card) => (
          <div key={card.label} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: card.color, display: 'flex' }}>{card.icon}</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>{card.label}</span>
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {isLoadingMetrics && !metrics ? '…' : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Server Info ───────────────────────────────────────────────────── */}
      <section style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
            fontSize: 'var(--font-size-md)',
            fontWeight: 600,
            color: 'var(--text-secondary)',
          }}
        >
          <Clock size={14} />
          {t('monitor.serverInfo')}
        </div>
        <div className="card">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '12px 24px',
            }}
          >
            {infoFields.map((field) => (
              <div key={field.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-tertiary)' }}>{field.label}</span>
                <span
                  style={{
                    fontSize: 'var(--font-size-md)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    wordBreak: 'break-all',
                  }}
                >
                  {field.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Keyspace Table ────────────────────────────────────────────────── */}
      {keyspaceRows.length > 0 && (
        <section style={{ flexShrink: 0 }}>
          <div
            style={{
              marginBottom: 10,
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            {t('monitor.keyspace')}
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('monitor.db')}</th>
                  <th>{t('monitor.keys')}</th>
                  <th>{t('monitor.expires')}</th>
                  <th>{t('monitor.avgTtl')}</th>
                </tr>
              </thead>
              <tbody>
                {keyspaceRows.map((row) => (
                  <tr key={row.db}>
                    <td className="mono">{row.db}</td>
                    <td className="mono">{row.keys.toLocaleString()}</td>
                    <td className="mono">{row.expires.toLocaleString()}</td>
                    <td className="mono">{row.avgTtl > 0 ? `${Math.round(row.avgTtl / 1000)}s` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Slow Queries ──────────────────────────────────────────────────── */}
      <section style={{ flexShrink: 0 }}>
        <div
          style={{
            marginBottom: 10,
            fontSize: 'var(--font-size-md)',
            fontWeight: 600,
            color: 'var(--text-secondary)',
          }}
        >
          {t('monitor.slowQueries')}
        </div>
        <div className="table-wrapper">
          {isLoadingSlowlog && slowLogs.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
              {t('monitor.loading')}
            </div>
          ) : slowLogs.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
              {t('monitor.noSlowQueries')}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('monitor.duration')}</th>
                  <th>{t('monitor.command')}</th>
                  <th>{t('monitor.time')}</th>
                </tr>
              </thead>
              <tbody>
                {slowLogs.map((entry) => {
                  const durationMs = entry.duration / 1000
                  const isSlow = durationMs > 10
                  return (
                    <tr key={entry.id}>
                      <td
                        className="mono"
                        style={{
                          color: isSlow ? 'var(--danger-color, #ff3b30)' : undefined,
                          fontWeight: isSlow ? 600 : undefined,
                        }}
                      >
                        {durationMs.toFixed(1)}ms
                      </td>
                      <td className="mono" title={entry.command} style={{ maxWidth: 360 }}>
                        {entry.command}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{formatTime(entry.timestamp)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

export default ServerMonitor
