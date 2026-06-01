import React from 'react'

const LANG = {
  zh: {
    pause: '暂停', resume: '恢复', stop: '停止',
    download: '下载 PPTX', exportPng: '导出 PNG', exportSvg: '导出 SVG',
    undo: '撤销', redo: '重新生成', clear: '清空图形',
    generating: '生成中...', paused: '已暂停', complete: '完成'
  },
  en: {
    pause: 'Pause', resume: 'Resume', stop: 'Stop',
    download: 'Download PPTX', exportPng: 'Export PNG', exportSvg: 'Export SVG',
    undo: 'Undo', redo: 'Regenerate', clear: 'Clear All',
    generating: 'Generating...', paused: 'Paused', complete: 'Complete'
  }
}

export default function ControlBar({
  isGenerating, isPaused, complete, hasElements,
  canUndo, canRedo,
  onPause, onResume, onStop, onDownload, onExportPng, onExportSvg,
  onClear, onUndo, onRedo,
  language = 'zh'
}) {
  const t = LANG[language]

  return (
    <div className="control-bar">
      {/* Generation controls */}
      {isGenerating && !isPaused && (
        <button onClick={onPause} className="btn btn-warning">⏸ {t.pause}</button>
      )}
      {isGenerating && isPaused && (
        <button onClick={onResume} className="btn btn-success">▶ {t.resume}</button>
      )}
      {isGenerating && (
        <button onClick={onStop} className="btn btn-danger">⏹ {t.stop}</button>
      )}

      {/* Post-generation controls */}
      {complete && (
        <button onClick={onDownload} className="btn btn-primary">⬇ {t.download}</button>
      )}
      {!isGenerating && hasElements && (
        <>
          <button onClick={onExportPng} className="btn btn-primary">🖼 {t.exportPng}</button>
          <button onClick={onExportSvg} className="btn btn-primary">✧ {t.exportSvg}</button>
          <button onClick={onClear} className="btn btn-danger">🗑 {t.clear}</button>
        </>
      )}

      {/* Undo / Redo */}
      {!isGenerating && hasElements && (
        <>
          <button onClick={onUndo} className={`btn btn-ghost${!canUndo ? ' btn-disabled' : ''}`}>↩ {t.undo}</button>
          <button onClick={onRedo} className={`btn btn-ghost${!canRedo ? ' btn-disabled' : ''}`}>↪ {t.redo}</button>
        </>
      )}

      <span className="control-status">
        {isGenerating && (
          <><span className="dot active" />{isPaused ? t.paused : t.generating}</>
        )}
        {!isGenerating && complete && (
          <><span className="dot done" />{t.complete}</>
        )}
      </span>
    </div>
  )
}
