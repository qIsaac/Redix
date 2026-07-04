import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useConnectionStore } from '../store/connectionStore'
import type { CLIResult, IPCResponse } from '../../shared/types'
import { DANGEROUS_COMMANDS } from '../../shared/constants'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from '../i18n'

const MAX_HISTORY = 100

const REDIS_COMMANDS = [
  'GET', 'SET', 'DEL', 'EXISTS', 'EXPIRE', 'EXPIREAT', 'PERSIST', 'TTL', 'PTTL', 'TYPE',
  'RENAME', 'RENAMENX', 'RANDOMKEY', 'DUMP', 'RESTORE', 'OBJECT',
  'KEYS', 'SCAN', 'SORT',
  'HGET', 'HSET', 'HDEL', 'HGETALL', 'HMGET', 'HMSET', 'HSETNX',
  'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HINCRBY', 'HINCRBYFLOAT',
  'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LRANGE', 'LLEN', 'LINDEX',
  'LSET', 'LINSERT', 'LREM', 'LTRIM', 'RPOPLPUSH',
  'SADD', 'SREM', 'SMEMBERS', 'SCARD', 'SISMEMBER',
  'SUNION', 'SUNIONSTORE', 'SINTER', 'SINTERSTORE', 'SDIFF', 'SDIFFSTORE',
  'SRANDMEMBER', 'SPOP',
  'ZADD', 'ZREM', 'ZRANGE', 'ZREVRANGE', 'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE',
  'ZRANGEBYLEX', 'ZREVRANGEBYLEX', 'ZCARD', 'ZSCORE', 'ZCOUNT', 'ZLEXCOUNT',
  'ZRANK', 'ZREVRANK', 'ZINCRBY', 'ZUNIONSTORE', 'ZINTERSTORE', 'ZPOPMIN', 'ZPOPMAX',
  'XADD', 'XRANGE', 'XREVRANGE', 'XREAD', 'XREADGROUP', 'XLEN',
  'XACK', 'XCLAIM', 'XDEL', 'XTRIM', 'XGROUP',
  'PING', 'ECHO', 'SELECT', 'INFO', 'DBSIZE', 'FLUSHDB', 'FLUSHALL',
  'CONFIG', 'CLIENT', 'CLUSTER', 'COMMAND',
  'SUBSCRIBE', 'UNSUBSCRIBE', 'PUBLISH', 'PSUBSCRIBE', 'PUNSUBSCRIBE',
  'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH',
  'AUTH', 'QUIT', 'SAVE', 'BGSAVE', 'BGREWRITEAOF', 'LASTSAVE',
  'MONITOR', 'DEBUG', 'SLOWLOG', 'MEMORY', 'WAIT',
  'SETNX', 'SETEX', 'PSETEX', 'MGET', 'MSET', 'MSETNX',
  'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR', 'DECRBY', 'APPEND', 'STRLEN',
  'GETRANGE', 'SETRANGE', 'GETSET',
  'CONFIG GET', 'CONFIG SET', 'CONFIG RESETSTAT', 'CONFIG REWRITE',
  'CLIENT LIST', 'CLIENT GETNAME', 'CLIENT SETNAME', 'CLIENT KILL', 'CLIENT INFO',
  'MEMORY USAGE', 'MEMORY DOCTOR', 'MEMORY STATS', 'MEMORY PURGE',
  'OBJECT ENCODING', 'OBJECT REFCOUNT', 'OBJECT IDLETIME', 'OBJECT FREQ', 'OBJECT HELP',
  'SLOWLOG GET', 'SLOWLOG LEN', 'SLOWLOG RESET',
  'XINFO STREAM', 'XINFO GROUPS', 'XINFO CONSUMERS',
  'CLUSTER INFO', 'CLUSTER NODES', 'CLUSTER SLOTS',
  'SCRIPT LOAD', 'SCRIPT EXISTS', 'SCRIPT FLUSH', 'EVAL', 'EVALSHA',
  'LPOS', 'LMPOP', 'BLMPOP', 'ZMPOP', 'BZMPOP', 'ZDIFF', 'ZDIFFSTORE',
  'ZINTER', 'ZUNION', 'ZINTERCARD', 'ZRANDMEMBER',
  'HRANDFIELD', 'GETDEL', 'GETEX', 'COPY', 'EXPIRETIME', 'PEXPIRETIME',
  'LCS', 'SINTERCARD', 'SMISMEMBER',
  'OBJECT TOUCH', 'CLUSTER SETSLOT', 'CLUSTER ADDSLOTS',
  'CLUSTER DELSLOTS', 'CLUSTER REPLICATE', 'CLUSTER FAILOVER',
  'CLUSTER FORGET', 'CLUSTER MEET',
  'ACL SETUSER', 'ACL GETUSER', 'ACL DELUSER', 'ACL LIST', 'ACL WHOAMI',
  'ACL LOG', 'ACL LOAD', 'ACL SAVE',
]

