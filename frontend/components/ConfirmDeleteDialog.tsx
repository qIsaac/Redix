import React from 'react'
import { Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'

interface ConfirmDeleteDialogProps {
  open: boolean
  target: string
  confirming?: boolean
  onCancel: () => void
  onConfirm: () => void
}

const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({ open, target, confirming = false, onCancel, onConfirm }) => {
  const t = useI18n((s) => s.t)

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={confirming ? undefined : onCancel}>
      <div className="dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trash2 size={16} />
          {t('confirm.deleteTitle')}
        </div>
        <div className="dialog-description" style={{ overflowWrap: 'anywhere' }}>
          {t('confirm.deleteDesc', { target })}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={confirming}>
            {t('confirm.cancel')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onConfirm} disabled={confirming}>
            <Trash2 size={13} />
            {confirming ? t('confirm.deleting') : t('confirm.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDeleteDialog
