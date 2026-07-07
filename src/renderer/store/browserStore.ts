import { create } from 'zustand'
import type { KeyInfo, ScanResult } from '../../shared/types'

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

  // Actions
  startScan: (connectionId: string, pattern?: string, typeFilter?: string | null, db?: number) => Promise<void>
  loadNextPage: () => Promise<void>
  searchKeys: (connectionId: string, pattern: string) => Promise<void>
  scanWithPrefix: (connectionId: string, prefix: string, db?: number) => Promise<void>
  selectKey: (key: KeyInfo | null) => void
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
    const requestId = get().requestId + 1
    // When switching databases or changing filters, always clear the selected key to avoid showing data from wrong database
    // This ensures we don't display a key that exists in both old and new databases but has different data
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId })
    try {
      const result = await window.redixAPI.scan.start(connectionId, pattern, typeFilter ?? undefined, db) as {
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
        const preserveMissing = Boolean(pattern?.trim() || typeFilter)
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
          sessionId: scanData.sessionId ?? scanData.cursor ?? null,
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
    if (!pattern.trim()) {
      // Empty search — restart normal scan
      get().startScan(connectionId)
      return
    }
    const requestId = get().requestId + 1
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId, requestId })
    try {
      const result = await window.redixAPI.scan.search(connectionId, pattern) as {
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

  scanWithPrefix: async (connectionId: string, prefix: string, db?: number) => {
    const { isLoading, keys: existingKeys, requestId } = get()
    if (isLoading) return
    set({ isLoading: true })
    try {
      const pattern = `${prefix}:*`
      const result = await window.redixAPI.scan.start(connectionId, pattern, undefined, db) as {
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
        set({
          keys: [...existingKeys, ...newKeys],
          hasMore: scanData.hasMore,
          totalScanned: (existingKeys.length + scanData.keys.length),
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

  selectKey: (key: KeyInfo | null) => {
    set({ selectedKey: key })
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
