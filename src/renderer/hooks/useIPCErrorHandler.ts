import { useEffect, useState } from 'react'
import type { IPCResponse } from '../../shared/types'
import { useToastStore } from '../components/Toast'

// ---------------------------------------------------------------------------
// Error code → user-friendly message mapping
// ---------------------------------------------------------------------------

const ERROR_MESSAGE_MAP: Record<string, string> = {
  ECONNREFUSED: '无法连接到 Redis 服务器',
  ETIMEDOUT: '连接超时，请检查网络或服务器状态',
  ENOTFOUND: '无法解析主机名，请检查地址配置',
  ECONNRESET: '连接被服务器重置',
  AUTH_FAILED: '认证失败，请检查密码',
  CONN_CLOSED: '连接已关闭',
  SOCKET_TIMEOUT: 'Socket 超时',
  NOAUTH: '需要密码认证',
  WRONGPASS: '密码错误',
  LOADING: 'Redis 正在加载数据，请稍后重试'
}

function resolveErrorMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback
  return ERROR_MESSAGE_MAP[code] ?? fallback
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Wraps an IPC promise and exposes `{ data, loading, error }` state.
 *
 * On failure, a toast notification is automatically shown.
 *
 * ```ts
 * const { data, loading, error } = useIPCErrorHandler(
 *   useMemo(() => window.redixAPI.connection.getStatus(connId), [connId])
 * )
 * ```
 */
export function useIPCErrorHandler<T>(
  promise: Promise<IPCResponse<T>> | undefined
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const toastError = useToastStore((s) => s.error)

  useEffect(() => {
    if (!promise) {
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)
    setData(null)

    promise
      .then((response: IPCResponse<T>) => {
        if (cancelled) return

        if (response.success) {
          setData((response.data as T) ?? null)
        } else {
          const message = resolveErrorMessage(
            response.error?.code,
            response.error?.message ?? 'Unknown error'
          )
          setError(message)
          toastError('操作失败', message)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return

        const message =
          err instanceof Error ? err.message : 'Unexpected error occurred'
        setError(message)
        toastError('请求异常', message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [promise, toastError])

  return { data, loading, error }
}
