import { create } from 'zustand'
import type { IPCResponse, KeyInfo, ScanResult } from '../shared/types'

/** Tracks a resumable SCAN session for one tree prefix ("load children"). */
interface PrefixScanState {
  sessionId: string | null
  hasMore: boolean
}

interface BrowserStore {
  // State
  keys: KeyInfo[]
  selectedKey: KeyInfo | null
  sessionId: string | null
  connectionId: string | null
  searchTerm: string
  isLoading: boolean
  hasMore: boolean
  typeFilter: string | null
  totalScanned: number
  requestId: number
  // Per-prefix scan sessions for tree "load children" pagination, keyed by prefix.
  prefixScans: Record<string, PrefixScanState>

  // Actions
  startScan: (connectionId: string, pattern?: string, typeFilter?: string | null, db?: number) => Promise<void>
  loadNextPage: () => Promise<void>
  searchKeys: (connectionId: string, pattern: string) => Promise<void>
  scanWithPrefix: (connectionId: string, prefix: string, db?: number, typeFilter?: string | null) => Promise<void>
  selectKey: (key: KeyInfo | null) => void
  refreshSelectedKey: (connectionId: string) => Promise<void>
  setSearchTerm: (term: string) => void
  setTypeFilter: (type: string | null) => void
  deleteKey: (connectionId: string, key: string) => Promise<void>
  renameKey: (connectionId: string, key: string, newKey: string) => Promise<void>
  setKeyTTL: (connectionId: string, key: string, ttl: number) => Promise<void>
  reset: () => void
}

const initialState = {
  keys: [],
  selectedKey: null,
  sessionId: null,
  connectionId: null,
  searchTerm: '',
  isLoading: false,
  hasMore: false,
  typeFilter: null,
  totalScanned: 0,
  requestId: 0,
  prefixScans: {},
}

function scopeKeys(keys: KeyInfo[], connectionId: string, db?: number): KeyInfo[] {
  return keys.map((key) => ({
    ...key,
    connectionId: key.connectionId ?? connectionId,
    db: key.db ?? db,
  }))
}

function isCurrentTarget(state: BrowserStore, requestId: number, connectionId: string): boolean {
  return state.requestId === requestId && state.connectionId === connectionId
}

function canKeepSelectedKey(key: KeyInfo | null, connectionId: string, db?: number): boolean {
  if (!key) return false
  if (key.connectionId && key.connectionId !== connectionId) return false
  if (db != null && key.db != null && key.db !== db) return false
  return true
}

export const MIN_KEY_SEARCH_CHARS = 2

export function hasSearchGlobPattern(pattern: string): boolean {
  return /[*?[\]]/.test(pattern)
}

export function isPlainSearchTooShort(pattern?: string): boolean {
  const trimmed = pattern?.trim()
  return Boolean(trimmed && !hasSearchGlobPattern(trimmed) && Array.from(trimmed).length < MIN_KEY_SEARCH_CHARS)
}

function normalizeSearchPattern(pattern?: string): string | undefined | null {
  const trimmed = pattern?.trim()
  if (!trimmed) return undefined
  if (isPlainSearchTooShort(trimmed)) return null
  return hasSearchGlobPattern(trimmed) ? trimmed : `*${trimmed}*`
}