const HELP_TEXT = `Available commands:
  Any valid Redis command (e.g. PING, SET, GET, KEYS, INFO, etc.)
  clear / cls    - Clear the terminal screen
  help           - Show this help message
  tips           - Show smart CLI tips
  exit           - Show exit hint

Tips:
  Use ↑ / ↓ arrow keys to navigate command history.
  Press Tab for context-aware command completion and usage hints.
  Press Tab on an empty prompt to see common command patterns.
  Use Cmd+C / Cmd+V to copy and paste.
  Dangerous commands (FLUSHDB, FLUSHALL, CONFIG, etc.) will show a warning.
`

const TIPS_TEXT = `Smart CLI tips:
  Empty prompt + Tab        Show common Redis command patterns.
  Partial command + Tab     Complete commands and subcommands, e.g. "config g".
  Full command + Tab        Show usage, examples, related commands, and safety notes.
  Keyword + Space           Suggest the next subcommand, key placeholder, option, or argument.
  Redis error response      Adds a nearby usage tip when Redix recognizes the command.

Examples:
  SET user:1 "Ada" EX 60
  GET user:1
  HGETALL profile:1
  SCAN 0 MATCH user:* COUNT 100
`

interface CommandHint {
  usage: string
  description: string
  examples?: string[]
  related?: string[]
  options?: string[]
}

