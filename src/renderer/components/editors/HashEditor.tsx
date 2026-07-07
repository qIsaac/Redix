import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, Edit3 } from 'lucide-react'
import { useToastStore } from '../Toast'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog'
import type { DataPage, HashField } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface HashEditorProps {
  connectionId: string
  keyName: string
}

function formatBinarySummary(length?: number, previewLength?: number): string {
  const total = length ?? 0
  const preview = previewLength ?? total
  return `binary-data(length=${total}, preview=${preview} bytes)`
}

function formatHashValue(field: HashField): string {
  if (field.valueIsBinary) {
    return formatBinarySummary(field.valueLength, field.valuePreviewLength)
  }
  return formatDisplayValue(field.value)
}

function formatHashField(field: HashField): string {
  if (field.fieldIsBinary) {
    return formatBinarySummary(field.fieldLength, field.fieldPreviewLength)
  }
  return formatDisplayValue(field.field)
}

function BinaryHexValue({ field }: { field: HashField }): React.ReactElement {
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
      {field.valueHexDump || '(empty)'}
    </pre>
  )
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
  const [editFieldName, setEditFieldName] = useState('')
  const [editValue, setEditValue] = useState('')
  const [editOldField, setEditOldField] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HashField | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const editingRef = useRef<HTMLDivElement | null>(null)

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

  const startEdit = useCallback((field: HashField, index: number) => {
    setEditingIndex(index)
    setEditFieldName(field.field)
    setEditValue(field.value)
    setEditOldField(field.field)
  }, [])

  useEffect(() => {
    if (editingIndex == null) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-hash-editing="true"]')) return
      if (target instanceof Node && editingRef.current?.contains(target)) return
      setEditingIndex(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editingIndex])

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
      if (isDeleting) return
      setIsDeleting(true)
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, field)) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.fieldDeleted'))
          setDeleteTarget(null)
          loadData(false)
        } else {
          useToastStore.getState().error(t('toast.deleteFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.deleteFailed'))
      } finally {
        setIsDeleting(false)
      }
    },
    [connectionId, keyName, isDeleting, loadData]
  )

  const handleEditSave = useCallback(async () => {
    if (isSavingEdit) return
    const nextField = editFieldName.trim()
    if (!nextField) {
      useToastStore.getState().warning(t('toast.updateFailed'), t('hash.fieldName'))
      return
    }
    setIsSavingEdit(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        field: nextField,
        oldField: editOldField,
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
    } finally {
      setIsSavingEdit(false)
    }
  }, [connectionId, keyName, editOldField, editFieldName, editValue, isSavingEdit, loadData])

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
              <th style={{ width: 84 }}></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const fieldLabel = formatHashField(f)
              const isEditing = editingIndex === i
              const editControls = f.valueIsBinary ? null : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  title={t('editor.edit')}
                  onClick={() => startEdit(f, i)}
                >
                  <Edit3 size={13} />
                </button>
              )
              const deleteControls = (
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }} onClick={() => setDeleteTarget(f)}>
                  <Trash2 size={13} />
                </button>
              )
              const editActions = (
                <span data-hash-editing="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ padding: '2px 6px' }}
                    disabled={isSavingEdit || !editFieldName.trim()}
                    onClick={() => void handleEditSave()}
                  >
                    <Save size={11} />
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditingIndex(null)}>
                    <X size={11} />
                  </button>
                </span>
              )
              const rowActions = isEditing ? editActions : (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {editControls}
                  {deleteControls}
                </span>
              )

              if (f.valueIsBinary) {
                return (
                  <tr key={f.field + i}>
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
                          <span
                            className="mono"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-primary)',
                              fontSize: 'var(--font-size-sm)',
                            }}
                          >
                            {fieldLabel}
                          </span>
                          <span
                            className="mono"
                            style={{
                              flexShrink: 0,
                              color: 'var(--text-tertiary)',
                              fontSize: 'var(--font-size-xs)',
                            }}
                          >
                            {formatBinarySummary(f.valueLength, f.valuePreviewLength)}
                          </span>
                          <span style={{ flexShrink: 0 }}>{deleteControls}</span>
                        </div>
                        <BinaryHexValue field={f} />
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={f.field + i}>
                  <td className="mono" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isEditing ? (
                      <div
                        ref={editingRef}
                        data-hash-editing="true"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          className="input"
                          style={{ width: '100%', padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                          value={editFieldName}
                          onChange={(event) => setEditFieldName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void handleEditSave()
                            if (event.key === 'Escape') setEditingIndex(null)
                          }}
                          autoFocus
                        />
                      </div>
                    ) : (
                      fieldLabel
                    )}
                  </td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {isEditing ? (
                      <div
                        data-hash-editing="true"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <textarea
                          className="input"
                          style={{
                            width: '100%',
                            minHeight: 64,
                            resize: 'vertical',
                            padding: '4px 8px',
                            fontSize: 'var(--font-size-sm)',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1.5,
                          }}
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void handleEditSave()
                            if (event.key === 'Escape') setEditingIndex(null)
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm mono"
                        style={{
                          justifyContent: 'flex-start',
                          maxWidth: '100%',
                          padding: '4px 8px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-secondary)',
                          borderRadius: 6,
                          color: 'var(--text-primary)',
                          fontWeight: 400,
                          textAlign: 'left',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={t('editor.edit')}
                        onClick={() => startEdit(f, i)}
                      >
                        {formatHashValue(f)}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{rowActions}</td>
                </tr>
              )
            })}
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

      <ConfirmDeleteDialog
        open={deleteTarget != null}
        target={deleteTarget ? formatHashField(deleteTarget) : ''}
        confirming={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDeleteField(deleteTarget.field)}
      />

    </div>
  )
}

export default React.memo(HashEditor)
