import { useEffect, useRef } from 'react'
import type { ConnectionStatus } from '../shared/types'
import { useConnectionStore } from '../store/connectionStore'

/**
 * Hook to listen for connection status changes from the native backend.
 */
export function useConnectionStatus(): void {
  const updateConnectionStatus = useConnectionStore((s) => s.updateConnectionStatus)

  useEffect(() => {
    const handler = (data: { id: string; status: string; error?: string }) => {
      updateConnectionStatus(data.id, data.status as ConnectionStatus, data.error)
    }

    const unsubscribe = window.redixAPI.connection.onStatusChanged(handler)

    return () => {
      unsubscribe?.()
    }
  }, [updateConnectionStatus])
}

/**
 * Interval hook — calls `callback` every `delay` ms.
 * Pass `null` as delay to pause.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (delay === null) return
    const id = setInterval(() => savedCallback.current(), delay)
    return () => clearInterval(id)
  }, [delay])
}
