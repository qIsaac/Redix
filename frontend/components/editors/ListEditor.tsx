import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, ArrowDownToLine, ArrowUpToLine, Pencil } from 'lucide-react'
import { useToastStore } from '../Toast'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog'
import type { DataPage, ListElement } from '../../shared/types'
import { formatBinarySummary, formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface ListEditorProps {
  connectionId: string
  keyName: string
}

function formatElementValue(item: ListElement): string {
  if (item.valueIsBinary) {
    return formatBinarySummary(item.valueLength, item.valuePreviewLength)
  }
  return formatDisplayValue(item.value)
}

function BinaryListValue({ item }: { item: ListElement }): React.ReactElement {
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: '8px 10px',
        maxHeight: 220,
        overflow: 'auto',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        fontSize: 'var(--font-size-xs)',
        lineHeight: 1.5,
        whiteSpace: 'pre',
      }}
    >
      {item.valueHexDump || '(empty)'}
    </pre>
  )
}

const ListEditor: React.FC<ListEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [items, setItems] = useState<ListElement[]>([])
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
  const [deleteTarget, setDeleteTarget] = useState<ListElement | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const editingRef = useRef<HTMLDivElement | null>(null)

  const pageSize = 100

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const currentOffset = append ? offset : 0
        const options: Record<string, unknown> = { type: 'list', offset: currentOffset, count: pageSize }
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<ListElement>
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

  useEffect(() => {
    if (editingIndex == null) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editingRef.current?.contains(target)) return
      setEditingIndex(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editingIndex])

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
      if (isDeleting) return
      setIsDeleting(true)
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, String(index))) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.elementDeleted'))
          setDeleteTarget(null)
          refresh()
        } else {
          useToastStore.getState().error(t('toast.deleteFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.deleteFailed'))
      } finally {
        setIsDeleting(false)
      }
    },
    [connectionId, keyName, isDeleting, refresh]
  )

  const handleEditSave = useCallback(
    async (index: number) => {
      if (isSavingEdit) return
      setIsSavingEdit(true)
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
      } finally {
        setIsSavingEdit(false)
      }
    },
    [connectionId, keyName, editValue, isSavingEdit, refresh]
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
            {items.map((item) => {
              const deleteControls = (
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }} onClick={() => setDeleteTarget(item)}>
                  <Trash2 size={13} />
                </button>
              )

              if (item.valueIsBinary) {
                return (
                  <tr key={item.index}>
                    <td
                      colSpan={3}
                      style={{
                        padding: 12,
                        whiteSpace: 'normal',
                        overflow: 'visible',
                        textOverflow: 'clip',
                        maxWidth: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <span className="mono" style={{ flexShrink: 0, color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
                            #{item.index}
                          </span>
                          <span className="mono" style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
                            {formatElementValue(item)}
                          </span>
                          <span style={{ flexShrink: 0 }}>{deleteControls}</span>
                        </div>
                        <BinaryListValue item={item} />
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={item.index}>
                  <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                    {item.index}
                  </td>
                  <td
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => {
                      setEditingIndex(item.index)
                      setEditValue(item.value)
                    }}
                  >
                    {editingIndex === item.index ? (
                      <div
                        ref={editingRef}
                        style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          className="input"
                          style={{ padding: '2px 6px', fontSize: 'var(--font-size-sm)', flex: 1 }}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleEditSave(item.index)
                            if (e.key === 'Escape') setEditingIndex(null)
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ padding: '2px 6px' }}
                          disabled={isSavingEdit}
                          onClick={(event) => {
                            event.stopPropagation()
                            handleEditSave(item.index)
                          }}
                        >
                          <Save size={11} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px' }}
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditingIndex(null)
                          }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="mono" style={{ flex: 1 }}>{formatElementValue(item)}</span>
                        <button
                          className="icon-button"
                          style={{ padding: '2px', opacity: 0.6 }}
                          title={t('list.edit')}
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditingIndex(item.index)
                            setEditValue(item.value)
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{deleteControls}</td>
                </tr>
              )
            })}
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
      <ConfirmDeleteDialog
        open={deleteTarget != null}
        target={deleteTarget ? `#${deleteTarget.index}` : ''}
        confirming={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.index)}
      />
    </div>
  )
}

export default React.memo(ListEditor)
