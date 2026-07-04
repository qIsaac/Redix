import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useToastStore } from '../Toast'
import type { DataPage, ZSetMember } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface ZSetEditorProps {
  connectionId: string
  keyName: string
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
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

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
    [connectionId, keyName, cursor, sortAsc]
  )

  useEffect(() => {
    setCursor(undefined)
    loadData(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, keyName, sortAsc])

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

  const handleEditScore = useCallback(
    async (member: string) => {
      const score = parseFloat(editScore)
      if (isNaN(score)) {
        useToastStore.getState().warning('Invalid score', 'Score must be a number')
        return
      }
      try {
        const result = (await window.redixAPI.data.addField(connectionId, keyName, {
          member,
          score,
          xx: true,
        })) as { success: boolean; error?: { message: string } }
        if (result.success) {
          useToastStore.getState().success(t('toast.scoreUpdated'))
          setEditingIndex(null)
          refresh()
        } else {
          useToastStore.getState().error(t('toast.updateFailed'), result.error?.message)
        }
      } catch {
        useToastStore.getState().error(t('toast.updateFailed'))
      }
    },
    [connectionId, keyName, editScore, refresh]
  )

  const handleDelete = useCallback(
    async (member: string) => {
      try {
        const result = (await window.redixAPI.data.deleteField(connectionId, keyName, member)) as {
          success: boolean
          error?: { message: string }
        }
        if (result.success) {
          useToastStore.getState().success(t('toast.memberDeleted'))
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
              <th style={{ width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <tr key={m.member + i}>
                <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                  {i + 1}
                </td>
                <td
                  style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)' }}
                  onClick={() => {
                    setEditingIndex(i)
                    setEditScore(String(m.score))
                  }}
                >
                  {editingIndex === i ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        className="input"
                        type="number"
                        step="any"
                        style={{ width: 80, padding: '2px 6px', fontSize: 'var(--font-size-sm)' }}
                        value={editScore}
                        onChange={(e) => setEditScore(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleEditScore(m.member)
                          if (e.key === 'Escape') setEditingIndex(null)
                        }}
                        autoFocus
                      />
                      <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleEditScore(m.member)}>
                        <Save size={11} />
                      </button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditingIndex(null)}>
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <span>{m.score}</span>
                  )}
                </td>
                <td className="mono">{formatDisplayValue(m.member)}</td>
                <td style={{ textAlign: 'center' }}>
                  {deleteConfirm === i ? (
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleDelete(m.member)}>
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
    </div>
  )
}

export default React.memo(ZSetEditor)
