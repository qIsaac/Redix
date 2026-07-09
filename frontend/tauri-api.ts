import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

type Unsubscribe = () => void;
type ConnectionTestResult = { success: boolean; error?: string };
type SelectDbResult = { success: boolean; data?: { db: number }; error?: { message: string } };
type DbSizesResult = { success: boolean; data?: Record<string, number>; error?: { message: string } };
type StatusChangedPayload = { id: string; status: string; error?: string };
const CONNECTION_STATUS_EVENT = 'connection-status-changed';

function call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

const connectionsAPI = {
  list: () => call('connection_list'),
  add: (config: unknown) => call('connection_add', { config }),
  update: (config: unknown) => call('connection_update', { config }),
  delete: (id: string) => call('connection_delete', { id }),
  test: (config: unknown) => call<ConnectionTestResult>('connection_test', { config }),
  connect: (id: string) => call('connection_connect', { id }),
  disconnect: (id: string) => call('connection_disconnect', { id }),
  getStatus: (id: string) => call('connection_status', { id }),
  selectDb: (connectionId: string, db: number) =>
    call<SelectDbResult>('connection_select_db', { connectionId, db }),
  getDbSizes: (connectionId: string) =>
    call<DbSizesResult>('connection_db_sizes', { connectionId }),
  onStatusChanged: (callback: (data: StatusChangedPayload) => void): Unsubscribe => {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    void listen<StatusChangedPayload>(CONNECTION_STATUS_EVENT, (event) => {
      if (active) callback(event.payload);
    })
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {
        // Status events are best-effort; command responses still update critical states.
      });

    return () => {
      active = false;
      unlisten?.();
    };
  },
};

const scanAPI = {
  start: (connectionId: string, pattern?: string, typeFilter?: string, db?: number) =>
    call('scan_start', { connectionId, pattern, typeFilter, db }),
  next: (sessionId: string, _connectionId?: string) =>
    call('scan_next', { sessionId }),
  search: (connectionId: string, pattern: string) =>
    call('scan_search', { connectionId, pattern }),
  cancel: (sessionId: string) => call('scan_cancel', { sessionId }),
};

const keyAPI = {
  info: (connectionId: string, key: string) => call('key_info', { connectionId, key }),
  delete: (connectionId: string, key: string) => call('key_delete', { connectionId, key }),
  rename: (connectionId: string, key: string, newKey: string) =>
    call('key_rename', { connectionId, key, newKey }),
  setTTL: (connectionId: string, key: string, ttl: number) =>
    call('key_set_ttl', { connectionId, key, ttl }),
  add: (connectionId: string, key: string, type: string, value?: unknown) =>
    call('key_add', { connectionId, key, keyType: type, value }),
};

const dataAPI = {
  view: (connectionId: string, key: string, options?: unknown) =>
    call('data_view', { connectionId, key, options }),
  update: (connectionId: string, key: string, value: unknown) =>
    call('data_update', { connectionId, key, changes: value }),
  addField: (connectionId: string, key: string, field: unknown, value?: unknown) =>
    call('data_add_field', { connectionId, key, field, value }),
  deleteField: (connectionId: string, key: string, field: string) =>
    call('data_delete_field', { connectionId, key, field }),
};

const cliAPI = {
  execute: (connectionId: string, command: string, confirmed?: boolean) =>
    call('cli_execute', { connectionId, command, confirmed }),
  completeKeys: (connectionId: string, prefix: string, limit?: number, typeFilter?: string) =>
    call('cli_complete_keys', { connectionId, prefix, limit, typeFilter }),
  completeHashFields: (connectionId: string, key: string, prefix: string, limit?: number) =>
    call('cli_complete_hash_fields', { connectionId, key, prefix, limit }),
  completeMembers: (connectionId: string, key: string, prefix: string, kind: string, limit?: number) =>
    call('cli_complete_members', { connectionId, key, prefix, kind, limit }),
};

const clipboardAPI = {
  writeText: (text: string) => {
    void writeText(text);
  },
  readText: () => readText(),
};

const serverAPI = {
  info: (connectionId: string) => call('server_info', { connectionId }),
  metrics: (connectionId: string) => call('server_metrics', { connectionId }),
  slowlog: (connectionId: string, count?: number) =>
    call('server_slowlog', { connectionId, count }),
  onMetricsUpdated: (_callback: (data: unknown) => void): Unsubscribe => {
    return () => {};
  },
};

const api: Window['redixAPI'] = {
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
};

window.redixAPI = api;
