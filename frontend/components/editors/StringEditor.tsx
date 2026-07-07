import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit3, Save, X, Copy, Eye, EyeOff } from 'lucide-react'
import { useToastStore } from '../Toast'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface StringEditorProps {
  connectionId: string
  keyName: string
}

type ViewMode = 'text' | 'json' | 'hex'

interface StringValuePayload {
  kind?: 'string'
  value?: string
  textPreview?: string
  hexDump?: string
  length?: number
  previewLength?: number
  isBinary?: boolean
  isTruncated?: boolean
}

function extractJsonPreview(value: string): string | null {
  const candidates = [value]
  const objectStart = value.search(/[\[{]/)
  if (objectStart > 0) {
    candidates.push(value.slice(objectStart))
  }

  for (const candidate of candidates) {
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2)
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const StringEditorInner: React.FC<StringEditorProps> = ({ connectionId, keyName }) => {
  const t = useI18n((s) => s.t)
  const [value, setValue] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('json')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const [originalValue, setOriginalValue] = useState('')
  const [showEscaped, setShowEscaped] = useState(true)
  const [hexDump, setHexDump] = useState('')
  const [isBinary, setIsBinary] = useState(false)
  const [valueLength, setValueLength] = useState<number | null>(null)
  const [jsonPreview, setJsonPreview] = useState<string | null>(null)

  const loadValue = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = (await window.redixAPI.data.view(connectionId, keyName, { type: 'string' })) as {
        success: boolean
        data?: unknown
      }
      if (result.success && result.data !== undefined) {
        const payload = result.data as StringValuePayload
        const hasStructuredPayload =
          payload && typeof payload === 'object' && ('value' in payload || 'textPreview' in payload || 'hexDump' in payload)
        const raw = hasStructuredPayload
          ? String(payload.textPreview ?? payload.value ?? '')
          : String(result.data)
        const binary = Boolean(hasStructuredPayload && payload.isBinary)
        const truncated = Boolean(hasStructuredPayload ? payload.isTruncated : raw.length > 1_000_000)
        const display = truncated ? raw.slice(0, 1_000_000) : raw
        setValue(display)
        setOriginalValue(display)
        setIsTruncated(truncated)
        setHexDump(hasStructuredPayload ? payload.hexDump ?? '' : '')
        setIsBinary(binary)
        setValueLength(hasStructuredPayload && typeof payload.length === 'number' ? payload.length : null)
        const extractedJson = extractJsonPreview(display)
        setJsonPreview(extractedJson)
        setViewMode(extractedJson ? 'json' : 'text')
      }
    } catch {
      useToastStore.getState().error(t('toast.loadFailed'), t('toast.couldNotLoad'))
    } finally {
      setIsLoading(false)
    }
  }, [connectionId, keyName])

  useEffect(() => {
    loadValue()
  }, [loadValue])

  // Auto-detect JSON and switch view mode accordingly
  useEffect(() => {
    if (value) {
      const extractedJson = extractJsonPreview(value)
      setJsonPreview(extractedJson)
      if (extractedJson && viewMode !== 'hex') {
        setViewMode('json')
      } else if (!extractedJson && viewMode === 'json') {
        setViewMode('text')
      }
    }
  }, [value, viewMode])

  const displayValue = useMemo(() => {
    if (viewMode === 'json') {
      return jsonPreview ?? value
    }
    if (viewMode === 'hex') return hexDump
    return showEscaped ? formatDisplayValue(value) : value
  }, [value, viewMode, showEscaped, hexDump, jsonPreview])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const result = (await window.redixAPI.data.update(connectionId, keyName, value)) as {
        success: boolean
        error?: { message: string }
      }
      if (result.success) {
        useToastStore.getState().success(t('toast.saved'), t('toast.stringUpdated'))
        setOriginalValue(value)
        setIsEditing(false)
      } else {
        useToastStore.getState().error(t('toast.saveFailed'), result.error?.message ?? 'Unknown error')
      }
    } catch {
      useToastStore.getState().error(t('toast.saveFailed'), t('toast.couldNotUpdate'))
    } finally {
      setIsSaving(false)
    }
  }, [connectionId, keyName, value])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(viewMode === 'hex' ? hexDump : value).then(
      () => useToastStore.getState().success(t('toast.copied')),
      () => useToastStore.getState().error(t('toast.copyFailed'))
    )
  }, [value, hexDump, viewMode, t])

  const textareaHeight = value.length > 1000 ? '400px' : '200px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(var(--bg-primary-rgb, 255,255,255), 0.6)',
            zIndex: 1,
            borderRadius: 6,
          }}
        >
          <div className="empty-state-title" style={{ padding: 0 }}>{t('editor.loading')}</div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="tabs" style={{ flexDirection: 'row' }}>
          <div className="tabs-list" style={{ width: 'auto' }}>
            <button
              className={`tab-button ${viewMode === 'json' ? 'active' : ''}`}
              style={{ flex: 'none', padding: '3px 12px', fontSize: 'var(--font-size-sm)' }}
              onClick={() => setViewMode('json')}
              disabled={!jsonPreview}
            >
              {t('editor.json')}
            </button>
            <button
              className={`tab-button ${viewMode === 'text' ? 'active' : ''}`}
              style={{ flex: 'none', padding: '3px 12px', fontSize: 'var(--font-size-sm)' }}
              onClick={() => setViewMode('text')}
            >
              {t('editor.text')}
            </button>
            {hexDump && (
              <button
                className={`tab-button ${viewMode === 'hex' ? 'active' : ''}`}
                style={{ flex: 'none', padding: '3px 12px', fontSize: 'var(--font-size-sm)' }}
                onClick={() => setViewMode('hex')}
              >
                HEX
              </button>
            )}
          </div>
        </div>
        {valueLength != null && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
            {valueLength} bytes
          </span>
        )}
        <div style={{ flex: 1 }} />
        {viewMode === 'text' && !isEditing && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowEscaped(!showEscaped)}
            title={showEscaped ? t('editor.showRaw') : t('editor.escapeChars')}
          >
            {showEscaped ? <EyeOff size={13} /> : <Eye size={13} />}
            {showEscaped ? t('editor.escaped') : t('editor.raw')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={handleCopy} title={t('editor.copyValue')}>
          <Copy size={13} />
        </button>
        {isEditing ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={isSaving}>
              <Save size={13} />
              {isSaving ? t('editor.saving') : t('editor.save')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setValue(originalValue)
                setIsEditing(false)
              }}
            >
              <X size={13} />
              {t('editor.cancel')}
            </button>
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setIsEditing(true)} disabled={isBinary}>
            <Edit3 size={13} />
            {t('editor.edit')}
          </button>
        )}
      </div>

      {/* Value area */}
      {isEditing ? (
        <textarea
          className="input mono"
          style={{
            width: '100%',
            minHeight: textareaHeight,
            resize: 'vertical',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-sm)',
            lineHeight: 1.6,
          }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('editor.stringValue')}
        />
      ) : (
        <div
          className="card"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-sm)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 500,
            overflow: 'auto',
            padding: 12,
          }}
        >
          {displayValue || <span style={{ color: 'var(--text-tertiary)' }}>{t('editor.empty')}</span>}
        </div>
      )}

      {isTruncated && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--warning-color)' }}>
          {t('editor.truncated')}
        </div>
      )}
    </div>
  )
}

export default React.memo(StringEditorInner)
