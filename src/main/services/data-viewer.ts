import { Redis } from 'ioredis'
import { DataPage, HashField, ZSetMember, StreamEntry, KeyInfo } from '../../shared/types'
import { APP_CONFIG } from '../../shared/constants'

// ioredis Redis or Cluster — both expose the same command methods
type RedisClient = Redis | InstanceType<typeof Redis.Cluster>

// ─── String value result ─────────────────────────────────────────────────────
export interface StringValue {
  value: string
  truncated: boolean
  originalLength?: number
}

// ─── Stream info result ──────────────────────────────────────────────────────
export interface StreamInfo {
  length: number
  firstEntry: StreamEntry | null
  lastEntry: StreamEntry | null
  groups: StreamGroupInfo[]
}

export interface StreamGroupInfo {
  name: string
  consumers: number
  pending: number
  lastDeliveredId: string
}

// ─── DataViewer ───────────────────────────────────────────────────────────────
export class DataViewer {
  // ── String ─────────────────────────────────────────────────────────────────

  async getString(client: RedisClient, key: string): Promise<StringValue> {
    const maxlen = APP_CONFIG.MAX_VALUE_DISPLAY_SIZE

    // Get full length first
    const len = await client.strlen(key)

    if (len <= maxlen) {
      const value = await client.get(key)
      return { value: value ?? '', truncated: false }
    }

    // Truncate via GETRANGE
    const value = await client.getrange(key, 0, maxlen - 1)
    return { value, truncated: true, originalLength: len }
  }

  // ── Hash ───────────────────────────────────────────────────────────────────

