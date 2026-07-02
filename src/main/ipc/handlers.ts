import { ipcMain, BrowserWindow } from 'electron'
import { Redis } from 'ioredis'
import { ConnectionManager } from '../services/connection-manager'
import { SecureStorage } from '../services/secure-storage'
import { CLIExecutor } from '../services/cli-executor'
import { KeyScanner } from '../services/key-scanner'
import { DataViewer } from '../services/data-viewer'
import { ServerMonitor } from '../services/server-monitor'
import { IPC_CHANNELS } from '../../shared/constants'
import type { IPCResponse, ConnectionConfig, ConnectionInfo, CLIResult } from '../../shared/types'
import type { IPCHandlers } from './channels'

/**
 * 构造成功的 IPCResponse
 */
function success<T>(data?: T): IPCResponse<T> {
  return { success: true, data }
}

/**
 * 构造失败的 IPCResponse
 */
function failure(code: string, message: string, details?: string): IPCResponse<never> {
  return { success: false, error: { code, message, details } }
}

/**
 * 从 ConnectionManager 中获取指定连接的 Redis 客户端，找不到则抛出错误
 */
function getRedisClient(connectionManager: ConnectionManager, connectionId: string) {
  const conn = connectionManager.getConnection(connectionId)
  if (!conn) {
    throw new Error(`Connection "${connectionId}" not found or not connected`)
  }
  if (conn.getStatus() !== 'connected') {
    throw new Error(`Connection "${connectionId}" is not connected (status: ${conn.getStatus()})`)
  }
  return conn.getClient()
}

/**
 * 注册所有 IPC handler，在主进程 ready 后调用
 */
