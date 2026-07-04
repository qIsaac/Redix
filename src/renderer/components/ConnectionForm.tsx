import { useState, useEffect, useCallback, useRef, type ReactElement, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Server, Plus, X, Loader2, Check, AlertCircle } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useConnectionStore } from '../store/connectionStore'
import type { ConnectionConfig } from '../../shared/types'
import { useI18n } from '../i18n'

type ConnectionType = ConnectionConfig['type']

interface FormState {
  name: string
  type: ConnectionType
  host: string
  port: string
  password: string
  db: string
  tls: boolean
  sentinelName: string
  sentinels: { host: string; port: string }[]
  clusterNodes: { host: string; port: string }[]
}

const defaultForm: FormState = {
  name: '',
  type: 'standalone',
  host: 'localhost',
  port: '6379',
  password: '',
  db: '0',
  tls: false,
  sentinelName: '',
  sentinels: [{ host: 'localhost', port: '26379' }],
  clusterNodes: [{ host: 'localhost', port: '6379' }],
}

function generateId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export default function ConnectionForm(): ReactElement {
  const t = useI18n((s) => s.t)
  const showConnectionForm = useAppStore((s) => s.showConnectionForm)
  const editingConnection = useAppStore((s) => s.editingConnection)
  const closeConnectionForm = useAppStore((s) => s.closeConnectionForm)
  const addConnection = useConnectionStore((s) => s.addConnection)
  const updateConnection = useConnectionStore((s) => s.updateConnection)
  const testConnection = useConnectionStore((s) => s.testConnection)

  const [form, setForm] = useState<FormState>({ ...defaultForm })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const testRunRef = useRef(0)

  // Populate form when editing
  useEffect(() => {
    testRunRef.current += 1
    if (editingConnection) {
      const c = editingConnection
      setForm({
        name: c.name,
        type: c.type,
        host: c.host,
        port: String(c.port),
        password: c.password ?? '',
        db: String(c.db ?? 0),
        tls: c.tls ?? false,
        sentinelName: c.sentinelOptions?.name ?? '',
        sentinels: c.sentinelOptions?.sentinels.map((s) => ({
          host: s.host,
          port: String(s.port),
        })) ?? [{ host: 'localhost', port: '26379' }],
        clusterNodes: c.clusterOptions?.nodes.map((n) => ({
          host: n.host,
          port: String(n.port),
        })) ?? [{ host: 'localhost', port: '6379' }],
      })
    } else {
      setForm({ ...defaultForm })
    }
    setErrors({})
    setTesting(false)
    setSaving(false)
    setTestResult(null)
  }, [editingConnection, showConnectionForm])

  const validate = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = t('form.nameRequired')
    if (!form.host.trim()) errs.host = t('form.hostRequired')
    const port = parseInt(form.port, 10)
    if (isNaN(port) || port < 1 || port > 65535) errs.port = t('form.portInvalid')
    if (form.type === 'sentinel') {
      if (!form.sentinelName.trim()) errs.sentinelName = t('form.sentinelNameRequired')
      if (form.sentinels.length === 0) errs.sentinels = t('form.sentinelNodeRequired')
      form.sentinels.forEach((s, i) => {
        if (!s.host.trim()) errs[`sentinel_host_${i}`] = t('form.hostRequired')
        const sp = parseInt(s.port, 10)
        if (isNaN(sp) || sp < 1 || sp > 65535) errs[`sentinel_port_${i}`] = t('form.invalidPort')
      })
    }
    if (form.type === 'cluster') {
      if (form.clusterNodes.length === 0) errs.clusterNodes = t('form.clusterNodeRequired')
      form.clusterNodes.forEach((n, i) => {
        if (!n.host.trim()) errs[`cluster_host_${i}`] = t('form.hostRequired')
        const np = parseInt(n.port, 10)
        if (isNaN(np) || np < 1 || np > 65535) errs[`cluster_port_${i}`] = t('form.invalidPort')
      })
    }
    return errs
  }, [form, t])

  const buildConfig = useCallback((): ConnectionConfig => {
    const config: ConnectionConfig = {
      id: editingConnection?.id ?? generateId(),
      name: form.name.trim(),
      type: form.type,
      host: form.host.trim(),
      port: parseInt(form.port, 10),
      password: form.password || undefined,
      db: parseInt(form.db, 10) || 0,
      tls: form.tls || undefined,
    }
    if (form.type === 'sentinel') {
      config.sentinelOptions = {
        name: form.sentinelName.trim(),
        sentinels: form.sentinels.map((s) => ({
          host: s.host.trim(),
          port: parseInt(s.port, 10),
        })),
      }
    }
    if (form.type === 'cluster') {
      config.clusterOptions = {
        nodes: form.clusterNodes.map((n) => ({
          host: n.host.trim(),
          port: parseInt(n.port, 10),
        })),
      }
    }
    return config
  }, [form, editingConnection])

  const handleTest = async (): Promise<void> => {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    const runId = ++testRunRef.current
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection(buildConfig())
      if (runId === testRunRef.current) {
        setTestResult(result)
      }
    } finally {
      if (runId === testRunRef.current) {
        setTesting(false)
      }
    }
  }

  const handleSave = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setSaving(true)
    try {
      const config = buildConfig()
      if (editingConnection) {
        await updateConnection(config)
      } else {
        await addConnection(config)
      }
      closeConnectionForm()
    } finally {
      setSaving(false)
    }
  }

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  // Sentinel helpers
  const addSentinel = (): void => {
    setForm((prev) => ({
      ...prev,
      sentinels: [...prev.sentinels, { host: 'localhost', port: '26379' }],
    }))
  }
  const removeSentinel = (index: number): void => {
    setForm((prev) => ({
      ...prev,
      sentinels: prev.sentinels.filter((_, i) => i !== index),
    }))
  }
  const updateSentinel = (index: number, field: 'host' | 'port', value: string): void => {
    setForm((prev) => ({
      ...prev,
      sentinels: prev.sentinels.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }))
  }

  // Cluster helpers
  const addClusterNode = (): void => {
    setForm((prev) => ({
      ...prev,
      clusterNodes: [...prev.clusterNodes, { host: 'localhost', port: '6379' }],
    }))
  }
  const removeClusterNode = (index: number): void => {
    setForm((prev) => ({
      ...prev,
      clusterNodes: prev.clusterNodes.filter((_, i) => i !== index),
    }))
  }
  const updateClusterNode = (index: number, field: 'host' | 'port', value: string): void => {
    setForm((prev) => ({
      ...prev,
      clusterNodes: prev.clusterNodes.map((n, i) => (i === index ? { ...n, [field]: value } : n)),
    }))
  }

  const formGroupStyle: React.CSSProperties = { marginBottom: 12 }
  const formLabelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
    color: 'var(--text-secondary)',
  }
  const errorStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--danger-color)',
    marginTop: 2,
  }
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  }

  return (
    <Dialog.Root
      open={showConnectionForm}
      onOpenChange={(open) => {
        if (!open) closeConnectionForm()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" style={{ width: 520, maxWidth: 'calc(100vw - 32px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Dialog.Title className="dialog-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Server size={18} />
              {editingConnection ? t('form.editConnection') : t('form.newConnection')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={(e) => void handleSave(e)}>
            {/* Name */}
            <div style={formGroupStyle}>
              <label style={formLabelStyle}>{t('form.name')}</label>
              <input
                className="input"
                placeholder={t('form.namePlaceholder')}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
              />
              {errors.name && <div style={errorStyle}>{errors.name}</div>}
            </div>

            {/* Type */}
            <div style={formGroupStyle}>
              <label style={formLabelStyle}>{t('form.connectionType')}</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => updateField('type', e.target.value as ConnectionType)}
              >
                <option value="standalone">{t('form.standalone')}</option>
                <option value="sentinel">{t('form.sentinel')}</option>
                <option value="cluster">{t('form.cluster')}</option>
              </select>
            </div>

            {/* Host + Port (Standalone & Sentinel) */}
            {form.type !== 'cluster' && (
              <div style={formGroupStyle}>
                <div style={rowStyle}>
                  <div style={{ flex: 1 }}>
                    <label style={formLabelStyle}>{t('form.host')}</label>
                    <input
                      className="input"
                      placeholder={t('form.hostPlaceholder')}
                      value={form.host}
                      onChange={(e) => updateField('host', e.target.value)}
                    />
                    {errors.host && <div style={errorStyle}>{errors.host}</div>}
                  </div>
                  <div style={{ width: 100 }}>
                    <label style={formLabelStyle}>{t('form.port')}</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => updateField('port', e.target.value)}
                    />
                    {errors.port && <div style={errorStyle}>{errors.port}</div>}
                  </div>
                </div>
              </div>
            )}

            {/* Sentinel extra fields */}
            {form.type === 'sentinel' && (
              <>
                <div style={formGroupStyle}>
                  <label style={formLabelStyle}>{t('form.sentinelName')}</label>
                  <input
                    className="input"
                    placeholder="mymaster"
                    value={form.sentinelName}
                    onChange={(e) => updateField('sentinelName', e.target.value)}
                  />
                  {errors.sentinelName && <div style={errorStyle}>{errors.sentinelName}</div>}
                </div>
                <div style={formGroupStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={formLabelStyle}>{t('form.sentinelNodes')}</label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={addSentinel}>
                      <Plus size={14} /> {t('form.add')}
                    </button>
                  </div>
                  {errors.sentinels && <div style={errorStyle}>{errors.sentinels}</div>}
                  {form.sentinels.map((s, i) => (
                    <div key={i} style={{ ...rowStyle, marginBottom: 4 }}>
                      <div style={{ flex: 1 }}>
                        <input
                          className="input"
                          placeholder={t('form.hostPlaceholder')}
                          value={s.host}
                          onChange={(e) => updateSentinel(i, 'host', e.target.value)}
                        />
                        {errors[`sentinel_host_${i}`] && (
                          <div style={errorStyle}>{errors[`sentinel_host_${i}`]}</div>
                        )}
                      </div>
                      <div style={{ width: 90 }}>
                        <input
                          className="input"
                          type="number"
                          placeholder={t('form.portPlaceholder')}
                          value={s.port}
                          onChange={(e) => updateSentinel(i, 'port', e.target.value)}
                        />
                        {errors[`sentinel_port_${i}`] && (
                          <div style={errorStyle}>{errors[`sentinel_port_${i}`]}</div>
                        )}
                      </div>
                      {form.sentinels.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 2, padding: 4 }}
                          onClick={() => removeSentinel(i)}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Cluster nodes */}
            {form.type === 'cluster' && (
              <div style={formGroupStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={formLabelStyle}>{t('form.clusterNodes')}</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addClusterNode}>
                    <Plus size={14} /> {t('form.add')}
                  </button>
                </div>
                {errors.clusterNodes && <div style={errorStyle}>{errors.clusterNodes}</div>}
                {form.clusterNodes.map((n, i) => (
                  <div key={i} style={{ ...rowStyle, marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <input
                        className="input"
                        placeholder={t('form.hostPlaceholder')}
                        value={n.host}
                        onChange={(e) => updateClusterNode(i, 'host', e.target.value)}
                      />
                      {errors[`cluster_host_${i}`] && (
                        <div style={errorStyle}>{errors[`cluster_host_${i}`]}</div>
                      )}
                    </div>
                    <div style={{ width: 90 }}>
                      <input
                        className="input"
                        type="number"
                        placeholder={t('form.portPlaceholder')}
                        value={n.port}
                        onChange={(e) => updateClusterNode(i, 'port', e.target.value)}
                      />
                      {errors[`cluster_port_${i}`] && (
                        <div style={errorStyle}>{errors[`cluster_port_${i}`]}</div>
                      )}
                    </div>
                    {form.clusterNodes.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 2, padding: 4 }}
                        onClick={() => removeClusterNode(i)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Password */}
            <div style={formGroupStyle}>
              <label style={formLabelStyle}>{t('form.password')}</label>
              <input
                className="input"
                type="password"
                placeholder={t('form.optional')}
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
              />
            </div>

            {/* DB + TLS */}
            <div style={formGroupStyle}>
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={formLabelStyle}>{t('form.database')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={form.db}
                    onChange={(e) => updateField('db', e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 22 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={form.tls}
                      onChange={(e) => updateField('tls', e.target.checked)}
                      style={{ accentColor: 'var(--accent-color)' }}
                    />
                    {t('form.tls')}
                  </label>
                </div>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  marginBottom: 12,
                  borderRadius: 6,
                  fontSize: 13,
                  backgroundColor: testResult.success ? 'rgba(52, 199, 89, 0.12)' : 'rgba(255, 59, 48, 0.12)',
                  color: testResult.success ? '#34c759' : '#ff3b30',
                }}
              >
                {testResult.success ? <Check size={16} /> : <AlertCircle size={16} />}
                {testResult.success ? t('form.connectionSuccessful') : testResult.error ?? t('form.connectionFailed')}
              </div>
            )}

            {/* Actions */}
            <div className="dialog-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleTest()}
                disabled={testing}
              >
                {testing ? <Loader2 size={14} className="spin" /> : <Server size={14} />}
                {testing ? t('form.testing') : t('form.testConnection')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeConnectionForm}>
                {t('form.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                {editingConnection ? t('form.update') : t('form.save')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </Dialog.Root>
  )
}
