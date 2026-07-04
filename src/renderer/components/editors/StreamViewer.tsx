import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Save, X, ChevronDown, Hash } from 'lucide-react'
import { useToastStore } from '../Toast'
import type { DataPage, StreamEntry } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface StreamViewerProps {
  connectionId: string
  keyName: string
}

const StreamViewer: React.FC<StreamViewerProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [entries, setEntries] = useState<StreamEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFields, setNewFields] = useState<{ key: string; value: string }[]>([{ key: '', value: '' }])
  const [isAdding, setIsAdding] = useState(false)
  const [consumerGroups, setConsumerGroups] = useState<string[]>([])

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const options: Record<string, unknown> = { type: 'stream' }
        if (append && cursor) options.cursor = cursor
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<StreamEntry> & { consumerGroups?: string[] }
        }
        if (result.success && result.data) {
          const page = result.data
          if (append) {
            setEntries((prev) => [...prev, ...page.items])
          } else {
            setEntries(page.items)
          }
          setCursor(page.cursor)
          setHasMore(page.hasMore)
          setTotalCount(page.totalCount)
          if (page.consumerGroups) {
            setConsumerGroups(page.consumerGroups)
          }
        }
      } catch {
        useToastStore.getState().error(t('toast.loadFailed'), 'Could not load stream entries')
      } finally {
        setIsLoading(false)
      }
    },
    [connectionId, keyName, cursor]
  )

  useEffect(() => {
    loadData(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, keyName])

  const refresh = useCallback(() => {
    setCursor(undefined)
    loadData(false)
  }, [loadData])

  const handleAddField = () => {
    setNewFields((prev) => [...prev, { key: '', value: '' }])
  }

  const handleRemoveField = (index: number) => {
    setNewFields((prev) => prev.filter((_, i) => i !== index))
  }

  const handleFieldChange = (index: number, field: 'key' | 'value', val: string) => {
    setNewFields((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: val } : f)))
  }

  const handleAdd = useCallback(async () => {
    const validFields = newFields.filter((f) => f.key.trim())
    if (validFields.length === 0) {
      useToastStore.getState().warning(t('toast.noFields'), t('toast.addAtLeastOne'))
      return
    }
    const fieldsObj: Record<string, string> = {}
    for (const f of validFields) {
      fieldsObj[f.key.trim()] = f.value
    }
    setIsAdding(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        fields: fieldsObj,
      })) as { success: boolean; error?: { message: string } }
      if (result.success) {
        useToastStore.getState().success(t('toast.entryAdded'))
        setNewFields([{ key: '', value: '' }])
        setShowAddForm(false)
        refresh()
      } else {
        useToastStore.getState().error(t('toast.addFailed'), result.error?.message)
      }
    } catch {
      useToastStore.getState().error(t('toast.addFailed'))
    } finally {
      setIsAdding(false)
    }
  }, [connectionId, keyName, newFields, refresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {t('stream.entries')} <strong>{totalCount ?? entries.length}</strong>
        </span>
        {consumerGroups.length > 0 && (
          <span className="badge badge-stream">
            {t('stream.consumerGroups', { count: consumerGroups.length, s: consumerGroups.length !== 1 ? 's' : '' })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={13} /> : <Plus size={13} />}
          {showAddForm ? t('stream.cancel') : t('stream.xadd')}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            {t('stream.autoId')}
          </div>
          {newFields.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <input
                  className="input"
                  placeholder={t('stream.fieldName')}
                  value={f.key}
                  onChange={(e) => handleFieldChange(i, 'key', e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  className="input"
                  placeholder={t('stream.value')}
                  value={f.value}
                  onChange={(e) => handleFieldChange(i, 'value', e.target.value)}
                />
              </div>
              {newFields.length > 1 && (
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleRemoveField(i)}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleAddField}>
              <Plus size={13} />
              {t('stream.addField')}
            </button>
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={isAdding}>
              <Save size={13} />
              {t('stream.addEntry')}
            </button>
          </div>
        </div>
      )}

      {/* Entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry) => (
          <div key={entry.id} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Hash size={12} style={{ color: 'var(--text-tertiary)' }} />
              <span className="mono" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                {entry.id}
              </span>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>{t('stream.field')}</th>
                    <th>{t('stream.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(entry.fields).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{formatDisplayValue(k)}</td>
                      <td className="mono">{formatDisplayValue(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {entries.length === 0 && !isLoading && (
          <div className="empty-state" style={{ height: 'auto', padding: '40px 0' }}>
            <div className="empty-state-title">{t('stream.noEntries')}</div>
            <div className="empty-state-description">{t('stream.noEntriesDesc')}</div>
          </div>
        )}
      </div>

      {hasMore && (
        <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)} disabled={isLoading} style={{ alignSelf: 'center' }}>
          <ChevronDown size={13} />
          {isLoading ? t('stream.loading') : t('stream.loadMore')}
        </button>
      )}
    </div>
  )
}

export default React.memo(StreamViewer)