  async getHashFields(
    client: RedisClient,
    key: string,
    cursor: string = '0',
    count: number = APP_CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<DataPage<HashField>> {
    const [nextCursor, raw] = await client.hscan(key, cursor, 'COUNT', count)

    const fields: HashField[] = []
    for (let i = 0; i < raw.length; i += 2) {
      fields.push({ field: raw[i], value: raw[i + 1] })
    }

    const hasMore = nextCursor !== '0'
    const totalCount = cursor === '0' ? await client.hlen(key) : undefined

    return {
      items: fields,
      cursor: nextCursor,
      hasMore,
      totalCount,
    }
  }

  async setHashField(client: RedisClient, key: string, field: string, value: string): Promise<void> {
    await client.hset(key, field, value)
  }

  async deleteHashField(client: RedisClient, key: string, field: string): Promise<void> {
    await client.hdel(key, field)
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async getListElements(
    client: RedisClient,
    key: string,
    start: number = 0,
    count: number = APP_CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<DataPage<string>> {
    const stop = start + count - 1
    const [elements, total] = await Promise.all([
      client.lrange(key, start, stop),
      client.llen(key),
    ])

    const hasMore = start + elements.length < total

    return {
      items: elements,
      hasMore,
      totalCount: total,
    }
  }

  async setListElement(client: RedisClient, key: string, index: number, value: string): Promise<void> {
    await client.lset(key, index, value)
  }

  async addListElement(
    client: RedisClient,
    key: string,
    value: string,
    position: 'head' | 'tail'
  ): Promise<number> {
    if (position === 'head') {
      return client.lpush(key, value)
    }
    return client.rpush(key, value)
  }

  /**
   * Delete a list element at a given index.
   * Strategy: LSET to a sentinel value then LREM to remove it.
   */
  async deleteListElement(client: RedisClient, key: string, index: number): Promise<void> {
    // Use a unique sentinel unlikely to appear in real data
    const sentinel = `__REDIS_PRO_DELETED_${Date.now()}_${Math.random().toString(36).slice(2)}__`
    await client.lset(key, index, sentinel)
    await client.lrem(key, 1, sentinel)
  }

  // ── Set ────────────────────────────────────────────────────────────────────

  async getSetMembers(
    client: RedisClient,
    key: string,
    cursor: string = '0',
    count: number = APP_CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<DataPage<string>> {
    const [nextCursor, members] = await client.sscan(key, cursor, 'COUNT', count)

    const hasMore = nextCursor !== '0'
    const totalCount = cursor === '0' ? await client.scard(key) : undefined

    return {
      items: members,
      cursor: nextCursor,
      hasMore,
      totalCount,
    }
  }

  async addSetMember(client: RedisClient, key: string, member: string): Promise<number> {
    return client.sadd(key, member)
  }

  async removeSetMember(client: RedisClient, key: string, member: string): Promise<number> {
    return client.srem(key, member)
  }

  // ── Sorted Set ─────────────────────────────────────────────────────────────

  async getZSetMembers(
    client: RedisClient,
    key: string,
    cursor: string = '0',
    count: number = APP_CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<DataPage<ZSetMember>> {
    const [nextCursor, raw] = await client.zscan(key, cursor, 'COUNT', count)

    const members: ZSetMember[] = []
    for (let i = 0; i < raw.length; i += 2) {
      members.push({ member: raw[i], score: parseFloat(raw[i + 1]) })
    }

    const hasMore = nextCursor !== '0'
    const totalCount = cursor === '0' ? await client.zcard(key) : undefined

    return {
      items: members,
      cursor: nextCursor,
      hasMore,
      totalCount,
    }
  }

  async addZSetMember(client: RedisClient, key: string, member: string, score: number): Promise<number> {
    return client.zadd(key, score, member)
  }

  async removeZSetMember(client: RedisClient, key: string, member: string): Promise<number> {
    return client.zrem(key, member)
  }

  async updateZSetScore(client: RedisClient, key: string, member: string, newScore: number): Promise<void> {
    // ZADD XX only updates existing members
    await client.zadd(key, 'XX', newScore, member)
  }

  // ── Stream ─────────────────────────────────────────────────────────────────

  async getStreamEntries(
    client: RedisClient,
    key: string,
    start: string = '-',
    count: number = APP_CONFIG.DEFAULT_PAGE_SIZE
  ): Promise<DataPage<StreamEntry>> {
    const raw = await client.xrange(key, start, '+', 'COUNT', count) as Array<[string, string[]]>

    const entries: StreamEntry[] = raw.map(([id, fieldValues]) => ({
      id,
      fields: this.parseStreamFields(fieldValues),
    }))

    // hasMore: if we got exactly `count` entries there might be more
    const hasMore = entries.length >= count

    return {
      items: entries,
      hasMore,
      totalCount: undefined, // XRANGE doesn't provide total cheaply
    }
  }

  async getStreamInfo(client: RedisClient, key: string): Promise<StreamInfo> {
    const [streamRaw, groupsRaw] = await Promise.all([
      client.xinfo('STREAM', key) as Promise<unknown[]>,
      client.xinfo('GROUPS', key) as Promise<unknown[]>,
    ])

    const streamMap = this.arrayToMap(streamRaw)
    const length = (streamMap['length'] as number) ?? 0

    const firstEntryRaw = streamMap['first-entry'] as [string, string[]] | null | undefined
    const lastEntryRaw = streamMap['last-entry'] as [string, string[]] | null | undefined

    const firstEntry: StreamEntry | null = firstEntryRaw
      ? { id: firstEntryRaw[0] as string, fields: this.parseStreamFields(firstEntryRaw[1] as string[]) }
      : null

    const lastEntry: StreamEntry | null = lastEntryRaw
      ? { id: lastEntryRaw[0] as string, fields: this.parseStreamFields(lastEntryRaw[1] as string[]) }
      : null

    const groups: StreamGroupInfo[] = (groupsRaw as unknown[][]).map((g) => {
      const m = this.arrayToMap(g)
      return {
        name: m['name'] as string,
        consumers: (m['consumers'] as number) ?? 0,
        pending: (m['pending'] as number) ?? 0,
        lastDeliveredId: m['last-delivered-id'] as string,
      }
    })

    return { length, firstEntry, lastEntry, groups }
  }

  async addStreamEntry(
    client: RedisClient,
    key: string,
    fields: Record<string, string>
  ): Promise<string> {
    const args: string[] = []
    for (const [field, value] of Object.entries(fields)) {
      args.push(field, value)
    }
    // XADD key * field1 value1 ...
    const id = await client.xadd(key, '*', ...args)
    if (!id) {
      throw new Error(`XADD failed for key "${key}"`)
    }
    return id
  }

  // ── Common key operations ──────────────────────────────────────────────────

  async deleteKey(client: RedisClient, key: string): Promise<number> {
    return client.del(key)
  }

  async renameKey(client: RedisClient, key: string, newKey: string): Promise<void> {
    await client.rename(key, newKey)
  }

  /**
   * Set TTL in milliseconds. Pass ttl=-1 to remove expiry (PERSIST).
   */
  async setTTL(client: RedisClient, key: string, ttl: number): Promise<void> {
    if (ttl === -1) {
      await client.persist(key)
    } else {
      await client.pexpire(key, ttl)
    }
  }

  /**
   * Get key metadata: TYPE + PTTL + MEMORY USAGE (graceful fallback if
   * MEMORY USAGE is unavailable due to ACL or older Redis version).
   */
  async getKeyInfo(client: RedisClient, key: string): Promise<KeyInfo> {
    const pipeline = client.pipeline()
    pipeline.type(key)
    pipeline.pttl(key)
    pipeline.call('MEMORY', 'USAGE', key, 'SAMPLES', '0')

    const results = await pipeline.exec()
    if (!results) {
      throw new Error(`Key "${key}" not found`)
    }

    const type = (results[0]?.[1] as string) ?? 'unknown'
    const ttl = (results[1]?.[1] as number) ?? -2
    // MEMORY USAGE may return null if the key doesn't exist or command is restricted
    const memoryResult = results[2]
    const memory: number | null = memoryResult?.[0]
      ? null // error occurred (e.g. ACL)
      : (memoryResult?.[1] as number | null) ?? null

    return { key, type, ttl, memory }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Parse a flat [field, value, field, value, ...] array into a Record.
   */
  private parseStreamFields(raw: string[]): Record<string, string> {
    const fields: Record<string, string> = {}
    for (let i = 0; i < raw.length; i += 2) {
      fields[raw[i]] = raw[i + 1]
    }
    return fields
  }

  /**
   * Convert a flat [key, value, key, value, ...] array (as returned by XINFO)
   * into a plain object map.
   */
  private arrayToMap(arr: unknown[]): Record<string, unknown> {
    const map: Record<string, unknown> = {}
    for (let i = 0; i < arr.length - 1; i += 2) {
      map[arr[i] as string] = arr[i + 1]
    }
    return map
  }
}
