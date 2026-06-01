import React, { forwardRef, useImperativeHandle } from 'react'
import { useCanvas } from '../hooks/useCanvas'

const LANG = {
  zh: { hint: '点击拖拽框选元素 | 长按2秒后拖动平移画布 | Shift+拖拽框选' },
  en: { hint: 'Drag to box-select | Hold 2s then drag to pan | Shift+drag to select' }
}

const Canvas = forwardRef(function Canvas({ instructions, selectedId, selectedIds, onCanvasClick, onBoxSelect, onElementDrag, language = 'zh' }, ref) {
  const { canvasRef, width, height, exportPng, zoomIn, zoomOut } = useCanvas(
    instructions, selectedId, selectedIds, onCanvasClick, onBoxSelect, onElementDrag
  )
  const t = LANG[language]

  useImperativeHandle(ref, () => ({ exportPng, zoomIn, zoomOut }), [exportPng, zoomIn, zoomOut])

  return (
    <div className="canvas-area">
      <canvas ref={canvasRef} />
      <div className="canvas-hint">
        <button className="zoom-btn" onClick={zoomOut} title="缩小">−</button>
        <button className="zoom-btn" onClick={zoomIn} title="放大">+</button>
        &nbsp; {width}×{height} &middot; {t.hint}
      </div>
    </div>
  )
})

export default Canvas
