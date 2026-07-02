import type Redis from 'ioredis'
import { CLIResult } from '../../shared/types'
import { DANGEROUS_COMMANDS } from '../../shared/constants'

type RedisClient = Redis | InstanceType<typeof Redis.Cluster>

const MAX_HISTORY = 100
const MAX_OUTPUT_LINES = 1000
const TRUNCATE_DISPLAY_LINES = 100

export class CLIExecutor {
  private history: string[] = []

  /**
   * 解析并执行 Redis 命令
   */
  async executeCommand(client: RedisClient, commandString: string): Promise<CLIResult> {
    const trimmed = commandString.trim()
    if (!trimmed) {
      return {
        command: trimmed,
        result: '(empty command)',
        isError: true,
        isWarning: false,
      }
    }

    // 记录历史
    this.addToHistory(trimmed)

    // 解析命令
    const argv = this.parseCommand(trimmed)
    if (argv.length === 0) {
      return {
        command: trimmed,
        result: '(empty command)',
        isError: true,
        isWarning: false,
      }
    }

    const commandName = argv[0].toUpperCase()

    // 安全检查：危险命令
    const isWarning = (DANGEROUS_COMMANDS as readonly string[]).includes(commandName)

    // 执行命令
    try {
      const rawResult = await client.call(commandName, ...argv.slice(1))
      const formatted = this.formatResponse(rawResult)
      return {
        command: trimmed,
        result: formatted,
        isError: false,
        isWarning,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      return {
        command: trimmed,
        result: `(error) ${errorMessage}`,
        isError: true,
        isWarning,
      }
    }
  }

  /**
   * 将命令字符串解析为 argv 数组，支持引号包裹的参数
   * 例如: SET key "hello world" → ['SET', 'key', 'hello world']
   */
  parseCommand(input: string): string[] {
    const argv: string[] = []
    let current = ''
    let inQuote: string | null = null
    let i = 0

    while (i < input.length) {
      const char = input[i]

      if (inQuote) {
        if (char === inQuote) {
          // 结束引号
          inQuote = null
        } else if (char === '\\' && i + 1 < input.length) {
          // 转义字符
          current += input[i + 1]
          i += 2
          continue
        } else {
          current += char
        }
      } else {
        if (char === '"' || char === "'") {
          inQuote = char
        } else if (char === ' ' || char === '\t') {
          if (current.length > 0) {
            argv.push(current)
            current = ''
          }
        } else {
          current += char
        }
      }

      i++
    }

    if (current.length > 0) {
      argv.push(current)
    }

    return argv
  }

  /**
   * 格式化 Redis 响应为终端友好输出
   */
  formatResponse(result: unknown, indent = 0): string {
    if (result === null || result === undefined) {
      return '(nil)'
    }

    if (typeof result === 'string') {
      return `"${result}"`
    }

    if (typeof result === 'number') {
      return `(integer) ${result}`
    }

    if (typeof result === 'boolean') {
      return result ? '(true)' : '(false)'
    }

    if (Buffer.isBuffer(result)) {
      return `"${result.toString('utf-8')}"`
    }

    if (Array.isArray(result)) {
      if (result.length === 0) {
        return '(empty array)'
      }

      const lines: string[] = []
      for (let i = 0; i < result.length; i++) {
        const prefix = `${this.indent(indent)}${i + 1}) `
        const value = this.formatResponse(result[i], indent + 1)
        lines.push(`${prefix}${value}`)
      }

      // 截断大结果
      if (lines.length > MAX_OUTPUT_LINES) {
        const truncated = lines.slice(0, TRUNCATE_DISPLAY_LINES)
        truncated.push(
          `${this.indent(indent)}... (${lines.length - TRUNCATE_DISPLAY_LINES} more lines, truncated)`
        )
        return truncated.join('\n')
      }

      return lines.join('\n')
    }

    // 对象类型（少见，但处理一下）
    if (typeof result === 'object') {
      return JSON.stringify(result, null, 2)
    }

    return String(result)
  }

  /**
   * 获取命令历史（最近 100 条）
   */
  getCommandHistory(): string[] {
    return [...this.history]
  }

  private addToHistory(command: string): void {
    // 避免重复添加连续相同命令
    if (this.history.length > 0 && this.history[this.history.length - 1] === command) {
      return
    }
    this.history.push(command)
    if (this.history.length > MAX_HISTORY) {
      this.history.shift()
    }
  }

  private indent(level: number): string {
    return '  '.repeat(level)
  }
}
