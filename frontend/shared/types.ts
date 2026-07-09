// 连接配置
export interface ConnectionConfig {
  id: string;
  name: string;
  type: 'standalone' | 'sentinel' | 'cluster';
  host: string;
  port: number;
  password?: string;
  hasPassword?: boolean;
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
  connectionId?: string;
  db?: number;
}

// SCAN 结果
export interface ScanResult {
  keys: KeyInfo[];
  cursor: string;
  hasMore: boolean;
  totalScanned?: number;
  connectionId?: string;
  db?: number;
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
  fieldEncoding?: 'utf8' | 'binary';
  fieldIsBinary?: boolean;
  fieldLength?: number;
  fieldPreviewLength?: number;
  fieldHexDump?: string;
  valueEncoding?: 'utf8' | 'binary';
  valueIsBinary?: boolean;
  valueLength?: number;
  valuePreviewLength?: number;
  valueHexDump?: string;
  valueIsTruncated?: boolean;
}

// Set 成员
export interface SetMember {
  member: string;
  memberEncoding?: 'utf8' | 'binary';
  memberIsBinary?: boolean;
  memberLength?: number;
  memberPreviewLength?: number;
  memberHexDump?: string;
  memberIsTruncated?: boolean;
}

// List 元素
export interface ListElement {
  index: number;
  value: string;
  valueEncoding?: 'utf8' | 'binary';
  valueIsBinary?: boolean;
  valueLength?: number;
  valuePreviewLength?: number;
  valueHexDump?: string;
  valueIsTruncated?: boolean;
}

// ZSet 成员
export interface ZSetMember {
  member: string;
  score: number;
  memberEncoding?: 'utf8' | 'binary';
  memberIsBinary?: boolean;
  memberLength?: number;
  memberPreviewLength?: number;
  memberHexDump?: string;
  memberIsTruncated?: boolean;
}

export interface StreamFieldValue {
  field: string;
  value: string;
  fieldEncoding?: 'utf8' | 'binary';
  fieldIsBinary?: boolean;
  fieldLength?: number;
  fieldPreviewLength?: number;
  fieldHexDump?: string;
  valueEncoding?: 'utf8' | 'binary';
  valueIsBinary?: boolean;
  valueLength?: number;
  valuePreviewLength?: number;
  valueHexDump?: string;
  valueIsTruncated?: boolean;
}

// Stream 条目
export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
  fieldValues?: StreamFieldValue[];
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
  requiresConfirmation?: boolean;
  truncated?: boolean;
}

export interface CLIKeyCompletionResult {
  keys: string[];
  segments?: string[];
  hasMore: boolean;
}

export interface CLIHashFieldCompletionResult {
  fields: string[];
  hasMore: boolean;
}

export interface CLIMemberCompletionResult {
  members: string[];
  hasMore: boolean;
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
