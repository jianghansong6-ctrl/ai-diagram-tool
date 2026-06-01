import React, { useState, useRef, useMemo, useEffect } from 'react'

const LANG = {
  zh: {
    placeholder: '描述一个神经网络结构或深度学习机制，例如：Transformer 架构：输入序列经过 Embedding 层映射为词向量...',
    submit: '生成',
    submitting: '生成中...',
    mindmapPlaceholder: '输入文本内容或上传文件，AI 将自动提取关键信息并生成思维导图',
    tablePlaceholder: '输入表格数据，AI 将自动生成表格',
    chartPlaceholder: '输入数据，AI 将自动生成统计图表',
    uploadBtn: '📄 上传文件 (.txt/.pdf/.docx/.png/.jpg)',
    uploading: '解析文件中...',
    fileSelected: '已选择文件',
    clearFile: '✕',
    dropHint: '或将文件拖拽到此处',
    parseError: '文件解析失败',
    types: {
      flowchart: '流程图',
      framework: '框架图',
      logic_diagram: '逻辑图',
      mindmap: '思维导图',
      table: '表格',
      bar_chart: '柱状图',
      line_chart: '折线图',
      pie_chart: '饼状图',
    },
  },
  en: {
    placeholder: 'Describe a neural network architecture or deep learning mechanism...',
    submit: 'Generate',
    submitting: 'Generating...',
    mindmapPlaceholder: 'Paste text content or upload a file, AI will extract key information and generate a mind map',
    tablePlaceholder: 'Enter table data, AI will generate a table',
    chartPlaceholder: 'Enter data, AI will generate a chart',
    uploadBtn: '📄 Upload File (.txt/.pdf/.docx/.png/.jpg)',
    uploading: 'Parsing file...',
    fileSelected: 'File selected',
    clearFile: '✕',
    dropHint: 'or drag & drop a file here',
    parseError: 'Failed to parse file',
    types: {
      flowchart: 'Flowchart',
      framework: 'Framework',
      logic_diagram: 'Logic',
      mindmap: 'Mind Map',
      table: 'Table',
      bar_chart: 'Bar',
      line_chart: 'Line',
      pie_chart: 'Pie',
    },
  },
}

const CHART_TYPES = ['flowchart', 'framework', 'logic_diagram', 'mindmap', 'table', 'bar_chart', 'line_chart', 'pie_chart']
const DATA_TYPES = ['bar_chart', 'line_chart', 'pie_chart']

function hasDataContent(text) {
  if (!text || !text.trim()) return false
  // 1) At least 6 numbers in the text
  const numbers = text.match(/\d+(\.\d+)?/g)
  if (numbers && numbers.length >= 6) return true
  // 2) Multiple lines with consistent delimiters (CSV-like)
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length >= 3) {
    const delimCounts = lines.map(l => {
      const c = (l.match(/,/g) || []).length
      const t = (l.match(/\t/g) || []).length
      const p = (l.match(/\|/g) || []).length
      return Math.max(c, t, p)
    })
    if (delimCounts.every(d => d >= 2 && d === delimCounts[0])) return true
  }
  // 3) Repeated key-value patterns with numbers (e.g. "年份: 2024", "value: 3.5")
  const kvLines = lines.filter(l => /[:：]\s*\d/.test(l))
  if (kvLines.length >= 4) return true
  return false
}

// Read file as text with encoding detection (UTF-8 first, fallback to GBK)
async function readFileAsText(file) {
  const arr = new Uint8Array(await file.arrayBuffer())
  const encodings = ["utf-8", "gbk", "gb2312", "gb18030", "latin1"]
  for (const enc of encodings) {
    try {
      const dec = new TextDecoder(enc, {fatal: false})
      const text = dec.decode(arr)
      if (text.includes("�")) continue
      if (!text.trim()) continue
      return text
    } catch (_) {}
  }
  return new TextDecoder("utf-8", {fatal: false}).decode(arr)
}

