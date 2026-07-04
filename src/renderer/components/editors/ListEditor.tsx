import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, ArrowDownToLine, ArrowUpToLine } from 'lucide-react'
import { useToastStore } from '../Toast'
import type { DataPage } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface ListEditorProps {
  connectionId: string
  keyName: string
}

const ListEditor: React.FC<ListEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [items, setItems] = useState<string[]>([])
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newItemValue, setNewItemValue] = useState('')
  const [pushSide, setPushSide] = useState<'left' | 'right'>('right')
  const [isAdding, setIsAdding] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const pageSize = 100

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const currentOffset = append ? offset : 0
        const options: Record<string, unknown> = { type: 'list', offset: currentOffset, count: pageSize }
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<string>
        }
        if (result.success && result.data) {
          const page = result.data
          if (append) {
            setItems((prev) => [...prev, ...page.items])
          } else {
            setItems(page.items)
          }
          setOffset(currentOffset + page.items.length)
          setHasMore(page.hasMore)
          setTotalCount(page.totalCount)
        }
      } catch {
        useToastStore.getState().error(t('toast.loadFailed'), 'Could not load list elements')
      } finally {
        setIsLoading(false)
      }
    },
    [connectionId, keyName, offset]
  )

  useEffect(() => {
    loadData(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, keyName])

  const refresh = useCallback(() => {
    setOffset(0)
    loadData(false)
  }, [loadData])

  const handleAdd = useCallback(async () => {
    if (!newItemValue.trim() && newItemValue === '') return
    setIsAdding(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        position: pushSide,
        value: newItemValue,
      })) as { success: boolean; error?: { message: string } }
      if (result.success) {
        useToastStore.getState().success(t('toast.elementAdded'))
        setNewItemValue('')
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
  }, [connectionId, keyName, newItemValue, pushSide, refresh])

  const handleDelete = useCallback(
    async (index: number) => {
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, String(index))) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.elementDeleted'))
          setDeleteConfirm(null)
          refresh()
        } else {
          useToastStore.getState().error(t('toast.deleteFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.deleteFailed'))
      }
    },
    [connectionId, keyName, refresh]
  )

  const handleEditSave = useCallback(
    async (index: number) => {
      try {
        const result = (await window.redixAPI.data.addField(connectionId, keyName, {
          index,
          value: editValue,
        })) as { success: boolean; error?: { message: string } }
        if (result.success) {
          useToastStore.getState().success(t('toast.elementUpdated'))
          setEditingIndex(null)
          refresh()
        } else {
          useToastStore.getState().error(t('toast.updateFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.updateFailed'))
      }
    },
    [connectionId, keyName, editValue, refresh]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {t('list.elements')} <strong>{totalCount ?? items.length}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={13} /> : <Plus size={13} />}
          {showAddForm ? t('list.cancel') : t('list.addElement')}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn btn-sm ${pushSide === 'left' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPushSide('left')}
              title="LPUSH"
            >
              <ArrowUpToLine size={13} />
              {t('list.head')}
            </button>
            <button
              className={`btn btn-sm ${pushSide === 'right' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPushSide('right')}
              title="RPUSH"
            >
              <ArrowDownToLine size={13} />
              {t('list.tail')}
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <input
              className="input"
              value={newItemValue}
              onChange={(e) => setNewItemValue(e.target.value)}
              placeholder={t('list.elementValue')}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={isAdding}>
            <Save size={13} />
            {t('list.add')}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 64 }}>#</th>
              <th>{t('list.value')}</th>
              <th style={{ width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                  {i}
                </td>
                <td
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setEditingIndex(i)
                    setEditValue(item)
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
                          if (e.key === 'Enter') handleEditSave(i)
                          if (e.key === 'Escape') setEditingIndex(null)
                        }}
                        autoFocus
                      />
                      <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleEditSave(i)}>
                        <Save size={11} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditingIndex(null)}>
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <span className="mono">{formatDisplayValue(item)}</span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {deleteConfirm === i ? (
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleDelete(i)}>
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
            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>
                  {t('list.noElements')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)} disabled={isLoading} style={{ alignSelf: 'center' }}>
          <ChevronDown size={13} />
          {isLoading ? t('list.loading') : t('list.loadMore')}
        </button>
      )}
    </div>
  )
}

export default React.memo(ListEditor)
