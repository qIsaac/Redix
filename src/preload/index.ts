import { clipboard, contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'

const connectionsAPI = {
  // ── 连接管理 ────────────────────────────────────────────────
  list: () => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_LIST),
  add: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_ADD, config),
  update: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_UPDATE, config),
  delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_DELETE, id),
  test: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_TEST, config),
  connect: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_CONNECT, id),
  disconnect: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_DISCONNECT, id),
  getStatus: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_STATUS, id),
  selectDb: (connectionId: string, db: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_SELECT_DB, connectionId, db),
  getDbSizes: (connectionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_DB_SIZES, connectionId),
  onStatusChanged: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.CONNECTION_STATUS_CHANGED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.CONNECTION_STATUS_CHANGED, handler)
    }
  },
}

const scanAPI = {
  // ── Key 浏览（预留）────────────────────────────────────────
  start: (connectionId: string, pattern?: string, typeFilter?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_START, connectionId, pattern, typeFilter),
  next: (sessionId: string, _connectionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_NEXT, sessionId),
  search: (connectionId: string, pattern: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_SEARCH, connectionId, pattern),
  cancel: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_CANCEL, sessionId),
}

const keyAPI = {
  // ── Key 操作（预留）────────────────────────────────────────
  info: (connectionId: string, key: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_INFO, connectionId, key),
  delete: (connectionId: string, key: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_DELETE, connectionId, key),
  rename: (connectionId: string, key: string, newKey: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_RENAME, connectionId, key, newKey),
  setTTL: (connectionId: string, key: string, ttl: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_SET_TTL, connectionId, key, ttl),
  add: (connectionId: string, key: string, type: string, value?: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_ADD, connectionId, key, type, value),
}

const dataAPI = {
  // ── 数据操作（预留）────────────────────────────────────────
  view: (connectionId: string, key: string, options?: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_VIEW, connectionId, key, options),
  update: (connectionId: string, key: string, value: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_UPDATE, connectionId, key, value),
  addField: (connectionId: string, key: string, field: unknown, value?: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_ADD_FIELD, connectionId, key, field, value),
  deleteField: (connectionId: string, key: string, field: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_DELETE_FIELD, connectionId, key, field),
}

const cliAPI = {
  // ── CLI ────────────────────────────────────────────────────
  execute: (connectionId: string, command: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CLI_EXECUTE, connectionId, command),
}

const clipboardAPI = {
  writeText: (text: string) => clipboard.writeText(text),
  readText: () => clipboard.readText(),
}

const serverAPI = {
  // ── 服务器 ─────────────────────────────────────────────────
  info: (connectionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SERVER_INFO, connectionId),
  metrics: (connectionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SERVER_METRICS, connectionId),
  slowlog: (connectionId: string, count?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.SERVER_SLOWLOG, connectionId, count),
  onMetricsUpdated: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.SERVER_METRICS_UPDATED, handler)
    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.SERVER_METRICS_UPDATED, handler)
    }
  },
}

// Expose as both `electronAPI` and `api` for compatibility across all renderer components
const api = {
  connection: connectionsAPI,
  connections: connectionsAPI,
  scan: scanAPI,
  scanner: scanAPI,
  key: keyAPI,
  keys: keyAPI,
  data: dataAPI,
  cli: cliAPI,
  clipboard: clipboardAPI,
  server: serverAPI,
}

contextBridge.exposeInMainWorld('electronAPI', api)
contextBridge.exposeInMainWorld('api', api)