function resolveSelectedKey(
  selectedKey: KeyInfo | null,
  keys: KeyInfo[],
  connectionId: string,
  db: number | undefined,
  scanComplete: boolean,
  preserveMissing: boolean
): KeyInfo | null {
  if (!canKeepSelectedKey(selectedKey, connectionId, db)) return null
  const refreshedKey = keys.find((key) => key.key === selectedKey?.key)
  if (refreshedKey) return refreshedKey
  return scanComplete && !preserveMissing ? null : selectedKey
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  ...initialState,

  startScan: async (connectionId: string, pattern?: string, typeFilter?: string | null, db?: number) => {
    const scanPattern = normalizeSearchPattern(pattern)
    const requestId = get().requestId + 1
    // When switching databases or changing filters, always clear the selected key to avoid showing data from wrong database
    // This ensures we don't display a key that exists in both old and new databases but has different data
    if (scanPattern === null) {
      set({ isLoading: false, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId, prefixScans: {} })
      return
    }
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId, prefixScans: {} })
    try {
      const result = await window.redixAPI.scan.start(connectionId, scanPattern, typeFilter ?? undefined, db) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (!isCurrentTarget(get(), requestId, connectionId)) return
      if (result.success && result.data) {
        const scanData = result.data
        const targetConnectionId = scanData.connectionId ?? connectionId
        const targetDb = scanData.db ?? db
        const scopedKeys = scopeKeys(scanData.keys, targetConnectionId, targetDb)
        const preserveMissing = Boolean(scanPattern || typeFilter)
        set({
          keys: scopedKeys,
          selectedKey: resolveSelectedKey(get().selectedKey, scopedKeys, targetConnectionId, targetDb, !scanData.hasMore, preserveMissing),
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? scanData.keys.length,
          sessionId: scanData.sessionId ?? scanData.cursor ?? null,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      if (isCurrentTarget(get(), requestId, connectionId)) set({ isLoading: false })
    }
  },

  loadNextPage: async () => {
    const { isLoading, hasMore, sessionId, keys, requestId, connectionId } = get()
    if (isLoading || !hasMore || !sessionId) return

    set({ isLoading: true })
    try {
      if (!connectionId) {
        set({ isLoading: false })
        return
      }
      const result = await window.redixAPI.scan.next(sessionId, connectionId) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (!isCurrentTarget(get(), requestId, connectionId) || get().sessionId !== sessionId) return
      if (result.success && result.data) {
        const scanData = result.data
        const targetConnectionId = scanData.connectionId ?? connectionId
        set({
          keys: [...keys, ...scopeKeys(scanData.keys, targetConnectionId, scanData.db)],
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? (keys.length + scanData.keys.length),
          // The backend keeps the same session key across pages and does not
          // echo sessionId back on scan_next — keep the existing one rather than
          // overwriting it with the cursor (which breaks the next page fetch).
          sessionId,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      const state = get()
      if (connectionId && isCurrentTarget(state, requestId, connectionId) && state.sessionId === sessionId) set({ isLoading: false })
    }
  },

  searchKeys: async (connectionId: string, pattern: string) => {
    const searchPattern = normalizeSearchPattern(pattern)
    const requestId = get().requestId + 1
    if (searchPattern === null) {
      set({ isLoading: false, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId, prefixScans: {} })
      return
    }
    if (!searchPattern) {
      // Empty search — restart normal scan
      get().startScan(connectionId)
      return
    }
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId, prefixScans: {} })
    try {
      const result = await window.redixAPI.scan.search(connectionId, searchPattern) as {
        success: boolean
        data?: ScanResult
        error?: { message: string }
      }
      if (!isCurrentTarget(get(), requestId, connectionId)) return
      if (result.success && result.data) {
        const scanData = result.data
        const targetConnectionId = scanData.connectionId ?? connectionId
        set({
          keys: scopeKeys(scanData.keys, targetConnectionId, scanData.db),
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? scanData.keys.length,
          sessionId: scanData.cursor ?? null,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      if (isCurrentTarget(get(), requestId, connectionId)) set({ isLoading: false })
    }
  },

  scanWithPrefix: async (connectionId: string, prefix: string, db?: number, typeFilter?: string | null) => {
    const { isLoading, keys: existingKeys, requestId, prefixScans } = get()
    if (isLoading) return

    // Resume the existing session for this prefix if one is already open, so a
    // repeated "load children" fetches the NEXT page instead of restarting at
    // cursor 0 (which would return the same keys and appear to do nothing).
    const existing = prefixScans[prefix]
    const canResume = Boolean(existing?.sessionId && existing.hasMore)
    if (existing && !existing.hasMore) return // already fully loaded for this prefix

    set({ isLoading: true })
    try {
      const result = (canResume
        ? await window.redixAPI.scan.next(existing!.sessionId!, connectionId)
        : await window.redixAPI.scan.start(connectionId, `${prefix}:*`, typeFilter ?? undefined, db)) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (!isCurrentTarget(get(), requestId, connectionId)) return
      if (result.success && result.data) {
        const scanData = result.data
        const targetConnectionId = scanData.connectionId ?? connectionId
        // Merge new keys with existing, avoiding duplicates
        const existingKeySet = new Set(existingKeys.map((k) => k.key))
        const newKeys = scopeKeys(scanData.keys, targetConnectionId, scanData.db).filter((k) => !existingKeySet.has(k.key))
        // scan_next does not echo sessionId; keep the one we resumed from.
        const nextSessionId = scanData.sessionId ?? existing?.sessionId ?? scanData.cursor ?? null
        set((state) => ({
          keys: [...existingKeys, ...newKeys],
          totalScanned: existingKeys.length + scanData.keys.length,
          isLoading: false,
          prefixScans: {
            ...state.prefixScans,
            [prefix]: { sessionId: nextSessionId, hasMore: scanData.hasMore },
          },
        }))
      } else {
        set({ isLoading: false })
      }
    } catch {
      if (isCurrentTarget(get(), requestId, connectionId)) set({ isLoading: false })
    }
  },

  selectKey: (key: KeyInfo | null) => {
    set({ selectedKey: key })
  },

  refreshSelectedKey: async (connectionId: string) => {
    const selectedKey = get().selectedKey
    if (!selectedKey) return
    if (selectedKey.connectionId && selectedKey.connectionId !== connectionId) return
    try {
      const result = await window.redixAPI.key.info(connectionId, selectedKey.key) as IPCResponse<KeyInfo>
      // Only update if this key is still the selected one (guards against races on fast key switches)
      if (get().selectedKey?.key !== selectedKey.key) return
      if (!result.success || !result.data) return
      const info = result.data
      set((state) => {
        const merged: KeyInfo = { ...selectedKey, ...info }
        return {
          keys: state.keys.map((k) => (k.key === selectedKey.key ? { ...k, ...merged } : k)),
          selectedKey: state.selectedKey?.key === selectedKey.key ? merged : state.selectedKey,
        }
      })
    } catch {
      // silently fail — header simply keeps its previous values
    }
  },

  setSearchTerm: (term: string) => {
    set({ searchTerm: term })
  },

  setTypeFilter: (type: string | null) => {
    set({ typeFilter: type })
  },

  deleteKey: async (connectionId: string, key: string) => {
    const selectedKey = get().selectedKey
    if (selectedKey && selectedKey.connectionId && selectedKey.connectionId !== connectionId) return
    try {
      const result = await window.redixAPI.key.delete(connectionId, key) as {
        success: boolean
        error?: { message: string }
      }
      if (result.success) {
        set((state) => ({
          keys: state.keys.filter((k) => k.key !== key),
          selectedKey: state.selectedKey?.key === key ? null : state.selectedKey,
        }))
      }
    } catch {
      // silently fail — UI will not update
    }
  },

  renameKey: async (connectionId: string, key: string, newKey: string) => {
    const selectedKey = get().selectedKey
    if (selectedKey && selectedKey.connectionId && selectedKey.connectionId !== connectionId) return
    try {
      const result = await window.redixAPI.key.rename(connectionId, key, newKey) as {
        success: boolean
        error?: { message: string }
      }
      if (result.success) {
        set((state) => ({
          keys: state.keys.map((k) => (k.key === key ? { ...k, key: newKey } : k)),
          selectedKey: state.selectedKey?.key === key
            ? { ...state.selectedKey, key: newKey }
            : state.selectedKey,
        }))
      }
    } catch {
      // silently fail
    }
  },

  setKeyTTL: async (connectionId: string, key: string, ttl: number) => {
    const selectedKey = get().selectedKey
    if (selectedKey && selectedKey.connectionId && selectedKey.connectionId !== connectionId) return
    try {
      const result = await window.redixAPI.key.setTTL(connectionId, key, ttl) as {
        success: boolean
        error?: { message: string }
      }
      if (result.success) {
        set((state) => ({
          keys: state.keys.map((k) => (k.key === key ? { ...k, ttl } : k)),
          selectedKey: state.selectedKey?.key === key
            ? { ...state.selectedKey, ttl }
            : state.selectedKey,
        }))
      }
    } catch {
      // silently fail
    }
  },

  reset: () => {
    set(initialState)
  },
}))