export default function PromptInput({ onSubmit, disabled, language = 'zh', chartType = 'flowchart', onChartTypeChange, resetCounter }) {
  const [prompt, setPrompt] = useState('')
  const [fileName, setFileName] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const t = LANG[language]
  const types = t.types

  // Clear prompt/fileName when parent signals a reset (new project, clear all)
  const [prevReset, setPrevReset] = useState(resetCounter)
  if (resetCounter !== prevReset) {
    setPrevReset(resetCounter)
    setPrompt('')
    setFileName('')
  }
  const isMindmap = chartType === 'mindmap'
  const isTable = chartType === 'table'
  const isChart = ['bar_chart', 'line_chart', 'pie_chart'].includes(chartType)
  const showFileUpload = true
  const hasData = useMemo(() => hasDataContent(prompt), [prompt])

  // If current chart type requires data but none detected, switch away
  const prevHasData = useRef(hasData)
  useEffect(() => {
    if (prevHasData.current !== hasData) {
      prevHasData.current = hasData
      if (!hasData && DATA_TYPES.includes(chartType)) {
        onChartTypeChange?.('flowchart')
      }
    }
  }, [hasData, chartType, onChartTypeChange])

  const getPlaceholder = () => {
    if (isMindmap) return t.mindmapPlaceholder
    if (isTable) return t.tablePlaceholder
    if (isChart) return t.chartPlaceholder
    return t.placeholder
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!prompt.trim() || disabled) return
    onSubmit(prompt.trim(), chartType)
  }

  const handleFileProcess = async (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    const supported = ['txt', 'csv', 'pdf', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'bmp']
    if (!supported.includes(ext)) {
      alert(t.parseError + ': .' + ext)
      return
    }
    setFileName(file.name)
    setIsUploading(true)
    try {
      // Always read .txt/.csv files locally (detect UTF-8/GBK encoding)
      if (ext === 'txt' || ext === 'csv') {
        const text = await readFileAsText(file)
        setPrompt(text.trim())
        if (textareaRef.current) textareaRef.current.value = text.trim()
        setIsUploading(false)
        return
      }
      // Other types need the backend
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/parse-document', { method: 'POST', body: formData })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error('HTTP ' + res.status + (errBody ? ': ' + errBody : ''))
      }
      const data = await res.json()
      setPrompt(data.text)
      if (textareaRef.current) textareaRef.current.value = data.text
    } catch (err) {
      console.error('Upload error:', err)
      setFileName('')
      // Try reading as text as last resort
      try {
        const text = await readFileAsText(file)
        if (text.trim()) {
          setPrompt(text.trim())
          if (textareaRef.current) textareaRef.current.value = text.trim()
          return
        }
      } catch (_) {}
      const msg = err.message || ''
      if (msg.includes('HTTP 500') || msg.includes('Failed to parse')) {
        alert(t.parseError)
      } else if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION')) {
        alert(t.parseError + ' - 无法连接后端')
      } else {
        alert(t.parseError)
      }
    } finally {
      setIsUploading(false)
    }
  }
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    handleFileProcess(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    handleFileProcess(file)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleClearFile = () => {
    setFileName('')
  }

  return (
    <form onSubmit={handleSubmit} className="prompt-input">
      {/* Type Selector Grid */}
      <div className="chart-type-grid">
        {CHART_TYPES.map(type => {
          const isDataDisabled = !hasData && DATA_TYPES.includes(type)
          return (
            <button
              key={type}
              type="button"
              className={`chart-type-btn${chartType === type ? ' active' : ''}${isDataDisabled ? ' disabled' : ''}`}
              onClick={() => { if (!isDataDisabled) onChartTypeChange?.(type) }}
              disabled={isDataDisabled}
              title={isDataDisabled ? (language === 'zh' ? '需上传或输入包含数据的文本' : 'Requires data in text') : type}
            >
              {types[type] || type}
            </button>
          )
        })}
      </div>

      {/* File Upload Zone (mindmap & table modes) */}
      {showFileUpload && (
        <div
          className={`file-upload-zone${isDragOver ? ' drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.docx,.png,.jpg,.jpeg,.gif,.bmp"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {isUploading ? (
            <span className="file-uploading">{t.uploading}</span>
          ) : fileName ? (
            <span className="file-selected">{t.fileSelected}: {fileName}</span>
          ) : (
            <>
              <span className="file-upload-icon">{t.uploadBtn}</span>
              <span className="file-hint">{t.dropHint}</span>
            </>
          )}
        </div>
      )}

      {/* Clear file button */}
      {fileName && !isUploading && (
        <div className="file-status">
          <span className="file-name">{fileName}</span>
          <button type="button" className="file-clear" onClick={handleClearFile}>{t.clearFile}</button>
        </div>
      )}

      <div className="panel-section-title">{language === 'zh' ? '描述' : 'Content'}</div>
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={getPlaceholder()}
        rows={isMindmap ? 6 : 8}
        disabled={disabled}
        className="prompt-textarea"
      />
      <button
        type="submit"
        disabled={disabled || !prompt.trim()}
        className="submit-btn"
      >
        {disabled ? t.submitting : t.submit}
      </button>
    </form>
  )
}
