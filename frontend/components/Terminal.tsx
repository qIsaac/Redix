import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useConnectionStore } from '../store/connectionStore'
import type { CLIHashFieldCompletionResult, CLIKeyCompletionResult, CLIMemberCompletionResult, CLIResult, IPCResponse } from '../shared/types'
import { DANGEROUS_COMMANDS } from '../shared/constants'
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
  LINDEX: [['key'], ['index']],
  LLEN: [['key']],
  LPOP: [['key'], ['count']],
  RPOP: [['key'], ['count']],
  LREM: [['key'], ['count'], ['element']],
  LSET: [['key'], ['index'], ['element']],
  LTRIM: [['key'], ['start'], ['stop']],
  LPOS: [['key'], ['element'], ['RANK rank', 'COUNT count', 'MAXLEN len']],
  LINSERT: [['key'], ['BEFORE', 'AFTER'], ['pivot'], ['element']],
  RPOPLPUSH: [['source'], ['destination']],
  LMOVE: [['source'], ['destination'], ['LEFT', 'RIGHT'], ['LEFT', 'RIGHT']],
  SADD: [['key'], ['member', 'member ...']],
  SREM: [['key'], ['member', 'member ...']],
  SISMEMBER: [['key'], ['member']],
  SMEMBERS: [['key']],
  SMISMEMBER: [['key'], ['member', 'member ...']],
  SPOP: [['key'], ['count']],
  SRANDMEMBER: [['key'], ['count']],
  SMOVE: [['source'], ['destination'], ['member']],
  SDIFF: [['key'], ['key', 'key ...']],
  SINTER: [['key'], ['key', 'key ...']],
  SUNION: [['key'], ['key', 'key ...']],
  SDIFFSTORE: [['destination'], ['key'], ['key', 'key ...']],
  SINTERSTORE: [['destination'], ['key'], ['key', 'key ...']],
  SUNIONSTORE: [['destination'], ['key'], ['key', 'key ...']],
  ZADD: [['key'], ['score'], ['member', 'score member ...'], ['NX', 'XX', 'CH', 'INCR']],
  ZRANGE: [['key'], ['0', 'start'], ['-1', 'stop'], ['WITHSCORES', 'REV', 'BYSCORE', 'BYLEX', 'LIMIT offset count']],
  ZREM: [['key'], ['member', 'member ...']],
  ZSCORE: [['key'], ['member']],
  ZRANK: [['key'], ['member']],
  ZREVRANK: [['key'], ['member']],
  ZINCRBY: [['key'], ['increment'], ['member']],
  ZCOUNT: [['key'], ['min'], ['max']],
  ZLEXCOUNT: [['key'], ['min'], ['max']],
  ZPOPMIN: [['key'], ['count']],
  ZPOPMAX: [['key'], ['count']],
  ZRANDMEMBER: [['key'], ['count'], ['WITHSCORES']],
  ZDIFF: [['numkeys'], ['key', 'key ...'], ['WITHSCORES']],
  ZINTER: [['numkeys'], ['key', 'key ...'], ['WEIGHTS weight ...', 'AGGREGATE SUM|MIN|MAX', 'WITHSCORES']],
  ZUNION: [['numkeys'], ['key', 'key ...'], ['WEIGHTS weight ...', 'AGGREGATE SUM|MIN|MAX', 'WITHSCORES']],
  ZDIFFSTORE: [['destination'], ['numkeys'], ['key', 'key ...']],
  ZINTERSTORE: [['destination'], ['numkeys'], ['key', 'key ...'], ['WEIGHTS weight ...', 'AGGREGATE SUM|MIN|MAX']],
  ZUNIONSTORE: [['destination'], ['numkeys'], ['key', 'key ...'], ['WEIGHTS weight ...', 'AGGREGATE SUM|MIN|MAX']],
  XADD: [['key'], ['*', 'ID'], ['field'], ['value', 'field value ...']],
  XRANGE: [['key'], ['-', 'start'], ['+', 'end'], ['COUNT count']],
  XLEN: [['key']],
  XDEL: [['key'], ['ID', 'ID ...']],
  XTRIM: [['key'], ['MAXLEN', 'MINID'], ['threshold']],
  XREAD: [['COUNT count', 'BLOCK milliseconds', 'STREAMS']],
  PING: [['message']],
  INFO: [['server', 'clients', 'memory', 'persistence', 'stats', 'replication', 'cpu', 'keyspace']],
  SELECT: [['0', '1', '2', '3']],
  'CONFIG GET': [['parameter', 'maxmemory', 'save', 'timeout']],
  'CONFIG SET': [['parameter', 'maxmemory', 'timeout'], ['value']],
  'CLIENT LIST': [['TYPE normal|master|replica|pubsub', 'ID client-id']],
  'MEMORY USAGE': [['key'], ['SAMPLES count']],
  COPY: [['source'], ['destination'], ['DB db', 'REPLACE']],
  RENAME: [['key'], ['newkey']],
  RENAMENX: [['key'], ['newkey']],
  BITOP: [['AND', 'OR', 'XOR', 'NOT'], ['destination'], ['key', 'key ...']],
  PFCOUNT: [['key', 'key ...']],
  PFMERGE: [['destination'], ['source', 'source ...']],
  'SLOWLOG GET': [['count']],
}

