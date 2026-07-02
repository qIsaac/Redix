import { Redis } from 'ioredis'
import { KeyInfo, ScanResult } from '../../shared/types'
import { APP_CONFIG } from '../../shared/constants'

interface ScanSession {
  cursor: string
  pattern: string
  typeFilter?: string
  exhausted: boolean
  connectionId: string
  totalScanned: number
}

const SAFE_KEYS_LIMIT = 10000

export class KeyScanner {
  private sessions: Map<string, ScanSession> = new Map()

  /**
   * Start a new SCAN session. Returns sessionId + first page of results.
   * Uses SCAN cursor COUNT 200 MATCH pattern. If typeFilter is provided
   * and Redis version >= 7.0, uses SCAN ... TYPE type; otherwise filters in-result.
   */
  async startScan(
    connectionId: string,
    client: Redis,
    pattern: string = '*',
    typeFilter?: string
  ): Promise<{ sessionId: string } & ScanResult> {
    const sessionId = this.generateSessionId(connectionId)

    const session: ScanSession = {
      cursor: '0',
      pattern,
      typeFilter,
      exhausted: false,
      connectionId,
      totalScanned: 0,
    }

    this.sessions.set(sessionId, session)

    const result = await this.fetchNextPage(client, session)

    return {
      sessionId,
      ...result,
    }
  }

  /**
   * Get next page of an existing SCAN session.
   */
  async getNextPage(sessionId: string, client: Redis): Promise<ScanResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Scan session "${sessionId}" not found or already cancelled`)
    }
    if (session.exhausted) {
      return { keys: [], cursor: '0', hasMore: false, totalScanned: session.totalScanned }
    }
    return this.fetchNextPage(client, session)
  }

  /**
   * Cancel a SCAN session and release resources.
   */
  cancelScan(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Search keys using SCAN + MATCH (never KEYS for safety).
   * Enforces SAFE_KEYS_LIMIT: if estimated key count > 10000, uses SCAN only.
   */
  async searchKeys(client: Redis, pattern: string): Promise<KeyInfo[]> {
    const allKeys: string[] = []
    let cursor = '0'

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        APP_CONFIG.DEFAULT_SCAN_COUNT
      )
      cursor = nextCursor
      allKeys.push(...keys)

      // Safety: stop if too many keys to prevent memory blow-up
      if (allKeys.length > SAFE_KEYS_LIMIT) {
        break
      }
    } while (cursor !== '0')

    if (allKeys.length === 0) {
      return []
    }

    return this.batchGetKeyInfo(client, allKeys)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Core pagination loop: keeps calling SCAN until we accumulate enough keys
   * or the cursor returns to '0'. Redis SCAN may return empty arrays on each
   * call, so we loop to fill a meaningful page.
   */
  private async fetchNextPage(client: Redis, session: ScanSession): Promise<ScanResult> {
    const keys: string[] = []
    const targetCount = APP_CONFIG.DEFAULT_SCAN_COUNT

    while (keys.length < targetCount) {
      // Build SCAN args: cursor is the first positional param, rest via spread
      const scanArgs: (string | number)[] = [
        'MATCH', session.pattern,
        'COUNT', APP_CONFIG.DEFAULT_SCAN_COUNT,
      ]

      // Redis 7.0+ supports SCAN ... TYPE type
      if (session.typeFilter) {
        scanArgs.push('TYPE', session.typeFilter)
      }

      const [nextCursor, batch] = await client.call(
        'SCAN', session.cursor, ...scanArgs
      ) as [string, string[]]

      session.cursor = nextCursor
      session.totalScanned += batch.length

      // Filter by type locally if TYPE arg is not supported or as extra guard
      let filteredBatch = batch
      if (session.typeFilter) {
        // We still filter locally in case the server ignored the TYPE arg
        const types = await this.batchGetType(client, batch)
        filteredBatch = batch.filter((_, i) => types[i] === session.typeFilter)
      }

      keys.push(...filteredBatch)

      if (session.cursor === '0') {
        session.exhausted = true
        break
      }
    }

    const keyInfos = keys.length > 0 ? await this.batchGetKeyInfo(client, keys) : []

    return {
      keys: keyInfos,
      cursor: session.cursor,
      hasMore: !session.exhausted,
      totalScanned: session.totalScanned,
    }
  }

  /**
   * Use pipeline to batch TYPE + PTTL for all keys in one RTT.
   */
  private async batchGetKeyInfo(client: Redis, keys: string[]): Promise<KeyInfo[]> {
    if (keys.length === 0) return []

    const pipeline = client.pipeline()
    for (const k of keys) {
      pipeline.type(k)
      pipeline.pttl(k)
    }

    const results = await pipeline.exec()
    if (!results) return []

    const infos: KeyInfo[] = []
    for (let i = 0; i < keys.length; i++) {
      const typeResult = results[i * 2]
      const ttlResult = results[i * 2 + 1]

      const type = typeResult?.[1] as string | undefined ?? 'unknown'
      const ttl = ttlResult?.[1] as number | undefined ?? -2

      infos.push({ key: keys[i], type, ttl })
    }

    return infos
  }

  /**
   * Batch TYPE for an array of keys (used for local type filtering).
   */
  private async batchGetType(client: Redis, keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []

    const pipeline = client.pipeline()
    for (const k of keys) {
      pipeline.type(k)
    }

    const results = await pipeline.exec()
    if (!results) return keys.map(() => 'none')

    return results.map((r) => (r?.[1] as string) ?? 'none')
  }

  private generateSessionId(connectionId: string): string {
    return `${connectionId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  }
}