const COMMAND_HINTS: Record<string, CommandHint> = {
  GET: {
    usage: 'GET key',
    description: 'Read a string value.',
    examples: ['GET session:123'],
    related: ['MGET', 'GETEX', 'GETDEL', 'STRLEN'],
  },
  SET: {
    usage: 'SET key value [NX|XX] [GET] [EX seconds|PX milliseconds]',
    description: 'Write a string value, optionally with conditions or TTL.',
    examples: ['SET session:123 "active" EX 3600', 'SET lock:job-7 token NX PX 30000'],
    related: ['GET', 'SETEX', 'SETNX', 'MSET'],
    options: ['NX only if key does not exist', 'XX only if key exists', 'EX/PX set expiration'],
  },
  DEL: {
    usage: 'DEL key [key ...]',
    description: 'Delete one or more keys.',
    examples: ['DEL cache:user:123'],
    related: ['UNLINK', 'EXISTS', 'TYPE'],
  },
  EXISTS: {
    usage: 'EXISTS key [key ...]',
    description: 'Count how many keys exist.',
    examples: ['EXISTS user:123 user:124'],
    related: ['TYPE', 'TTL', 'DEL'],
  },
  EXPIRE: {
    usage: 'EXPIRE key seconds [NX|XX|GT|LT]',
    description: 'Set a key expiration in seconds.',
    examples: ['EXPIRE session:123 900'],
    related: ['TTL', 'PERSIST', 'PEXPIRE', 'EXPIRETIME'],
  },
  TTL: {
    usage: 'TTL key',
    description: 'Show remaining key lifetime in seconds.',
    examples: ['TTL session:123'],
    related: ['PTTL', 'EXPIRE', 'PERSIST'],
  },
  TYPE: {
    usage: 'TYPE key',
    description: 'Return the Redis data type for a key.',
    examples: ['TYPE user:123'],
    related: ['OBJECT ENCODING', 'MEMORY USAGE'],
  },
  KEYS: {
    usage: 'KEYS pattern',
    description: 'Find keys by pattern. Prefer SCAN on production-sized datasets.',
    examples: ['KEYS user:*'],
    related: ['SCAN', 'TYPE'],
  },
  SCAN: {
    usage: 'SCAN cursor [MATCH pattern] [COUNT count] [TYPE type]',
    description: 'Incrementally iterate keys without blocking Redis for long.',
    examples: ['SCAN 0 MATCH user:* COUNT 100', 'SCAN 0 TYPE hash COUNT 100'],
    related: ['HSCAN', 'SSCAN', 'ZSCAN'],
    options: ['Use returned cursor until it becomes 0', 'MATCH filters names', 'COUNT is a hint'],
  },
  HGET: {
    usage: 'HGET key field',
    description: 'Read one hash field.',
    examples: ['HGET profile:123 name'],
    related: ['HMGET', 'HGETALL', 'HSET'],
  },
  HSET: {
    usage: 'HSET key field value [field value ...]',
    description: 'Set one or more hash fields.',
    examples: ['HSET profile:123 name "Ada" city London'],
    related: ['HGET', 'HDEL', 'HGETALL'],
  },
  HGETALL: {
    usage: 'HGETALL key',
    description: 'Read all fields and values from a hash.',
    examples: ['HGETALL profile:123'],
    related: ['HSCAN', 'HKEYS', 'HVALS'],
  },
  HSCAN: {
    usage: 'HSCAN key cursor [MATCH pattern] [COUNT count]',
    description: 'Incrementally iterate hash fields.',
    examples: ['HSCAN profile:123 0 MATCH pref:* COUNT 50'],
    related: ['HGETALL', 'SCAN'],
  },
  LPUSH: {
    usage: 'LPUSH key element [element ...]',
    description: 'Push values to the head of a list.',
    examples: ['LPUSH queue:emails job-3 job-2 job-1'],
    related: ['RPUSH', 'LPOP', 'LRANGE'],
  },
  RPUSH: {
    usage: 'RPUSH key element [element ...]',
    description: 'Push values to the tail of a list.',
    examples: ['RPUSH queue:emails job-1 job-2 job-3'],
    related: ['LPUSH', 'RPOP', 'LRANGE'],
  },
  LRANGE: {
    usage: 'LRANGE key start stop',
    description: 'Read a range from a list. Use 0 -1 for all elements.',
    examples: ['LRANGE queue:emails 0 20', 'LRANGE queue:emails 0 -1'],
    related: ['LLEN', 'LINDEX', 'LTRIM'],
  },
  SADD: {
    usage: 'SADD key member [member ...]',
    description: 'Add members to a set.',
    examples: ['SADD tags:post:1 redis tauri typescript'],
    related: ['SMEMBERS', 'SREM', 'SISMEMBER'],
  },
  SMEMBERS: {
    usage: 'SMEMBERS key',
    description: 'Read all set members. Prefer SSCAN for very large sets.',
    examples: ['SMEMBERS tags:post:1'],
    related: ['SSCAN', 'SCARD', 'SISMEMBER'],
  },
  ZADD: {
    usage: 'ZADD key [NX|XX] [CH] [INCR] score member [score member ...]',
    description: 'Add or update sorted set members.',
    examples: ['ZADD leaderboard 1200 alice 900 bob'],
    related: ['ZRANGE', 'ZSCORE', 'ZREM'],
  },
  ZRANGE: {
    usage: 'ZRANGE key start stop [BYSCORE|BYLEX] [REV] [LIMIT offset count] [WITHSCORES]',
    description: 'Read sorted set members by rank, score, or lexicographic range.',
    examples: ['ZRANGE leaderboard 0 9 WITHSCORES'],
    related: ['ZREVRANGE', 'ZRANK', 'ZSCORE'],
  },
  XADD: {
    usage: 'XADD key ID field value [field value ...]',
    description: 'Append an entry to a stream. Use * for an auto-generated ID.',
    examples: ['XADD events * type login user alice'],
    related: ['XRANGE', 'XREAD', 'XGROUP'],
  },
  XRANGE: {
    usage: 'XRANGE key start end [COUNT count]',
    description: 'Read stream entries from low ID to high ID.',
    examples: ['XRANGE events - + COUNT 20'],
    related: ['XREVRANGE', 'XREAD', 'XLEN'],
  },
  XREAD: {
    usage: 'XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]',
    description: 'Read new or existing stream entries.',
    examples: ['XREAD COUNT 10 STREAMS events 0', 'XREAD BLOCK 5000 STREAMS events $'],
    related: ['XRANGE', 'XREADGROUP'],
  },
  PING: {
    usage: 'PING [message]',
    description: 'Check whether Redis responds.',
    examples: ['PING', 'PING hello'],
    related: ['ECHO', 'INFO'],
  },
  INFO: {
    usage: 'INFO [section]',
    description: 'Show server information and statistics.',
    examples: ['INFO', 'INFO memory', 'INFO keyspace'],
    related: ['DBSIZE', 'SLOWLOG GET', 'CLIENT LIST'],
  },
  DBSIZE: {
    usage: 'DBSIZE',
    description: 'Return the number of keys in the current database.',
    examples: ['DBSIZE'],
    related: ['INFO keyspace', 'SCAN'],
  },
  SELECT: {
    usage: 'SELECT index',
    description: 'Switch the current connection to another logical database.',
    examples: ['SELECT 1'],
    related: ['DBSIZE', 'INFO keyspace'],
  },
  'CONFIG GET': {
    usage: 'CONFIG GET parameter',
    description: 'Read Redis configuration values.',
    examples: ['CONFIG GET maxmemory', 'CONFIG GET save'],
    related: ['CONFIG SET', 'CONFIG RESETSTAT'],
  },
  'CONFIG SET': {
    usage: 'CONFIG SET parameter value',
    description: 'Change Redis configuration at runtime.',
    examples: ['CONFIG SET maxmemory 512mb'],
    related: ['CONFIG GET', 'CONFIG REWRITE'],
  },
  'CLIENT LIST': {
    usage: 'CLIENT LIST [TYPE normal|master|replica|pubsub] [ID client-id ...]',
    description: 'List connected clients.',
    examples: ['CLIENT LIST'],
    related: ['CLIENT INFO', 'CLIENT KILL'],
  },
  'MEMORY USAGE': {
    usage: 'MEMORY USAGE key [SAMPLES count]',
    description: 'Estimate memory used by a key.',
    examples: ['MEMORY USAGE profile:123'],
    related: ['MEMORY STATS', 'OBJECT ENCODING'],
  },
  'SLOWLOG GET': {
    usage: 'SLOWLOG GET [count]',
    description: 'Read recent slow command entries.',
    examples: ['SLOWLOG GET 20'],
    related: ['SLOWLOG LEN', 'SLOWLOG RESET'],
  },
}

