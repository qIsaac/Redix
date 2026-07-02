import { Redis } from 'ioredis'
import { ServerMetrics, SlowLogEntry } from '../../shared/types'

export class ServerMonitor {
  async getInfo(client: Redis): Promise<string> {
    return await client.info()
  }

  async getMetrics(client: Redis): Promise<ServerMetrics> {
    const infoStr = await client.info()
    const sections = this.parseInfo(infoStr)

    const usedMemory = parseInt(sections['Memory']?.['used_memory'] ?? '0', 10)
    const usedMemoryHuman = sections['Memory']?.['used_memory_human'] ?? '0B'
    const connectedClients = parseInt(sections['Clients']?.['connected_clients'] ?? '0', 10)
    const totalCommandsProcessed = parseInt(sections['Stats']?.['total_commands_processed'] ?? '0', 10)
    const instantaneousOpsPerSec = parseInt(sections['Stats']?.['instantaneous_ops_per_sec'] ?? '0', 10)
    const keyspaceHits = parseInt(sections['Stats']?.['keyspace_hits'] ?? '0', 10)
    const keyspaceMisses = parseInt(sections['Stats']?.['keyspace_misses'] ?? '0', 10)
    const uptimeInSeconds = parseInt(sections['Server']?.['uptime_in_seconds'] ?? '0', 10)

    const total = keyspaceHits + keyspaceMisses
    const hitRate = total > 0 ? (keyspaceHits / total) * 100 : 0

    // Parse dbKeys from Keyspace section: db0:keys=100,expires=50,avg_ttl=...
    const dbKeys: Record<string, number> = {}
    const keyspaceSection = sections['Keyspace'] ?? {}
    for (const [dbName, raw] of Object.entries(keyspaceSection)) {
      const match = /keys=(\d+)/.exec(raw)
      if (match) {
        dbKeys[dbName] = parseInt(match[1], 10)
      }
    }

    return {
      usedMemory,
      usedMemoryHuman,
      connectedClients,
      totalCommandsProcessed,
      instantaneousOpsPerSec,
      keyspaceHits,
      keyspaceMisses,
      hitRate,
      uptimeInSeconds,
      dbKeys,
    }
  }

  async getSlowLog(client: Redis, count: number = 20): Promise<SlowLogEntry[]> {
    const result = (await client.slowlog('GET', count)) as unknown[][]

    return result.map((entry) => {
      const id = entry[0] as number
      const timestamp = entry[1] as number
      const duration = entry[2] as number
      const cmdArgs = entry[3] as string[]
      const clientAddress = (entry[4] as string) ?? ''

      const command = Array.isArray(cmdArgs) ? cmdArgs.join(' ') : String(cmdArgs)

      return { id, timestamp, duration, command, clientAddress }
    })
  }

  /**
   * Parse Redis INFO output (sectioned key-value text) into a nested record.
   * Sections are delimited by blank lines after a "# SectionName" header.
   */
  private parseInfo(infoStr: string): Record<string, Record<string, string>> {
    const sections: Record<string, Record<string, string>> = {}
    let currentSection = 'default'
    sections[currentSection] = {}

    const lines = infoStr.split('\r\n')
    for (const line of lines) {
      if (line.startsWith('# ')) {
        currentSection = line.slice(2).trim()
        if (!sections[currentSection]) sections[currentSection] = {}
      } else if (line.includes(':')) {
        const colonIdx = line.indexOf(':')
        const key = line.slice(0, colonIdx)
        const value = line.slice(colonIdx + 1)
        sections[currentSection][key] = value
      }
    }

    return sections
  }
}
