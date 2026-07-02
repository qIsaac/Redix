import type {
  ConnectionConfig,
  ConnectionInfo,
  KeyInfo,
  ScanResult,
  DataPage,
  CLIResult,
  ServerMetrics,
  SlowLogEntry,
  IPCResponse,
  HashField,
  ZSetMember,
  StreamEntry,
} from '../../shared/types'

/**
 * IPC Handler 类型签名
 * args: handler 接收的参数元组
 * result: handler 返回的业务数据类型（包裹在 IPCResponse<T> 中）
 */
export interface IPCHandlers {
  // ── 连接管理 ──────────────────────────────────────────────
  'connection:list': {
    args: []
    result: ConnectionInfo[]
  }
  'connection:add': {
    args: [config: ConnectionConfig]
    result: ConnectionInfo
  }
  'connection:update': {
    args: [config: ConnectionConfig]
    result: ConnectionInfo
  }
  'connection:delete': {
    args: [id: string]
    result: void
  }
  'connection:test': {
    args: [config: ConnectionConfig]
    result: { success: boolean; error?: string }
  }
  'connection:connect': {
    args: [id: string]
    result: void
  }
  'connection:disconnect': {
    args: [id: string]
    result: void
  }
  'connection:status': {
    args: [id: string]
    result: { status: string; error?: string }
  }
  'connection:select-db': {
    args: [connectionId: string, db: number]
    result: { db: number }
  }
  'connection:db-sizes': {
    args: [connectionId: string]
    result: Record<string, number>
  }

  // ── Key 浏览 ──────────────────────────────────────────────
  'scan:start': {
    args: [connectionId: string, pattern?: string, typeFilter?: string]
    result: ScanResult
  }
  'scan:next': {
    args: [sessionId: string]
    result: ScanResult
  }
  'scan:search': {
    args: [connectionId: string, pattern: string]
    result: ScanResult
  }
  'scan:cancel': {
    args: [sessionId: string]
    result: void
  }

  // ── Key 操作 ──────────────────────────────────────────────
  'key:info': {
    args: [connectionId: string, key: string]
    result: KeyInfo
  }
  'key:delete': {
    args: [connectionId: string, key: string]
    result: void
  }
  'key:rename': {
    args: [connectionId: string, oldKey: string, newKey: string]
    result: void
  }
  'key:set-ttl': {
    args: [connectionId: string, key: string, ttl: number]
    result: void
  }
  'key:add': {
    args: [connectionId: string, key: string, type: string, value?: unknown]
    result: void
  }

  // ── 数据查看 ──────────────────────────────────────────────
  'data:view': {
    args: [connectionId: string, key: string, options?: DataViewOptions]
    result: DataPage<HashField | ZSetMember | StreamEntry | string>
  }
  'data:update': {
    args: [connectionId: string, key: string, changes: unknown]
    result: void
  }
  'data:add-field': {
    args: [connectionId: string, key: string, field: unknown, value?: unknown]
    result: void
  }
  'data:delete-field': {
    args: [connectionId: string, key: string, field: string]
    result: void
  }

  // ── CLI ───────────────────────────────────────────────────
  'cli:execute': {
    args: [connectionId: string, command: string]
    result: CLIResult
  }

  // ── 服务器 ────────────────────────────────────────────────
  'server:info': {
    args: [connectionId: string]
    result: string
  }
  'server:metrics': {
    args: [connectionId: string]
    result: ServerMetrics
  }
  'server:slowlog': {
    args: [connectionId: string, count?: number]
    result: SlowLogEntry[]
  }
}

/** 数据查看的分页选项 */
export interface DataViewOptions {
  cursor?: string
  count?: number
  pattern?: string
  min?: string | number
  max?: string | number
  withScores?: boolean
}

/**
 * 从 IPCHandlers 映射中提取某个通道的 IPCResponse 返回类型
 */
export type IPCResponseOf<K extends keyof IPCHandlers> = IPCResponse<IPCHandlers[K]['result']>