const COMMON_PATTERNS = [
  'PING',
  'INFO memory',
  'DBSIZE',
  'SCAN 0 MATCH prefix:* COUNT 100',
  'GET key',
  'SET key value EX 60',
  'HGETALL key',
  'LRANGE key 0 -1',
  'ZRANGE key 0 -1 WITHSCORES',
  'MEMORY USAGE key',
]

const SUBCOMMAND_SUGGESTIONS: Record<string, string[]> = {
  CONFIG: ['GET', 'SET', 'RESETSTAT', 'REWRITE'],
  CLIENT: ['LIST', 'GETNAME', 'SETNAME', 'KILL', 'INFO'],
  MEMORY: ['USAGE', 'DOCTOR', 'STATS', 'PURGE'],
  OBJECT: ['ENCODING', 'REFCOUNT', 'IDLETIME', 'FREQ', 'HELP'],
  SLOWLOG: ['GET', 'LEN', 'RESET'],
  XINFO: ['STREAM', 'GROUPS', 'CONSUMERS'],
  CLUSTER: ['INFO', 'NODES', 'SLOTS', 'MEET', 'FORGET', 'FAILOVER'],
  SCRIPT: ['LOAD', 'EXISTS', 'FLUSH'],
  ACL: ['SETUSER', 'GETUSER', 'DELUSER', 'LIST', 'WHOAMI', 'LOG', 'LOAD', 'SAVE'],
}

const NEXT_TOKEN_SUGGESTIONS: Record<string, string[][]> = {
  GET: [['key']],
  SET: [['key'], ['value'], ['EX seconds', 'PX milliseconds', 'NX', 'XX', 'GET']],
  DEL: [['key', 'key ...']],
  EXISTS: [['key', 'key ...']],
  EXPIRE: [['key'], ['seconds'], ['NX', 'XX', 'GT', 'LT']],
  TTL: [['key']],
  TYPE: [['key']],
  KEYS: [['pattern']],
  SCAN: [['0'], ['MATCH pattern', 'COUNT count', 'TYPE string|hash|list|set|zset|stream']],
  HGET: [['key'], ['field']],
  HSET: [['key'], ['field'], ['value', 'field value ...']],
  HGETALL: [['key']],
  HSCAN: [['key'], ['0'], ['MATCH pattern', 'COUNT count']],
  LPUSH: [['key'], ['element', 'element ...']],
  RPUSH: [['key'], ['element', 'element ...']],
  LRANGE: [['key'], ['0'], ['-1', 'stop']],
  SADD: [['key'], ['member', 'member ...']],
  SMEMBERS: [['key']],
  ZADD: [['key'], ['score'], ['member', 'score member ...'], ['NX', 'XX', 'CH', 'INCR']],
  ZRANGE: [['key'], ['0', 'start'], ['-1', 'stop'], ['WITHSCORES', 'REV', 'BYSCORE', 'BYLEX', 'LIMIT offset count']],
  XADD: [['key'], ['*', 'ID'], ['field'], ['value', 'field value ...']],
  XRANGE: [['key'], ['-', 'start'], ['+', 'end'], ['COUNT count']],
  XREAD: [['COUNT count', 'BLOCK milliseconds', 'STREAMS']],
  PING: [['message']],
  INFO: [['server', 'clients', 'memory', 'persistence', 'stats', 'replication', 'cpu', 'keyspace']],
  SELECT: [['0', '1', '2', '3']],
  'CONFIG GET': [['parameter', 'maxmemory', 'save', 'timeout']],
  'CONFIG SET': [['parameter', 'maxmemory', 'timeout'], ['value']],
  'CLIENT LIST': [['TYPE normal|master|replica|pubsub', 'ID client-id']],
  'MEMORY USAGE': [['key'], ['SAMPLES count']],
  'SLOWLOG GET': [['count']],
}

const COMMAND_CATALOG = Array.from(new Set(REDIS_COMMANDS)).sort((a, b) => a.localeCompare(b))
const COMMANDS_BY_SPECIFICITY = [...COMMAND_CATALOG].sort((a, b) => {
  const tokenDiff = b.split(' ').length - a.split(' ').length
  return tokenDiff !== 0 ? tokenDiff : b.length - a.length
})
const DANGEROUS_COMMAND_SET = new Set<string>(DANGEROUS_COMMANDS)

const formatPrompt = (connected: boolean, promptLabel = 'redis> '): string =>
  connected ? `\x1b[32m${promptLabel}\x1b[0m` : `\x1b[31m${promptLabel}\x1b[0m`

const normalizeTerminalText = (text: string): string => text.replace(/\r?\n/g, '\r\n')

