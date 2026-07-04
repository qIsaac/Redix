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

  // Actions
  startScan: (connectionId: string, pattern?: string) => Promise<void>
  loadNextPage: () => Promise<void>
  searchKeys: (connectionId: string, pattern: string) => Promise<void>
  scanWithPrefix: (connectionId: string, prefix: string) => Promise<void>
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
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  ...initialState,

  startScan: async (connectionId: string, pattern?: string) => {
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0, sessionId: null, connectionId })
    try {
      const result = await window.redixAPI.scan.start(connectionId, pattern) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (result.success && result.data) {
        const scanData = result.data
        set({
          keys: scanData.keys,
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? scanData.keys.length,
          sessionId: scanData.sessionId ?? scanData.cursor ?? null,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  loadNextPage: async () => {
    const { isLoading, hasMore, sessionId, keys } = get()
    if (isLoading || !hasMore || !sessionId) return

    set({ isLoading: true })
    try {
      const connectionId = get().connectionId
      if (!connectionId) {
        set({ isLoading: false })
        return
      }
      const result = await window.redixAPI.scan.next(sessionId, connectionId) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (result.success && result.data) {
        const scanData = result.data
        set({
          keys: [...keys, ...scanData.keys],
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? (keys.length + scanData.keys.length),
          sessionId: scanData.sessionId ?? scanData.cursor ?? null,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  searchKeys: async (connectionId: string, pattern: string) => {
    if (!pattern.trim()) {
      // Empty search — restart normal scan
      get().startScan(connectionId)
      return
    }
    set({ isLoading: true, keys: [], selectedKey: null, hasMore: false, totalScanned: 0 })
    try {
      const result = await window.redixAPI.scan.search(connectionId, pattern) as {
        success: boolean
        data?: ScanResult
        error?: { message: string }
      }
      if (result.success && result.data) {
        const scanData = result.data
        set({
          keys: scanData.keys,
          hasMore: scanData.hasMore,
          totalScanned: scanData.totalScanned ?? scanData.keys.length,
          sessionId: scanData.cursor ?? null,
          isLoading: false,
        })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  scanWithPrefix: async (connectionId: string, prefix: string) => {
    const { isLoading, keys: existingKeys } = get()
    if (isLoading) return
    set({ isLoading: true })
    try {
      const pattern = `${prefix}:*`
      const result = await window.redixAPI.scan.start(connectionId, pattern) as {
        success: boolean
        data?: ScanResult & { sessionId?: string }
        error?: { message: string }
      }
      if (result.success && result.data) {
        const scanData = result.data
        // Merge new keys with existing, avoiding duplicates
        const existingKeySet = new Set(existingKeys.map((k) => k.key))
        const newKeys = scanData.keys.filter((k) => !existingKeySet.has(k.key))
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
      set({ isLoading: false })
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