export function registerIPCHandlers(
  connectionManager: ConnectionManager,
  storage: SecureStorage,
  mainWindow: BrowserWindow
): void {
  const cliExecutor = new CLIExecutor()
  const keyScanner = new KeyScanner()
  const dataViewer = new DataViewer()
  const serverMonitor = new ServerMonitor()

  // ── 监听连接状态变化，推送到渲染进程 ──────────────────────
  connectionManager.on('connectionStatusChanged', (data) => {
    try {
      mainWindow.webContents.send(IPC_CHANNELS.CONNECTION_STATUS_CHANGED, data)
    } catch {
      // 窗口可能已关闭，忽略
    }
  })

  // ── 连接管理 ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_LIST,
    async (): Promise<IPCResponse<IPCHandlers['connection:list']['result']>> => {
      try {
        const configs = storage.getConnections()
        const infos: ConnectionInfo[] = configs.map((config) => {
          const conn = connectionManager.getConnection(config.id)
          return conn
            ? { config, status: conn.getStatus(), errorMessage: conn.getErrorMessage() }
            : { config, status: 'disconnected' as const }
        })
        return success(infos)
      } catch (err) {
        return failure('STORAGE_ERROR', 'Failed to load connections', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_ADD,
    async (_e, config: ConnectionConfig): Promise<IPCResponse<IPCHandlers['connection:add']['result']>> => {
      try {
        storage.addConnection(config)
        await connectionManager.addConnection(config)
        const info = connectionManager.getConnectionInfo(config.id)
        return success(info!)
      } catch (err) {
        // 回滚：连接失败时从 storage 移除
        try {
          storage.deleteConnection(config.id)
        } catch {
          // 忽略回滚错误
        }
        return failure('ADD_FAILED', 'Failed to add connection', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_UPDATE,
    async (_e, config: ConnectionConfig): Promise<IPCResponse<IPCHandlers['connection:update']['result']>> => {
      // 保存旧配置用于回滚
      const oldConfig = storage.getConnection(config.id)
      try {
        storage.updateConnection(config)
        // 重连：先移除旧连接，再用新配置连接
        const existing = connectionManager.getConnection(config.id)
        if (existing) {
          await connectionManager.removeConnection(config.id)
        }
        await connectionManager.addConnection(config)
        const info = connectionManager.getConnectionInfo(config.id)
        return success(info!)
      } catch (err) {
        // 回滚：恢复旧配置
        if (oldConfig) {
          try {
            storage.updateConnection(oldConfig)
          } catch {
            // 忽略回滚错误
          }
        }
        return failure('UPDATE_FAILED', 'Failed to update connection', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_DELETE,
    async (_e, id: string): Promise<IPCResponse<IPCHandlers['connection:delete']['result']>> => {
      try {
        // 先断开运行中的连接（忽略"不存在"错误）
        try {
          await connectionManager.removeConnection(id)
        } catch {
          // 连接可能本来就没连上
        }
        storage.deleteConnection(id)
        return success()
      } catch (err) {
        return failure('DELETE_FAILED', 'Failed to delete connection', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_TEST,
    async (_e, config: ConnectionConfig): Promise<IPCResponse<IPCHandlers['connection:test']['result']>> => {
      try {
        const result = await connectionManager.testConnection(config)
        return success(result)
      } catch (err) {
        return failure('TEST_FAILED', 'Failed to test connection', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_CONNECT,
    async (_e, id: string): Promise<IPCResponse<IPCHandlers['connection:connect']['result']>> => {
      try {
        const config = storage.getConnection(id)
        if (!config) {
          return failure('NOT_FOUND', `Connection "${id}" not found in storage`)
        }
        // 如果已经存在连接，先断开
        const existing = connectionManager.getConnection(id)
        if (existing) {
          await connectionManager.removeConnection(id)
        }
        await connectionManager.addConnection(config)
        return success()
      } catch (err) {
        return failure('CONNECT_FAILED', 'Failed to connect', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_DISCONNECT,
    async (_e, id: string): Promise<IPCResponse<IPCHandlers['connection:disconnect']['result']>> => {
      try {
        await connectionManager.removeConnection(id)
        return success()
      } catch (err) {
        return failure('DISCONNECT_FAILED', 'Failed to disconnect', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_STATUS,
    async (_e, id: string): Promise<IPCResponse<IPCHandlers['connection:status']['result']>> => {
      try {
        const info = connectionManager.getConnectionInfo(id)
        if (!info) {
          return success({ status: 'disconnected' })
        }
        return success({ status: info.status, error: info.errorMessage })
      } catch (err) {
        return failure('STATUS_ERROR', 'Failed to get status', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_SELECT_DB,
    async (_e, connectionId: string, db: number): Promise<IPCResponse<IPCHandlers['connection:select-db']['result']>> => {
      try {
        const result = await connectionManager.selectDb(connectionId, db)
        return success(result)
      } catch (err) {
        return failure('SELECT_DB_ERROR', 'Failed to select database', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CONNECTION_DB_SIZES,
    async (_e, connectionId: string): Promise<IPCResponse<IPCHandlers['connection:db-sizes']['result']>> => {
      try {
        const sizes = await connectionManager.getDbSizes(connectionId)
        return success(sizes)
      } catch (err) {
        return failure('DB_SIZES_ERROR', 'Failed to get database sizes', errMsg(err))
      }
    }
  )

  // ── Key 浏览 ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.SCAN_START,
    async (_e, connectionId: string, pattern?: string, typeFilter?: string): Promise<IPCResponse<IPCHandlers['scan:start']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const result = await keyScanner.startScan(connectionId, client, pattern, typeFilter)
        return success(result)
      } catch (err) {
        return failure('SCAN_ERROR', 'Scan failed', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SCAN_NEXT,
    async (_e, sessionId: string): Promise<IPCResponse<IPCHandlers['scan:next']['result']>> => {
      try {
        // 从 sessionId 中提取 connectionId（格式: connectionId:timestamp:random）
        const connectionId = sessionId.split(':')[0]
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const result = await keyScanner.getNextPage(sessionId, client)
        return success(result)
      } catch (err) {
        return failure('SCAN_ERROR', 'Scan next failed', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SCAN_SEARCH,
    async (_e, connectionId: string, pattern: string): Promise<IPCResponse<IPCHandlers['scan:search']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const keys = await keyScanner.searchKeys(client, pattern)
        return success({ keys, cursor: '0', hasMore: false, totalScanned: keys.length })
      } catch (err) {
        return failure('SCAN_ERROR', 'Search failed', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SCAN_CANCEL,
    async (_e, sessionId: string): Promise<IPCResponse<IPCHandlers['scan:cancel']['result']>> => {
      try {
        keyScanner.cancelScan(sessionId)
        return success()
      } catch (err) {
        return failure('SCAN_ERROR', 'Cancel failed', errMsg(err))
      }
    }
  )

  // ── Key 操作 ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.KEY_INFO,
    async (_e, connectionId: string, key: string): Promise<IPCResponse<IPCHandlers['key:info']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId)
        const info = await dataViewer.getKeyInfo(client, key)
        return success(info)
      } catch (err) {
        return failure('KEY_ERROR', 'Failed to get key info', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.KEY_DELETE,
    async (_e, connectionId: string, key: string): Promise<IPCResponse<IPCHandlers['key:delete']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId)
        await dataViewer.deleteKey(client, key)
        return success()
      } catch (err) {
        return failure('KEY_ERROR', 'Failed to delete key', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.KEY_RENAME,
    async (_e, connectionId: string, oldKey: string, newKey: string): Promise<IPCResponse<IPCHandlers['key:rename']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId)
        await dataViewer.renameKey(client, oldKey, newKey)
        return success()
      } catch (err) {
        return failure('KEY_ERROR', 'Failed to rename key', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.KEY_SET_TTL,
    async (_e, connectionId: string, key: string, ttl: number): Promise<IPCResponse<IPCHandlers['key:set-ttl']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId)
        await dataViewer.setTTL(client, key, ttl)
        return success()
      } catch (err) {
        return failure('KEY_ERROR', 'Failed to set TTL', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.KEY_ADD,
    async (_e, connectionId: string, key: string, type: string, value?: unknown): Promise<IPCResponse<IPCHandlers['key:add']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        switch (type) {
          case 'string':
            await client.set(key, String(value ?? ''))
            break
          case 'hash': {
            const fields = value as Record<string, string>
            if (fields && typeof fields === 'object') {
              for (const [f, v] of Object.entries(fields)) {
                await client.hset(key, f, v)
              }
            }
            break
          }
          case 'list': {
            const items = Array.isArray(value) ? value.map(String) : [String(value ?? '')]
            if (items.length > 0) {
              await client.rpush(key, ...items)
            }
            break
          }
          case 'set': {
            const members = Array.isArray(value) ? value.map(String) : [String(value ?? '')]
            if (members.length > 0) {
              await client.sadd(key, ...members)
            }
            break
          }
          case 'zset': {
            const members = value as Array<{ member: string; score: number }>
            if (Array.isArray(members)) {
              for (const m of members) {
                await client.zadd(key, m.score, m.member)
              }
            }
            break
          }
          case 'stream': {
            const fields = value as Record<string, string>
            if (fields && typeof fields === 'object') {
              await dataViewer.addStreamEntry(client, key, fields)
            }
            break
          }
          default:
            return failure('KEY_ERROR', `Unsupported key type: ${type}`)
        }
        return success()
      } catch (err) {
        return failure('KEY_ERROR', 'Failed to add key', errMsg(err))
      }
    }
  )

  // ── 数据操作 ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.DATA_VIEW,
    async (_e, connectionId: string, key: string, options?: unknown): Promise<IPCResponse<IPCHandlers['data:view']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const opts = (options ?? {}) as { type?: string; cursor?: string; count?: number; start?: number | string }
        const type = opts.type ?? (await client.type(key))
        const cursor = opts.cursor ?? '0'
        const count = opts.count ?? 100

        switch (type) {
          case 'string': {
            const result = await dataViewer.getString(client, key)
            return success({ items: [result.value], hasMore: false, totalCount: 1 } as never)
          }
          case 'hash': {
            const result = await dataViewer.getHashFields(client, key, cursor, count)
            return success(result as never)
          }
          case 'list': {
            const start = typeof opts.start === 'number' ? opts.start : 0
            const result = await dataViewer.getListElements(client, key, start, count)
            return success(result as never)
          }
          case 'set': {
            const result = await dataViewer.getSetMembers(client, key, cursor, count)
            return success(result as never)
          }
          case 'zset': {
            const result = await dataViewer.getZSetMembers(client, key, cursor, count)
            return success(result as never)
          }
          case 'stream': {
            const start = typeof opts.start === 'string' ? opts.start : '-'
            const result = await dataViewer.getStreamEntries(client, key, start, count)
            return success(result as never)
          }
          default:
            return failure('DATA_ERROR', `Unsupported type: ${type}`)
        }
      } catch (err) {
        return failure('DATA_ERROR', 'Failed to view data', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_UPDATE,
    async (_e, connectionId: string, key: string, changes: unknown): Promise<IPCResponse<IPCHandlers['data:update']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const type = await client.type(key)
        const c = changes as { type?: string; value?: unknown; index?: number; field?: string; member?: string; score?: number; position?: 'head' | 'tail' }

        const actualType = c.type ?? type
        switch (actualType) {
          case 'string':
            await client.set(key, String(c.value ?? ''))
            break
          case 'list':
            if (c.index !== undefined) {
              await dataViewer.setListElement(client, key, c.index, String(c.value ?? ''))
            }
            break
          case 'hash':
            if (c.field !== undefined) {
              await dataViewer.setHashField(client, key, c.field, String(c.value ?? ''))
            }
            break
          case 'zset':
            if (c.member !== undefined && c.score !== undefined) {
              await dataViewer.updateZSetScore(client, key, c.member, c.score)
            }
            break
          default:
            return failure('DATA_ERROR', `Update not supported for type: ${actualType}`)
        }
        return success()
      } catch (err) {
        return failure('DATA_ERROR', 'Failed to update data', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_ADD_FIELD,
    async (_e, connectionId: string, key: string, field: unknown, value?: unknown): Promise<IPCResponse<IPCHandlers['data:add-field']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const type = await client.type(key)
        const v = value as { position?: 'head' | 'tail'; fields?: Record<string, string> }

        switch (type) {
          case 'hash':
            await dataViewer.setHashField(client, key, String(field), String(value ?? ''))
            break
          case 'list': {
            const position = v?.position ?? 'tail'
            await dataViewer.addListElement(client, key, String(field), position)
            break
          }
          case 'set':
            await dataViewer.addSetMember(client, key, String(field))
            break
          case 'zset': {
            const score = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
            await dataViewer.addZSetMember(client, key, String(field), score)
            break
          }
          case 'stream': {
            const fields = typeof field === 'object' && field !== null
              ? field as Record<string, string>
              : { [String(field)]: String(value ?? '') }
            await dataViewer.addStreamEntry(client, key, fields)
            break
          }
          default:
            return failure('DATA_ERROR', `Add field not supported for type: ${type}`)
        }
        return success()
      } catch (err) {
        return failure('DATA_ERROR', 'Failed to add field', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.DATA_DELETE_FIELD,
    async (_e, connectionId: string, key: string, field: string): Promise<IPCResponse<IPCHandlers['data:delete-field']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const type = await client.type(key)

        switch (type) {
          case 'hash':
            await dataViewer.deleteHashField(client, key, field)
            break
          case 'list': {
            const index = parseInt(field, 10)
            if (isNaN(index)) {
              return failure('DATA_ERROR', 'List index must be a number')
            }
            await dataViewer.deleteListElement(client, key, index)
            break
          }
          case 'set':
            await dataViewer.removeSetMember(client, key, field)
            break
          case 'zset':
            await dataViewer.removeZSetMember(client, key, field)
            break
          default:
            return failure('DATA_ERROR', `Delete field not supported for type: ${type}`)
        }
        return success()
      } catch (err) {
        return failure('DATA_ERROR', 'Failed to delete field', errMsg(err))
      }
    }
  )

  // ── CLI ────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CLI_EXECUTE,
    async (_e, connectionId: string, command: string): Promise<IPCResponse<CLIResult>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId)
        const result = await cliExecutor.executeCommand(client, command)
        return success(result)
      } catch (err) {
        return failure('CLI_ERROR', 'Failed to execute CLI command', errMsg(err))
      }
    }
  )

  // ── 服务器 ─────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.SERVER_INFO,
    async (_e, connectionId: string): Promise<IPCResponse<IPCHandlers['server:info']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const info = await serverMonitor.getInfo(client)
        return success(info)
      } catch (err) {
        return failure('SERVER_ERROR', 'Failed to get server info', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SERVER_METRICS,
    async (_e, connectionId: string): Promise<IPCResponse<IPCHandlers['server:metrics']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const metrics = await serverMonitor.getMetrics(client)
        return success(metrics)
      } catch (err) {
        return failure('SERVER_ERROR', 'Failed to get server metrics', errMsg(err))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SERVER_SLOWLOG,
    async (_e, connectionId: string, count?: number): Promise<IPCResponse<IPCHandlers['server:slowlog']['result']>> => {
      try {
        const client = getRedisClient(connectionManager, connectionId) as Redis
        const entries = await serverMonitor.getSlowLog(client, count)
        return success(entries)
      } catch (err) {
        return failure('SERVER_ERROR', 'Failed to get slowlog', errMsg(err))
      }
    }
  )
}

/**
 * 从未知错误中提取消息字符串
 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