const copyTextWithFallback = (text: string): void => {
  if (!text) return

  try {
    window.redixAPI?.clipboard?.writeText(text)
    return
  } catch {
    // Fall through to browser clipboard strategies.
  }

  const copyViaTextarea = (): void => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    textarea.setAttribute('readonly', 'true')
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  const writePromise = navigator.clipboard?.writeText(text)
  if (writePromise) {
    writePromise.catch(copyViaTextarea)
  } else {
    copyViaTextarea()
  }
}

const copyTerminalSelection = (term: XTerm, event?: ClipboardEvent | KeyboardEvent): boolean => {
  const selection = term.getSelection()
  if (!selection) return false

  event?.preventDefault()
  event?.stopPropagation()

  if (event && 'clipboardData' in event && event.clipboardData) {
    event.clipboardData.setData('text/plain', selection)
    copyTextWithFallback(selection)
    return true
  }

  copyTextWithFallback(selection)
  return true
}

const splitWords = (input: string): string[] => input.trim().split(/\s+/).filter(Boolean)

const getCommandRoot = (command: string): string => command.split(/\s+/)[0]?.toUpperCase() ?? ''

const getCommandForInput = (input: string): string | null => {
  const tokens = splitWords(input).map((token) => token.toUpperCase())
  if (tokens.length === 0) return null

  return (
    COMMANDS_BY_SPECIFICITY.find((command) => {
      const commandTokens = command.split(' ')
      if (commandTokens.length > tokens.length) return false
      return commandTokens.every((token, index) => tokens[index] === token)
    }) ?? null
  )
}

const getCommandHint = (inputOrCommand: string): CommandHint | null => {
  const command = getCommandForInput(inputOrCommand) ?? splitWords(inputOrCommand)[0]?.toUpperCase()
  if (!command) return null
  return COMMAND_HINTS[command] ?? COMMAND_HINTS[getCommandRoot(command)] ?? null
}

const getCommandMatches = (input: string): string[] => {
  const tokens = splitWords(input).map((token) => token.toUpperCase())
  if (tokens.length === 0 || tokens.length > 2) return []

  const endedWithSpace = /\s$/.test(input)
  let query = tokens.join(' ')
  if (endedWithSpace) {
    const exact = COMMAND_CATALOG.includes(query)
    const hasSubcommands = COMMAND_CATALOG.some((command) => command.startsWith(`${query} `))
    if (exact && !hasSubcommands) return []
    query = `${query} `
  }

  return COMMAND_CATALOG.filter((command) => command.startsWith(query))
}

const levenshteinDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array(right.length + 1).fill(0)

  for (let i = 1; i <= left.length; i++) {
    current[0] = i
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[right.length]
}

