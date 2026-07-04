import type { ConnectionConfig } from '../shared/types'

type Unsubscribe = () => void

interface ConnectionAPI {
  list: () => Promise<unknown>
  add: (config: ConnectionConfig) => Promise<unknown>
  update: (config: ConnectionConfig) => Promise<unknown>
  delete: (id: string) => Promise<unknown>
  test: (config: ConnectionConfig) => Promise<{ success: boolean; error?: string }>
  connect: (id: string) => Promise<unknown>
  disconnect: (id: string) => Promise<unknown>
  getStatus: (id: string) => Promise<unknown>
  selectDb: (connectionId: string, db: number) => Promise<{ success: boolean; data?: { db: number }; error?: { message: string } }>
  getDbSizes: (connectionId: string) => Promise<{ success: boolean; data?: Record<string, number>; error?: { message: string } }>
  onStatusChanged: (callback: (data: { id: string; status: string; error?: string }) => void) => Unsubscribe
}

interface ScanAPI {
  start: (connectionId: string, pattern?: string, typeFilter?: string) => Promise<unknown>
  next: (sessionId: string, connectionId?: string) => Promise<unknown>
  search: (connectionId: string, pattern: string) => Promise<unknown>
  cancel: (sessionId: string) => Promise<unknown>
}

interface KeyAPI {
  info: (connectionId: string, key: string) => Promise<unknown>
  delete: (connectionId: string, key: string) => Promise<unknown>
  rename: (connectionId: string, oldKey: string, newKey: string) => Promise<unknown>
  setTTL: (connectionId: string, key: string, ttl: number) => Promise<unknown>
  add: (connectionId: string, key: string, type: string, value?: unknown) => Promise<unknown>
}

interface DataAPI {
  view: (connectionId: string, key: string, options?: unknown) => Promise<unknown>
  update: (connectionId: string, key: string, value: unknown) => Promise<unknown>
  addField: (connectionId: string, key: string, field: unknown, value?: unknown) => Promise<unknown>
  deleteField: (connectionId: string, key: string, field: string) => Promise<unknown>
}

interface CLIAPI {
  execute: (connectionId: string, command: string) => Promise<unknown>
}

interface ClipboardAPI {
  writeText: (text: string) => void
  readText: () => string | Promise<string>
}

interface ServerAPI {
  info: (connectionId: string) => Promise<unknown>
  metrics: (connectionId: string) => Promise<unknown>
  slowlog: (connectionId: string, count?: number) => Promise<unknown>
  onMetricsUpdated: (callback: (data: unknown) => void) => Unsubscribe
}

interface RedixAPI {
  connection: ConnectionAPI
  connections: ConnectionAPI
  scan: ScanAPI
  scanner: ScanAPI
  key: KeyAPI
  keys: KeyAPI
  data: DataAPI
  cli: CLIAPI
  clipboard: ClipboardAPI
  server: ServerAPI
}

declare global {
  interface Window {
    redixAPI: RedixAPI
  }
}

export {}
