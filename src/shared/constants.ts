// IPC 通道名称
export const IPC_CHANNELS = {
  // 连接管理
  CONNECTION_LIST: 'connection:list',
  CONNECTION_ADD: 'connection:add',
  CONNECTION_UPDATE: 'connection:update',
  CONNECTION_DELETE: 'connection:delete',
  CONNECTION_TEST: 'connection:test',
  CONNECTION_CONNECT: 'connection:connect',
  CONNECTION_DISCONNECT: 'connection:disconnect',
  CONNECTION_STATUS: 'connection:status',
  CONNECTION_STATUS_CHANGED: 'connection:status-changed',
  CONNECTION_SELECT_DB: 'connection:select-db',
  CONNECTION_DB_SIZES: 'connection:db-sizes',

  // Key 浏览
  SCAN_START: 'scan:start',
  SCAN_NEXT: 'scan:next',
  SCAN_SEARCH: 'scan:search',
  SCAN_CANCEL: 'scan:cancel',
  KEY_INFO: 'key:info',
  KEY_DELETE: 'key:delete',
  KEY_RENAME: 'key:rename',
  KEY_SET_TTL: 'key:set-ttl',
  KEY_ADD: 'key:add',

  // 数据查看
  DATA_VIEW: 'data:view',
  DATA_UPDATE: 'data:update',
  DATA_ADD_FIELD: 'data:add-field',
  DATA_DELETE_FIELD: 'data:delete-field',

  // CLI
  CLI_EXECUTE: 'cli:execute',

  // 服务器
  SERVER_INFO: 'server:info',
  SERVER_METRICS: 'server:metrics',
  SERVER_SLOWLOG: 'server:slowlog',
  SERVER_METRICS_UPDATED: 'server:metrics-updated',
} as const;

// 应用常量
export const APP_CONFIG = {
  DEFAULT_SCAN_COUNT: 200,
  DEFAULT_PAGE_SIZE: 100,
  MAX_VALUE_DISPLAY_SIZE: 1024 * 1024, // 1MB
  COMMAND_TIMEOUT: 5000,
  HEARTBEAT_INTERVAL: 30000,
  RECONNECT_BASE_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,
  METRICS_REFRESH_INTERVAL: 3000,
  SLOWLOG_REFRESH_INTERVAL: 10000,
  MAX_PARALLEL_CONNECTIONS: 20,
  VIRTUAL_LIST_ROW_HEIGHT: 36,
  PREFETCH_THRESHOLD: 100,
} as const;

// 危险命令列表
export const DANGEROUS_COMMANDS = [
  'FLUSHALL',
  'FLUSHDB',
  'CONFIG',
  'DEBUG',
  'SHUTDOWN',
  'SLAVEOF',
  'REPLICAOF',
  'MODULE',
] as const;
