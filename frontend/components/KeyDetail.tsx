import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Edit3, Clock, Key, Copy, Save, RefreshCw } from 'lucide-react'
import { useBrowserStore } from '../store/browserStore'
import { useConnectionStore } from '../store/connectionStore'
import { StringEditor, HashEditor, ListEditor, SetEditor, ZSetEditor, StreamViewer } from './editors'
import { useI18n } from '../i18n'

const KeyDetail: React.FC = () => {
  const t = useI18n((s) => s.t)
  const selectedKey = useBrowserStore((s) => s.selectedKey)
  const deleteKey = useBrowserStore((s) => s.deleteKey)
  const renameKey = useBrowserStore((s) => s.renameKey)
  const setKeyTTL = useBrowserStore((s) => s.setKeyTTL)
  const refreshSelectedKey = useBrowserStore((s) => s.refreshSelectedKey)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const [refreshToken, setRefreshToken] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [editingTTL, setEditingTTL] = useState(false)
  const [ttlValue, setTTLValue] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const ttlEditorRef = useRef<HTMLSpanElement>(null)
  const targetMatches =
    !!activeConnectionId &&
    !!selectedKey &&
    (!selectedKey.connectionId || selectedKey.connectionId === activeConnectionId)

  const handleTTLSave = useCallback(() => {
    if (!activeConnectionId || !selectedKey || !targetMatches) return
    const parsed = parseInt(ttlValue, 10)
    if (!isNaN(parsed)) {
      setKeyTTL(activeConnectionId, selectedKey.key, parsed)
    }
    setEditingTTL(false)
  }, [activeConnectionId, selectedKey, targetMatches, ttlValue, setKeyTTL])

  const handleDelete = useCallback(() => {
    if (!activeConnectionId || !selectedKey || !targetMatches) return
    deleteKey(activeConnectionId, selectedKey.key)
    setShowDeleteConfirm(false)
  }, [activeConnectionId, selectedKey, targetMatches, deleteKey])

  const handleRename = useCallback(() => {
    if (!activeConnectionId || !selectedKey || !targetMatches || !newKeyName.trim()) return
    renameKey(activeConnectionId, selectedKey.key, newKeyName.trim())
    setShowRenameDialog(false)
    setNewKeyName('')
  }, [activeConnectionId, selectedKey, targetMatches, newKeyName, renameKey])

  const handleCopyKey = useCallback(() => {
    if (selectedKey) {
      navigator.clipboard.writeText(selectedKey.key).catch(() => {
        /* ignore */
      })
    }
  }, [selectedKey])

  const handleRefresh = useCallback(async () => {
    if (!activeConnectionId || !selectedKey || !targetMatches || isRefreshing) return
    setIsRefreshing(true)
    try {
      // Refresh header info (type/ttl/memory) from the store, and remount the
      // editor via a changing key so it re-fetches the latest value.
      await refreshSelectedKey(activeConnectionId)
      setRefreshToken((token) => token + 1)
    } finally {
      setIsRefreshing(false)
    }
  }, [activeConnectionId, selectedKey, targetMatches, isRefreshing, refreshSelectedKey])

  useEffect(() => {
    if (!editingTTL) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && ttlEditorRef.current?.contains(target)) {
        return
      }
      setEditingTTL(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [editingTTL])

  useEffect(() => {
    setEditingTTL(false)
  }, [selectedKey?.key])



  // Empty state
  if (!selectedKey) {
    return (
      <div className="empty-state">
        <Key className="empty-state-icon" />
        <div className="empty-state-title">{t('detail.noKeySelected')}</div>
        <div className="empty-state-description">
          {t('detail.noKeySelectedDesc')}
        </div>
      </div>
    )
  }

  const typeClass = `badge badge-${selectedKey.type}`
  const ttlDisplay = selectedKey.ttl === -1 ? t('detail.noExpiry') : `${selectedKey.ttl}s`
  const memoryDisplay =
    selectedKey.memory != null ? formatBytes(selectedKey.memory) : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Key Info Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t('detail.key')}
          </span>
          <span
            className="mono"
            title={selectedKey.key}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedKey.key}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={handleRefresh}
              disabled={!targetMatches || isRefreshing}
              title={t('detail.refresh')}
            >
              <RefreshCw size={13} className={isRefreshing ? 'spinning' : ''} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={handleCopyKey} title={t('detail.copyKeyName')}>
              <Copy size={13} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t('detail.type')}</span>
            <span className={typeClass}>{selectedKey.type}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t('detail.ttl')}</span>
            {editingTTL ? (
              <span ref={ttlEditorRef} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  className="input"
                  style={{ width: 72, padding: '2px 6px', fontSize: 'var(--font-size-xs)' }}
                  type="number"
                  value={ttlValue}
                  onChange={(e) => setTTLValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTTLSave()
                    if (e.key === 'Escape') setEditingTTL(false)
                  }}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px' }} onClick={handleTTLSave}>
                  <Save size={11} />
                </button>
              </span>
            ) : (
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                }}
                onClick={() => {
                  setTTLValue(String(selectedKey.ttl))
                  setEditingTTL(true)
                }}
                title={t('detail.clickToEditTTL')}
              >
                {ttlDisplay}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t('detail.memory')}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)' }}>{memoryDisplay}</span>
          </div>
        </div>
      </div>

      {/* Editor Area */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {activeConnectionId && selectedKey && targetMatches && renderEditor(activeConnectionId, selectedKey.type, selectedKey.key, refreshToken)}
        {!targetMatches && (
          <div className="empty-state" style={{ height: 'auto', padding: '40px 0' }}>
            <div className="empty-state-title">{t('detail.noKeySelected')}</div>
            <div className="empty-state-description">{t('detail.noKeySelectedDesc')}</div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderTop: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-secondary btn-sm"
          disabled={!targetMatches}
          onClick={() => {
            setNewKeyName(selectedKey.key)
            setShowRenameDialog(true)
          }}
        >
          <Edit3 size={13} />
          {t('detail.rename')}
        </button>
        <button className="btn btn-danger btn-sm" disabled={!targetMatches} onClick={() => setShowDeleteConfirm(true)}>
          <Trash2 size={13} />
          {t('detail.delete')}
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="dialog-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{t('detail.deleteKey')}</div>
            <div className="dialog-description">
              {t('detail.deleteKeyConfirm', { key: selectedKey.key })}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteConfirm(false)}>
                {t('editor.cancel')}
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                {t('detail.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <div className="dialog-overlay" onClick={() => setShowRenameDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">{t('detail.renameKey')}</div>
            <div className="dialog-description">{t('detail.renameKeyDesc')}</div>
            <input
              className="input"
              style={{ marginBottom: 16 }}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setShowRenameDialog(false)
              }}
              autoFocus
            />
            <div className="dialog-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowRenameDialog(false)}>
                {t('editor.cancel')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleRename} disabled={!newKeyName.trim()}>
                {t('detail.rename')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderEditor(
  connectionId: string,
  type: string,
  keyName: string,
  refreshToken: number
): React.ReactElement {
  const props = { connectionId, keyName }
  // A changing refreshToken forces the editor to remount, re-running its
  // initial data fetch so the displayed value reflects the latest state.
  const editorKey = `${connectionId}:${keyName}:${refreshToken}`
  switch (type) {
    case 'string':
      return <StringEditor key={editorKey} {...props} />
    case 'hash':
      return <HashEditor key={editorKey} {...props} />
    case 'list':
      return <ListEditor key={editorKey} {...props} />
    case 'set':
      return <SetEditor key={editorKey} {...props} />
    case 'zset':
      return <ZSetEditor key={editorKey} {...props} />
    case 'stream':
      return <StreamViewer key={editorKey} {...props} />
    default:
      return (
        <div className="empty-state" style={{ height: 'auto', padding: '40px 0' }}>
          <div className="empty-state-title">{useI18n.getState().t('detail.unknownType')}</div>
          <div className="empty-state-description">{useI18n.getState().t('detail.unknownTypeDesc', { type })}</div>
        </div>
      )
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default KeyDetail
