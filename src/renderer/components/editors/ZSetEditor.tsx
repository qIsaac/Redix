import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, ArrowUp, ArrowDown, Edit3 } from 'lucide-react'
import { useToastStore } from '../Toast'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog'
import type { DataPage, ZSetMember } from '../../../shared/types'
import { formatBinarySummary, formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface ZSetEditorProps {
  connectionId: string
  keyName: string
}

function formatMemberValue(member: ZSetMember): string {
  if (member.memberIsBinary) {
    return formatBinarySummary(member.memberLength, member.memberPreviewLength)
  }
  return formatDisplayValue(member.member)
}

function BinaryZSetMember({ member }: { member: ZSetMember }): React.ReactElement {
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
      {member.memberHexDump || '(empty)'}
    </pre>
  )
}

const ZSetEditor: React.FC<ZSetEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [members, setMembers] = useState<ZSetMember[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [sortAsc, setSortAsc] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newScore, setNewScore] = useState('')
  const [newMember, setNewMember] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editScore, setEditScore] = useState('')
  const [editMemberValue, setEditMemberValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ZSetMember | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const editingRef = useRef<HTMLDivElement | null>(null)

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const options: Record<string, unknown> = { type: 'zset', order: sortAsc ? 'asc' : 'desc' }
        if (append && cursor) options.cursor = cursor
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<ZSetMember>
        }
        if (result.success && result.data) {
          const page = result.data
          if (append) {
            setMembers((prev) => [...prev, ...page.items])
          } else {
            setMembers(page.items)
          }
          setCursor(page.cursor)
          setHasMore(page.hasMore)
          setTotalCount(page.totalCount)
        }
      } catch {
        useToastStore.getState().error(t('toast.loadFailed'), 'Could not load sorted set members')
      } finally {
        setIsLoading(false)
      }
    },
    [connectionId, keyName, sortAsc]
  )

  useEffect(() => {
    setCursor(undefined)
    loadData(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, keyName, sortAsc])

  useEffect(() => {
    if (editingIndex == null) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-zset-editing="true"]')) return
      if (target instanceof Node && editingRef.current?.contains(target)) return
      setEditingIndex(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editingIndex])

  const refresh = useCallback(() => {
    setCursor(undefined)
    loadData(false)
  }, [loadData])

  const handleAdd = useCallback(async () => {
    if (!newMember.trim() || newScore === '') return
    const score = parseFloat(newScore)
    if (isNaN(score)) {
      useToastStore.getState().warning(t('toast.invalidScore'), t('toast.scoreMustBeNumber'))
      return
    }
    setIsAdding(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        member: newMember.trim(),
        score,
      })) as { success: boolean; error?: { message: string } }
      if (result.success) {
        useToastStore.getState().success(t('toast.memberAdded'))
        setNewMember('')
        setNewScore('')
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
  }, [connectionId, keyName, newMember, newScore, refresh])

  const startEditMember = useCallback((member: ZSetMember, index: number) => {
    setEditingIndex(index)
    setEditScore(String(member.score))
    setEditMemberValue(member.member)
  }, [])

  const handleEditSave = useCallback(
    async (member: string) => {
      if (isSavingEdit) return
      const score = parseFloat(editScore)
      if (isNaN(score)) {
        useToastStore.getState().warning(t('toast.invalidScore'), t('toast.scoreMustBeNumber'))
        return
      }
      if (!editMemberValue.trim()) {
        useToastStore.getState().warning(t('toast.updateFailed'), t('zset.memberValue'))
        return
      }
      setIsSavingEdit(true)
      try {
        const result = (await window.redixAPI.data.addField(connectionId, keyName, {
          oldMember: member,
          member: editMemberValue.trim(),
          score,
        })) as { success: boolean; error?: { message: string } }
        if (result.success) {
          useToastStore.getState().success(t('toast.memberUpdated'))
          setEditingIndex(null)
          setEditMemberValue('')
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
    [connectionId, keyName, editMemberValue, editScore, isSavingEdit, refresh]
  )

  const handleDelete = useCallback(
    async (member: string) => {
      if (isDeleting) return
      setIsDeleting(true)
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, member)) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.memberDeleted'))
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {t('zset.members')} <strong>{totalCount ?? members.length}</strong>
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setSortAsc(!sortAsc)}
          title={sortAsc ? t('zset.ascending') : t('zset.descending')}
        >
          {sortAsc ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          {sortAsc ? 'ASC' : 'DESC'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={13} /> : <Plus size={13} />}
          {showAddForm ? t('zset.cancel') : t('zset.addMember')}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12 }}>
          <div style={{ width: 120 }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {t('zset.score')}
            </label>
            <input
              className="input"
              type="number"
              step="any"
              value={newScore}
              onChange={(e) => setNewScore(e.target.value)}
              placeholder="0"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {t('zset.member')}
            </label>
            <input
              className="input"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder={t('zset.memberValue')}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={isAdding || !newMember.trim() || newScore === ''}>
            <Save size={13} />
            {t('zset.add')}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th style={{ width: 120 }}>{t('zset.score')}</th>
              <th>{t('zset.member')}</th>
              <th style={{ width: 96 }}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => {
              const isEditing = editingIndex === i
              const editControls = m.memberIsBinary ? null : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  title={t('editor.edit')}
                  onClick={() => startEditMember(m, i)}
                >
                  <Edit3 size={13} />
                </button>
              )
              const deleteControls = m.memberIsBinary ? (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  disabled
                  title="Binary members cannot be deleted from this view yet"
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }} onClick={() => setDeleteTarget(m)}>
                  <Trash2 size={13} />
                </button>
              )
              const editActions = (
                <span data-zset-editing="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ padding: '2px 6px' }}
                    disabled={isSavingEdit || !editMemberValue.trim()}
                    onClick={() => handleEditSave(m.member)}
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

              if (m.memberIsBinary) {
                return (
                  <tr key={m.member + i}>
                    <td
                      colSpan={4}
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
                            #{i + 1}
                          </span>
                          <span className="mono" style={{ flexShrink: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                            score {m.score}
                          </span>
                          <span className="mono" style={{ flex: 1, minWidth: 0, color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>
                            {formatMemberValue(m)}
                          </span>
                          <span style={{ flexShrink: 0 }}>{rowActions}</span>
                        </div>
                        <BinaryZSetMember member={m} />
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={m.member + i}>
                  <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                    {i + 1}
                  </td>
                  <td
                    style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                    onClick={() => startEditMember(m, i)}
                  >
                    {isEditing ? (
                      <div
                        ref={editingRef}
                        data-zset-editing="true"
                        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          className="input"
                          type="number"
                          step="any"
                          style={{ width: 80, padding: '2px 6px', fontSize: 'var(--font-size-sm)' }}
                          value={editScore}
                          onChange={(e) => setEditScore(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleEditSave(m.member)
                            if (e.key === 'Escape') setEditingIndex(null)
                          }}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <span>{m.score}</span>
                    )}
                  </td>
                  <td className="mono">
                    {isEditing ? (
                      <div
                        data-zset-editing="true"
                        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          className="input"
                          style={{ padding: '2px 6px', fontSize: 'var(--font-size-sm)' }}
                          value={editMemberValue}
                          onChange={(event) => setEditMemberValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleEditSave(m.member)
                            if (event.key === 'Escape') setEditingIndex(null)
                          }}
                        />
                      </div>
                    ) : (
                      formatMemberValue(m)
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{rowActions}</td>
                </tr>
              )
            })}
            {members.length === 0 && !isLoading && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>
                  {t('zset.noMembers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)} disabled={isLoading} style={{ alignSelf: 'center' }}>
          <ChevronDown size={13} />
          {isLoading ? t('zset.loading') : t('zset.loadMore')}
        </button>
      )}
      <ConfirmDeleteDialog
        open={deleteTarget != null}
        target={deleteTarget ? formatMemberValue(deleteTarget) : ''}
        confirming={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget.member)}
      />
    </div>
  )
}

export default React.memo(ZSetEditor)