const MULTI_KEY_COMMANDS = new Set([
  'DEL', 'EXISTS', 'MGET', 'TOUCH', 'UNLINK',
])

const PAIR_KEY_COMMANDS = new Set([
  'MSET', 'MSETNX',
])

type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'

const FIRST_KEY_COMMANDS = new Set([
  'APPEND', 'BITCOUNT', 'BITFIELD', 'BITOP', 'BITPOS', 'COPY', 'DECR', 'DECRBY',
  'DUMP', 'EXPIRE', 'EXPIREAT', 'EXPIRETIME', 'GET', 'GETDEL', 'GETEX', 'GETRANGE',
  'GETSET', 'HDEL', 'HEXISTS', 'HGET', 'HGETALL', 'HINCRBY', 'HINCRBYFLOAT',
  'HKEYS', 'HLEN', 'HMGET', 'HMSET', 'HRANDFIELD', 'HSCAN', 'HSET', 'HSETNX',
  'HSTRLEN', 'HVALS', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'LINDEX', 'LINSERT',
  'LLEN', 'LMOVE', 'LMPOP', 'LPOP', 'LPOS', 'LPUSH', 'LPUSHX', 'LRANGE', 'LREM',
  'LSET', 'LTRIM', 'MEMORY USAGE', 'OBJECT ENCODING', 'OBJECT FREQ',
  'OBJECT IDLETIME', 'OBJECT REFCOUNT', 'OBJECT TOUCH', 'PERSIST', 'PEXPIRE',
  'PEXPIREAT', 'PEXPIRETIME', 'PFADD', 'PFCOUNT', 'PFMERGE', 'PTTL', 'RENAME',
  'RENAMENX', 'RESTORE', 'RPOP', 'RPOPLPUSH', 'RPUSH', 'RPUSHX', 'SADD', 'SCARD',
  'SDIFF', 'SDIFFSTORE', 'SET', 'SETEX', 'SETNX', 'PSETEX', 'SINTER', 'SINTERCARD',
  'SINTERSTORE', 'SISMEMBER', 'SMEMBERS', 'SMISMEMBER', 'SMOVE', 'SORT', 'SPOP',
  'SRANDMEMBER', 'SREM', 'SSCAN', 'STRLEN', 'SUNION', 'SUNIONSTORE', 'TYPE', 'TTL',
  'XACK', 'XADD', 'XCLAIM', 'XDEL', 'XGROUP', 'XINFO STREAM', 'XLEN', 'XRANGE',
  'XREADGROUP', 'XREVRANGE', 'XTRIM', 'ZADD', 'ZCARD', 'ZCOUNT', 'ZDIFF', 'ZDIFFSTORE',
  'ZINCRBY', 'ZINTER', 'ZINTERCARD', 'ZINTERSTORE', 'ZLEXCOUNT', 'ZMPOP',
  'ZPOPMAX', 'ZPOPMIN', 'ZRANDMEMBER', 'ZRANGE', 'ZRANGEBYLEX', 'ZRANGEBYSCORE',
  'ZRANK', 'ZREM', 'ZREMRANGEBYLEX', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE',
  'ZREVRANGE', 'ZREVRANGEBYLEX', 'ZREVRANGEBYSCORE', 'ZREVRANK', 'ZSCAN',
  'ZSCORE', 'ZUNION', 'ZUNIONSTORE',
])

const STRING_KEY_COMMANDS = new Set([
  'APPEND', 'BITCOUNT', 'BITFIELD', 'BITPOS', 'DECR', 'DECRBY', 'GET', 'GETDEL',
  'GETEX', 'GETRANGE', 'GETSET', 'INCR', 'INCRBY', 'INCRBYFLOAT', 'MGET',
  'MSET', 'MSETNX', 'PFADD', 'PFCOUNT', 'PFMERGE', 'PSETEX', 'SET', 'SETEX',
  'SETNX', 'SETRANGE', 'STRLEN',
])

const HASH_KEY_COMMANDS = new Set([
  'HDEL', 'HEXISTS', 'HGET', 'HGETALL', 'HINCRBY', 'HINCRBYFLOAT', 'HKEYS',
  'HLEN', 'HMGET', 'HMSET', 'HRANDFIELD', 'HSCAN', 'HSET', 'HSETNX', 'HSTRLEN',
  'HVALS',
])

const LIST_KEY_COMMANDS = new Set([
  'LINDEX', 'LINSERT', 'LLEN', 'LMOVE', 'LMPOP', 'LPOP', 'LPOS', 'LPUSH',
  'LPUSHX', 'LRANGE', 'LREM', 'LSET', 'LTRIM', 'RPOP', 'RPOPLPUSH', 'RPUSH',
  'RPUSHX',
])

const SET_KEY_COMMANDS = new Set([
  'SADD', 'SCARD', 'SDIFF', 'SDIFFSTORE', 'SINTER', 'SINTERCARD', 'SINTERSTORE',
  'SISMEMBER', 'SMEMBERS', 'SMISMEMBER', 'SMOVE', 'SPOP', 'SRANDMEMBER',
  'SREM', 'SSCAN', 'SUNION', 'SUNIONSTORE',
])

