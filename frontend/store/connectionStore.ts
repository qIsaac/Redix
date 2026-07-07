import { create } from 'zustand'
import type { ConnectionConfig, ConnectionInfo, ConnectionStatus } from '../shared/types'

export interface DatabaseEntry {
  connectionId: string
  dbNumber: number
  alias: string
}

const ADDED_DB_STORAGE_KEY = 'redix:added-databases'
const ACTIVE_SELECTION_STORAGE_KEY = 'redix:active-selection'

interface ActiveSelection {
  connectionId: string
  db: number
}

function loadAddedDatabases(): DatabaseEntry[] {
  try {
    const raw = localStorage.getItem(ADDED_DB_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as DatabaseEntry[]
  } catch {
    /* ignore */
  }
  return []
}

function loadActiveSelection(): ActiveSelection | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SELECTION_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ActiveSelection>
    if (typeof value.connectionId === 'string' && typeof value.db === 'number') {
      return { connectionId: value.connectionId, db: value.db }
    }
  } catch {
    /* ignore */
  }
  return null
}

function saveAddedDatabases(entries: DatabaseEntry[]): void {
  localStorage.setItem(ADDED_DB_STORAGE_KEY, JSON.stringify(entries))
}

function saveActiveSelection(selection: ActiveSelection | null): void {
  if (!selection) {
    localStorage.removeItem(ACTIVE_SELECTION_STORAGE_KEY)
    return
  }
  localStorage.setItem(ACTIVE_SELECTION_STORAGE_KEY, JSON.stringify(selection))
}

const savedActiveSelection = loadActiveSelection()

interface ConnectionStore {
  connections: ConnectionInfo[]
  activeConnectionId: string | null
  currentDb: number
  isLoading: boolean
  error: string | null
  dbSizes: Record<string, Record<string, number>>  // connectionId -> { db0: 123, db1: 456, ... }
  addedDatabases: DatabaseEntry[]

  setConnections: (connections: ConnectionInfo[]) => void
  addConnection: (config: ConnectionConfig) => Promise<void>
  updateConnection: (config: ConnectionConfig) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  selectConnection: (id: string) => void
  updateConnectionStatus: (id: string, status: ConnectionStatus, error?: string) => void
  testConnection: (config: ConnectionConfig) => Promise<{ success: boolean; error?: string }>
  loadConnections: () => Promise<void>
  connectToServer: (id: string) => Promise<void>
  disconnectFromServer: (id: string) => Promise<void>
  selectDb: (connectionId: string, db: number) => Promise<boolean>
  fetchDbSizes: (connectionId: string) => Promise<void>
  addDatabase: (entry: DatabaseEntry) => void
  removeDatabase: (connectionId: string, dbNumber: number) => void
  updateDatabase: (connectionId: string, oldDbNumber: number, newDbNumber: number, newAlias: string) => void
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connections: [],
  activeConnectionId: savedActiveSelection?.connectionId ?? null,
  currentDb: savedActiveSelection?.db ?? 0,
  isLoading: false,
  error: null,
  dbSizes: {},
  addedDatabases: loadAddedDatabases(),

  setConnections: (connections) => set({ connections }),

