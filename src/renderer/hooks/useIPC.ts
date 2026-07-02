import { useEffect, useRef } from 'react'
import type { ConnectionStatus } from '../../shared/types'
import { useConnectionStore } from '../store/connectionStore'

/**
 * Hook to listen for connection status changes from the main process.
 */
export function useConnectionStatus(): void {
  const updateConnectionStatus = useConnectionStore((s) => s.updateConnectionStatus)

  useEffect(() => {
    const handler = (data: { id: string; status: string; error?: string }) => {
      updateConnectionStatus(data.id, data.status as ConnectionStatus, data.error)
    }

    const api = window.electronAPI || window.api
    api?.connection?.onStatusChanged(handler)

    // Cleanup: currently preload does not return unsubscribe function;
    // when preload is updated to return one, use it here.
    return () => {
      // no-op for now
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
