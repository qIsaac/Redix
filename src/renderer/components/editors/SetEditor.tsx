import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, X, ChevronDown, Search } from 'lucide-react'
import { useToastStore } from '../Toast'
import type { DataPage } from '../../../shared/types'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface SetEditorProps {
  connectionId: string
  keyName: string
}

const SetEditor: React.FC<SetEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [members, setMembers] = useState<string[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMember, setNewMember] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const loadData = useCallback(
    async (append: boolean) => {
      setIsLoading(true)
      try {
        const options: Record<string, unknown> = { type: 'set' }
        if (append && cursor) options.cursor = cursor
        const result = (await window.redixAPI.data.view(connectionId, keyName, options)) as {
          success: boolean
          data?: DataPage<string>
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

  const refresh = useCallback(() => {
    setCursor(undefined)
    loadData(false)
  }, [loadData])

  const filteredMembers = useMemo(() => {
    if (!searchTerm.trim()) return members
    const term = searchTerm.toLowerCase()
    return members.filter((m) => m.toLowerCase().includes(term))
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
              <th style={{ width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((member, i) => (
              <tr key={member + i}>
                <td style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                  {i + 1}
                </td>
                <td className="mono">{formatDisplayValue(member)}</td>
                <td style={{ textAlign: 'center' }}>
                  {deleteConfirm === i ? (
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => handleDelete(member)}>
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

    </div>
  )
}

export default React.memo(SetEditor)