  loadConnections: async () => {
    set({ isLoading: true, error: null })
    try {
      const result = await window.redixAPI.connection.list()
      const data = result as { success: boolean; data?: unknown[]; error?: { message: string } }
      if (data.success && data.data) {
        // 兼容处理：如果返回的是 ConnectionConfig[]，转换为 ConnectionInfo[]
        const connections = data.data.map(item => {
          const obj = item as Record<string, unknown>
          if (obj.config) return obj as unknown as ConnectionInfo  // 已经是 ConnectionInfo
          return { config: obj as unknown as ConnectionConfig, status: 'disconnected' as const }  // 需要转换
        })
        set((state) => {
          const currentActiveExists = state.activeConnectionId
            ? connections.some((connection) => connection.config.id === state.activeConnectionId)
            : false
          const savedActiveExists = savedActiveSelection
            ? connections.some((connection) => connection.config.id === savedActiveSelection.connectionId)
            : false
          if (currentActiveExists) {
            return { connections, isLoading: false }
          }
          if (savedActiveSelection && savedActiveExists) {
            return {
              connections,
              activeConnectionId: savedActiveSelection.connectionId,
              currentDb: savedActiveSelection.db,
              isLoading: false,
            }
          }
          return { connections, activeConnectionId: null, isLoading: false }
        })
      } else {
        set({ isLoading: false, error: data.error?.message ?? 'Failed to load connections' })
      }
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  addConnection: async (config) => {
    set({ error: null })
    try {
      const result = await window.redixAPI.connection.add(config)
      const data = result as { success: boolean; data?: ConnectionInfo; error?: { message: string } }
      if (data.success) {
        // 不管 data 是否有值，都重新加载列表
        await get().loadConnections()
      } else {
        set({ error: data.error?.message ?? 'Failed to add connection' })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  updateConnection: async (config) => {
    set({ error: null })
    try {
      const result = await window.redixAPI.connection.update(config)
      const data = result as { success: boolean; data?: ConnectionInfo; error?: { message: string } }
      if (data.success) {
        // 不管 data 是否有值，都重新加载列表
        await get().loadConnections()
      } else {
        set({ error: data.error?.message ?? 'Failed to update connection' })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  deleteConnection: async (id) => {
    set({ error: null })
    try {
      const result = await window.redixAPI.connection.delete(id)
      const data = result as { success: boolean; error?: { message: string } }
      if (data.success) {
        set((state) => {
          const newAddedDbs = state.addedDatabases.filter((e) => e.connectionId !== id)
          saveAddedDatabases(newAddedDbs)
          return {
            connections: state.connections.filter((c) => c.config.id !== id),
            activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
            addedDatabases: newAddedDbs,
          }
        })
        if (get().activeConnectionId === null) saveActiveSelection(null)
      } else {
        set({ error: data.error?.message ?? 'Failed to delete connection' })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  selectConnection: (id) => {
    set((state) => {
      const nextDb = state.activeConnectionId === id
        ? state.currentDb
        : state.connections.find((connection) => connection.config.id === id)?.config.db ?? 0
      saveActiveSelection({ connectionId: id, db: nextDb })
      return {
        activeConnectionId: id,
        currentDb: nextDb,
      }
    })
  },

  updateConnectionStatus: (id, status, error) => {
    set((state) => ({
      connections: state.connections.map((c) =>
        c.config.id === id ? { ...c, status, errorMessage: error } : c
      ),
    }))
  },

  testConnection: async (config) => {
    try {
      return await window.redixAPI.connection.test(config)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  },

  connectToServer: async (id) => {
    set({ error: null })
    get().updateConnectionStatus(id, 'connecting')
    try {
      const result = await window.redixAPI.connection.connect(id)
      const data = result as { success: boolean; error?: { message: string } }
      if (data.success) {
        get().updateConnectionStatus(id, 'connected')
      } else {
        get().updateConnectionStatus(id, 'error', data.error?.message)
      }
    } catch (err) {
      get().updateConnectionStatus(id, 'error', err instanceof Error ? err.message : 'Unknown error')
    }
  },

  disconnectFromServer: async (id) => {
    set({ error: null })
    try {
      const result = await window.redixAPI.connection.disconnect(id)
      const data = result as { success: boolean; error?: { message: string } }
      if (data.success) {
        get().updateConnectionStatus(id, 'disconnected')
      } else {
        set({ error: data.error?.message ?? 'Failed to disconnect' })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  selectDb: async (connectionId, db) => {
    try {
      const result = await window.redixAPI.connection.selectDb(connectionId, db)
      if (result.success) {
        set({ activeConnectionId: connectionId, currentDb: db })
        saveActiveSelection({ connectionId, db })
        return true
      }
      return false
    } catch {
      return false
    }
  },

  fetchDbSizes: async (connectionId) => {
    try {
      const result = await window.redixAPI.connection.getDbSizes(connectionId)
      if (result.success && result.data) {
        set((state) => ({
          dbSizes: {
            ...state.dbSizes,
            [connectionId]: result.data!,
          },
        }))
      }
    } catch {
      // Silently fail — db sizes are optional display data
    }
  },

  addDatabase: (entry) => {
    set((state) => {
      // Prevent duplicate: same connectionId + dbNumber
      const exists = state.addedDatabases.some(
        (e) => e.connectionId === entry.connectionId && e.dbNumber === entry.dbNumber
      )
      if (exists) return state
      const newAddedDbs = [...state.addedDatabases, entry]
      saveAddedDatabases(newAddedDbs)
      return { addedDatabases: newAddedDbs }
    })
  },

  removeDatabase: (connectionId, dbNumber) => {
    set((state) => {
      const newAddedDbs = state.addedDatabases.filter(
        (e) => !(e.connectionId === connectionId && e.dbNumber === dbNumber)
      )
      saveAddedDatabases(newAddedDbs)
      const wasActive =
        state.activeConnectionId === connectionId && state.currentDb === dbNumber
      return {
        addedDatabases: newAddedDbs,
        activeConnectionId: wasActive ? null : state.activeConnectionId,
      }
    })
    if (get().activeConnectionId === null) saveActiveSelection(null)
  },

  updateDatabase: (connectionId, oldDbNumber, newDbNumber, newAlias) => {
    set((state) => {
      // Check if the new dbNumber already exists for this connection (excluding the old entry)
      const conflict = state.addedDatabases.some(
        (e) =>
          e.connectionId === connectionId &&
          e.dbNumber === newDbNumber &&
          e.dbNumber !== oldDbNumber
      )
      if (conflict) return state
      const newAddedDbs = state.addedDatabases.map((e) =>
        e.connectionId === connectionId && e.dbNumber === oldDbNumber
          ? { ...e, dbNumber: newDbNumber, alias: newAlias }
          : e
      )
      saveAddedDatabases(newAddedDbs)
      // Update currentDb if the active db was renamed
      const wasActive =
        state.activeConnectionId === connectionId && state.currentDb === oldDbNumber
      const nextState = {
        addedDatabases: newAddedDbs,
        currentDb: wasActive ? newDbNumber : state.currentDb,
      }
      if (wasActive) saveActiveSelection({ connectionId, db: newDbNumber })
      return nextState
    })
  },
}))
