import { EventEmitter } from 'events'
import { RedisConnection } from './redis-connection'
import { ConnectionConfig, ConnectionStatus, ConnectionInfo } from '../../shared/types'
import { APP_CONFIG } from '../../shared/constants'

export class ConnectionManager extends EventEmitter {
  private connections: Map<string, RedisConnection> = new Map()

  async addConnection(config: ConnectionConfig): Promise<ConnectionInfo> {
    if (this.connections.size >= APP_CONFIG.MAX_PARALLEL_CONNECTIONS) {
      throw new Error(
        `Maximum number of connections (${APP_CONFIG.MAX_PARALLEL_CONNECTIONS}) reached`
      )
    }

    if (this.connections.has(config.id)) {
      throw new Error(`Connection with id "${config.id}" already exists`)
    }

    const conn = new RedisConnection(config)
    this.connections.set(config.id, conn)

    // Forward status changes from the connection
    conn.on('statusChanged', (data) => {
      this.emit('connectionStatusChanged', data)
    })

    await conn.connect()
    return this.buildConnectionInfo(conn)
  }

  async removeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) {
      throw new Error(`Connection with id "${id}" not found`)
    }

    await conn.disconnect()
    conn.destroy()
    this.connections.delete(id)
  }

  getConnection(id: string): RedisConnection | undefined {
    return this.connections.get(id)
  }

  getConnectionInfo(id: string): ConnectionInfo | undefined {
    const conn = this.connections.get(id)
    if (!conn) return undefined
    return this.buildConnectionInfo(conn)
  }

  getAllConnections(): ConnectionInfo[] {
    const infos: ConnectionInfo[] = []
    this.connections.forEach((conn) => {
      infos.push(this.buildConnectionInfo(conn))
    })
    return infos
  }

  async reconnect(id: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) {
      throw new Error(`Connection with id "${id}" not found`)
    }

    await conn.disconnect()
    await conn.connect()
  }

  async selectDb(id: string, db: number): Promise<{ db: number }> {
    const conn = this.connections.get(id)
    if (!conn) {
      throw new Error(`Connection with id "${id}" not found`)
    }
    if (conn.getStatus() !== 'connected') {
      throw new Error(`Connection "${id}" is not connected`)
    }
    const client = conn.getClient()
    // Cluster mode doesn't support SELECT
    if ('select' in client) {
      await client.select(db)
    } else {
      throw new Error('SELECT is not supported in cluster mode')
    }
    return { db }
  }

  async testConnection(
    config: ConnectionConfig
  ): Promise<{ success: boolean; error?: string }> {
    const conn = new RedisConnection(config)
    try {
      await conn.connect()
      await conn.disconnect()
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    } finally {
      conn.destroy()
    }
  }

  async getDbSizes(id: string): Promise<Record<string, number>> {
    const conn = this.connections.get(id)
    if (!conn) {
      throw new Error(`Connection with id "${id}" not found`)
    }
    if (conn.getStatus() !== 'connected') {
      throw new Error(`Connection "${id}" is not connected`)
    }
    const client = conn.getClient()
    const result: Record<string, number> = {}
    // Initialize all 16 dbs to 0
    for (let i = 0; i < 16; i++) {
      result[`db${i}`] = 0
    }
    try {
      const info = await client.info('keyspace')
      // Parse INFO keyspace output:
      // db0:keys=12345,expires=100,avg_ttl=1234
      const lines = info.split('\n')
      for (const line of lines) {
        const match = line.match(/^(db\d+):keys=(\d+)/)
        if (match) {
          result[match[1]] = parseInt(match[2], 10)
        }
      }
    } catch {
      // If INFO keyspace fails, try DBSIZE for current db only
      try {
        if ('dbsize' in client) {
          const size = await client.dbsize()
          result['db0'] = size
        }
      } catch {
        // Ignore — return all zeros
      }
    }
    return result
  }

  destroyAll(): void {
    this.connections.forEach((conn) => {
      conn.destroy()
    })
    this.connections.clear()
    this.removeAllListeners()
  }

  private buildConnectionInfo(conn: RedisConnection): ConnectionInfo {
    const config = conn.getConfig()
    const status: ConnectionStatus = conn.getStatus()
    const errorMessage = conn.getErrorMessage()
    return { config, status, errorMessage }
  }
}
