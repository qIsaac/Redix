import type {
  ConnectionConfig,
  ConnectionInfo,
  DataPage,
  HashField,
  KeyInfo,
  ScanResult,
  ServerMetrics,
  SlowLogEntry,
} from './shared/types'

type Response<T = unknown> = { success: boolean; data?: T; error?: { code: string; message: string } }
type Unsubscribe = () => void

const connectionId = 'demo-local'

const connection: ConnectionInfo = {
  config: {
    id: connectionId,
    name: 'Local demo',
    type: 'standalone',
    host: '127.0.0.1',
    port: 6379,
    db: 0,
  },
  status: 'connected',
  serverInfo: {
    redis_version: '7.2.0',
    mode: 'standalone',
  },
}

const keys: KeyInfo[] = [
  { key: 'app:user:1001:profile', type: 'hash', ttl: 3600, memory: 2048, connectionId, db: 0 },
  { key: 'app:user:1001:settings', type: 'hash', ttl: -1, memory: 1536, connectionId, db: 0 },
  { key: 'app:user:1002:profile', type: 'hash', ttl: 7200, memory: 1920, connectionId, db: 0 },
  { key: 'app:session:token:7f3a', type: 'string', ttl: 842, memory: 512, connectionId, db: 0 },
  { key: 'app:feature-flags', type: 'string', ttl: -1, memory: 640, connectionId, db: 0 },
  { key: 'app:queue:email', type: 'list', ttl: -1, memory: 4096, connectionId, db: 0 },
  { key: 'app:tags:active', type: 'set', ttl: -1, memory: 768, connectionId, db: 0 },
  { key: 'app:leaderboard:weekly', type: 'zset', ttl: 86400, memory: 3072, connectionId, db: 0 },
  { key: 'app:events:stream', type: 'stream', ttl: -1, memory: 6144, connectionId, db: 0 },
]

const hashFields: HashField[] = [
  { field: 'name', value: 'Demo User' },
  { field: 'email', value: 'demo@example.local' },
  { field: 'plan', value: 'pro' },
  { field: 'last_seen', value: '2026-07-09T09:30:00Z' },
  { field: 'region', value: 'local' },
]

const ok = <T,>(data: T): Response<T> => ({ success: true, data })

function normalizePattern(pattern?: string): string {
  return pattern || '*'
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function scanKeys(pattern?: string, typeFilter?: string, db = 0): ScanResult {
  const regex = globToRegExp(normalizePattern(pattern))
  const matched = keys.filter((key) =>
    key.db === db
    && regex.test(key.key)
    && (!typeFilter || key.type === typeFilter)
  )
  return {
    keys: matched,
    cursor: '0',
    hasMore: false,
    totalScanned: matched.length,
    connectionId,
    db,
  }
}

function keyInfo(key: string): KeyInfo {
  return keys.find((item) => item.key === key) ?? {
    key,
    type: 'none',
    ttl: -2,
    memory: null,
    connectionId,
    db: 0,
  }
}

window.redixAPI = {
  connection: {
    list: async () => ok([connection]),
    add: async () => ok(connection),
    update: async () => ok(connection),
    delete: async () => ok({}),
    test: async () => ({ success: true }),
    connect: async () => ok(connection),
    disconnect: async () => ok({}),
    getStatus: async () => ok('connected'),
    selectDb: async (_id: string, db: number) => ok({ db }),
    getDbSizes: async () => ok({ '0': keys.length, '1': 0, '7': 42 }),
    onStatusChanged: () => (() => {}) as Unsubscribe,
  },
  connections: undefined as never,
  scan: {
    start: async (_id: string, pattern?: string, typeFilter?: string, db?: number) =>
      ok(scanKeys(pattern, typeFilter, db)),
    next: async () => ok({ keys: [], cursor: '0', hasMore: false, totalScanned: 0 }),
    search: async (_id: string, pattern: string) => ok(scanKeys(pattern)),
    cancel: async () => ok({}),
  },
  scanner: undefined as never,
  key: {
    info: async (_id: string, key: string) => ok(keyInfo(key)),
    delete: async () => ok({}),
    rename: async () => ok({}),
    setTTL: async () => ok({}),
    add: async () => ok({}),
  },
  keys: undefined as never,
  data: {
    view: async (_id: string, key: string, options?: unknown) => {
      const type = (options as { type?: string } | undefined)?.type ?? keyInfo(key).type
      if (type === 'hash') {
        return ok<DataPage<HashField>>({
          items: hashFields,
          cursor: '0',
          hasMore: false,
          totalCount: hashFields.length,
        })
      }
      if (type === 'string') {
        return ok({
          kind: 'string',
          value: JSON.stringify({ enabled: true, rollout: 75, owner: 'platform' }, null, 2),
          length: 58,
          isBinary: false,
          isTruncated: false,
        })
      }
      return ok({ items: [], cursor: '0', hasMore: false })
    },
    update: async () => ok({}),
    addField: async () => ok({}),
    deleteField: async () => ok({}),
  },
  cli: {
    execute: async (_id: string, command: string) => ok({
      command,
      result: command.startsWith('hget')
        ? '"Demo User"'
        : '(integer) 1',
      isError: false,
      isWarning: false,
    }),
    completeKeys: async (_id: string, prefix: string) => {
      const matching = keys.map((item) => item.key).filter((key) => key.startsWith(prefix))
      const segments = Array.from(new Set(matching.map((key) => {
        const remaining = key.slice(prefix.length)
        const index = remaining.indexOf(':')
        return index >= 0 ? `${prefix}${remaining.slice(0, index + 1)}` : key
      }))).filter((segment) => segment !== prefix)
      return ok({ keys: matching, segments, hasMore: false })
    },
    completeHashFields: async (_id: string, _key: string, prefix: string) =>
      ok({ fields: hashFields.map((field) => field.field).filter((field) => field.startsWith(prefix)), hasMore: false }),
    completeMembers: async () => ok({ members: [], hasMore: false }),
  },
  clipboard: {
    writeText: () => {},
    readText: async () => '',
  },
  server: {
    info: async () => ok({ redis_version: '7.2.0', mode: 'standalone', role: 'master' }),
    metrics: async () => ok<ServerMetrics>({
      usedMemory: 64 * 1024 * 1024,
      usedMemoryHuman: '64.00M',
      connectedClients: 12,
      totalCommandsProcessed: 128904,
      instantaneousOpsPerSec: 420,
      keyspaceHits: 98230,
      keyspaceMisses: 1280,
      hitRate: 98.7,
      uptimeInSeconds: 388800,
      dbKeys: { '0': keys.length, '7': 42 },
    }),
    slowlog: async () => ok<SlowLogEntry[]>([
      { id: 1, timestamp: 1783560000, duration: 1200, command: 'HGET app:user:1001:profile name', clientAddress: '127.0.0.1:53000' },
      { id: 2, timestamp: 1783559900, duration: 980, command: 'SCAN 0 MATCH app:*', clientAddress: '127.0.0.1:53001' },
    ]),
    onMetricsUpdated: () => (() => {}) as Unsubscribe,
  },
}

window.redixAPI.connections = window.redixAPI.connection
window.redixAPI.scanner = window.redixAPI.scan
window.redixAPI.keys = window.redixAPI.key
