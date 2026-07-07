import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { List } from 'react-window'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, RefreshCw, Filter, Key, List as ListIcon, FolderTree, ChevronRight, ChevronDown, Folder, Plus, X, Save } from 'lucide-react'
import { useBrowserStore } from '../store/browserStore'
import { useConnectionStore } from '../store/connectionStore'
import { APP_CONFIG } from '../../shared/constants'
import type { IPCResponse, KeyInfo } from '../../shared/types'
import { useI18n } from '../i18n'
import { useToastStore } from './Toast'

const KEY_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream'] as const
type KeyType = typeof KEY_TYPES[number]

type ViewMode = 'list' | 'tree'

const QUICK_ADD_TYPES: KeyType[] = ['string', 'list', 'hash', 'set', 'zset', 'stream']

// ─── Tree data structures ────────────────────────────────────────

interface TreeNode {
  name: string
  fullPath: string
  isLeaf: boolean
  keyInfo?: KeyInfo
  children: Map<string, TreeNode>
  childCount: number
}

function buildTree(keys: KeyInfo[]): TreeNode {
  const root: TreeNode = {
    name: '',
    fullPath: '',
    isLeaf: false,
    children: new Map(),
    childCount: 0,
  }
  for (const key of keys) {
    const parts = key.key.split(':')
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: parts.slice(0, i + 1).join(':'),
          isLeaf: i === parts.length - 1,
          keyInfo: i === parts.length - 1 ? key : undefined,
          children: new Map(),
          childCount: 0,
        })
      }
      current.childCount++
      current = current.children.get(part)!
    }
  }
  return root
}

/** Collect fullPaths of all ancestors of keys matching `term` */
function collectMatchingAncestors(root: TreeNode, term: string): Set<string> {
  const expanded = new Set<string>()
  const lowerTerm = term.toLowerCase()

  function walk(node: TreeNode): boolean {
    let matched = false
    for (const child of node.children.values()) {
      if (child.isLeaf && child.fullPath.toLowerCase().includes(lowerTerm)) {
        matched = true
      }
      if (walk(child)) {
        expanded.add(node.fullPath)
        matched = true
      }
    }
    return matched
  }

  walk(root)
  return expanded
}

interface TreeRowData {
  node: TreeNode
  depth: number
}

function sortedTreeChildren(node: TreeNode): TreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

function flattenTree(root: TreeNode, expandedPaths: Set<string>): TreeRowData[] {
  const rows: TreeRowData[] = []

  function visit(node: TreeNode, depth: number): void {
    rows.push({ node, depth })
    if (!node.isLeaf && expandedPaths.has(node.fullPath)) {
      for (const child of sortedTreeChildren(node)) {
        visit(child, depth + 1)
      }
    }
  }

  for (const child of sortedTreeChildren(root)) {
    visit(child, 0)
  }

  return rows
}

function quickAddInitialValueFor(type: KeyType): unknown {
  switch (type) {
    case 'string':
      return ''
    case 'hash':
      return { field: '' }
    case 'list':
      return ['']
    case 'set':
      return ['']
    case 'zset':
      return [{ score: 0, member: '' }]
    case 'stream':
      return { field: '' }
  }
}

function isQuickAddValid(keyName: string): boolean {
  return !!keyName.trim()
}

