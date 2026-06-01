import React, { useState, useCallback, useRef, useEffect } from 'react'
import Canvas from './components/Canvas'
import PromptInput from './components/PromptInput'
import ControlBar from './components/ControlBar'
import ElementTooltip from './components/ElementTooltip'
import HistoryPanel from './components/HistoryPanel'
import BatchModifyInput from './components/BatchModifyInput'
import LogicPanel from './components/LogicPanel'
import ProgressBar from './components/ProgressBar'
import { hitTest, hitTestBox } from './utils/hitTest'

const LANG = {
  zh: { title: 'AI 科研机制图绘制', generating: '正在生成...', complete: '生成完成', total_time: '总耗时', estimated: '预计', remaining: '剩余', newProject: '＋ 新建项目' },
  en: { title: 'AI Scientific Diagram Tool', generating: 'Generating...', complete: 'Complete', total_time: 'Total', estimated: '~', remaining: 'remaining', newProject: '+ New Project' }
}

export default function App() {
  const [sessionId, setSessionId] = useState(null)
  const [instructions, setInstructions] = useState([])
  const [progress, setProgress] = useState({ completed: 0, total: 0, current_desc: '' })
  const [isGenerating, setIsGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [complete, setComplete] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [language, setLanguage] = useState('zh')
  const [toast, setToast] = useState(null)
  const [logicSummary, setLogicSummary] = useState('')
  const [chartType, setChartType] = useState('flowchart')
  const [isModifying, setIsModifying] = useState(false)
  const [modifyProgress, setModifyProgress] = useState({ current: 0, total: 0 })
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [resetCounter, setResetCounter] = useState(0)
  const handleChartTypeChange = useCallback((newType) => {
    setChartType(newType)
    if (newType === 'mindmap') setLogicSummary('')
  }, [])
  const abortRef = useRef(null)
  const timerRef = useRef(null)
  const completionPendingRef = useRef(false)
  const instCountRef = useRef(0)
  const firstInstTimeRef = useRef(null)
  const canvasRef = useRef(null)
  const startGenerationRef = useRef(null)

  // ── Undo / Regenerate ──
  const instructionsRef = useRef(instructions)
  instructionsRef.current = instructions
  const undoStackRef = useRef([])
  const lastPromptRef = useRef('')
  const lastChartTypeRef = useRef('flowchart')

  const saveUndoPoint = useCallback(() => {
    const current = instructionsRef.current
    if (current.length > 0) {
      undoStackRef.current.push([...current])
      if (undoStackRef.current.length > 50) undoStackRef.current.shift()
    }
  }, [])

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) {
      setToast(language === 'zh' ? '没有可撤销的操作' : 'Nothing to undo')
      return
    }
    setInstructions(undoStackRef.current.pop())
    setComplete(true)
  }, [language])

  // Keyboard shortcut: only Ctrl+Z for undo (no Ctrl+Y redo to avoid accidental regeneration)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        handleUndo()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

  return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo])

  const t = LANG[language]

  // Compute global generation progress percent
  const genPercent = (() => {
    if (!isGenerating && !complete) return 0
    if (complete) return 100
    if (progress.total > 0) return Math.round((progress.completed / progress.total) * 100)
    // Before first progress event, estimate from instruction count
    const count = instructions.length
    if (count > 0) return Math.min(count * 15, 85)
    return 5
  })()

  // Compute ETA
  const estimatedRemaining = (() => {
    const count = instructions.length
    if (!isGenerating || isPaused || count < 2 || elapsed < 3) return null
    const avgPerInst = elapsed / count
    const estTotal = Math.max(count + 2, Math.min(count * 1.5, 10))
    const remaining = Math.round(avgPerInst * (estTotal - count))
    return remaining > 0 ? remaining : null
  })()

  // --- SSE ---
  const handleSSEEvent = useCallback((event, data) => {
    switch (event) {
      case 'session_start':
        setSessionId(data.session_id)
        break
      case 'instruction':
        if (data.action === 'logic_summary') {
          setLogicSummary(data.params?.text || '')
        } else {
          setInstructions(prev => [...prev, data])
          instCountRef.current += 1
          if (!firstInstTimeRef.current) {
            firstInstTimeRef.current = Date.now()
          }
        }
        break
      case 'instruction_updated':
        setInstructions(prev => prev.map(i =>
          i.id === data.id && data.params ? { ...i, ...data } : i
        ))
        break
      case 'instructions_updated':
        if (Array.isArray(data)) {
          setInstructions(prev => prev.map(i => {
            const updated = data.find(d => d.id === i.id)
            return updated ? { ...i, ...updated } : i
          }))
        }
        break
      case 'progress':
        setProgress(data)
        break
      case 'complete':
        // Mark completion as pending so the finally block doesn't reset elapsed
        completionPendingRef.current = true
        setTimeout(() => {
          setComplete(true)
          setIsPaused(false)
          setIsGenerating(false)
          completionPendingRef.current = false
        }, 400)
        break
      case 'error':
        console.error('Generation error:', data.message)
        setIsGenerating(false)
        break
    }
  }, [])

  // --- Elapsed timer ---
  useEffect(() => {
    if (isGenerating) {
      const start = Date.now() - elapsed * 1000
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000))
      }, 1000)
    } else if (!complete) {
      clearInterval(timerRef.current)
      setElapsed(0)
      instCountRef.current = 0
      firstInstTimeRef.current = null
    }

  return () => clearInterval(timerRef.current)
  }, [isGenerating, complete])

  const startGeneration = useCallback(async (prompt, genChartType) => {
    const effectiveType = genChartType || chartType
    lastPromptRef.current = prompt
    lastChartTypeRef.current = effectiveType
    setSessionId(null)
    setInstructions([])
    setProgress({ completed: 0, total: 0, current_desc: '' })
    setComplete(false)
    setSelectedId(null)
    setSelectedIds([])
    setElapsed(0)
    setLogicSummary('')
    setIsPaused(false)
    setIsGenerating(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, language, mode: 'diagram', chart_type: effectiveType }),
        signal: controller.signal
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (!dataStr) continue
            try {
              const data = JSON.parse(dataStr)
              handleSSEEvent(currentEvent, data)
            } catch (_) { /* skip */ }
            currentEvent = ''
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Generation error:', err)
    } finally {
      if (!completionPendingRef.current) {
        setIsGenerating(false)
      }
    }
  }, [handleSSEEvent, language])

  // ── Regenerate (redo): re-submit the last prompt ──
  startGenerationRef.current = startGeneration
  const handleRedo = useCallback(() => {
    if (!lastPromptRef.current) {
      setToast(language === 'zh' ? '没有可重新生成的图像' : 'Nothing to regenerate')
      return
    }
    startGenerationRef.current(lastPromptRef.current, lastChartTypeRef.current)
  }, [language])

  // --- Controls ---
  const controlAction = useCallback(async (action) => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/session/${sessionId}/${action}`, { method: 'POST' })
      if (res.ok) {
        const body = await res.json()
        if (body.status === 'paused') setIsPaused(true)
        else if (body.status === 'resumed') setIsPaused(false)
        else if (body.status === 'stopped') { setIsPaused(false); setIsGenerating(false) }
      }
    } catch (err) {
      console.error(`${action} failed:`, err)
    }
  }, [sessionId])

  const handlePause = () => controlAction('pause')
  const handleResume = () => controlAction('resume')
  const handleStop = () => {
    controlAction('stop')
    abortRef.current?.abort()
  }

  const handleDownload = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/session/${sessionId}/export/pptx`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${sessionId}.pptx`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('Download failed:', err)
    }
  }, [sessionId])

  const handleExportPng = useCallback(() => {
    canvasRef.current?.exportPng()
  }, [])

  const handleExportSvg = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/session/${sessionId}/export/svg`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${sessionId}.svg`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('SVG export failed:', err)
    }
  }, [sessionId])

  // --- Canvas click -> single modify ---
  const handleCanvasClick = useCallback((x, y) => {
    if (isGenerating && !isPaused) return
    setSelectedIds([])
    const id = hitTest(x, y, instructions)
    setSelectedId(id)
    if (id) setTooltipPos({ x, y })
  }, [instructions, isGenerating, isPaused])

  // --- Canvas box selection -> batch modify ---
  const handleBoxSelect = useCallback((x1, y1, x2, y2) => {
    if (isGenerating && !isPaused) return
    setSelectedId(null)
    const ids = hitTestBox(x1, y1, x2, y2, instructions)
    setSelectedIds(ids)
  }, [instructions, isGenerating, isPaused])

  const handleModify = useCallback(async (elementId, instruction) => {
    if (!sessionId) return
    saveUndoPoint()
    setIsModifying(true)
    setModifyProgress({ current: 0, total: 1 })
    try {
      const res = await fetch(`/api/session/${sessionId}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element_id: elementId, instruction })
      })
      setModifyProgress({ current: 1, total: 1 })
      if (res.ok) {
        const body = await res.json()
        if (body.data) {
          setInstructions(prev => prev.map(i =>
            i.id === elementId ? { ...i, ...body.data } : i
          ))
          setToast(language === 'zh' ? '✓ 修改完成' : '✓ Modified')
        } else {
          console.error('Modify: response missing data', body)
          setToast(language === 'zh' ? '✗ 修改失败：返回数据为空' : '✗ Modify failed: empty response')
        }
      } else {
        const errText = await res.text().catch(() => '')
        console.error('Modify HTTP', res.status, errText.slice(0, 200))
        setToast(`${language === 'zh' ? '✗ 修改失败' : '✗ Modify failed'} (${res.status})`)
      }
    } catch (err) {
      console.error('Modify error:', err)
      setToast(language === 'zh' ? '✗ 修改失败' : '✗ Modify failed')
    }
    setIsModifying(false)
    setSelectedId(null)
  }, [sessionId, language, saveUndoPoint])

  const handleBatchModify = useCallback(async (instruction) => {
    if (!sessionId || selectedIds.length === 0) return
    saveUndoPoint()
    setIsModifying(true)
    const total = selectedIds.length
    setModifyProgress({ current: 0, total })
    try {
      const res = await fetch(`/api/session/${sessionId}/modify-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element_ids: selectedIds, instruction })
      })
      setModifyProgress({ current: total, total })
      if (res.ok) {
        const body = await res.json()
        if (Array.isArray(body.data)) {
          setInstructions(prev => prev.map(i => {
            const updated = body.data.find(d => d.id === i.id)
            return updated ? { ...i, ...updated } : i
          }))
          setToast(language === 'zh' ? `✓ 已完成 ${body.data.length} 个元素修改` : `✓ ${body.data.length} elements modified`)
        }
      } else {
        setToast(language === 'zh' ? '✗ 批量修改失败' : '✗ Batch modify failed')
      }
    } catch (err) {
      console.error('Batch modify error:', err)
      setToast(language === 'zh' ? '✗ 批量修改失败' : '✗ Batch modify failed')
    }
    setIsModifying(false)
    setSelectedIds([])
  }, [sessionId, selectedIds, language, saveUndoPoint])

  // --- Element drag ---
  const handleElementDrag = useCallback((elementId, newCoords, connectedArrows = []) => {
    setInstructions(prev => prev.map(inst => {
      if (inst.id === elementId) {
        return { ...inst, params: { ...inst.params, ...newCoords } }
      }
      const arrowUpdate = connectedArrows.find(a => a.id === inst.id)
      if (arrowUpdate) {
        return { ...inst, params: { ...inst.params, ...arrowUpdate.params } }
      }
      return inst
    }))
  }, [])

  // --- Delete ---
  const handleDelete = useCallback(async (elementId) => {
    saveUndoPoint()
    if (!sessionId) {
      setInstructions(prev => prev.filter(i => i.id !== elementId))
      setSelectedId(null)
      return
    }
    try {
      const res = await fetch(`/api/session/${sessionId}/element/${elementId}`, { method: 'DELETE' })
      if (res.ok) {
        setInstructions(prev => prev.filter(i => i.id !== elementId))
        setSelectedId(null)
        setToast(language === 'zh' ? '✓ 已删除' : '✓ Deleted')
      } else {
        setToast(language === 'zh' ? '✗ 删除失败' : '✗ Delete failed')
      }
    } catch (err) {
      console.error('Delete error:', err)
      setToast(language === 'zh' ? '✗ 删除失败' : '✗ Delete failed')
    }
  }, [sessionId, language, saveUndoPoint])

  const handleClearAll = useCallback(async () => {
    saveUndoPoint()
    if (!sessionId) {
      setInstructions([])
      return
    }
    try {
      const res = await fetch(`/api/session/${sessionId}/clear`, { method: 'POST' })
      if (res.ok) {
        setInstructions([])
        setComplete(false)
        setSelectedId(null)
        setSelectedIds([])
        setLogicSummary('')
        setResetCounter(prev => prev + 1)
        setToast(language === 'zh' ? '✓ 已清空' : '✓ Cleared')
      } else {
        setToast(language === 'zh' ? '✗ 清空失败' : '✗ Clear failed')
      }
    } catch (err) {
      console.error('Clear error:', err)
      setToast(language === 'zh' ? '✗ 清空失败' : '✗ Clear failed')
    }
  }, [sessionId, language, saveUndoPoint])

  // --- History ---
  const handleHistorySelect = useCallback((historyInstructions, session) => {
    let summary = ''
    const filtered = historyInstructions.map(i => {
      let parsed = i.params
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed) } catch (_) { parsed = {} }
      }
      return { ...i, params: parsed }
    }).filter(i => {
      if (i.action === 'logic_summary') {
        summary = i.params?.text || ''
        return false
      }
      return true
    })
    setLogicSummary(summary)
    setInstructions(filtered)
    setComplete(true)
    setIsGenerating(false)
    setIsPaused(false)
    setSessionId(session.id)
    setSelectedId(null)
    setSelectedIds([])
    undoStackRef.current = []
  }, [])

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2000)

  return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {

  return () => abortRef.current?.abort()
  }, [])

  const selectedElement = selectedId
    ? instructions.find(i => i.id === selectedId)
    : null

  const statusDot = isGenerating
    ? (isPaused ? 'paused' : 'generating')
    : (complete ? 'complete' : '')



  const handleNewProject = useCallback(() => {
    setSessionId(null)
    setInstructions([])
    setProgress({ completed: 0, total: 0, current_desc: '' })
    setComplete(false)
    setIsGenerating(false)
    setIsPaused(false)
    setSelectedId(null)
    setSelectedIds([])
    setLogicSummary('')
    undoStackRef.current = []
    lastPromptRef.current = ''
  }, [])

  return (
    <>
      <header className="app-header">
        
<div className="header-title-row"><h1>{t.title}</h1><button className="new-project-btn" onClick={handleNewProject} disabled={isGenerating}>{t.newProject}</button></div>
        {isGenerating && (
          <span className="header-status">
            <span className={`dot ${statusDot}`} />
            {t.generating}
            <span className="elapsed">{elapsed}s</span>
            {instructions.length > 0 && (
              <span className="inst-count">{instructions.length}条</span>
            )}
            {estimatedRemaining !== null && (
              <span className="eta">{t.estimated}{estimatedRemaining}s {t.remaining}</span>
            )}
          </span>
        )}
        {!isGenerating && complete && (
          <span className="header-status">
            <span className="dot complete" />
            {t.complete}
            <span className="elapsed" style={{ color: 'var(--text-secondary)' }}>
              ({t.total_time} {elapsed}s)
            </span>
          </span>
        )}
        {/* Global generation progress bar */}
        <ProgressBar
          percent={genPercent}
          label={isGenerating ? (isPaused ? (language === 'zh' ? '已暂停' : 'Paused') : `${genPercent}%`) : complete ? '100%' : ''}
          sublabel={isGenerating && progress.current_desc ? progress.current_desc : ''}
          visible={isGenerating || complete}
        />
      </header>
      <div className="app-body">
        <div className={`history-sidebar${leftCollapsed ? ' collapsed' : ''}`}>
          <button
            className="collapse-btn left"
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            title={leftCollapsed ? (language === 'zh' ? '展开历史记录' : 'Expand history') : (language === 'zh' ? '收起历史记录' : 'Collapse history')}
          >
            {leftCollapsed ? '▶' : '◀'}
          </button>
          {!leftCollapsed && <HistoryPanel onSelect={handleHistorySelect} language={language} />}
        </div>
        <div className="center-column">
          <ProgressBar
            percent={modifyProgress.total > 0 ? Math.round((modifyProgress.current / modifyProgress.total) * 100) : 0}
            label={language === 'zh' ? `正在修改...` : `Modifying...`}
            indeterminate={isModifying}
            visible={isModifying}
          />
          <Canvas
            ref={canvasRef}
            instructions={instructions}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onCanvasClick={handleCanvasClick}
            onBoxSelect={handleBoxSelect}
            onElementDrag={handleElementDrag}
            language={language}
          />
        </div>
        <LogicPanel
          text={logicSummary}
          language={language}
          isGenerating={isGenerating}
        />
        <div className={`right-panel${rightCollapsed ? ' collapsed' : ''}`}>
          <button
            className="collapse-btn right"
            onClick={() => setRightCollapsed(!rightCollapsed)}
            title={rightCollapsed ? (language === 'zh' ? '展开控制面板' : 'Expand panel') : (language === 'zh' ? '收起控制面板' : 'Collapse panel')}
          >
            {rightCollapsed ? '◀' : '▶'}
          </button>
          {!rightCollapsed && <>
            <PromptInput
              resetCounter={resetCounter}
              onSubmit={startGeneration}
              disabled={isGenerating}
              language={language}
              chartType={chartType}
              onChartTypeChange={handleChartTypeChange}
            />
            <div className="language-selector">
              <button
                onClick={() => setLanguage('zh')}
                className={`lang-btn ${language === 'zh' ? 'active-zh' : ''}`}
              >中文</button>
              <button
                onClick={() => setLanguage('en')}
                className={`lang-btn ${language === 'en' ? 'active-en' : ''}`}
              >English</button>
            </div>
            <ControlBar
              isGenerating={isGenerating}
              isPaused={isPaused}
              complete={complete}
              hasElements={instructions.length > 0}
              canUndo={undoStackRef.current.length > 0}
              canRedo={!!lastPromptRef.current}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              onDownload={handleDownload}
              onExportPng={handleExportPng}
              onExportSvg={handleExportSvg}
              onClear={handleClearAll}
              onUndo={handleUndo}
              onRedo={handleRedo}
              language={language}
            />
            {selectedIds.length > 0 && (
              <BatchModifyInput
                count={selectedIds.length}
                onSubmit={handleBatchModify}
                onCancel={() => setSelectedIds([])}
                language={language}
              />
            )}
          </>}
        </div>
      </div>
      {selectedElement && (
        <ElementTooltip
          element={selectedElement}
          position={tooltipPos}
          onModify={handleModify}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
          language={language}
        />
      )}
      {toast && <div className="toast-notification">{toast}</div>}
    </>
  )
}