const getFuzzyCommandMatches = (input: string): string[] => {
  const firstWord = splitWords(input)[0]?.toUpperCase()
  if (!firstWord || firstWord.length < 2) return []

  return COMMAND_CATALOG
    .map((command) => ({
      command,
      distance: levenshteinDistance(firstWord, getCommandRoot(command)),
    }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance || a.command.localeCompare(b.command))
    .slice(0, 6)
    .map(({ command }) => command)
}

const completeCommandInput = (input: string, command: string): string => {
  const leadingWhitespace = input.match(/^\s*/)?.[0] ?? ''
  return `${leadingWhitespace}${command.toLowerCase()} `
}

const replaceCurrentInput = (term: XTerm, previous: string, next: string): void => {
  for (let i = 0; i < previous.length; i++) {
    term.write('\b \b')
  }
  term.write(next)
}

const buildCommandLine = (command: string): string => {
  const hint = COMMAND_HINTS[command] ?? COMMAND_HINTS[getCommandRoot(command)]
  const label = `\x1b[36m${command.padEnd(16)}\x1b[0m`
  return hint ? `${label} ${hint.usage} - ${hint.description}` : label.trimEnd()
}

const buildUsageLines = (input: string): string[] => {
  const command = getCommandForInput(input) ?? splitWords(input)[0]?.toUpperCase()
  const hint = command ? getCommandHint(command) : null
  if (!command || !hint) return []

  const lines = [`${hint.usage} - ${hint.description}`]
  if (hint.options?.length) {
    lines.push(`Options: ${hint.options.join('; ')}`)
  }
  if (hint.examples?.length) {
    lines.push(`Example: ${hint.examples[0]}`)
  }
  if (hint.related?.length) {
    lines.push(`Related: ${hint.related.join(', ')}`)
  }
  if (DANGEROUS_COMMAND_SET.has(getCommandRoot(command))) {
    lines.push('Safety: review target server and arguments before running this command.')
  }
  return lines
}

const getNextTokenSuggestions = (input: string): string[] => {
  if (!/\s$/.test(input)) return []

  const tokens = splitWords(input).map((token) => token.toUpperCase())
  if (tokens.length === 0) return []

  const subcommands = tokens.length === 1 ? SUBCOMMAND_SUGGESTIONS[tokens[0]] : undefined
  if (subcommands?.length) return subcommands

  const command = getCommandForInput(input)
  if (!command) return []

  const commandTokenCount = command.split(' ').length
  const argumentCount = Math.max(0, tokens.length - commandTokenCount)
  const suggestions = NEXT_TOKEN_SUGGESTIONS[command]
    ?? NEXT_TOKEN_SUGGESTIONS[getCommandRoot(command)]

  return suggestions?.[argumentCount] ?? suggestions?.[suggestions.length - 1] ?? []
}

const formatGhostHint = (suggestions: string[]): string => {
  const hint = suggestions.slice(0, 5).join(' | ')
  return hint.length > 70 ? `${hint.slice(0, 67)}...` : hint
}

interface TerminalProps {
  connectionId: string | null
  currentDb?: number
  embedded?: boolean
}

const Terminal: React.FC<TerminalProps> = ({ connectionId, currentDb, embedded = false }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const inputBufferRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const isExecutingRef = useRef(false)
  const isConnectedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null)
  const ghostHintRef = useRef('')
  const promptLabelRef = useRef('redis> ')

  const connections = useConnectionStore((s) => s.connections)
  const activeConnection = connections.find((c) => c.config.id === connectionId) ?? null
  const activeConnectionRef = useRef(activeConnection)

  useEffect(() => {
    isConnectedRef.current = !!activeConnection && activeConnection.status === 'connected'
    connectionIdRef.current = connectionId
    activeConnectionRef.current = activeConnection
    promptLabelRef.current = embedded ? `[db${currentDb ?? 0}] > ` : 'redis> '
  }, [activeConnection, connectionId, currentDb, embedded])

  const writePrompt = useCallback((term: XTerm, connected: boolean) => {
    term.write(`\r\n${formatPrompt(connected, promptLabelRef.current)}`)
    term.scrollToBottom()
  }, [])

  const writeLine = useCallback((term: XTerm, text: string, color?: string) => {
    const colorCode = color ? `\x1b[${color}m` : ''
    const resetCode = color ? '\x1b[0m' : ''
    term.write(`\r\n${colorCode}${normalizeTerminalText(text)}${resetCode}`)
    term.scrollToBottom()
  }, [])

  const writeLines = useCallback(
    (term: XTerm, lines: string[], color?: string) => {
      for (const line of lines) {
        writeLine(term, line, color)
      }
    },
    [writeLine]
  )

  const clearGhostHint = useCallback((term: XTerm) => {
    const hint = ghostHintRef.current
    if (!hint) return

    term.write(`${' '.repeat(hint.length)}\x1b[${hint.length}D`)
    ghostHintRef.current = ''
  }, [])

  const renderGhostHint = useCallback((term: XTerm, suggestions: string[]) => {
    const hint = formatGhostHint(suggestions)
    if (!hint) return

    ghostHintRef.current = hint
    term.write(`\x1b[90m${hint}\x1b[0m\x1b[${hint.length}D`)
  }, [])

  const executeCommand = useCallback(
    async (command: string) => {
      const term = termRef.current
      if (!term) return

      // Read latest values from refs to avoid stale closure
      const connId = connectionIdRef.current
      const activeConn = activeConnectionRef.current
      const connected = isConnectedRef.current

      const trimmed = command.trim()
      if (!trimmed) {
        writePrompt(term, connected)
        return
      }

      // Special local commands
      const lower = trimmed.toLowerCase()
      if (lower === 'clear' || lower === 'cls') {
        term.clear()
        writePrompt(term, connected)
        return
      }
      if (lower === 'help') {
        writeLine(term, HELP_TEXT)
        writePrompt(term, connected)
        return
      }
      if (lower === 'tips') {
        writeLine(term, TIPS_TEXT)
        writePrompt(term, connected)
        return
      }
      if (lower === 'exit') {
        writeLine(term, useI18n.getState().t('terminal.exitHint'), '33')
        writePrompt(term, connected)
        return
      }

      // Check connection
      if (!connId || !activeConn || activeConn.status !== 'connected') {
        writeLine(term, useI18n.getState().t('terminal.noActiveConnection'), '31')
        writePrompt(term, false)
        return
      }

      // Add to history
      const hist = historyRef.current
      if (hist.length === 0 || hist[hist.length - 1] !== trimmed) {
        hist.push(trimmed)
        if (hist.length > MAX_HISTORY) {
          hist.shift()
        }
      }
      historyIndexRef.current = -1

      isExecutingRef.current = true
      try {
        const response = (await window.redixAPI.cli.execute(connId, trimmed)) as IPCResponse<CLIResult>
        if (response && response.success && response.data) {
          const cliResult = response.data
          if (cliResult.isWarning) {
            writeLine(term, useI18n.getState().t('terminal.dangerousCommand', { cmd: cliResult.command }), '33')
          }
          writeLine(term, cliResult.command, '36')  // echo command
          if (cliResult.isError) {
            writeLine(term, cliResult.result, '31')
            const usageLines = buildUsageLines(trimmed)
            if (usageLines.length > 0) {
              writeLines(term, usageLines.map((line) => `Hint: ${line}`), '90')
            }
          } else {
            writeLine(term, cliResult.result)
          }
        } else {
          const errMsg = response?.error?.message ?? 'Unknown error'
          writeLine(term, `(error) ${errMsg}`, '31')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        writeLine(term, `(error) ${msg}`, '31')
      } finally {
        isExecutingRef.current = false
        writePrompt(term, isConnectedRef.current)
      }
    },
    [writePrompt, writeLine, writeLines]
  )

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      lineHeight: 1.2,
      fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#f5f5f7',
        cursor: '#f5f5f7',
        selectionBackground: 'rgba(0, 122, 255, 0.3)',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    term.element?.classList.add(embedded ? 'xterm-embedded' : 'xterm-standalone')

    // Slight delay to ensure container has layout
    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
        term.scrollToBottom()
      } catch {
        // ignore fit errors during initial render
      }
    })

    termRef.current = term
    fitAddonRef.current = fitAddon

    // isTerminalFocused removed — no longer needed after deduplicating event handlers

    const insertPastedText = (text: string): void => {
      if (isExecutingRef.current) return

      const sanitized = Array.from(text.replace(/\r\n|\r|\n/g, ' '))
        .filter((ch) => ch >= ' ' || ch === '\t')
        .join('')

      if (!sanitized) return

      clearGhostHint(term)
      inputBufferRef.current += sanitized
      term.write(sanitized)
      term.scrollToBottom()
    }

    const pasteFromClipboard = (): void => {
      try {
        const textOrPromise = window.redixAPI?.clipboard?.readText()
        if (typeof textOrPromise === 'string' && textOrPromise) {
          insertPastedText(textOrPromise)
          return
        }
        if (textOrPromise && typeof textOrPromise !== 'string') {
          textOrPromise.then(insertPastedText).catch(() => {
            navigator.clipboard?.readText()
              .then(insertPastedText)
              .catch(() => {
                // Ignore clipboard read failures; DOM paste remains as a fallback.
              })
          })
          return
        }
      } catch {
        // Fall through to browser clipboard.
      }

      navigator.clipboard?.readText()
        .then(insertPastedText)
        .catch(() => {
          // Ignore clipboard read failures; DOM paste remains as a fallback.
        })
    }

    // Intercept ONLY Tab for auto-completion; let all other keys pass through
    // to xterm.js normal processing so onKey / onData fire correctly.
    // Returning false = "I handled it, stop processing"
    // Returning true  = "not handled, continue xterm.js processing"
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isCopyShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c'
      if (isCopyShortcut && term.hasSelection()) {
        copyTerminalSelection(term, e)
        return false
      }

      const isPasteShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v'
      if (isPasteShortcut) {
        e.preventDefault()
        pasteFromClipboard()
        return false
      }

      // Tab – intercept for auto-completion
      if (e.key === 'Tab') {
        e.preventDefault()
        if (isExecutingRef.current) return false

        clearGhostHint(term)
        const buf = inputBufferRef.current
        const redrawPromptAndInput = (): void => {
          term.write(`\r\n${formatPrompt(isConnectedRef.current, promptLabelRef.current)}`)
          term.write(inputBufferRef.current)
          term.scrollToBottom()
        }

        if (!buf.trim()) {
          term.write('\r\n\x1b[90mCommon patterns:\x1b[0m')
          COMMON_PATTERNS.forEach((pattern) => {
            term.write(`\r\n  \x1b[36m${pattern}\x1b[0m`)
          })
          redrawPromptAndInput()
          return false
        }

        const matches = getCommandMatches(buf)

        if (matches.length === 1) {
          const completed = completeCommandInput(buf, matches[0])
          replaceCurrentInput(term, buf, completed)
          inputBufferRef.current = completed
          return false
        }

        if (matches.length > 1) {
          term.write('\r\n\x1b[90mSuggestions:\x1b[0m')
          matches.slice(0, 10).forEach((match) => {
            term.write(`\r\n  ${buildCommandLine(match)}`)
          })
          if (matches.length > 10) {
            term.write(`\r\n  \x1b[90m... ${matches.length - 10} more; type more letters to narrow.\x1b[0m`)
          }
          redrawPromptAndInput()
          return false
        }

        const usageLines = buildUsageLines(buf)
        if (usageLines.length > 0) {
          term.write('\r\n\x1b[90mUsage hint:\x1b[0m')
          usageLines.forEach((line) => {
            term.write(`\r\n  \x1b[90m${line}\x1b[0m`)
          })
          redrawPromptAndInput()
          return false
        }

        const fuzzyMatches = getFuzzyCommandMatches(buf)
        if (fuzzyMatches.length > 0) {
          term.write('\r\n\x1b[90mDid you mean:\x1b[0m')
          fuzzyMatches.forEach((match) => {
            term.write(`\r\n  ${buildCommandLine(match)}`)
          })
          redrawPromptAndInput()
        }
        return false
      }
      return true
    })

    const handleCopy = (e: ClipboardEvent): void => {
      copyTerminalSelection(term, e)
    }
    term.element?.addEventListener('copy', handleCopy)

    // Handle paste via DOM paste event (fallback for non-keyboard paste, e.g. Edit menu)
    const handlePaste = (e: ClipboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const text = e.clipboardData?.getData('text/plain')
      if (text) insertPastedText(text)
    }
    term.element?.addEventListener('paste', handlePaste)

    // Welcome message
    const isConnected = !!activeConnection && activeConnection.status === 'connected'

    if (!embedded) {
      term.writeln('\x1b[1;36m' + useI18n.getState().t('terminal.welcome') + '\x1b[0m')
      term.writeln(useI18n.getState().t('terminal.helpHint'))
      const hostPort2 = activeConnection
        ? `${activeConnection.config.host}:${activeConnection.config.port}`
        : useI18n.getState().t('terminal.noConnection')
      term.writeln(useI18n.getState().t('terminal.connectedTo', { host: hostPort2 }))
      term.write('')
    }

    term.write(formatPrompt(isConnected, promptLabelRef.current))
    term.scrollToBottom()

    // Key handling
    term.onKey(({ key, domEvent }) => {
      if (isExecutingRef.current) return

      const { keyCode } = domEvent

      // Enter
      if (keyCode === 13) {
        const cmd = inputBufferRef.current
        inputBufferRef.current = ''
        clearGhostHint(term)
        term.write('\r\n')
        executeCommand(cmd)
        return
      }

      // Backspace
      if (keyCode === 8) {
        const buf = inputBufferRef.current
        if (buf.length > 0) {
          clearGhostHint(term)
          inputBufferRef.current = buf.slice(0, -1)
          term.write('\b \b')
        }
        return
      }

      // Up arrow – previous history
      if (keyCode === 38) {
        const hist = historyRef.current
        if (hist.length === 0) return
        clearGhostHint(term)
        const idx =
          historyIndexRef.current === -1
            ? hist.length - 1
            : Math.max(0, historyIndexRef.current - 1)
        historyIndexRef.current = idx
        // Clear current input
        const currentLen = inputBufferRef.current.length
        for (let i = 0; i < currentLen; i++) {
          term.write('\b \b')
        }
        inputBufferRef.current = hist[idx]
        term.write(hist[idx])
        return
      }

      // Down arrow – next history
      if (keyCode === 37 || keyCode === 39) {
        // Left/Right arrow – ignore for simplicity
        return
      }
      if (keyCode === 40) {
        const hist = historyRef.current
        if (historyIndexRef.current === -1) return
        clearGhostHint(term)
        const nextIdx = historyIndexRef.current + 1
        if (nextIdx >= hist.length) {
          historyIndexRef.current = -1
          const currentLen = inputBufferRef.current.length
          for (let i = 0; i < currentLen; i++) {
            term.write('\b \b')
          }
          inputBufferRef.current = ''
        } else {
          historyIndexRef.current = nextIdx
          const currentLen = inputBufferRef.current.length
          for (let i = 0; i < currentLen; i++) {
            term.write('\b \b')
          }
          inputBufferRef.current = hist[nextIdx]
          term.write(hist[nextIdx])
        }
        return
      }

      // Ctrl+C – cancel current input only when nothing is selected
      // (copy with selection is handled by attachCustomKeyEventHandler above)
      if (domEvent.ctrlKey && domEvent.key === 'c') {
        if (!term.hasSelection()) {
          clearGhostHint(term)
          term.write('^C')
          inputBufferRef.current = ''
          writePrompt(term, isConnectedRef.current)
        }
        return
      }

      // Ctrl+L – clear
      if (domEvent.ctrlKey && domEvent.key === 'l') {
        clearGhostHint(term)
        term.clear()
        writePrompt(term, isConnectedRef.current)
        return
      }

      // Printable characters
      if (key && !domEvent.ctrlKey && !domEvent.altKey && !domEvent.metaKey) {
        const previousInput = inputBufferRef.current
        clearGhostHint(term)
        inputBufferRef.current += key
        term.write(key)

        if (key === ' ' && previousInput.trim() && !/\s$/.test(previousInput)) {
          const suggestions = getNextTokenSuggestions(inputBufferRef.current)
          if (suggestions.length > 0) {
            renderGhostHint(term, suggestions)
          }
        }
      }
    })

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          term.scrollToBottom()
        } catch {
          // ignore
        }
      })
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      term.element?.removeEventListener('copy', handleCopy)
      term.element?.removeEventListener('paste', handlePaste)
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: '#1e1e1e',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    />
  )
}

export default Terminal