function QuickAddKeyDialog({
  open,
  type,
  connectionId,
  currentDb,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  type: KeyType | null
  connectionId: string | null
  currentDb: number
  onOpenChange: (open: boolean) => void
  onCreated: (key: KeyInfo) => void
}): ReactElement | null {
  const t = useI18n((s) => s.t)
  const [keyName, setKeyName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKeyName('')
    setSaving(false)
  }, [open, type])

  if (!type) return null

  const valid = isQuickAddValid(keyName)

  const handleSubmit = async (): Promise<void> => {
    if (!connectionId || !valid || saving) return
    const trimmedKey = keyName.trim()
    setSaving(true)
    try {
      const infoBefore = await window.redixAPI.key.info(connectionId, trimmedKey) as IPCResponse<KeyInfo>
      if (infoBefore.success && infoBefore.data && infoBefore.data.type !== 'none') {
        useToastStore.getState().warning(t('quickAdd.exists'), trimmedKey)
        return
      }

      const value = quickAddInitialValueFor(type)
      const result = await window.redixAPI.key.add(connectionId, trimmedKey, type, value) as IPCResponse
      if (!result.success) {
        useToastStore.getState().error(t('quickAdd.createFailed'), result.error?.message)
        return
      }

      const infoAfter = await window.redixAPI.key.info(connectionId, trimmedKey) as IPCResponse<KeyInfo>
      const createdKey: KeyInfo = {
        key: trimmedKey,
        type,
        ttl: -1,
        memory: null,
        connectionId,
        db: currentDb,
        ...(infoAfter.success && infoAfter.data ? infoAfter.data : {}),
      }
      useToastStore.getState().success(t('quickAdd.created'))
      onCreated(createdKey)
      onOpenChange(false)
    } catch (error) {
      useToastStore.getState().error(
        t('quickAdd.createFailed'),
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setSaving(false)
    }
  }

  const title = t('quickAdd.title', { type: t(`quickAdd.type.${type}`) })

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Dialog.Title className="dialog-title" style={{ marginBottom: 0, flex: 1 }}>
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="btn btn-ghost btn-sm" aria-label={t('quickAdd.cancel')}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="dialog-description">{t('quickAdd.description')}</Dialog.Description>

          <div className="dialog-field">
            <label>{t('quickAdd.keyName')}</label>
            <input
              className="input"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && valid) void handleSubmit()
              }}
              autoFocus
            />
          </div>

          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="btn btn-secondary btn-sm">{t('quickAdd.cancel')}</button>
            </Dialog.Close>
            <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!valid || saving}>
              <Save size={13} />
              {saving ? t('quickAdd.creating') : t('quickAdd.create')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── Flat list row ────────────────────────────────────────────────

interface RowProps {
  keys: KeyInfo[]
  selectedKey: KeyInfo | null
  onSelect: (key: KeyInfo) => void
  onCopyKey: (key: string) => void
}

function KeyRow({
  ariaAttributes,
  index,
  style,
  keys,
  selectedKey,
  onSelect,
  onCopyKey,
}: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: CSSProperties
  keys: KeyInfo[]
  selectedKey: KeyInfo | null
  onSelect: (key: KeyInfo) => void
  onCopyKey: (key: string) => void
}): ReactElement | null {
  const item = keys[index]
  if (!item) return null

  const t = useI18n((s) => s.t)
  const isSelected = selectedKey?.key === item.key
  const typeClass = `badge badge-${item.type}`

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          {...ariaAttributes}
          style={{
            ...style,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            cursor: 'default',
            backgroundColor: isSelected ? 'var(--bg-selected)' : undefined,
            borderBottom: '1px solid var(--border-color)',
            boxSizing: 'border-box',
          }}
          onClick={() => onSelect(item)}
        >
          <span className={typeClass} style={{ marginRight: 8, flexShrink: 0 }}>
            {item.type.toUpperCase()}
          </span>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
            }}
          >
            {item.key}
          </span>
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
              minWidth: 48,
              textAlign: 'right',
            }}
          >
            {item.ttl === -1 ? '—' : `${item.ttl}s`}
          </span>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          <ContextMenu.Item
            className="context-menu-item"
            onSelect={() => onCopyKey(item.key)}
          >
            {t('browser.copyKey')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// ─── Tree row ─────────────────────────────────────────────────────

interface TreeRowProps {
  rows: TreeRowData[]
  selectedKey: KeyInfo | null
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (key: KeyInfo) => void
  onLoadChildren: (prefix: string) => void
}

function TreeRow({
  ariaAttributes,
  index,
  style,
  rows,
  selectedKey,
  expandedPaths,
  onToggle,
  onSelect,
  onLoadChildren,
}: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: CSSProperties
  rows: TreeRowData[]
  selectedKey: KeyInfo | null
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (key: KeyInfo) => void
  onLoadChildren: (prefix: string) => void
}): ReactElement | null {
  const row = rows[index]
  if (!row) return null

  const { node, depth } = row
  const t = useI18n((s) => s.t)
  const isExpanded = expandedPaths.has(node.fullPath)

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(node.fullPath).catch(() => { /* ignore */ })
  }, [node.fullPath])

  const handleLoadChildren = useCallback(() => {
    onLoadChildren(node.fullPath)
  }, [node.fullPath, onLoadChildren])

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          {...ariaAttributes}
          className={`tree-node${node.isLeaf && selectedKey?.key === node.fullPath ? ' selected' : ''}`}
          style={{ ...style, paddingLeft: depth * 16 + 8, boxSizing: 'border-box' }}
          onClick={() => {
            if (node.isLeaf && node.keyInfo) {
              onSelect(node.keyInfo)
            } else {
              onToggle(node.fullPath)
            }
          }}
        >
          {!node.isLeaf ? (
            <span className="tree-toggle">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          ) : (
            <span className="tree-toggle" />
          )}
          {node.isLeaf ? (
            <>
              {node.keyInfo && (
                <span className={`badge badge-${node.keyInfo.type}`} style={{ marginRight: 8, flexShrink: 0 }}>
                  {node.keyInfo.type.toUpperCase()}
                </span>
              )}
              <span className="tree-key-name">{node.name}</span>
            </>
          ) : (
            <>
              <Folder size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <span className="tree-folder-name">{node.name}</span>
              <span className="tree-count">{node.childCount}</span>
            </>
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          {!node.isLeaf && (
            <>
              <ContextMenu.Item
                className="context-menu-item"
                onSelect={handleLoadChildren}
              >
                {t('browser.loadChildren')}
              </ContextMenu.Item>
              <ContextMenu.Separator className="context-menu-separator" />
            </>
          )}
          <ContextMenu.Item
            className="context-menu-item"
            onSelect={handleCopyPath}
          >
            {t('browser.copyPath')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// ─── Main component ───────────────────────────────────────────────

const KeyBrowser: React.FC = () => {
  const t = useI18n((s) => s.t)
  const keys = useBrowserStore((s) => s.keys)
  const selectedKey = useBrowserStore((s) => s.selectedKey)
  const isLoading = useBrowserStore((s) => s.isLoading)
  const hasMore = useBrowserStore((s) => s.hasMore)
  const searchTerm = useBrowserStore((s) => s.searchTerm)
  const typeFilter = useBrowserStore((s) => s.typeFilter)
  const totalScanned = useBrowserStore((s) => s.totalScanned)

  const startScan = useBrowserStore((s) => s.startScan)
  const loadNextPage = useBrowserStore((s) => s.loadNextPage)
  const scanWithPrefix = useBrowserStore((s) => s.scanWithPrefix)
  const selectKey = useBrowserStore((s) => s.selectKey)
  const setSearchTerm = useBrowserStore((s) => s.setSearchTerm)
  const setTypeFilter = useBrowserStore((s) => s.setTypeFilter)

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const currentDb = useConnectionStore((s) => s.currentDb)
  const connections = useConnectionStore((s) => s.connections)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingTriggeredRef = useRef(false)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [quickAddType, setQuickAddType] = useState<KeyType | null>(null)

  // Tree expanded state
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set())

  const activeConnection = connections.find((c) => c.config.id === activeConnectionId) ?? null
  const isConnected = activeConnection?.status === 'connected'

  // Auto-start scan when connection becomes active or database changes
  useEffect(() => {
    if (activeConnectionId && isConnected) {
      // Clear manual expanded paths when switching databases
      setManualExpanded(new Set())
      startScan(activeConnectionId, searchTerm.trim() || undefined, typeFilter, currentDb)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, isConnected, currentDb])

  // Filtered keys
  const filteredKeys = useMemo(() => {
    if (!typeFilter) return keys
    return keys.filter((k) => k.type === typeFilter)
  }, [keys, typeFilter])

  // Build tree from filtered keys
  const treeRoot = useMemo(() => buildTree(filteredKeys), [filteredKeys])

  // Auto-expand matching ancestors when searching in tree mode
  const expandedPaths = useMemo(() => {
    if (searchTerm.trim()) {
      const auto = collectMatchingAncestors(treeRoot, searchTerm.trim())
      // merge with manual toggles
      const merged = new Set(manualExpanded)
      for (const p of auto) merged.add(p)
      return merged
    }
    return manualExpanded
  }, [treeRoot, searchTerm, manualExpanded])

  const treeRows = useMemo(() => flattenTree(treeRoot, expandedPaths), [treeRoot, expandedPaths])

  useEffect(() => {
    loadingTriggeredRef.current = false
  }, [viewMode, filteredKeys.length])

  // Debounced search
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchTerm(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (activeConnectionId) {
          startScan(activeConnectionId, value.trim() || undefined, typeFilter, currentDb)
        }
      }, 300)
    },
    [activeConnectionId, currentDb, startScan, setSearchTerm, typeFilter]
  )

  // Refresh
  const handleRefresh = useCallback(() => {
    if (activeConnectionId) {
      startScan(activeConnectionId, searchTerm.trim() || undefined, typeFilter, currentDb)
    }
  }, [activeConnectionId, currentDb, searchTerm, startScan, typeFilter])

  // Type filter
  const handleTypeFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      const nextType = value === '' ? null : value
      setTypeFilter(nextType)
      if (activeConnectionId) {
        startScan(activeConnectionId, searchTerm.trim() || undefined, nextType, currentDb)
      }
    },
    [activeConnectionId, currentDb, searchTerm, setTypeFilter, startScan]
  )

  // Detect scroll near bottom for prefetch (list mode only)
  const handleRowsRendered = useCallback(
    (_visibleRows: { startIndex: number; stopIndex: number }, allRows: { startIndex: number; stopIndex: number }) => {
      if (!hasMore || isLoading || typeFilter || searchTerm.trim()) {
        loadingTriggeredRef.current = false
        return
      }
      const threshold = APP_CONFIG.PREFETCH_THRESHOLD
      const lastIndex = filteredKeys.length - 1
      if (allRows.stopIndex >= lastIndex - threshold && !loadingTriggeredRef.current) {
        loadingTriggeredRef.current = true
        loadNextPage()
      }
    },
    [hasMore, isLoading, typeFilter, searchTerm, filteredKeys.length, loadNextPage]
  )

  const handleSelectKey = useCallback(
    (key: KeyInfo) => {
      selectKey(key)
    },
    [selectKey]
  )

  const handleCopyKey = useCallback((key: string) => {
    navigator.clipboard.writeText(key).catch(() => {
      /* ignore */
    })
  }, [])

  const handleToggleNode = useCallback((path: string) => {
    setManualExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleLoadChildren = useCallback((prefix: string) => {
    if (activeConnectionId) {
      scanWithPrefix(activeConnectionId, prefix, currentDb)
      // Auto-expand the node so children are visible after loading
      setManualExpanded((prev) => {
        const next = new Set(prev)
        next.add(prefix)
        return next
      })
    }
  }, [activeConnectionId, currentDb, scanWithPrefix])

  const handleQuickCreated = useCallback(
    (key: KeyInfo) => {
      setSearchTerm('')
      setTypeFilter(null)
      useBrowserStore.setState((state) => {
        const nextKey = { ...key, connectionId: activeConnectionId ?? key.connectionId, db: currentDb }
        return {
          keys: [nextKey, ...state.keys.filter((item) => item.key !== key.key)],
          selectedKey: nextKey,
          totalScanned: state.totalScanned + (state.keys.some((item) => item.key === key.key) ? 0 : 1),
        }
      })
    },
    [activeConnectionId, currentDb, setSearchTerm, setTypeFilter]
  )

  const rowProps: RowProps = useMemo(
    () => ({ keys: filteredKeys, selectedKey, onSelect: handleSelectKey, onCopyKey: handleCopyKey }),
    [filteredKeys, selectedKey, handleSelectKey, handleCopyKey]
  )

  const treeRowProps: TreeRowProps = useMemo(
    () => ({
      rows: treeRows,
      selectedKey,
      expandedPaths,
      onToggle: handleToggleNode,
      onSelect: handleSelectKey,
      onLoadChildren: handleLoadChildren,
    }),
    [treeRows, selectedKey, expandedPaths, handleToggleNode, handleSelectKey, handleLoadChildren]
  )

  // No connection selected
  if (!activeConnectionId || !activeConnection) {
    return (
      <div className="empty-state">
        <Key className="empty-state-icon" />
        <div className="empty-state-title">{t('browser.selectConnection')}</div>
        <div className="empty-state-description">
          {t('browser.selectConnectionDesc')}
        </div>
      </div>
    )
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <div className="search-input-wrapper" style={{ flex: 1 }}>
          <input
            className="search-input"
            type="text"
            placeholder={t('browser.searchKeys')}
            value={searchTerm}
            onChange={handleSearchChange}
          />
          <Search className="search-input-icon" />
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <select
            className="input"
            style={{
              padding: '4px 24px 4px 8px',
              fontSize: 'var(--font-size-sm)',
              appearance: 'none',
              cursor: 'pointer',
              minWidth: 80,
            }}
            value={typeFilter ?? ''}
            onChange={handleTypeFilterChange}
          >
            <option value="">{t('browser.allTypes')}</option>
            {KEY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Filter
            size={12}
            style={{
              position: 'absolute',
              right: 8,
              pointerEvents: 'none',
              color: 'var(--text-tertiary)',
            }}
          />
        </div>

        {/* View mode toggle */}
        <div className="view-toggle">
          <button
            className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
            onClick={() => setViewMode('list')}
            title={t('browser.listView')}
          >
            <ListIcon size={14} />
          </button>
          <button
            className={`view-toggle-btn${viewMode === 'tree' ? ' active' : ''}`}
            onClick={() => setViewMode('tree')}
            title={t('browser.treeView')}
          >
            <FolderTree size={14} />
          </button>
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="btn btn-ghost btn-sm" title={t('quickAdd.menuTitle')} disabled={!isConnected}>
              <Plus size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="context-menu" align="end" sideOffset={4}>
              {QUICK_ADD_TYPES.map((type) => (
                <DropdownMenu.Item
                  key={type}
                  className="context-menu-item"
                  onSelect={() => setQuickAddType(type)}
                >
                  {t(`quickAdd.type.${type}`)}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="context-menu-separator" />
              <DropdownMenu.Item className="context-menu-item" disabled>
                {t('quickAdd.import')}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <button className="btn btn-ghost btn-sm" onClick={handleRefresh} title={t('browser.refresh')} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
        </button>
      </div>

      {/* Key List / Tree */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!isConnected ? (
          <div className="empty-state">
            <Key className="empty-state-icon" />
            <div className="empty-state-title">{t('browser.notConnected')}</div>
            <div className="empty-state-description">
              {t('browser.notConnectedDesc')}
            </div>
          </div>
        ) : filteredKeys.length === 0 && !isLoading ? (
          <div className="empty-state">
            <Key className="empty-state-icon" />
            <div className="empty-state-title">{t('browser.noKeysFound')}</div>
            <div className="empty-state-description">
              {searchTerm
                ? t('browser.noKeysMatch', { term: searchTerm })
                : t('browser.databaseEmpty')}
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <List<RowProps>
            rowComponent={KeyRow}
            rowProps={rowProps}
            rowCount={filteredKeys.length}
            rowHeight={APP_CONFIG.VIRTUAL_LIST_ROW_HEIGHT}
            onRowsRendered={handleRowsRendered}
            overscanCount={10}
            style={{ height: '100%', width: '100%' }}
          />
        ) : (
          <div className="tree-view">
            <List<TreeRowProps>
              rowComponent={TreeRow}
              rowProps={treeRowProps}
              rowCount={treeRows.length}
              rowHeight={APP_CONFIG.VIRTUAL_LIST_ROW_HEIGHT}
              overscanCount={12}
              style={{ flex: 1, minHeight: 0, width: '100%' }}
            />
            <div className="tree-load-more">
              {hasMore ? (
                <button className="btn btn-ghost btn-sm" onClick={loadNextPage} disabled={isLoading}>
                  {isLoading ? t('browser.loading') : t('browser.loadMoreKeys', { count: keys.length })}
                </button>
              ) : (
                <span className="tree-all-loaded">{t('browser.allKeysLoaded', { count: keys.length })}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom info bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          borderTop: '1px solid var(--border-color)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-secondary)',
          flexShrink: 0,
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        <span>
          {t('browser.keysLoaded', { count: filteredKeys.length.toLocaleString() })}
          {typeFilter ? ` ${t('browser.filtered', { type: typeFilter })}` : ''}
        </span>
        <span>
          {isLoading ? t('browser.scanning') : hasMore ? t('browser.scanProgress', { count: totalScanned.toLocaleString() }) : t('browser.scanComplete')}
        </span>
      </div>
    </div>
    <QuickAddKeyDialog
      open={quickAddType != null}
      type={quickAddType}
      connectionId={activeConnectionId}
      currentDb={currentDb}
      onOpenChange={(open) => {
        if (!open) setQuickAddType(null)
      }}
      onCreated={handleQuickCreated}
    />
    </>
  )
}

export default KeyBrowser
