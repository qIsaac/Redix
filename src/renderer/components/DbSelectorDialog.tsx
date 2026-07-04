import React, { useState, useMemo, useRef, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, Database } from 'lucide-react'
import { useI18n } from '../i18n'

interface DbSelectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionName: string
  currentDb: number
  dbCounts?: Record<string, number> // Supports both numeric keys and Redis keyspace names like db0.
  onSelect: (dbNumber: number) => void
}

const INITIAL_LOAD_COUNT = 50 // 初始加载数量
const LOAD_MORE_COUNT = 50 // 每次加载更多数量

export const DbSelectorDialog: React.FC<DbSelectorDialogProps> = ({
  open,
  onOpenChange,
  connectionName,
  currentDb,
  dbCounts = {},
  onSelect,
}) => {
  const t = useI18n((s) => s.t)
  const [searchTerm, setSearchTerm] = useState('')
  const [visibleCount, setVisibleCount] = useState(INITIAL_LOAD_COUNT)
  const listRef = useRef<HTMLDivElement>(null)

  const getDbCount = (dbNum: number): number => {
    return dbCounts[String(dbNum)] ?? dbCounts[`db${dbNum}`] ?? 0
  }

  // 生成所有数据库列表 (0-255)
  const allDatabases = useMemo(() => {
    return Array.from({ length: 256 }, (_, i) => i)
  }, [])

  // 根据搜索词过滤
  const filteredDatabases = useMemo(() => {
    if (!searchTerm.trim()) {
      return allDatabases
    }
    const term = searchTerm.toLowerCase()
    return allDatabases.filter((dbNum) => {
      const count = getDbCount(dbNum)
      return (
        String(dbNum).includes(term) ||
        `db${dbNum}`.toLowerCase().includes(term) ||
        String(count).includes(term)
      )
    })
  }, [allDatabases, searchTerm, dbCounts])

  // 当前显示的数据库列表（根据 visibleCount 截取）
  const visibleDatabases = useMemo(() => {
    return filteredDatabases.slice(0, visibleCount)
  }, [filteredDatabases, visibleCount])

  // 重置显示数量当搜索词改变时
  useEffect(() => {
    setVisibleCount(INITIAL_LOAD_COUNT)
  }, [searchTerm])

  const handleSelect = (dbNumber: number) => {
    onSelect(dbNumber)
    onOpenChange(false)
  }

  // 处理滚动事件，实现无限加载
  const handleScroll = () => {
    if (!listRef.current) return
    
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    // 当滚动到距离底部 100px 时，加载更多
    if (scrollHeight - scrollTop - clientHeight < 100 && visibleCount < filteredDatabases.length) {
      setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, filteredDatabases.length))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" style={{ maxWidth: 480, width: '100%' }}>
          <Dialog.Title className="dialog-title">
            {t('dbSelector.selectDatabase')}
          </Dialog.Title>
          <Dialog.Description className="dialog-description">
            {t('dbSelector.selectDesc', { name: connectionName })}
          </Dialog.Description>

          {/* 搜索框 */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)',
              }}
            />
            <input
              type="text"
              placeholder={t('dbSelector.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px 8px 32px',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                backgroundColor: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 'var(--font-size-sm)',
                outline: 'none',
              }}
            />
          </div>

          {/* 数据库列表 - 支持无限滚动 */}
          <div
            ref={listRef}
            onScroll={handleScroll}
            style={{
              maxHeight: 400,
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
            }}
          >
            {visibleDatabases.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                }}
              >
                <Database size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <div>{t('dbSelector.noResults')}</div>
              </div>
            ) : (
              <>
                {visibleDatabases.map((dbNum) => {
                  const count = getDbCount(dbNum)
                  const isCurrent = dbNum === currentDb
                  return (
                    <button
                      key={dbNum}
                      onClick={() => handleSelect(dbNum)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '10px 14px',
                        border: 'none',
                        borderBottom: '1px solid var(--border-color)',
                        backgroundColor: isCurrent ? 'var(--bg-selected)' : 'transparent',
                        color: isCurrent ? 'var(--text-accent)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = 'var(--bg-hover)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Database size={14} style={{ opacity: 0.7 }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                          {t('dbSelector.databaseLabel', { num: dbNum })}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--text-tertiary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {count.toLocaleString()} keys
                      </span>
                    </button>
                  )
                })}
                
                {/* 加载提示 */}
                {visibleCount < filteredDatabases.length && (
                  <div
                    style={{
                      padding: '12px',
                      textAlign: 'center',
                      color: 'var(--text-tertiary)',
                      fontSize: 'var(--font-size-xs)',
                    }}
                  >
                    加载中... ({visibleCount}/{filteredDatabases.length})
                  </div>
                )}
              </>
            )}
          </div>

          <Dialog.Close asChild>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
              {t('common.close')}
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
