import Store from 'electron-store'
import { safeStorage } from 'electron'
import { ConnectionConfig } from '../../shared/types'

interface StoredConnection {
  id: string
  name: string
  type: 'standalone' | 'sentinel' | 'cluster'
  host: string
  port: number
  db?: number
  tls?: boolean
  passwordEncrypted?: string // base64 编码的加密密码
  sentinelOptions?: ConnectionConfig['sentinelOptions']
  clusterOptions?: ConnectionConfig['clusterOptions']
}

interface StoreSchema {
  connections: StoredConnection[]
  settings: {
    lastConnectionId?: string
    theme?: 'system' | 'light' | 'dark'
    sidebarWidth?: number
  }
}

export class SecureStorage {
  private store: Store<StoreSchema>

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: {
        connections: [],
        settings: {}
      }
    })
  }

  // ── 密码加密/解密 ─────────────────────────────────────

  encryptPassword(password: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage encryption is not available on this system. ' +
        'Please ensure macOS Keychain (or platform equivalent) is accessible.'
      )
    }
    const encrypted: Buffer = safeStorage.encryptString(password)
    return encrypted.toString('base64')
  }

  decryptPassword(encrypted: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage encryption is not available on this system. ' +
        'Cannot decrypt stored passwords.'
      )
    }
    const buffer = Buffer.from(encrypted, 'base64')
    return safeStorage.decryptString(buffer)
  }

  // ── 内部转换 ──────────────────────────────────────────

  /**
   * 将 ConnectionConfig 转为 StoredConnection（加密密码）
   */
  private toStored(config: ConnectionConfig): StoredConnection {
    const stored: StoredConnection = {
      id: config.id,
      name: config.name,
      type: config.type,
      host: config.host,
      port: config.port,
      db: config.db,
      tls: config.tls,
      sentinelOptions: config.sentinelOptions,
      clusterOptions: config.clusterOptions
    }

    if (config.password) {
      stored.passwordEncrypted = this.encryptPassword(config.password)
    }

    return stored
  }

  /**
   * 将 StoredConnection 转为 ConnectionConfig（解密密码）
   */
  private toConfig(stored: StoredConnection): ConnectionConfig {
    const config: ConnectionConfig = {
      id: stored.id,
      name: stored.name,
      type: stored.type,
      host: stored.host,
      port: stored.port,
      db: stored.db,
      tls: stored.tls,
      sentinelOptions: stored.sentinelOptions,
      clusterOptions: stored.clusterOptions
    }

    if (stored.passwordEncrypted) {
      config.password = this.decryptPassword(stored.passwordEncrypted)
    }

    return config
  }

  // ── 连接配置 CRUD ─────────────────────────────────────

  getConnections(): ConnectionConfig[] {
    const stored = this.store.get('connections')
    return stored.map((s) => {
      try {
        return this.toConfig(s)
      } catch {
        // 解密失败时返回不含密码的配置，不影响其他连接
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          host: s.host,
          port: s.port,
          db: s.db,
          tls: s.tls,
          sentinelOptions: s.sentinelOptions,
          clusterOptions: s.clusterOptions,
        } as ConnectionConfig
      }
    })
  }

  getConnection(id: string): ConnectionConfig | undefined {
    const stored = this.store.get('connections')
    const found = stored.find((s) => s.id === id)
    return found ? this.toConfig(found) : undefined
  }

  addConnection(config: ConnectionConfig): void {
    const connections = this.store.get('connections')
    connections.push(this.toStored(config))
    this.store.set('connections', connections)
  }

  updateConnection(config: ConnectionConfig): void {
    const connections = this.store.get('connections')
    const index = connections.findIndex((s) => s.id === config.id)
    if (index === -1) {
      throw new Error(`Connection with id "${config.id}" not found`)
    }
    connections[index] = this.toStored(config)
    this.store.set('connections', connections)
  }

  deleteConnection(id: string): void {
    const connections = this.store.get('connections')
    const filtered = connections.filter((s) => s.id !== id)
    if (filtered.length === connections.length) {
      throw new Error(`Connection with id "${id}" not found`)
    }
    this.store.set('connections', filtered)
  }

  // ── 设置管理 ──────────────────────────────────────────

  getSettings(): StoreSchema['settings'] {
    return this.store.get('settings')
  }

  updateSettings(settings: Partial<StoreSchema['settings']>): void {
    const current = this.store.get('settings')
    this.store.set('settings', { ...current, ...settings })
  }

  getLastConnectionId(): string | undefined {
    return this.store.get('settings').lastConnectionId
  }

  setLastConnectionId(id: string): void {
    this.updateSettings({ lastConnectionId: id })
  }
}
