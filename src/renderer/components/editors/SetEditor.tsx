import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, Search, Edit3 } from 'lucide-react'
import { useToastStore } from '../Toast'
import ConfirmDeleteDialog from '../ConfirmDeleteDialog'
import type { DataPage, SetMember } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface SetEditorProps {
  connectionId: string
  keyName: string
}

function formatBinarySummary(length?: number, previewLength?: number): string {
  const total = length ?? 0
  const preview = previewLength ?? total
  return `binary-data(length=${total}, preview=${preview} bytes)`
}

function formatMemberValue(member: SetMember): string {
  if (member.memberIsBinary) {
    return formatBinarySummary(member.memberLength, member.memberPreviewLength)
  }
  return formatDisplayValue(member.member)
}

function BinaryMemberValue({ member }: { member: SetMember }): React.ReactElement {
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

const SetEditor: React.FC<SetEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [members, setMembers] = useState<SetMember[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMember, setNewMember] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [editMemberValue, setEditMemberValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SetMember | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const editingRef = useRef<HTMLDivElement | null>(null)

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const options: Record<string, unknown> = { type: 'set' }
        if (append && cursor) options.cursor = cursor
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<SetMember>
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
        useToastStore.getState().error(t('toast.loadFailed'), 'Could not load set members')
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

  useEffect(() => {
    if (editingMember == null) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && editingRef.current?.contains(target)) return
      setEditingMember(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editingMember])

  const refresh = useCallback(() => {
    setCursor(undefined)
    loadData(false)
  }, [loadData])

  const filteredMembers = useMemo(() => {
    if (!searchTerm.trim()) return members
    const term = searchTerm.toLowerCase()
    return members.filter((m) => m.member.toLowerCase().includes(term) || m.memberHexDump?.toLowerCase().includes(term))
  }, [members, searchTerm])

  const handleAdd = useCallback(async () => {
    if (!newMember.trim()) return
    setIsAdding(true)
    try {
      const result = (await window.redixAPI.data.addField(connectionId, keyName, {
        member: newMember.trim(),
      })) as { success: boolean; error?: { message: string } }
      if (result.success) {
        useToastStore.getState().success(t('toast.memberAdded'))
        setNewMember('')
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
  }, [connectionId, keyName, newMember, refresh])

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

  const handleEditSave = useCallback(
    async (oldMember: string) => {
      if (isSavingEdit || !editMemberValue.trim()) return
      setIsSavingEdit(true)
      try {
        const result = (await window.redixAPI.data.addField(connectionId, keyName, {
          oldMember,
          member: editMemberValue.trim(),
        })) as { success: boolean; error?: { message: string } }
        if (result.success) {
          useToastStore.getState().success(t('toast.memberUpdated'))
          setEditingMember(null)
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
    [connectionId, keyName, editMemberValue, isSavingEdit, refresh]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
          {t('set.members')} <strong>{totalCount ?? members.length}</strong>
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? <X size={13} /> : <Plus size={13} />}
          {showAddForm ? t('set.cancel') : t('set.addMember')}
        </button>
      </div>

      {/* Search */}
      <div className="search-input-wrapper">
        <Search className="search-input-icon" size={14} />
        <input
          className="search-input"
          placeholder={t('set.filterMembers')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              {t('set.member')}
            </label>
            <input
              className="input"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder={t('set.memberValue')}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={isAdding || !newMember.trim()}>
            <Save size={13} />
            {t('set.add')}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>{t('set.member')}</th>
              <th style={{ width: 84 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member, i) => {
              const editControls = member.memberIsBinary ? null : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  title={t('editor.edit')}
                  onClick={() => {
                    setEditingMember(member.member)
                    setEditMemberValue(member.member)
                  }}
                >
                  <Edit3 size={13} />
                </button>
              )
              const deleteControls = member.memberIsBinary ? (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  disabled
                  title="Binary members cannot be deleted from this view yet"
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 6px', color: 'var(--text-tertiary)' }}
                  onClick={() => setDeleteTarget(member)}
                >
                  <Trash2 size={13} />
                </button>
              )
              const rowActions = (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {editControls}
                  {deleteControls}
                </span>
              )

              if (member.memberIsBinary) {
                return (
                  <tr key={member.member + i}>
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
                              flexShrink: 0,
                              color: 'var(--text-tertiary)',
                              fontSize: 'var(--font-size-xs)',
                            }}
                          >
                            #{i + 1}
                          </span>
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
                            {formatMemberValue(member)}
                          </span>
                          <span style={{ flexShrink: 0 }}>{rowActions}</span>
                        </div>
                        <BinaryMemberValue member={member} />
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={member.member + i}>
                  <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                    {i + 1}
                  </td>
                  <td className="mono">
                    {editingMember === member.member ? (
                      <div
                        ref={editingRef}
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
                            if (event.key === 'Enter') handleEditSave(member.member)
                            if (event.key === 'Escape') setEditingMember(null)
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ padding: '2px 6px' }}
                          disabled={isSavingEdit || !editMemberValue.trim()}
                          onClick={() => handleEditSave(member.member)}
                        >
                          <Save size={11} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditingMember(null)}>
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      formatMemberValue(member)
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{rowActions}</td>
                </tr>
              )
            })}
            {filteredMembers.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>
                  {searchTerm ? t('set.noMatching') : t('set.noMembers')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button className="btn btn-secondary btn-sm" onClick={() => loadData(true)} disabled={isLoading} style={{ alignSelf: 'center' }}>
          <ChevronDown size={13} />
          {isLoading ? t('set.loading') : t('set.loadMore')}
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

export default React.memo(SetEditor)