const ZSET_KEY_COMMANDS = new Set([
  'BZMPOP', 'ZADD', 'ZCARD', 'ZCOUNT', 'ZDIFF', 'ZDIFFSTORE', 'ZINCRBY',
  'ZINTER', 'ZINTERCARD', 'ZINTERSTORE', 'ZLEXCOUNT', 'ZMPOP', 'ZPOPMAX',
  'ZPOPMIN', 'ZRANDMEMBER', 'ZRANGE', 'ZRANGEBYLEX', 'ZRANGEBYSCORE', 'ZRANK',
  'ZREM', 'ZREMRANGEBYLEX', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZREVRANGE',
  'ZREVRANGEBYLEX', 'ZREVRANGEBYSCORE', 'ZREVRANK', 'ZSCAN', 'ZSCORE',
  'ZUNION', 'ZUNIONSTORE',
])

const STREAM_KEY_COMMANDS = new Set([
  'XACK', 'XADD', 'XCLAIM', 'XDEL', 'XGROUP', 'XINFO STREAM', 'XLEN', 'XRANGE',
  'XREADGROUP', 'XREVRANGE', 'XTRIM',
])

const COMMAND_CATALOG = Array.from(new Set(REDIS_COMMANDS)).sort((a, b) => a.localeCompare(b))
const COMMANDS_BY_SPECIFICITY = [...COMMAND_CATALOG].sort((a, b) => {
  const tokenDiff = b.split(' ').length - a.split(' ').length
  return tokenDiff !== 0 ? tokenDiff : b.length - a.length
})
const DANGEROUS_COMMAND_SET = new Set<string>(DANGEROUS_COMMANDS)

const formatPrompt = (connected: boolean, promptLabel = 'redis> '): string =>
  connected ? `\x1b[32m${promptLabel}\x1b[0m` : `\x1b[31m${promptLabel}\x1b[0m`

const escapeTerminalControls = (text: string): string =>
  text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(2, '0')
    return `\\x${code}`
  }).replace(/\x1b/g, '\\x1b')

const normalizeTerminalText = (text: string): string =>
  escapeTerminalControls(text).replace(/\r?\n/g, '\r\n')

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

interface InputToken {
  value: string
  start: number
  end: number
}

interface CompletionRange {
  start: number
  end: number
  value: string
  tokenIndex: number
}

interface KeyCompletionContext {
  prefix: string
  range: CompletionRange
  typeFilter?: RedisKeyType
  acceptCursorEnd?: number
  replaceEnd?: number
}

interface HashFieldCompletionContext {
  key: string
  keyRange: CompletionRange
  prefix: string
  range: CompletionRange
}

interface MemberCompletionContext {
  key: string
  kind: 'set' | 'zset'
  prefix: string
  range: CompletionRange
}

interface PendingTokenCompletion {
  start: number
  end: number
  acceptCursorEnd?: number
  replaceEnd?: number
  prefix: string
  value: string
  appendSpace?: boolean
  inputVersion: number
}

const tokenizeWithRanges = (input: string): InputToken[] => {
  const tokens: InputToken[] = []
  const matcher = /\S+/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(input)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return tokens
}

const getCompletionRange = (input: string, cursor: number): CompletionRange => {
  const tokens = tokenizeWithRanges(input)
  const tokenIndex = tokens.findIndex((token) => cursor >= token.start && cursor <= token.end)
  if (tokenIndex >= 0) {
    const token = tokens[tokenIndex]
    return {
      start: token.start,
      end: token.end,
      value: input.slice(token.start, cursor),
      tokenIndex,
    }
  }

  const tokensBeforeCursor = tokens.filter((token) => token.end <= cursor).length
  return {
    start: cursor,
    end: cursor,
    value: '',
    tokenIndex: tokensBeforeCursor,
  }
}

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

const isKeyArgument = (command: string, argumentIndex: number): boolean => {
  if (argumentIndex < 0) return false

  const root = getCommandRoot(command)
  if (MULTI_KEY_COMMANDS.has(root)) return true
  if (PAIR_KEY_COMMANDS.has(root)) return argumentIndex % 2 === 0
  if (['COPY', 'RENAME', 'RENAMENX', 'RPOPLPUSH', 'LMOVE'].includes(root)) {
    return argumentIndex === 0 || argumentIndex === 1
  }
  if (root === 'SMOVE') return argumentIndex === 0 || argumentIndex === 1
  if (root === 'BITOP') return argumentIndex >= 1
  if (['SDIFF', 'SINTER', 'SUNION', 'ZDIFF', 'ZINTER', 'ZUNION'].includes(root)) {
    return argumentIndex >= 1
  }
  if (['SDIFFSTORE', 'SINTERSTORE', 'SUNIONSTORE'].includes(root)) return true
  if (['ZDIFFSTORE', 'ZINTERSTORE', 'ZUNIONSTORE'].includes(root)) {
    return argumentIndex === 0 || argumentIndex >= 2
  }
  if (root === 'PFMERGE') return true
  if (root === 'PFCOUNT') return true
  return FIRST_KEY_COMMANDS.has(command) || FIRST_KEY_COMMANDS.has(root)
    ? argumentIndex === 0
    : false
}

