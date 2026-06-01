import React, { useEffect, useState } from 'react'

const LANG = {
  zh: { title: '历史记录', refresh: '刷新', loading: '加载中...', empty: '暂无记录' },
  en: { title: 'History', refresh: 'Refresh', loading: 'Loading...', empty: 'No records' }
}

export default function HistoryPanel({ onSelect, language = 'zh' }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const t = LANG[language]

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/history')
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch (err) {
      console.error('Failed to fetch history:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const handleSelect = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        if (onSelect) onSelect(data.instructions, data.session)
      }
    } catch (err) {
      console.error('Failed to load history:', err)
    }
  }

  const handleDelete = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      }
    } catch (err) {
      console.error('Failed to delete history:', err)
    }
  }

  return (
    <>
      <div className="history-header">
        <span className="history-header-label">{t.title}</span>
        <button onClick={fetchHistory} className="history-refresh-btn">{t.refresh}</button>
      </div>
      {loading && <div className="history-loading">{t.loading}</div>}
      <div className="history-list">
        {sessions.length === 0 && !loading && (
          <div className="history-empty">{t.empty}</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSelect(s.id)}
            className="history-item"
          >
            <div className="history-item-prompt">{s.prompt}</div>
            <div className="history-item-time">
              {(() => {
                const t = s.created_at
                const d = typeof t === 'number'
                  ? new Date(t)
                  : new Date(t + (t.includes('T') ? '' : 'Z'))
                return d.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')
              })()}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
              title="删除"
              className="history-item-delete"
            >×</button>
          </div>
        ))}
      </div>
    </>
  )
}
