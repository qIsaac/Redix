import { create } from 'zustand'
import type { ConnectionConfig } from '../shared/types'

export type ActiveView = 'browser' | 'terminal' | 'monitor'

interface AppStore {
  activeView: ActiveView
  sidebarWidth: number
  showConnectionForm: boolean
  editingConnection: ConnectionConfig | null
  browserCliOpen: boolean
  browserCliCollapsed: boolean

  setActiveView: (view: ActiveView) => void
  setSidebarWidth: (width: number) => void
  openConnectionForm: () => void
  closeConnectionForm: () => void
  editConnection: (config: ConnectionConfig) => void
  openBrowserCli: () => void
  closeBrowserCli: () => void
  toggleBrowserCliCollapsed: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  activeView: 'browser',
  sidebarWidth: 240,
  showConnectionForm: false,
  editingConnection: null,
  browserCliOpen: false,
  browserCliCollapsed: false,

  setActiveView: (view) => set({ activeView: view }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  openConnectionForm: () => set({ showConnectionForm: true, editingConnection: null }),
  closeConnectionForm: () => set({ showConnectionForm: false, editingConnection: null }),
  editConnection: (config) => set({ showConnectionForm: true, editingConnection: config }),
  openBrowserCli: () => set({ browserCliOpen: true, browserCliCollapsed: false }),
  closeBrowserCli: () => set({ browserCliOpen: false, browserCliCollapsed: false }),
  toggleBrowserCliCollapsed: () => set((state) => ({ browserCliCollapsed: !state.browserCliCollapsed })),
}))
