// 连接配置
export interface ConnectionConfig {
  id: string;
  name: string;
  type: 'standalone' | 'sentinel' | 'cluster';
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls?: boolean;
  sentinelOptions?: {
    name: string;
    sentinels: { host: string; port: number }[];
  };
  clusterOptions?: {
    nodes: { host: string; port: number }[];
  };
}

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// 连接信息（包含运行时状态）
export interface ConnectionInfo {
  config: ConnectionConfig;
  status: ConnectionStatus;
  serverInfo?: Record<string, string>;
  errorMessage?: string;
}

// Key 信息
export interface KeyInfo {
  key: string;
  type: string;
  ttl: number;  // -1: no expiry, -2: key doesn't exist
  memory?: number | null;
}

// SCAN 结果
export interface ScanResult {
  keys: KeyInfo[];
  cursor: string;
  hasMore: boolean;
  totalScanned?: number;
}

// 通用分页结果
export interface DataPage<T> {
  items: T[];
  cursor?: string;
  hasMore: boolean;
  totalCount?: number;
}

// Hash 字段
export interface HashField {
  field: string;
  value: string;
}

// ZSet 成员
export interface ZSetMember {
  member: string;
  score: number;
}

// Stream 条目
export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

// IPC 响应
export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// CLI 执行结果
export interface CLIResult {
  command: string;
  result: string;
  isError: boolean;
  isWarning: boolean;
}

// 服务器指标
export interface ServerMetrics {
  usedMemory: number;
  usedMemoryHuman: string;
  connectedClients: number;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number;
  uptimeInSeconds: number;
  dbKeys: Record<string, number>;
}

// 慢查询日志
export interface SlowLogEntry {
  id: number;
  timestamp: number;
  duration: number;  // microseconds
  command: string;
  clientAddress: string;
}