const getKeyTypeForCommand = (command: string): RedisKeyType | undefined => {
  const root = getCommandRoot(command)
  const matchesCommand = (commands: Set<string>): boolean => commands.has(command) || commands.has(root)

  if (matchesCommand(STRING_KEY_COMMANDS)) return 'string'
  if (matchesCommand(HASH_KEY_COMMANDS)) return 'hash'
  if (matchesCommand(LIST_KEY_COMMANDS)) return 'list'
  if (matchesCommand(SET_KEY_COMMANDS)) return 'set'
  if (matchesCommand(ZSET_KEY_COMMANDS)) return 'zset'
  if (matchesCommand(STREAM_KEY_COMMANDS)) return 'stream'
  return undefined
}

const isHashFieldArgument = (command: string, argumentIndex: number): boolean => {
  const root = getCommandRoot(command)
  if (argumentIndex < 1 || root[0] !== 'H') return false
  if (['HGET', 'HEXISTS', 'HINCRBY', 'HINCRBYFLOAT', 'HSETNX', 'HSTRLEN'].includes(root)) {
    return argumentIndex === 1
  }
  if (['HDEL', 'HMGET'].includes(root)) return argumentIndex >= 1
  if (['HSET', 'HMSET'].includes(root)) return argumentIndex % 2 === 1
  return false
}

const getMemberCompletionKind = (command: string, argumentIndex: number): 'set' | 'zset' | null => {
  const root = getCommandRoot(command)
  if (argumentIndex < 1) return null

  if (['SADD', 'SREM', 'SMISMEMBER'].includes(root)) return 'set'
  if (['SISMEMBER'].includes(root)) return argumentIndex === 1 ? 'set' : null
  if (root === 'SMOVE') return argumentIndex === 2 ? 'set' : null

  if (['ZREM'].includes(root)) return 'zset'
  if (['ZSCORE', 'ZRANK', 'ZREVRANK'].includes(root)) return argumentIndex === 1 ? 'zset' : null
  if (root === 'ZINCRBY') return argumentIndex === 2 ? 'zset' : null
  return null
}

const stripOpeningQuote = (value: string): string =>
  value.startsWith('"') || value.startsWith("'") ? value.slice(1) : value

const unquoteCliToken = (value: string): string => {
  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1).replace(/\\(.)/g, '$1')
    }
  }
  return value
}

