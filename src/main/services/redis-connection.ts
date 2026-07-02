import Redis from 'ioredis'
import { EventEmitter } from 'events'
import { ConnectionConfig, ConnectionStatus } from '../../shared/types'
import { APP_CONFIG } from '../../shared/constants'

type RedisClient = Redis | InstanceType<typeof Redis.Cluster>

export class RedisConnection extends EventEmitter {
  private config: ConnectionConfig
  private client: RedisClient | null = null
  private status: ConnectionStatus = 'disconnected'
  private _errorMessage?: string
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(config: ConnectionConfig) {
    super()
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.destroyed) {
      throw new Error('Connection has been destroyed')
    }

    // If already connected, disconnect first
    if (this.client) {
      await this.disconnect()
    }

    this.setStatus('connecting')

    try {
      this.client = this.createClient()
      this.attachListeners(this.client)
      await this.waitForConnection()
      this.setStatus('connected')
      this.startHeartbeat()
    } catch (err) {
      this.setStatus('error', this.classifyError(err))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat()
    if (this.client) {
      try {
        await this.client.quit()
      } catch {
        // Force disconnect if quit fails
        this.client.disconnect()
      }
      this.client = null
    }
    if (!this.destroyed) {
      this.setStatus('disconnected')
    }
  }

  getClient(): RedisClient {
    if (!this.client) {
      throw new Error('Redis client is not connected')
    }
    return this.client
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getConfig(): ConnectionConfig {
    return this.config
  }

  getErrorMessage(): string | undefined {
    return this._errorMessage
  }

  static async testConnection(config: ConnectionConfig): Promise<boolean> {
    const conn = new RedisConnection(config)
    try {
      await conn.connect()
      await conn.disconnect()
      return true
    } catch {
      return false
    } finally {
      conn.destroy()
    }
  }

  destroy(): void {
    this.destroyed = true
    this.stopHeartbeat()
    if (this.client) {
      try {
        this.client.disconnect()
      } catch {
        // Ignore disconnect errors during destroy
      }
      this.client = null
    }
    this.removeAllListeners()
  }

  private createClient(): RedisClient {
    const { type } = this.config

    if (type === 'cluster') {
      return this.createClusterClient()
    }

    if (type === 'sentinel') {
      return this.createSentinelClient()
    }

    return this.createStandaloneClient()
  }

  private createStandaloneClient(): Redis {
    const { host, port, password, db, tls } = this.config

    return new Redis({
      host,
      port,
      password: password || undefined,
      db: db ?? 0,
      tls: tls ? {} : undefined,
      commandTimeout: APP_CONFIG.COMMAND_TIMEOUT,
      retryStrategy: this.retryStrategy.bind(this),
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    })
  }

  private createSentinelClient(): Redis {
    const { password, db, sentinelOptions } = this.config

    if (!sentinelOptions) {
      throw new Error('Sentinel options are required for sentinel connection type')
    }

    return new Redis({
      sentinels: sentinelOptions.sentinels,
      name: sentinelOptions.name,
      password: password || undefined,
      db: db ?? 0,
      commandTimeout: APP_CONFIG.COMMAND_TIMEOUT,
      retryStrategy: this.retryStrategy.bind(this),
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    })
  }

  private createClusterClient(): InstanceType<typeof Redis.Cluster> {
    const { password, clusterOptions } = this.config

    if (!clusterOptions) {
      throw new Error('Cluster options are required for cluster connection type')
    }

    const nodes = clusterOptions.nodes.map((n) => ({
      host: n.host,
      port: n.port,
    }))

    return new Redis.Cluster(nodes, {
      redisOptions: {
        password: password || undefined,
        commandTimeout: APP_CONFIG.COMMAND_TIMEOUT,
      },
      clusterRetryStrategy: this.retryStrategy.bind(this),
      lazyConnect: true,
      enableReadyCheck: true,
      maxRedirections: 16,
    })
  }

  private retryStrategy(times: number): number | null {
    const delay = Math.min(
      APP_CONFIG.RECONNECT_BASE_DELAY * Math.pow(2, times - 1),
      APP_CONFIG.RECONNECT_MAX_DELAY
    )

    this.setStatus('reconnecting')
    return delay
  }

  private attachListeners(client: RedisClient): void {
    client.on('error', (err: Error) => {
      const message = this.classifyError(err)
      this.setStatus('error', message)
      this.emit('error', err)
    })

    client.on('reconnecting', () => {
      this.setStatus('reconnecting')
    })

    client.on('close', () => {
      if (!this.destroyed) {
        this.setStatus('reconnecting')
      }
    })
  }

  private waitForConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const client = this.client
      if (!client) {
        return reject(new Error('Client not initialized'))
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Connection timeout'))
      }, APP_CONFIG.COMMAND_TIMEOUT)

      const onConnect = (): void => {
        cleanup()
        resolve()
      }

      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }

      const cleanup = (): void => {
        clearTimeout(timeout)
        client.removeListener('connect', onConnect)
        client.removeListener('error', onError)
      }

      client.once('connect', onConnect)
      client.once('error', onError)

      // Trigger connection via connect()
      if (client instanceof Redis) {
        client.connect().catch(() => {
          // Error handled by 'error' event
        })
      } else {
        // Cluster also has connect()
        (client as InstanceType<typeof Redis.Cluster>).connect().catch(() => {
          // Error handled by 'error' event
        })
      }
    })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.client && this.status === 'connected') {
        this.client
          .ping()
          .then(() => {
            this.emit('heartbeat', true)
          })
          .catch(() => {
            this.emit('heartbeat', false)
            this.setStatus('error', 'Heartbeat failed')
          })
      }
    }, APP_CONFIG.HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private setStatus(status: ConnectionStatus, errorMessage?: string): void {
    const prevStatus = this.status
    this.status = status
    if (errorMessage !== undefined) {
      this._errorMessage = errorMessage
    } else if (status === 'connected' || status === 'disconnected') {
      this._errorMessage = undefined
    }
    if (prevStatus !== status) {
      this.emit('statusChanged', {
        id: this.config.id,
        status,
        prevStatus,
        errorMessage: this._errorMessage,
      })
    }
  }

  private classifyError(err: unknown): string {
    if (!(err instanceof Error)) {
      return 'Unknown error'
    }

    const message = err.message || ''

    if (message.includes('ECONNREFUSED')) {
      return 'Connection refused: Redis server is not running or unreachable'
    }
    if (message.includes('ETIMEDOUT')) {
      return 'Connection timeout: Redis server did not respond in time'
    }
    if (message.includes('WRONGPASS')) {
      return 'Authentication failed: invalid password'
    }
    if (message.includes('NOAUTH')) {
      return 'Authentication required: password is needed'
    }
    return message
  }
}
