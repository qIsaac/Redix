import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useI18n } from '../i18n'

interface DatabaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionName: string
  mode?: 'add' | 'edit'
  initialDbNumber?: number
  initialAlias?: string
  onConfirm: (dbNumber: number, alias: string) => void
}

export const DatabaseDialog: React.FC<DatabaseDialogProps> = ({
  open,
  onOpenChange,
  connectionName,
  mode = 'add',
  initialDbNumber,
  initialAlias,
  onConfirm,
}) => {
  const t = useI18n((s) => s.t)
  const [dbNumber, setDbNumber] = useState('0')
  const [alias, setAlias] = useState('')

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit') {
        setDbNumber(String(initialDbNumber ?? 0))
        setAlias(initialAlias ?? '')
      } else {
        setDbNumber('0')
        setAlias('')
      }
    }
  }, [open, mode, initialDbNumber, initialAlias])

  const handleConfirm = (): void => {
    const num = parseInt(dbNumber, 10)
    if (isNaN(num) || num < 0 || num > 15) return
    const displayAlias = alias.trim() || `db${num}`
    onConfirm(num, displayAlias)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" onKeyDown={handleKeyDown}>
          <Dialog.Title className="dialog-title">
            {mode === 'edit' ? t('dbDialog.editDatabase') : t('dbDialog.addDatabase')}
          </Dialog.Title>
          <Dialog.Description className="dialog-description">
            {t('dbDialog.addDesc', { name: connectionName })}
          </Dialog.Description>
          <div className="dialog-field">
            <label>{t('dbDialog.databaseRange')}</label>
            <input
              type="number"
              min="0"
              max="15"
              value={dbNumber}
              onChange={(e) => setDbNumber(e.target.value)}
              className="input"
            />
          </div>
          <div className="dialog-field">
            <label>{t('dbDialog.alias')}</label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={`db${dbNumber}`}
              className="input"
            />
          </div>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="btn btn-ghost btn-sm">{t('dbDialog.cancel')}</button>
            </Dialog.Close>
            <button className="btn btn-primary btn-sm" onClick={handleConfirm}>
              {mode === 'edit' ? t('dbDialog.save') : t('dbDialog.add')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
