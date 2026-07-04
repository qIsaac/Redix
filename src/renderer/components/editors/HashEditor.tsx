import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown } from 'lucide-react'
import { useToastStore } from '../Toast'
import type { DataPage, HashField } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface HashEditorProps {
  connectionId: string
  keyName: string
}

const HashEditor: React.FC<HashEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [fields, setFields] = useState<HashField[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newField, setNewField] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const options: Record<string, unknown> = { type: 'hash' }
        if (append && cursor) options.cursor = cursor
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<HashField>
        }
        if (result.success && result.data) {
          const page = result.data
          setFields((prev) => (append ? [...prev, ...page.items] : page.items))
          setCursor(page.cursor)
          setHasMore(page.hasMore)
          setTotalCount(page.totalCount)
        }
      } catch {
        useToastStore.getState().error(t('toast.loadFailed'), 'Could not load hash fields')
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

  const handleAddField = useCallback(async () => {
    if (!newField.trim()) return
    setIsAdding(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        field: newField.trim(),
        value: newValue,
      })) as { success: boolean; error?: { message: string } }
      if (result.success) {
        useToastStore.getState().success(t('toast.fieldAdded'))
        setNewField('')
        setNewValue('')
        setShowAddForm(false)
        loadData(false)
      } else {
        useToastStore.getState().error(t('toast.addFailed'), result.error?.message)
      }
    } catch {
      useToastStore.getState().error(t('toast.addFailed'))
    } finally {
      setIsAdding(false)
    }
  }, [connectionId, keyName, newField, newValue, loadData])

  const handleDeleteField = useCallback(
    async (field: string) => {
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, field)) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.fieldDeleted'))
          setDeleteConfirm(null)
          loadData(false)
        } else {
          useToastStore.getState().error(t('toast.deleteFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.deleteFailed'))
      }
    },
    [connectionId, keyName, loadData]
  )

  const handleEditSave = useCallback(
    async (field: string) => {
      try {
        const result = (await window.redixAPI.data.addField(connectionId, keyName, {
          field,
          value: editValue,
        })) as { success: boolean; error?: { message: string } }
        if (result.success) {
          useToastStore.getState().success(t('toast.fieldUpdated'))
          setEditingIndex(null)
          loadData(false)
        } else {
          useToastStore.getState().error(t('toast.updateFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.updateFailed'))
      }
    },
    [connectionId, keyName, editValue, loadData]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {t('hash.fields')}{' '}
          <strong>{totalCount != null ? totalCount : fields.length}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={13} /> : <Plus size={13} />}
          {showAddForm ? t('hash.cancel') : t('hash.addField')}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {t('hash.field')}
            </label>
            <input
              className="input"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              placeholder={t('hash.fieldName')}
              onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {t('hash.value')}
            </label>
            <input
              className="input"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={t('hash.value')}
              onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAddField} disabled={isAdding || !newField.trim()}>
            <Save size={13} />
            {t('hash.add')}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40%' }}>{t('hash.field')}</th>
              <th>{t('hash.value')}</th>
              <th style={{ width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f.field + i}>
                <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {formatDisplayValue(f.field)}
                </td>
                <td
                  style={{ cursor: 'pointer', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => {
                    setEditingIndex(i)
                    setEditValue(f.value)
                  }}
                >
                  {editingIndex === i ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        className="input"
                        style={{ padding: '2px 6px', fontSize: 'var(--font-size-sm)' }}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleEditSave(f.field)
                          if (e.key === 'Escape') setEditingIndex(null)
                        }}
                        autoFocus
                      />
                      <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleEditSave(f.field)}>
                        <Save size={11} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditingIndex(null)}>
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <span className="mono">{formatDisplayValue(f.value)}</span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {deleteConfirm === i ? (
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleDeleteField(f.field)}>
                        <Trash2 size={11} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setDeleteConfirm(null)}>
                        <X size={11} />
                      </button>
                    </span>
                  ) : (
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }} onClick={() => setDeleteConfirm(i)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {fields.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>
                  {t('hash.noFields')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)} disabled={isLoading} style={{ alignSelf: 'center' }}>
          <ChevronDown size={13} />
          {isLoading ? t('hash.loading') : t('hash.loadMore')}
        </button>
      )}


    </div>
  )
}

export default React.memo(HashEditor)
