import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit3, Save, X, Copy, Eye, EyeOff } from 'lucide-react'
import { useToastStore } from '../Toast'
import { formatDisplayValue } from '../../utils/format'
import { useI18n } from '../../i18n'

interface StringEditorProps {
  connectionId: string
  keyName: string
}

type ViewMode = 'text' | 'json'

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

  const loadValue = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = (await window.redixAPI.data.view(connectionId, keyName)) as {
        success: boolean
        data?: unknown
      }
      if (result.success && result.data !== undefined) {
        const raw = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
        const truncated = raw.length > 1_000_000
        const display = truncated ? raw.slice(0, 1_000_000) : raw
        setValue(display)
        setOriginalValue(display)
        setIsTruncated(truncated)
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
      try {
        JSON.parse(value)
        setViewMode('json')
      } catch {
        setViewMode('text')
      }
    }
  }, [value])

  const displayValue = useMemo(() => {
    if (viewMode === 'json') {
      try {
        const parsed = JSON.parse(value)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return value
      }
    }
    return showEscaped ? formatDisplayValue(value) : value
  }, [value, viewMode, showEscaped])

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
    navigator.clipboard.writeText(value).then(
      () => useToastStore.getState().success(t('toast.copied')),
      () => useToastStore.getState().error(t('toast.copyFailed'))
    )
  }, [value, t])

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
          </div>
        </div>
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
          <button className="btn btn-secondary btn-sm" onClick={() => setIsEditing(true)}>
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
