import React, { useState, useCallback, useRef, useEffect } from 'react'

const LANG = {
  zh: {
    title: '逻辑说明',
    empty: '暂无说明',
    generating: '正在生成说明...',
  },
  en: {
    title: 'Diagram Logic',
    empty: 'No description yet',
    generating: 'Generating description...',
  },
}

export default function LogicPanel({
  text,
  language = 'zh',
  isGenerating,
}) {
  const t = LANG[language]
  const [collapsed, setCollapsed] = useState(false)
  const [position, setPosition] = useState(() => {
    // Position to the right of the canvas center, staying within viewport
    const maxX = Math.max(window.innerWidth - 380, 10)
    return { x: Math.min(640, maxX), y: 80 }
  })
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef(null)
  const posRef = useRef(position)
  const offsetRef = useRef({ x: 0, y: 0 })
  const mouseDownPosRef = useRef({ x: 0, y: 0 })

  // Keep ref in sync
  posRef.current = position

  const handleMouseDown = useCallback((e) => {
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY }
    offsetRef.current = {
      x: e.clientX - posRef.current.x,
      y: e.clientY - posRef.current.y,
    }
    setDragging(true)
  }, [])

  const handleHeaderClick = useCallback((e) => {
    // Only toggle collapse when clicking (not dragging)
    const dx = Math.abs(e.clientX - mouseDownPosRef.current.x)
    const dy = Math.abs(e.clientY - mouseDownPosRef.current.y)
    if (dx < 4 && dy < 4) {
      setCollapsed(prev => !prev)
    }
  }, [])

  useEffect(() => {
    if (!dragging) return
    const handleMouseMove = (e) => {
      // Constrain within viewport with 10px margin
      const el = panelRef.current
      const pw = el ? el.offsetWidth : 320
      const ph = el ? el.offsetHeight : 200
      const newPos = {
        x: Math.max(10, Math.min(e.clientX - offsetRef.current.x, window.innerWidth - pw - 10)),
        y: Math.max(10, Math.min(e.clientY - offsetRef.current.y, window.innerHeight - ph - 10)),
      }
      posRef.current = newPos
      setPosition(newPos)
    }
    const handleMouseUp = () => setDragging(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging])

  // Keep last text so panel persists after generation
  // Only update ref when text is non-empty (preserves old text during transitions)
  const textRef = useRef(text || '')
  if (text) textRef.current = text
  const displayText = text || textRef.current
  if (!displayText && !isGenerating) return null

  return (
    <div
      ref={panelRef}
      className={`logic-panel-float${collapsed ? ' collapsed' : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="logic-panel-header"
        onMouseDown={handleMouseDown}
        onClick={handleHeaderClick}
      >
        <span className="logic-panel-title">{t.title}</span>
        <span className="logic-panel-toggle">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="logic-panel-body">
          {isGenerating && !displayText ? (
            <div className="logic-panel-loading">
              <span className="logic-spinner" />
              {t.generating}
            </div>
          ) : (
            <p>{displayText}</p>
          )}
        </div>
      )}
    </div>
  )
}
