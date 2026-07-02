import { create } from 'zustand'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import type { ReactElement, CSSProperties } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastType = 'success' | 'warning' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration: number
  exiting: boolean
}

interface ToastStore {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id' | 'exiting'>) => void
  removeToast: (id: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 3
const EXIT_DURATION_MS = 200

let idCounter = 0

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++idCounter}`
    const entry: Toast = { ...toast, id, exiting: false }
    set((state) => ({ toasts: [...state.toasts, entry] }))

    // Schedule auto-dismiss
    setTimeout(() => {
      get().removeToast(id)
    }, toast.duration)
  },

  removeToast: (id) => {
    // Phase 1: trigger exit animation
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    }))
    // Phase 2: remove from array after animation completes
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, EXIT_DURATION_MS)
  },

  success: (title, message) =>
    get().addToast({ type: 'success', title, message, duration: 3000 }),

  error: (title, message) =>
    get().addToast({ type: 'error', title, message, duration: 5000 }),

  warning: (title, message) =>
    get().addToast({ type: 'warning', title, message, duration: 4000 }),

  info: (title, message) =>
    get().addToast({ type: 'info', title, message, duration: 3000 })
}))

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const TOAST_ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info
}

// ---------------------------------------------------------------------------
// ToastItem
// ---------------------------------------------------------------------------

interface ToastItemProps {
  toast: Toast
}

function ToastItem({ toast }: ToastItemProps): ReactElement {
  const removeToast = useToastStore((s) => s.removeToast)
  const Icon = TOAST_ICONS[toast.type]

  const exitStyle: CSSProperties | undefined = toast.exiting
    ? {
        opacity: 0,
        transform: 'translateX(24px)',
        transition: `opacity ${EXIT_DURATION_MS}ms ease, transform ${EXIT_DURATION_MS}ms ease`
      }
    : undefined

  return (
    <div className={`toast ${toast.type}`} style={exitStyle}>
      <Icon className="toast-icon" size={18} />
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
      </div>
      <button
        className="toast-close"
        onClick={() => removeToast(toast.id)}
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ToastContainer  – mount once at the app root
// ---------------------------------------------------------------------------

export function ToastContainer(): ReactElement {
  const toasts = useToastStore((s) => s.toasts)

  // Render: all currently-exiting toasts (for animation) + up to MAX_VISIBLE active toasts
  const exitingToasts = toasts.filter((t) => t.exiting)
  const activeToasts = toasts.filter((t) => !t.exiting).slice(0, MAX_VISIBLE)
  const visibleToasts = [...exitingToasts, ...activeToasts]

  return (
    <div className="toast-container">
      {visibleToasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// useToast  – convenience hook for other components
// ---------------------------------------------------------------------------

export function useToast(): Pick<
  ToastStore,
  'success' | 'error' | 'warning' | 'info' | 'addToast' | 'removeToast'
> {
  return {
    success: useToastStore((s) => s.success),
    error: useToastStore((s) => s.error),
    warning: useToastStore((s) => s.warning),
    info: useToastStore((s) => s.info),
    addToast: useToastStore((s) => s.addToast),
    removeToast: useToastStore((s) => s.removeToast)
  }
}