const quoteCliArgIfNeeded = (value: string): string => {
  if (value && !/[\s"'\\]/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const longestCommonPrefix = (values: string[]): string => {
  if (values.length === 0) return ''

  let prefix = values[0]
  for (const value of values.slice(1)) {
    let index = 0
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1
    }
    prefix = prefix.slice(0, index)
    if (!prefix) break
  }
  return prefix
}

const isKeyNamespaceCandidate = (prefix: string, value: string): boolean =>
  value.length > prefix.length && value.endsWith(':')

const sortKeySegmentCandidates = (prefix: string, candidates: string[]): string[] =>
  [...candidates].sort((left, right) => {
    const leftIsNamespace = isKeyNamespaceCandidate(prefix, left)
    const rightIsNamespace = isKeyNamespaceCandidate(prefix, right)
    if (leftIsNamespace !== rightIsNamespace) return leftIsNamespace ? -1 : 1
    return left.localeCompare(right)
  })

const getNextKeySegmentCandidates = (prefix: string, keys: string[]): string[] => {
  const candidates = new Set<string>()
  for (const key of keys) {
    if (!key.startsWith(prefix) || key === prefix) continue

    const remaining = key.slice(prefix.length)
    const nextSeparator = remaining.indexOf(':')
    candidates.add(nextSeparator >= 0 ? `${prefix}${remaining.slice(0, nextSeparator + 1)}` : key)
  }

  return sortKeySegmentCandidates(prefix, Array.from(candidates))
}

const formatKeySegmentOptions = (prefix: string, candidates: string[]): string => {
  const labels = candidates.slice(0, 8).map((candidate) => {
    const label = candidate.slice(prefix.length)
    return label.endsWith(':') ? label.slice(0, -1) : label
  })
  const more = candidates.length > labels.length ? ` | +${candidates.length - labels.length}` : ''
  return ` ${labels.join(' | ')}${more}`
}

const getKeyCompletionContext = (input: string, cursor: number): KeyCompletionContext | null => {
  const beforeCursor = input.slice(0, cursor)
  const command = getCommandForInput(beforeCursor)
  if (!command) return null

  const range = getCompletionRange(input, cursor)
  const argumentIndex = range.tokenIndex - command.split(' ').length
  if (!isKeyArgument(command, argumentIndex)) return null

  return {
    prefix: stripOpeningQuote(range.value),
    range,
    typeFilter: getKeyTypeForCommand(command),
  }
}

const getHashFieldCompletionContext = (input: string, cursor: number): HashFieldCompletionContext | null => {
  const beforeCursor = input.slice(0, cursor)
  const command = getCommandForInput(beforeCursor)
  if (!command) return null

  const tokens = tokenizeWithRanges(input)
  const commandTokenCount = command.split(' ').length
  const keyToken = tokens[commandTokenCount]
  if (!keyToken) return null

  const range = getCompletionRange(input, cursor)
  const argumentIndex = range.tokenIndex - commandTokenCount
  if (!isHashFieldArgument(command, argumentIndex)) return null

  return {
    key: unquoteCliToken(keyToken.value),
    keyRange: {
      start: keyToken.start,
      end: keyToken.end,
      value: stripOpeningQuote(keyToken.value),
      tokenIndex: commandTokenCount,
    },
    prefix: stripOpeningQuote(range.value),
    range,
  }
}

const getMemberCompletionContext = (input: string, cursor: number): MemberCompletionContext | null => {
  const beforeCursor = input.slice(0, cursor)
  const command = getCommandForInput(beforeCursor)
  if (!command) return null

  const tokens = tokenizeWithRanges(input)
  const commandTokenCount = command.split(' ').length
  const keyToken = tokens[commandTokenCount]
  if (!keyToken) return null

  const range = getCompletionRange(input, cursor)
  const argumentIndex = range.tokenIndex - commandTokenCount
  const kind = getMemberCompletionKind(command, argumentIndex)
  if (!kind) return null

  return {
    key: unquoteCliToken(keyToken.value),
    kind,
    prefix: stripOpeningQuote(range.value),
    range,
  }
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

  if (!suggestions) return []
  if (argumentCount < suggestions.length) return suggestions[argumentCount]

  const repeatableSuggestions = suggestions[suggestions.length - 1]
  return repeatableSuggestions.some((suggestion) => suggestion.includes('...'))
    ? repeatableSuggestions
    : []
}

const formatGhostHint = (suggestions: string[]): string => {
  const hint = suggestions.slice(0, 5).join(' | ')
  return hint.length > 70 ? `${hint.slice(0, 67)}...` : hint
}

const charTerminalWidth = (char: string): number => {
  const codePoint = char.codePointAt(0) ?? 0
  if (codePoint === 0) return 0
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  return codePoint > 0x1100 ? 2 : 1
}

const terminalTextWidth = (text: string): number =>
  Array.from(text).reduce((width, char) => width + charTerminalWidth(char), 0)

const sliceTerminalText = (text: string, maxWidth: number): string => {
  let width = 0
  let output = ''
  for (const char of Array.from(text)) {
    const charWidth = charTerminalWidth(char)
    if (width + charWidth > maxWidth) break
    output += char
    width += charWidth
  }
  return output
}

const fitGhostHintToCurrentLine = (term: XTerm, hint: string): { text: string; width: number } | null => {
  const availableColumns = Math.max(0, term.cols - term.buffer.active.cursorX - 1)
  if (availableColumns < 4) return null

  const sanitized = escapeTerminalControls(hint)
  const sanitizedWidth = terminalTextWidth(sanitized)
  if (sanitizedWidth <= availableColumns) {
    return { text: sanitized, width: sanitizedWidth }
  }

  const suffix = '...'
  const clipped = `${sliceTerminalText(sanitized, availableColumns - suffix.length)}${suffix}`
  return { text: clipped, width: terminalTextWidth(clipped) }
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
  const cursorIndexRef = useRef(0)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const isExecutingRef = useRef(false)
  const isConnectedRef = useRef(false)
  const connectionIdRef = useRef<string | null>(null)
  const ghostHintRef = useRef('')
  const ghostHintColumnsRef = useRef(0)
  const pendingTokenCompletionRef = useRef<PendingTokenCompletion | null>(null)
  const inputVersionRef = useRef(0)
  const promptLabelRef = useRef('redis> ')
  const pendingDangerousCommandRef = useRef<string | null>(null)

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
    pendingTokenCompletionRef.current = null
    if (!hint) return

    const columns = ghostHintColumnsRef.current || terminalTextWidth(hint)
    term.write(`${' '.repeat(columns)}\x1b[${columns}D`)
    ghostHintRef.current = ''
    ghostHintColumnsRef.current = 0
  }, [])

  const renderGhostHint = useCallback((term: XTerm, suggestions: string[]) => {
    const hint = formatGhostHint(suggestions)
    if (!hint) return

    const fittedHint = fitGhostHintToCurrentLine(term, hint)
    if (!fittedHint) return

    ghostHintRef.current = fittedHint.text
    ghostHintColumnsRef.current = fittedHint.width
    term.write(`\x1b[90m${fittedHint.text}\x1b[0m\x1b[${fittedHint.width}D`)
  }, [])

  const renderInlineGhostHint = useCallback((term: XTerm, hint: string) => {
    if (!hint) return

    const fittedHint = fitGhostHintToCurrentLine(term, hint)
    if (!fittedHint) {
      return
    }

    ghostHintRef.current = fittedHint.text
    ghostHintColumnsRef.current = fittedHint.width
    term.write(`\x1b[90m${fittedHint.text}\x1b[0m\x1b[${fittedHint.width}D`)
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
        pendingDangerousCommandRef.current = null
        writePrompt(term, connected)
        return
      }

      // Special local commands
      const lower = trimmed.toLowerCase()
      if (lower === 'clear' || lower === 'cls') {
        pendingDangerousCommandRef.current = null
        term.clear()
        writePrompt(term, connected)
        return
      }
      if (lower === 'help') {
        pendingDangerousCommandRef.current = null
        writeLine(term, HELP_TEXT)
        writePrompt(term, connected)
        return
      }
      if (lower === 'tips') {
        pendingDangerousCommandRef.current = null
        writeLine(term, TIPS_TEXT)
        writePrompt(term, connected)
        return
      }
      if (lower === 'exit') {
        pendingDangerousCommandRef.current = null
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
        const isDangerous = DANGEROUS_COMMAND_SET.has(getCommandRoot(trimmed))
        const confirmed = isDangerous && pendingDangerousCommandRef.current === trimmed
        const response = (await window.redixAPI.cli.execute(connId, trimmed, confirmed)) as IPCResponse<CLIResult>
        if (response && response.success && response.data) {
          const cliResult = response.data
          if (cliResult.requiresConfirmation) {
            pendingDangerousCommandRef.current = trimmed
          } else {
            pendingDangerousCommandRef.current = null
          }
          if (cliResult.isWarning) {
            writeLine(term, useI18n.getState().t('terminal.dangerousCommand', { cmd: cliResult.command }), '33')
          }
          writeLine(term, cliResult.command, '36')  // echo command
          if (cliResult.requiresConfirmation) {
            writeLine(term, cliResult.result, '33')
            return
          }
          if (cliResult.isError) {
            writeLine(term, cliResult.result, '31')
            const usageLines = buildUsageLines(trimmed)
            if (usageLines.length > 0) {
              writeLines(term, usageLines.map((line) => `Hint: ${line}`), '90')
            }
          } else {
            writeLine(term, cliResult.result)
            if (cliResult.truncated) {
              writeLine(term, 'Output truncated. Narrow the command or use a cursor-based command.', '33')
            }
          }
        } else {
          pendingDangerousCommandRef.current = null
          const errMsg = response?.error?.message ?? 'Unknown error'
          writeLine(term, `(error) ${errMsg}`, '31')
        }
      } catch (err) {
        pendingDangerousCommandRef.current = null
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

    const moveCursorToInputOffset = (input: string, cursor: number): void => {
      const promptColumns = terminalTextWidth(promptLabelRef.current)
      const endColumns = promptColumns + terminalTextWidth(input)
      const targetColumns = promptColumns + terminalTextWidth(input.slice(0, cursor))
      const rowsUp = Math.floor(endColumns / term.cols) - Math.floor(targetColumns / term.cols)
      const targetColumn = targetColumns % term.cols

      if (rowsUp > 0) {
        term.write(`\x1b[${rowsUp}A`)
      }
      term.write('\r')
      if (targetColumn > 0) {
        term.write(`\x1b[${targetColumn}C`)
      }
    }

    const eraseCurrentInput = (): void => {
      const buf = inputBufferRef.current
      const cursor = cursorIndexRef.current
      const promptColumns = terminalTextWidth(promptLabelRef.current)
      const cursorColumns = promptColumns + terminalTextWidth(buf.slice(0, cursor))
      const cursorRows = Math.floor(cursorColumns / term.cols)

      if (cursorRows > 0) {
        term.write(`\x1b[${cursorRows}A`)
      }
      term.write('\r')
      if (promptColumns > 0) {
        term.write(`\x1b[${promptColumns}C`)
      }
      term.write('\x1b[0J')
    }

    const redrawInput = (next: string, cursor = next.length): void => {
      clearGhostHint(term)
      inputVersionRef.current += 1
      eraseCurrentInput()
      inputBufferRef.current = next
      cursorIndexRef.current = Math.max(0, Math.min(cursor, next.length))
      term.write(next)
      if (cursorIndexRef.current < next.length) {
        moveCursorToInputOffset(next, cursorIndexRef.current)
      }
      term.scrollToBottom()
    }

    const redrawPromptAndInput = (): void => {
      term.write(`\r\n${formatPrompt(isConnectedRef.current, promptLabelRef.current)}`)
      term.write(inputBufferRef.current)
      cursorIndexRef.current = inputBufferRef.current.length
      term.scrollToBottom()
    }

    const acceptPendingTokenCompletion = (): boolean => {
      const pending = pendingTokenCompletionRef.current
      if (!pending) return false

      const buf = inputBufferRef.current
      const acceptCursorEnd = pending.acceptCursorEnd ?? pending.end
      if (
        cursorIndexRef.current !== acceptCursorEnd
        || buf.slice(pending.start, pending.end) !== pending.prefix
        || pending.inputVersion !== inputVersionRef.current
      ) {
        pendingTokenCompletionRef.current = null
        return false
      }

      const completed = pending.appendSpace === false
        ? quoteCliArgIfNeeded(pending.value)
        : `${quoteCliArgIfNeeded(pending.value)} `
      const replaceEnd = pending.replaceEnd ?? pending.end
      const next = `${buf.slice(0, pending.start)}${completed}${buf.slice(replaceEnd)}`
      redrawInput(next, pending.start + completed.length)
      pendingTokenCompletionRef.current = null
      return true
    }

    const suggestTokenCompletion = (
      range: CompletionRange,
      prefix: string,
      value: string,
      appendSpace = true,
      acceptCursorEnd?: number,
      replaceEnd?: number
    ): void => {
      if (!value.startsWith(prefix)) return

      const end = range.start + prefix.length
      pendingTokenCompletionRef.current = {
        start: range.start,
        end,
        acceptCursorEnd: acceptCursorEnd ?? end,
        replaceEnd: replaceEnd ?? end,
        prefix,
        value,
        appendSpace,
        inputVersion: inputVersionRef.current,
      }
      renderInlineGhostHint(term, value.slice(prefix.length))
    }

    const insertTextAtCursor = (text: string): void => {
      if (!text) return
      const buf = inputBufferRef.current
      const cursor = cursorIndexRef.current
      const next = `${buf.slice(0, cursor)}${text}${buf.slice(cursor)}`
      redrawInput(next, cursor + text.length)
    }

    const insertPastedText = (text: string): void => {
      if (isExecutingRef.current) return

      const sanitized = Array.from(text.replace(/\r\n|\r|\n/g, ' '))
        .filter((ch) => ch >= ' ' || ch === '\t')
        .join('')

      insertTextAtCursor(sanitized)
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

    const completeRedisKey = async (context: KeyCompletionContext): Promise<void> => {
      const connId = connectionIdRef.current
      if (!connId || !isConnectedRef.current) return

      try {
        const response = (await window.redixAPI.cli.completeKeys(
          connId,
          context.prefix,
          30,
          context.typeFilter
        )) as IPCResponse<CLIKeyCompletionResult>

        if (!response?.success || !response.data) {
          writeLine(term, response?.error?.message ?? 'Key completion failed', '31')
          redrawPromptAndInput()
          return
        }

        const keys = response.data.keys
        const hasMore = response.data.hasMore
        const candidates = sortKeySegmentCandidates(
          context.prefix,
          response.data.segments?.length
            ? response.data.segments
            : getNextKeySegmentCandidates(context.prefix, keys)
        )
        if (candidates.length === 1) {
          const candidate = candidates[0]
          if (isKeyNamespaceCandidate(context.prefix, candidate)) {
            suggestTokenCompletion(
              context.range,
              context.prefix,
              candidate,
              false,
              context.acceptCursorEnd,
              context.replaceEnd
            )
            return
          }
          if (!hasMore && keys.length === 1 && candidate === keys[0]) {
            suggestTokenCompletion(
              context.range,
              context.prefix,
              candidate,
              true,
              context.acceptCursorEnd,
              context.replaceEnd
            )
            return
          }
          pendingTokenCompletionRef.current = null
          renderInlineGhostHint(term, ' ...')
          return
        }

        if (candidates.length > 1) {
          const commonPrefix = longestCommonPrefix(candidates)
          if (commonPrefix.length > context.prefix.length) {
            suggestTokenCompletion(
              context.range,
              context.prefix,
              commonPrefix,
              false,
              context.acceptCursorEnd,
              context.replaceEnd
            )
            return
          }

          if (context.range.end === cursorIndexRef.current) {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, formatKeySegmentOptions(context.prefix, candidates))
          } else {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, '...')
          }
          return
        }

        if (keys.length > 0) {
          pendingTokenCompletionRef.current = null
          renderInlineGhostHint(term, ' ...')
          return
        }

        pendingTokenCompletionRef.current = null
        // A truncated scan (hasMore) that found nothing does NOT mean the key is
        // absent — the scan budget was exhausted before a match surfaced. Only
        // claim "no match" when the whole keyspace was scanned to completion.
        renderInlineGhostHint(term, hasMore ? ' scanning… (keep typing to narrow)' : ' no match')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        pendingTokenCompletionRef.current = null
        renderInlineGhostHint(term, ` ${msg}`)
      }
    }

    const completeHashField = async (context: HashFieldCompletionContext): Promise<void> => {
      const connId = connectionIdRef.current
      if (!connId || !isConnectedRef.current) return

      try {
        const response = (await window.redixAPI.cli.completeHashFields(
          connId,
          context.key,
          context.prefix,
          30
        )) as IPCResponse<CLIHashFieldCompletionResult>

        if (!response?.success || !response.data) {
          writeLine(term, response?.error?.message ?? 'Field completion failed', '31')
          redrawPromptAndInput()
          return
        }

        const fields = response.data.fields
        const hasMore = response.data.hasMore
        if (fields.length === 1 && !hasMore) {
          suggestTokenCompletion(context.range, context.prefix, fields[0])
          return
        }

        if (fields.length > 1) {
          const commonPrefix = longestCommonPrefix(fields)
          if (commonPrefix.length > context.prefix.length) {
            suggestTokenCompletion(context.range, context.prefix, commonPrefix, false)
            return
          }

          if (context.range.end === cursorIndexRef.current) {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, fields[0].slice(context.prefix.length))
          } else {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, '...')
          }
          return
        }

        if (fields.length === 1) {
          pendingTokenCompletionRef.current = null
          renderInlineGhostHint(term, ' ...')
          return
        }

        if (!context.prefix) {
          await completeRedisKey({
            prefix: context.keyRange.value,
            range: context.keyRange,
            typeFilter: 'hash',
            acceptCursorEnd: context.range.end,
            replaceEnd: context.range.end,
          })
          return
        }

        pendingTokenCompletionRef.current = null
        renderInlineGhostHint(term, ' no field')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        pendingTokenCompletionRef.current = null
        renderInlineGhostHint(term, ` ${msg}`)
      }
    }

    const completeMember = async (context: MemberCompletionContext): Promise<void> => {
      const connId = connectionIdRef.current
      if (!connId || !isConnectedRef.current) return

      try {
        const response = (await window.redixAPI.cli.completeMembers(
          connId,
          context.key,
          context.prefix,
          context.kind,
          30
        )) as IPCResponse<CLIMemberCompletionResult>

        if (!response?.success || !response.data) {
          writeLine(term, response?.error?.message ?? 'Member completion failed', '31')
          redrawPromptAndInput()
          return
        }

        const members = response.data.members
        const hasMore = response.data.hasMore
        if (members.length === 1 && !hasMore) {
          suggestTokenCompletion(context.range, context.prefix, members[0])
          return
        }

        if (members.length > 1) {
          const commonPrefix = longestCommonPrefix(members)
          if (commonPrefix.length > context.prefix.length) {
            suggestTokenCompletion(context.range, context.prefix, commonPrefix, false)
            return
          }

          if (context.range.end === cursorIndexRef.current) {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, members[0].slice(context.prefix.length))
          } else {
            pendingTokenCompletionRef.current = null
            renderInlineGhostHint(term, '...')
          }
          return
        }

        if (members.length === 1) {
          pendingTokenCompletionRef.current = null
          renderInlineGhostHint(term, ' ...')
          return
        }

        pendingTokenCompletionRef.current = null
        renderInlineGhostHint(term, ' no member')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        pendingTokenCompletionRef.current = null
        renderInlineGhostHint(term, ` ${msg}`)
      }
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

        if (acceptPendingTokenCompletion()) {
          return false
        }

        clearGhostHint(term)
        const buf = inputBufferRef.current

        if (!buf.trim()) {
          term.write('\r\n\x1b[90mCommon patterns:\x1b[0m')
          COMMON_PATTERNS.forEach((pattern) => {
            term.write(`\r\n  \x1b[36m${pattern}\x1b[0m`)
          })
          redrawPromptAndInput()
          return false
        }

        const hashFieldCompletionContext = getHashFieldCompletionContext(buf, cursorIndexRef.current)
        if (hashFieldCompletionContext && connectionIdRef.current && isConnectedRef.current) {
          void completeHashField(hashFieldCompletionContext)
          return false
        }

        const memberCompletionContext = getMemberCompletionContext(buf, cursorIndexRef.current)
        if (memberCompletionContext && connectionIdRef.current && isConnectedRef.current) {
          void completeMember(memberCompletionContext)
          return false
        }

        const keyCompletionContext = getKeyCompletionContext(buf, cursorIndexRef.current)
        if (keyCompletionContext && connectionIdRef.current && isConnectedRef.current) {
          void completeRedisKey(keyCompletionContext)
          return false
        }

        const matches = getCommandMatches(buf)

        if (matches.length === 1) {
          const completed = completeCommandInput(buf, matches[0])
          redrawInput(completed)
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
        cursorIndexRef.current = 0
        clearGhostHint(term)
        term.write('\r\n')
        executeCommand(cmd)
        return
      }

      // Backspace
      if (keyCode === 8) {
        const buf = inputBufferRef.current
        const cursor = cursorIndexRef.current
        if (cursor > 0) {
          const next = `${buf.slice(0, cursor - 1)}${buf.slice(cursor)}`
          redrawInput(next, cursor - 1)
        }
        return
      }

      // Delete
      if (keyCode === 46) {
        const buf = inputBufferRef.current
        const cursor = cursorIndexRef.current
        if (cursor < buf.length) {
          const next = `${buf.slice(0, cursor)}${buf.slice(cursor + 1)}`
          redrawInput(next, cursor)
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
        redrawInput(hist[idx])
        return
      }

      if (keyCode === 37 || keyCode === 39) {
        // Left/Right arrow – move within the current input buffer
        clearGhostHint(term)
        if (keyCode === 37 && cursorIndexRef.current > 0) {
          cursorIndexRef.current -= 1
          term.write('\x1b[D')
        }
        if (keyCode === 39 && cursorIndexRef.current < inputBufferRef.current.length) {
          cursorIndexRef.current += 1
          term.write('\x1b[C')
        }
        return
      }

      // Home / End
      if (keyCode === 36 || keyCode === 35) {
        clearGhostHint(term)
        const cursor = cursorIndexRef.current
        const target = keyCode === 36 ? 0 : inputBufferRef.current.length
        const delta = target - cursor
        if (delta < 0) {
          term.write(`\x1b[${Math.abs(delta)}D`)
        } else if (delta > 0) {
          term.write(`\x1b[${delta}C`)
        }
        cursorIndexRef.current = target
        return
      }

      // Down arrow – next history
      if (keyCode === 40) {
        const hist = historyRef.current
        if (historyIndexRef.current === -1) return
        clearGhostHint(term)
        const nextIdx = historyIndexRef.current + 1
        if (nextIdx >= hist.length) {
          historyIndexRef.current = -1
          redrawInput('')
        } else {
          historyIndexRef.current = nextIdx
          redrawInput(hist[nextIdx])
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
          cursorIndexRef.current = 0
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
        insertTextAtCursor(key)

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
