import { useRef, useEffect, useCallback } from 'react'
import { hitTest, getElementBounds, rectsOverlap } from '../utils/hitTest'

// roundRect polyfill for browsers that don't support it yet
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
    const r = Math.min(typeof radii === 'number' ? radii : (radii?.[0] ?? 0), Math.min(w, h) / 2)
    this.moveTo(x + r, y)
    this.lineTo(x + w - r, y)
    this.quadraticCurveTo(x + w, y, x + w, y + r)
    this.lineTo(x + w, y + h - r)
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    this.lineTo(x + r, y + h)
    this.quadraticCurveTo(x, y + h, x, y + h - r)
    this.lineTo(x, y + r)
    this.quadraticCurveTo(x, y, x + r, y)
    this.closePath()
  }
}

const CANVAS_WIDTH = 1200
const CANVAS_HEIGHT = 800
const DRAG_THRESHOLD = 5
const FADE_DURATION = 350 // ms for fade-in animation
const SNAP_THRESHOLD = 6
const ARROW_EP_THRESHOLD = 14 // px for arrow endpoint grab

export function useCanvas(instructions, selectedId, selectedIds, onCanvasClick, onBoxSelect, onElementDrag) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const instRef = useRef(instructions)
  instRef.current = instructions
  const selIdRef = useRef(selectedId)
  selIdRef.current = selectedId
  const selIdsRef = useRef(selectedIds || [])
  selIdsRef.current = selectedIds || []
  const onClickRef = useRef(onCanvasClick)
  onClickRef.current = onCanvasClick
  const onBoxRef = useRef(onBoxSelect)
  onBoxRef.current = onBoxSelect
  const onDragRef = useRef(onElementDrag)
  onDragRef.current = onElementDrag
  const rafRef = useRef(null)
  const hoveredIdRef = useRef(null)
  const panRef = useRef({ x: 0, y: 0 })
  const panStartRef = useRef({ x: 0, y: 0, mouseX: 0, mouseY: 0 })
  const panTimerRef = useRef(null)
  const zoomRef = useRef(1.0)      // 0.2 ~ 3.0
  const snapRef = useRef(null) // { guides: [{axis:'x', pos}, ...], snapOffsets: {x, y} }

  // ── Fade-in animation: track when each element was first seen ──
  const birthTimesRef = useRef({})
  const prevIdsRef = useRef(new Set())
  useEffect(() => {
    const times = birthTimesRef.current
    const now = Date.now()
    const currentIds = new Set(instructions.map(i => i.id))
    const prevIds = prevIdsRef.current

    // Detect bulk replacement (history load) vs incremental (SSE stream)
    // Case 1: empty canvas → multiple instructions at once = history load
    // Case 2: non-empty canvas → all IDs replaced = history load
    const isBulkLoad = currentIds.size > 1 && (
      prevIds.size === 0
      || (prevIds.size > 0
        && currentIds.size >= prevIds.size
        && [...currentIds].every(id => !prevIds.has(id)))
    )

    for (const inst of instructions) {
      if (!times[inst.id]) {
        times[inst.id] = isBulkLoad ? now - FADE_DURATION : now
      }
    }
    // clean up IDs no longer in instructions
    for (const id of Object.keys(times)) {
      if (!currentIds.has(id)) delete times[id]
    }
    prevIdsRef.current = currentIds
  }, [instructions])

  // ── Export PNG (high-resolution) ──
  const exportPng = useCallback((scale = 3) => {
    const insts = instRef.current
    if (!insts.length) return
    // Create off-screen canvas at target resolution
    const w = CANVAS_WIDTH * scale
    const h = CANVAS_HEIGHT * scale
    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    const ctx = offscreen.getContext('2d')
    ctx.scale(scale, scale)

    // White background
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // Render all instructions at full opacity, no selection, no grid, no fading
    const sorted = insts.length > 1
      ? [...insts].sort((a, b) => (a.params?.zIndex || 0) - (b.params?.zIndex || 0))
      : insts
    for (const inst of sorted) {
      const p = inst.params || {}
      ctx.save()
      ctx.globalAlpha = p.opacity || 1.0
      switch (inst.action) {
        case 'draw_rect': try { drawRect(ctx, p, false, false) } catch (_) {} break
        case 'draw_circle': try { drawCircle(ctx, p, false, false) } catch (_) {} break
        case 'draw_ellipse': try { drawEllipse(ctx, p, false, false) } catch (_) {} break
        case 'draw_line': try { drawLine(ctx, p) } catch (_) {} break
        case 'draw_dashed_line': try { drawDashedLine(ctx, p) } catch (_) {} break
        case 'draw_arrow':
          if (drag && drag.mode === 'arrow_endpoint' && inst.id === drag.elementId) {
            const tp = { ...p }
            tp.startX = drag.tempStartX
            tp.startY = drag.tempStartY
            tp.endX = drag.tempEndX
            tp.endY = drag.tempEndY
            try { drawArrow(ctx, tp) } catch (_) {}
          } else {
            try { drawArrow(ctx, p) } catch (_) {}
          }
          break
        case 'draw_text': try { drawText(ctx, p) } catch (_) {} break
        case 'draw_label': try { drawLabel(ctx, p) } catch (_) {} break
        case 'draw_pie_slice': try { drawPieSlice(ctx, p) } catch (_) {} break
      }
      ctx.restore()
    }

    // Download
    const link = document.createElement('a')
    link.download = `diagram-${Date.now()}@${scale}x.png`
    link.href = offscreen.toDataURL('image/png')
    link.click()
  }, [])

  // ── Draw ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const insts = instRef.current
    const selId = selIdRef.current
    const selIds = selIdsRef.current
    const drag = dragRef.current
    const hoveredId = hoveredIdRef.current
    const now = Date.now()
    const times = birthTimesRef.current
    const pan = panRef.current
    const zoom = zoomRef.current

    // Reset transform and clear full canvas
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()

    // Apply pan + zoom transform for all content
    ctx.save()
    ctx.setTransform(zoom, 0, 0, zoom, -pan.x * zoom, -pan.y * zoom)

    // Subtle grid background (visible region only, accounting for zoom)
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.03)'
    ctx.lineWidth = 0.5
    const viewW = canvas.width / (canvas.width / CANVAS_WIDTH) / zoom
    const viewH = canvas.height / (canvas.height / CANVAS_HEIGHT) / zoom
    const gridStartX = Math.max(0, Math.floor(pan.x / 40) * 40)
    const gridEndX = Math.min(CANVAS_WIDTH, Math.ceil((pan.x + viewW) / 40) * 40)
    const gridStartY = Math.max(0, Math.floor(pan.y / 40) * 40)
    const gridEndY = Math.min(CANVAS_HEIGHT, Math.ceil((pan.y + viewH) / 40) * 40)
    for (let x = gridStartX; x < gridEndX; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, gridStartY); ctx.lineTo(x, gridEndY); ctx.stroke()
    }
    for (let y = gridStartY; y < gridEndY; y += 40) {
      ctx.beginPath(); ctx.moveTo(gridStartX, y); ctx.lineTo(gridEndX, y); ctx.stroke()
    }
    ctx.restore()

    const sorted = insts.length > 1
      ? [...insts].sort((a, b) => (a.params?.zIndex || 0) - (b.params?.zIndex || 0))
      : insts

    // Pre-pass: detect shape labels overlapped by higher-zIndex shapes
    const _shapeBounds = sorted
      .filter(inst => ['draw_rect', 'draw_circle', 'draw_ellipse'].includes(inst.action))
      .map(inst => ({ id: inst.id, bounds: getElementBounds(inst.action, inst.params || {}), zIndex: inst.params?.zIndex || 0 }))
    const bottomAnchorIds = new Set()
    for (const a of _shapeBounds) {
      if (_shapeBounds.some(b => b.id !== a.id && b.zIndex > a.zIndex && rectsOverlap(a.bounds, b.bounds))) {
        bottomAnchorIds.add(a.id)
      }
    }

    let anyFading = false

    for (const inst of sorted) {
      const p = inst.params || {}
      const isSelected = inst.id === selId || selIds.includes(inst.id)
      const isHovered = inst.id === hoveredId && !isSelected

      // Fade-in animation
      const birth = times[inst.id]
      const age = birth ? Math.min((now - birth) / FADE_DURATION, 1) : 1
      if (age < 1) anyFading = true

      ctx.save()
      ctx.globalAlpha = (p.opacity || 1.0) * age

      // Apply drag offset when dragging element(s) or connected arrows
      if (drag && drag.mode === 'element' && drag.moved) {
        const inGroup = drag.isMultiDrag && drag.origins && drag.origins[inst.id] !== undefined
        if (inst.id === drag.elementId || inGroup) {
          ctx.translate(drag.offsetX, drag.offsetY)
        } else if (/^(draw_arrow|draw_line|draw_dashed_line)$/.test(inst.action)) {
          const idsToCheck = drag.isMultiDrag ? Object.keys(drag.origins) : [drag.elementId]
          const pp = inst.params || {}
          for (const eid of idsToCheck) {
            const draggedEl = instRef.current.find(i => i.id === eid)
            if (draggedEl && (isPointOnElement(pp.startX, pp.startY, draggedEl) || isPointOnElement(pp.endX, pp.endY, draggedEl))) {
              ctx.translate(drag.offsetX, drag.offsetY)
              break
            }
          }
        }
      }

      if (isSelected) {
        ctx.strokeStyle = '#2196F3'
        ctx.lineWidth = 3
        ctx.setLineDash([5, 3])
      }

      switch (inst.action) {
        case 'draw_rect': {
          const bp = bottomAnchorIds.has(inst.id) ? { ...p, _bottomAnchor: true } : p
          try { drawRect(ctx, bp, isSelected, isHovered) } catch (_) {}
        } break
        case 'draw_circle': {
          const bp = bottomAnchorIds.has(inst.id) ? { ...p, _bottomAnchor: true } : p
          try { drawCircle(ctx, bp, isSelected, isHovered) } catch (_) {}
        } break
        case 'draw_ellipse': {
          const bp = bottomAnchorIds.has(inst.id) ? { ...p, _bottomAnchor: true } : p
          try { drawEllipse(ctx, bp, isSelected, isHovered) } catch (_) {}
        } break
        case 'draw_line': try { drawLine(ctx, p) } catch (_) {} break
        case 'draw_dashed_line': try { drawDashedLine(ctx, p) } catch (_) {} break
        case 'draw_arrow':
          if (drag && drag.mode === 'arrow_endpoint' && inst.id === drag.elementId) {
            const tp = { ...p }
            tp.startX = drag.tempStartX
            tp.startY = drag.tempStartY
            tp.endX = drag.tempEndX
            tp.endY = drag.tempEndY
            try { drawArrow(ctx, tp) } catch (_) {}
          } else {
            try { drawArrow(ctx, p) } catch (_) {}
          }
          break
        case 'draw_text': try { drawText(ctx, p) } catch (_) {} break
        case 'draw_label': try { drawLabel(ctx, p) } catch (_) {} break
        case 'draw_pie_slice': try { drawPieSlice(ctx, p) } catch (_) {} break
      }

      ctx.restore()
    }

    // Selection rectangle (drawn within pan transform, in logical coords)
    if (drag && drag.active) {
      ctx.save()
      ctx.strokeStyle = '#2196F3'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      const x = Math.min(drag.x1, drag.x2)
      const y = Math.min(drag.y1, drag.y2)
      const w = Math.abs(drag.x2 - drag.x1)
      const h = Math.abs(drag.y2 - drag.y1)
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = 'rgba(33, 150, 243, 0.08)'
      ctx.fillRect(x, y, w, h)
      ctx.restore()
    }

    // Alignment guide lines (drawn within pan transform)
    const snap = snapRef.current
    if (snap && snap.guides && snap.guides.length > 0) {
      for (const g of snap.guides) {
        ctx.save()
        ctx.strokeStyle = '#2196F3'
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        if (g.axis === 'x') {
          ctx.moveTo(g.pos, 0)
          ctx.lineTo(g.pos, CANVAS_HEIGHT)
        } else {
          ctx.moveTo(0, g.pos)
          ctx.lineTo(CANVAS_WIDTH, g.pos)
        }
        ctx.stroke()
        // Small circle at intersection hint
        if (g.markerPos) {
          ctx.fillStyle = '#2196F3'
          ctx.beginPath()
          ctx.arc(g.markerPos.x, g.markerPos.y, 3, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }
    }

    // Restore from pan transform
    ctx.restore()

    // Keep animating while elements fade in
  }, [])

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        draw()
      })
    }
  }, [draw])

  useEffect(() => {
    draw()
  }, [instructions])

  // ── Mouse events ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT

    const getCanvasPos = (e) => {
      const rect = canvas.getBoundingClientRect()
      const pan = panRef.current
      const zoom = zoomRef.current
      return {
        x: (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width) / zoom + pan.x,
        y: (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height) / zoom + pan.y
      }
    }

    const handleMouseDown = (e) => {
      const pos = getCanvasPos(e)
      // Check if mouse is on an element
      const hitId = hitTest(pos.x, pos.y, instRef.current)
      const dragState = { active: true, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, moved: false, mode: 'box' }

      if (hitId) {
        const hitEl = instRef.current.find(i => i.id === hitId)
        const action = hitEl?.action || ''
        const p = hitEl?.params || {}

        // Arrow endpoint drag
        if (/^(draw_arrow|draw_line|draw_dashed_line)$/.test(action)) {
          const dS = Math.sqrt((pos.x - (p.startX||0))**2 + (pos.y - (p.startY||0))**2)
          const dE = Math.sqrt((pos.x - (p.endX||100))**2 + (pos.y - (p.endY||100))**2)
          if (dS < ARROW_EP_THRESHOLD || dE < ARROW_EP_THRESHOLD) {
            dragState.mode = 'arrow_endpoint'
            dragState.elementId = hitId
            dragState.endpoint = dS < dE ? 'start' : 'end'
            dragState.origStartX = p.startX || 0
            dragState.origStartY = p.startY || 0
            dragState.origEndX = p.endX || 100
            dragState.origEndY = p.endY || 100
            dragState.tempStartX = dragState.origStartX
            dragState.tempStartY = dragState.origStartY
            dragState.tempEndX = dragState.origEndX
            dragState.tempEndY = dragState.origEndY
            canvas.style.cursor = 'grabbing'
            canvas.classList.add('panning')
            dragRef.current = dragState
            scheduleDraw()
            return
          }
        }

        // Element drag mode (shapes and text)
        if (/^(draw_rect|draw_circle|draw_ellipse|draw_text|draw_label)$/.test(action)) {
          dragState.mode = 'element'
          dragState.elementId = hitId
          dragState.offsetX = 0
          dragState.offsetY = 0
          dragState.origX = p.x || 0
          dragState.origY = p.y || 0
          canvas.style.cursor = 'grabbing'
          canvas.classList.add('panning')
        }

        // Multi-drag: if multiple elements are box-selected, move all together
        const selIds = selIdsRef.current
        if (selIds.length > 1 && selIds.includes(hitId)) {
          dragState.isMultiDrag = true
          dragState.origins = {}
          for (const id of selIds) {
            const oel = instRef.current.find(i => i.id === id)
            if (oel && /^(draw_rect|draw_circle|draw_ellipse)$/.test(oel.action)) {
              dragState.origins[id] = {
                x: oel.params?.x || 0,
                y: oel.params?.y || 0
              }
            }
          }
        }
      } else if (e.shiftKey) {
        // Shift+drag → box selection mode (immediate)
        dragState.mode = 'box'
      } else {
        // Drag on empty space → box select immediately, but set 2s timer for pan
        dragState.mode = 'box'
        if (panTimerRef.current) clearTimeout(panTimerRef.current)
        panTimerRef.current = setTimeout(() => {
          const d = dragRef.current
          if (d && d.mode === 'box' && !d.moved) {
            d.mode = 'pan'
            panStartRef.current = { x: panRef.current.x, y: panRef.current.y }
            canvas.style.cursor = 'grabbing'
            canvas.classList.add('panning')
          }
          panTimerRef.current = null
        }, 2000)
      }

      dragRef.current = dragState
      scheduleDraw()
    }

    const handleMouseMove = (e) => {
      const pos = getCanvasPos(e)
      const drag = dragRef.current

      if (drag && drag.active) {
        drag.x2 = pos.x
        drag.y2 = pos.y
        const dx = Math.abs(drag.x2 - drag.x1)
        const dy = Math.abs(drag.y2 - drag.y1)
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) drag.moved = true

        if (drag.mode === 'element' && drag.moved) {
          const rawOffX = drag.x2 - drag.x1
          const rawOffY = drag.y2 - drag.y1
          const el = instRef.current.find(i => i.id === drag.elementId)
          const snap = computeSnap(rawOffX, rawOffY, el, instRef.current)
          drag.offsetX = snap.offsetX
          drag.offsetY = snap.offsetY
          snapRef.current = snap
        } else if (drag.mode === 'arrow_endpoint' && drag.moved) {
          const dx = drag.x2 - drag.x1
          const dy = drag.y2 - drag.y1
          if (drag.endpoint === 'end') {
            drag.tempEndX = drag.origEndX + dx
            drag.tempEndY = drag.origEndY + dy
          } else {
            drag.tempStartX = drag.origStartX + dx
            drag.tempStartY = drag.origStartY + dy
          }
          snapRef.current = null
        } else {
          snapRef.current = null
        }
        if (drag.mode === 'box' && drag.moved) {
          // User started dragging — cancel pan timer, stay in box select
          if (panTimerRef.current) {
            clearTimeout(panTimerRef.current)
            panTimerRef.current = null
          }
        } else if (drag.mode === 'pan' && drag.moved) {
          const deltaX = pos.x - drag.x1
          const deltaY = pos.y - drag.y1
          panRef.current = {
            x: panStartRef.current.x - deltaX,
            y: panStartRef.current.y - deltaY
          }
        }

        scheduleDraw()
      } else {
        // Hover detection
        const hovered = hitTest(pos.x, pos.y, instRef.current)
        if (hovered !== hoveredIdRef.current) {
          hoveredIdRef.current = hovered
          const hoveredAction = hovered ? instRef.current.find(i => i.id === hovered)?.action : null
          const isDraggable = hoveredAction && /^(draw_rect|draw_circle|draw_ellipse|draw_text|draw_label)$/.test(hoveredAction)
          canvas.style.cursor = isDraggable ? 'grab' : (hovered ? 'pointer' : 'crosshair')
          if (!hovered && !isDraggable) canvas.classList.remove('panning', 'grab')
          else if (isDraggable) canvas.classList.add('grab')
          scheduleDraw()
        }
      }
    }

    const handleMouseUp = (e) => {
      // Clear alignment guides
      snapRef.current = null
      // Clear pan timer
      if (panTimerRef.current) {
        clearTimeout(panTimerRef.current)
        panTimerRef.current = null
      }
      const drag = dragRef.current
      if (!drag) return
      const pos = getCanvasPos(e)
      drag.active = false
      dragRef.current = null
      scheduleDraw()
      canvas.style.cursor = 'crosshair'
      canvas.classList.remove('panning', 'grab')

      if (drag.mode === 'pan') {
        // Panning done — no click/select events
      } else if (drag.mode === 'arrow_endpoint' && drag.moved) {
        const updated = {}
        if (drag.endpoint === 'end') {
          let ex = Math.round(drag.tempEndX * 10) / 10
          let ey = Math.round(drag.tempEndY * 10) / 10
          const edge = snapArrowToShape(ex, ey, instRef.current)
          if (edge) { ex = edge[0]; ey = edge[1] }
          updated.endX = ex
          updated.endY = ey
        } else {
          let sx = Math.round(drag.tempStartX * 10) / 10
          let sy = Math.round(drag.tempStartY * 10) / 10
          const edge = snapArrowToShape(sx, sy, instRef.current)
          if (edge) { sx = edge[0]; sy = edge[1] }
          updated.startX = sx
          updated.startY = sy
        }
        // After edge snap, also snap the whole arrow to axis
        const arrowInst = instRef.current.find(i => i.id === drag.elementId)
        if (arrowInst) {
          const base = arrowInst.params || {}
          const axisSnap = snapArrowToAxis({
            startX: updated.startX != null ? updated.startX : base.startX,
            startY: updated.startY != null ? updated.startY : base.startY,
            endX: updated.endX != null ? updated.endX : base.endX,
            endY: updated.endY != null ? updated.endY : base.endY,
          }, instRef.current)
          if (axisSnap) Object.assign(updated, axisSnap)
        }
        onDragRef.current && onDragRef.current(drag.elementId, updated, [])
      } else if (drag.mode === 'element' && drag.moved) {
        if (drag.isMultiDrag && drag.origins) {
          // Commit positions for all elements in the multi-drag group
          let allArrowUpdates = {}
          for (const [id, orig] of Object.entries(drag.origins)) {
            const newX = Math.round((orig.x + drag.offsetX) * 10) / 10
            const newY = Math.round((orig.y + drag.offsetY) * 10) / 10
            const updates = computeArrowUpdates(id, drag.offsetX, drag.offsetY, instRef.current)
            // Snap multi-drag connected arrows to axis
            for (const u of updates) {
              const arrInstM = instRef.current.find(i => i.id === u.id)
              if (arrInstM) {
                const baseArrM = arrInstM.params || {}
                const axSnapM = snapArrowToAxis({
                  startX: u.params.startX != null ? u.params.startX : baseArrM.startX,
                  startY: u.params.startY != null ? u.params.startY : baseArrM.startY,
                  endX: u.params.endX != null ? u.params.endX : baseArrM.endX,
                  endY: u.params.endY != null ? u.params.endY : baseArrM.endY,
                }, instRef.current)
                if (axSnapM) Object.assign(u.params, axSnapM)
              }
            }
            for (const u of updates) allArrowUpdates[u.id] = u
            onDragRef.current && onDragRef.current(id, { x: newX, y: newY }, Object.values(allArrowUpdates))
          }
        } else {
          const newX = Math.round((drag.origX + drag.offsetX) * 10) / 10
          const newY = Math.round((drag.origY + drag.offsetY) * 10) / 10
          const arrowUpdates = computeArrowUpdates(drag.elementId, drag.offsetX, drag.offsetY, instRef.current)
          // Snap connected arrows to axis after shape drag
          for (const au of arrowUpdates) {
            const arrInst = instRef.current.find(i => i.id === au.id)
            if (arrInst) {
              const baseArr = arrInst.params || {}
              const axSnap = snapArrowToAxis({
                startX: au.params.startX != null ? au.params.startX : baseArr.startX,
                startY: au.params.startY != null ? au.params.startY : baseArr.startY,
                endX: au.params.endX != null ? au.params.endX : baseArr.endX,
                endY: au.params.endY != null ? au.params.endY : baseArr.endY,
              }, instRef.current)
              if (axSnap) Object.assign(au.params, axSnap)
            }
          }
          onDragRef.current && onDragRef.current(drag.elementId, { x: newX, y: newY }, arrowUpdates)
        }
      } else if (drag.moved) {
        onBoxRef.current && onBoxRef.current(drag.x1, drag.y1, pos.x, pos.y)
      } else {
        onClickRef.current && onClickRef.current(pos.x, pos.y)
      }
    }

    const handleMouseLeave = () => {
      snapRef.current = null
      if (panTimerRef.current) {
        clearTimeout(panTimerRef.current)
        panTimerRef.current = null
      }
      if (hoveredIdRef.current) {
        hoveredIdRef.current = null
        canvas.style.cursor = 'crosshair'
        scheduleDraw()
      }
      if (dragRef.current?.mode === 'arrow_endpoint') {
        const drag = dragRef.current
        const updated = {}
        if (drag.endpoint === 'end') {
          let ex = Math.round(drag.tempEndX * 10) / 10
          let ey = Math.round(drag.tempEndY * 10) / 10
          const snap = snapArrowToShape(ex, ey, instRef.current)
          if (snap) { ex = snap[0]; ey = snap[1] }
          updated.endX = ex
          updated.endY = ey
        } else {
          let sx = Math.round(drag.tempStartX * 10) / 10
          let sy = Math.round(drag.tempStartY * 10) / 10
          const snap = snapArrowToShape(sx, sy, instRef.current)
          if (snap) { sx = snap[0]; sy = snap[1] }
          updated.startX = sx
          updated.startY = sy
        }
        // After edge snap, also snap to axis
        const arrowInst2 = instRef.current.find(i => i.id === drag.elementId)
        if (arrowInst2) {
          const base2 = arrowInst2.params || {}
          const axisSnap2 = snapArrowToAxis({
            startX: updated.startX != null ? updated.startX : base2.startX,
            startY: updated.startY != null ? updated.startY : base2.startY,
            endX: updated.endX != null ? updated.endX : base2.endX,
            endY: updated.endY != null ? updated.endY : base2.endY,
          }, instRef.current)
          if (axisSnap2) Object.assign(updated, axisSnap2)
        }
        onDragRef.current && onDragRef.current(drag.elementId, updated, [])
        dragRef.current = null
      } else if (dragRef.current?.mode === 'element') {
        const drag = dragRef.current
        if (drag.isMultiDrag && drag.origins) {
          let allArrowUpdates = {}
          for (const [id, orig] of Object.entries(drag.origins)) {
            const newX = Math.round((orig.x + drag.offsetX) * 10) / 10
            const newY = Math.round((orig.y + drag.offsetY) * 10) / 10
            const updates = computeArrowUpdates(id, drag.offsetX, drag.offsetY, instRef.current)
            for (const u of updates) allArrowUpdates[u.id] = u
            onDragRef.current && onDragRef.current(id, { x: newX, y: newY }, Object.values(allArrowUpdates))
          }
        } else {
          const newX = Math.round((drag.origX + drag.offsetX) * 10) / 10
          const newY = Math.round((drag.origY + drag.offsetY) * 10) / 10
          const arrowUpdates = computeArrowUpdates(drag.elementId, drag.offsetX, drag.offsetY, instRef.current)
          onDragRef.current && onDragRef.current(drag.elementId, { x: newX, y: newY }, arrowUpdates)
        }
        dragRef.current = null
      } else {
        dragRef.current = null
      }
      canvas.classList.remove('panning', 'grab')
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    draw()

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [draw, scheduleDraw])

  const zoomIn = useCallback(() => {
    zoomRef.current = Math.min(3.0, zoomRef.current + 0.15)
    scheduleDraw()
  }, [scheduleDraw])

  const zoomOut = useCallback(() => {
    zoomRef.current = Math.max(0.2, zoomRef.current - 0.15)
    scheduleDraw()
  }, [scheduleDraw])

  return { canvasRef, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, exportPng, zoom: zoomRef, zoomIn, zoomOut }
}

// ═══════════════════════════════════════════
//  Style helpers
// ═══════════════════════════════════════════

const SHADOW_SHAPE = { color: 'rgba(0,0,0,0.10)', blur: 6, offsetY: 2 }
const SHADOW_TEXT = { color: 'rgba(255,255,255,0.85)', blur: 4, offsetY: 0 }
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', 'PingFang SC', sans-serif"

function fontStr(size) {
  return `${size}px ${FONT_STACK}`
}

function applyShapeShadow(ctx, depth) {
  let intensity = 1.0
  if (depth === 'bottom') intensity = 0.5
  else if (depth === 'top') intensity = 1.5
  ctx.shadowColor = `rgba(0,0,0,${0.10 * intensity})`
  ctx.shadowBlur = 6 * intensity
  ctx.shadowOffsetY = 2 * intensity
}

function hexToRgb(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)]
}

function darkenColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex)
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`
}

function shapeGradient(ctx, fillColor, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x, y + h)
  grad.addColorStop(0, fillColor)
  grad.addColorStop(0.5, fillColor)
  grad.addColorStop(1, darkenColor(fillColor, 0.08))
  return grad
}

// ── Text wrapping ──
function wrapText(ctx, text, maxWidth) {
  if (!text) return ['']
  const lines = []
  let line = ''
  for (const char of text) {
    const test = line + char
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : [text]
}

// Draw label inside a shape with wrapping + pill background
function drawLabelOnShape(ctx, label, x, y, maxW, fontColor, fontSize, anchorBottom, shapeBottom) {
  const size = fontSize || 13
  ctx.save()
  ctx.font = fontStr(size)
  ctx.textAlign = 'center'
  const availW = Math.max(maxW - 20, 30)
  const lines = wrapText(ctx, label, availW)
  const lineHeight = size * 1.3

  let maxLineW = 0
  for (const line of lines) {
    const w = ctx.measureText(line).width
    if (w > maxLineW) maxLineW = w
  }

  // Text with subtle shadow
  ctx.shadowColor = SHADOW_TEXT.color
  ctx.shadowBlur = SHADOW_TEXT.blur
  ctx.fillStyle = fontColor || '#2C3E50'

  if (anchorBottom && shapeBottom != null) {
    // Position text one line-height above bottom edge
    ctx.textBaseline = 'bottom'
    const bottomY = shapeBottom - lineHeight
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, bottomY - (lines.length - 1 - i) * lineHeight)
    }
  } else {
    // Centered (original behavior)
    ctx.textBaseline = 'middle'
    const startY = y - (lines.length - 1) * lineHeight / 2
    lines.forEach((line, i) => ctx.fillText(line, x, startY + i * lineHeight))
  }

  ctx.restore()
}

function capLine(ctx, x1, y1, x2, y2, color, width) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.stroke()
}

// ═══════════════════════════════════════════
//  Drawing functions
// ═══════════════════════════════════════════

function drawRect(ctx, p, selected, hovered) {
  const x = p.x || 0, y = p.y || 0, w = p.w || 100, h = p.h || 100
  const fill = p.fill || '#CCCCCC'
  const isHighlight = selected || hovered
  const stroke = isHighlight
    ? (selected ? '#2196F3' : 'rgba(33,150,243,0.45)')
    : (p.stroke || '#333')
  const lw = selected ? 3 : (hovered ? 2.5 : (p.strokeWidth || 2))
  const rx = p.rx || 0

  ctx.save()
  ctx.beginPath()
  if (rx > 0) {
    ctx.roundRect(x, y, w, h, Math.min(rx, Math.min(w, h) / 2))
  } else {
    ctx.rect(x, y, w, h)
  }

  applyShapeShadow(ctx, p._layerDepth)
  ctx.fillStyle = shapeGradient(ctx, fill, x, y, w, h)
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.strokeStyle = stroke
  ctx.lineWidth = lw
  ctx.stroke()
  ctx.restore()

  if (p.label) {
    drawLabelOnShape(ctx, p.label, x + w / 2, y + h / 2, w, p.fontColor, p.fontSize, p._bottomAnchor, y + h)
  }
}

function drawCircle(ctx, p, selected, hovered) {
  const cx = p.cx ?? p.x ?? 0, cy = p.cy ?? p.y ?? 0, r = p.r ?? 30
  const fill = p.fill || '#CCCCCC'
  const isHighlight = selected || hovered
  const stroke = isHighlight
    ? (selected ? '#2196F3' : 'rgba(33,150,243,0.45)')
    : (p.stroke || '#333')
  const lw = selected ? 3 : (hovered ? 2.5 : (p.strokeWidth || 2))

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)

  applyShapeShadow(ctx, p._layerDepth)
  ctx.fillStyle = shapeGradient(ctx, fill, cx - r, cy - r, r * 2, r * 2)
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.strokeStyle = stroke
  ctx.lineWidth = lw
  ctx.stroke()
  ctx.restore()

  if (p.label) {
    drawLabelOnShape(ctx, p.label, cx, cy, r * 2, p.fontColor, p.fontSize, p._bottomAnchor, cy + r)
  }
}

function drawEllipse(ctx, p, selected, hovered) {
  const cx = p.cx ?? p.x ?? 0, cy = p.cy ?? p.y ?? 0
  const rw = p.rx ?? ((p.w ?? 80) / 2)
  const rh = p.ry ?? ((p.h ?? 40) / 2)
  const fill = p.fill || '#CCCCCC'
  const isHighlight = selected || hovered
  const stroke = isHighlight
    ? (selected ? '#2196F3' : 'rgba(33,150,243,0.45)')
    : (p.stroke || '#333')
  const lw = selected ? 3 : (hovered ? 2.5 : (p.strokeWidth || 2))

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2)

  applyShapeShadow(ctx, p._layerDepth)
  ctx.fillStyle = shapeGradient(ctx, fill, cx - rw, cy - rh, rw * 2, rh * 2)
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.strokeStyle = stroke
  ctx.lineWidth = lw
  ctx.stroke()
  ctx.restore()

  if (p.label) {
    drawLabelOnShape(ctx, p.label, cx, cy, rw * 2, p.fontColor, p.fontSize, p._bottomAnchor, cy + rh)
  }
}

function drawLine(ctx, p) {
  capLine(ctx, p.startX || 0, p.startY || 0, p.endX || 100, p.endY || 100,
    p.stroke || '#666', p.strokeWidth || 2)
}

function drawDashedLine(ctx, p) {
  ctx.save()
  ctx.setLineDash([6, 5])
  capLine(ctx, p.startX || 0, p.startY || 0, p.endX || 100, p.endY || 100,
    p.stroke || '#888', p.strokeWidth || 1.5)
  ctx.restore()
}

function drawArrow(ctx, p) {
  const sx = p.startX || 0, sy = p.startY || 0
  const ex = p.endX || 100, ey = p.endY || 100
  const stroke = p.stroke || '#555'
  const lw = p.strokeWidth || 2
  const headLen = 11, headAngle = 0.5

  const midX = p.midX, midY = p.midY
  let finalAngle

  if (midX != null) {
    capLine(ctx, sx, sy, midX, sy, stroke, lw)
    capLine(ctx, midX, sy, midX, ey, stroke, lw)
    capLine(ctx, midX, ey, ex, ey, stroke, lw)
    finalAngle = Math.atan2(0, ex - midX)
  } else if (midY != null) {
    capLine(ctx, sx, sy, sx, midY, stroke, lw)
    capLine(ctx, sx, midY, ex, midY, stroke, lw)
    capLine(ctx, ex, midY, ex, ey, stroke, lw)
    finalAngle = Math.atan2(ey - midY, 0)
  } else {
    capLine(ctx, sx, sy, ex, ey, stroke, lw)
    finalAngle = Math.atan2(ey - sy, ex - sx)
  }

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - headLen * Math.cos(finalAngle - headAngle), ey - headLen * Math.sin(finalAngle - headAngle))
  ctx.lineTo(ex - headLen * Math.cos(finalAngle + headAngle), ey - headLen * Math.sin(finalAngle + headAngle))
  ctx.closePath()
  applyShapeShadow(ctx)
  ctx.fillStyle = stroke
  ctx.fill()
  ctx.restore()
}

function drawText(ctx, p) {
  const text = p.text || ''
  if (!text) return

  ctx.save()
  const size = p.fontSize || 14
  ctx.font = fontStr(size)
  const align = p.textAlign || 'left'
  ctx.textAlign = align
  ctx.textBaseline = 'top'

  // Wrap text within canvas bounds
  const maxW = Math.min(p.maxWidth || (CANVAS_WIDTH - (p.x || 0) - 40), CANVAS_WIDTH - 40)
  const lines = wrapText(ctx, text, maxW)
  const lineHeight = size * 1.4

  ctx.shadowColor = SHADOW_TEXT.color
  ctx.shadowBlur = SHADOW_TEXT.blur
  ctx.fillStyle = p.fontColor || '#F4D03F'
  const x = p.x || 0
  const y = p.y || 0
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight))
  ctx.restore()
}

function drawLabel(ctx, p) {
  const x = p.x || 0, y = p.y || 0
  const label = p.label || ''

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = p.stroke || '#666'
  ctx.shadowColor = SHADOW_TEXT.color
  ctx.shadowBlur = SHADOW_TEXT.blur
  ctx.fill()
  ctx.restore()

  const lx = x + 60, ly = y - 22
  capLine(ctx, x, y, lx, ly, p.stroke || '#999', 1)

  if (!label) return

  ctx.save()
  const size = 12
  ctx.font = fontStr(size)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const lines = wrapText(ctx, label, 160)
  const lineHeight = size * 1.3
  let maxLineW = 0
  for (const line of lines) {
    const w = ctx.measureText(line).width
    if (w > maxLineW) maxLineW = w
  }
  const tw = maxLineW + 14
  const th = Math.max(lines.length * lineHeight + 4, size + 6)

  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.roundRect(lx + 4, ly - th / 2, tw, th, th / 2)
  ctx.fill()

  ctx.shadowColor = SHADOW_TEXT.color
  ctx.shadowBlur = SHADOW_TEXT.blur
  ctx.fillStyle = p.fontColor || '#333'
  const startY = ly - (lines.length - 1) * lineHeight / 2
  lines.forEach((line, i) => ctx.fillText(line, lx + 11, startY + i * lineHeight))
  ctx.restore()
}

function drawPieSlice(ctx, p) {
  const cx = p.x || 0, cy = p.y || 0, r = p.r || 50
  const startAngle = p.startAngle || 0
  const endAngle = p.endAngle || Math.PI * 2
  const fill = p.fill || '#3B82F6'
  const stroke = p.stroke || '#FFFFFF'
  const lw = p.strokeWidth || 2

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, startAngle, endAngle)
  ctx.closePath()

  applyShapeShadow(ctx)
  ctx.fillStyle = fill
  ctx.fill()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.strokeStyle = stroke
  ctx.lineWidth = lw
  ctx.stroke()
  ctx.restore()

  // Draw label centered on slice (at midpoint angle, ~60% radius)
  if (p.label) {
    const midAngle = (startAngle + endAngle) / 2
    const labelR = r * 0.6
    const lx = cx + labelR * Math.cos(midAngle)
    const ly = cy + labelR * Math.sin(midAngle)
    ctx.save()
    ctx.font = fontStr(13)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = SHADOW_TEXT.color
    ctx.shadowBlur = SHADOW_TEXT.blur
    // Auto white/dark text based on fill luminance
    if (p.fontColor) {
      ctx.fillStyle = p.fontColor
    } else {
      const fill = p.fill || '#3B82F6'
      const hex = fill.replace('#', '')
      const r2 = parseInt(hex.substring(0,2), 16)
      const g2 = parseInt(hex.substring(2,4), 16)
      const b2 = parseInt(hex.substring(4,6), 16)
      const lum = r2 * 0.299 + g2 * 0.587 + b2 * 0.114
      ctx.fillStyle = lum < 128 ? '#FFFFFF' : '#1A1A2E'
    }
    ctx.fillText(p.label, lx, ly)
    ctx.restore()
  }
}

// ═══════════════════════════════════════════
//  Alignment snap helpers
// ═══════════════════════════════════════════

/**
 * Compute alignment snap offsets and guide lines when dragging an element.
 * Checks edges and centers against all other shape elements.
 */
function computeSnap(dragOffsetX, dragOffsetY, dragElement, allInsts) {
  const result = { guides: [], offsetX: dragOffsetX, offsetY: dragOffsetY }
  if (!dragElement) return result

  const p = dragElement.params || {}
  const w = p.w || 100
  const h = p.h || 100
  const origX = p.x || 0
  const origY = p.y || 0
  const newX = origX + dragOffsetX
  const newY = origY + dragOffsetY

  const dragEdges = {
    left: newX,
    cx: newX + w / 2,
    right: newX + w,
    top: newY,
    cy: newY + h / 2,
    bottom: newY + h,
  }

  // Find other alignable elements (shapes with bounds)
  const others = allInsts.filter(inst =>
    inst.id !== dragElement.id
    && /^(draw_rect|draw_circle|draw_ellipse)$/.test(inst.action)
  )

  let snapX = null
  let snapY = null

  for (const other of others) {
    const op = other.params || {}
    let oLeft, oRight, oTop, oBottom
    if (other.action === 'draw_circle') {
      const r = op.r || 30
      const cx = op.x || 0
      const cy = op.y || 0
      oLeft = cx - r; oRight = cx + r
      oTop = cy - r; oBottom = cy + r
    } else {
      const ox = op.x || 0, oy = op.y || 0
      const ow = op.w || 100, oh = op.h || 100
      oLeft = ox; oRight = ox + ow
      oTop = oy; oBottom = oy + oh
    }

    const oEdges = {
      left: oLeft, cx: (oLeft + oRight) / 2, right: oRight,
      top: oTop, cy: (oTop + oBottom) / 2, bottom: oBottom,
    }

    // Check X alignment (snap horizontal guides — vertical lines)
    for (const key of ['left', 'cx', 'right']) {
      const diff = dragEdges[key] - oEdges[key]
      if (Math.abs(diff) < SNAP_THRESHOLD && snapX === null) {
        snapX = -diff
        result.guides.push({ axis: 'x', pos: oEdges[key], markerPos: { x: oEdges[key], y: dragEdges.cy } })
      }
    }

    // Check Y alignment (snap vertical guides — horizontal lines)
    for (const key of ['top', 'cy', 'bottom']) {
      const diff = dragEdges[key] - oEdges[key]
      if (Math.abs(diff) < SNAP_THRESHOLD && snapY === null) {
        snapY = -diff
        result.guides.push({ axis: 'y', pos: oEdges[key], markerPos: { x: dragEdges.cx, y: oEdges[key] } })
      }
    }
  }

  result.offsetX = snapX !== null ? dragOffsetX + snapX : dragOffsetX
  result.offsetY = snapY !== null ? dragOffsetY + snapY : dragOffsetY
  return result
}

/**
 * Get the point on a shape's bounding box edge where a ray from center
 * toward (tx, ty) first hits the actual edge segment.
 * Mirrors backend _get_edge_point logic.
 */
function getEdgeBounds(bounds, tx, ty) {
  const [left, top, right, bottom] = bounds
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]

  const candidates = []
  if (dx > 0) {
    const t = (right - cx) / dx
    const y = cy + dy * t
    if (y >= top && y <= bottom) candidates.push([t, right, y])
  } else if (dx < 0) {
    const t = (left - cx) / dx
    const y = cy + dy * t
    if (y >= top && y <= bottom) candidates.push([t, left, y])
  }

  if (dy > 0) {
    const t = (bottom - cy) / dy
    const x = cx + dx * t
    if (x >= left && x <= right) candidates.push([t, x, bottom])
  } else if (dy < 0) {
    const t = (top - cy) / dy
    const x = cx + dx * t
    if (x >= left && x <= right) candidates.push([t, x, top])
  }

  if (candidates.length === 0) {
    return [Math.max(left, Math.min(right, tx)), Math.max(top, Math.min(bottom, ty))]
  }
  const best = candidates.reduce((a, b) => a[0] < b[0] ? a : b)
  return [best[1], best[2]]
}

function getElementBoundsArr(action, p) {
  switch (action) {
    case 'draw_rect':
      return [p.x || 0, p.y || 0, (p.x || 0) + (p.w || 100), (p.y || 0) + (p.h || 100)]
    case 'draw_circle': {
      const cx = p.x || 0, cy = p.y || 0, r = p.r || 30
      return [cx - r, cy - r, cx + r, cy + r]
    }
    case 'draw_ellipse': {
      const cx = p.x || 0, cy = p.y || 0
      const rw = (p.w || 80) / 2, rh = (p.h || 40) / 2
      return [cx - rw, cy - rh, cx + rw, cy + rh]
    }
    default:
      return null
  }
}

/**
 * Snap a point to the nearest shape edge within threshold.
 * Returns [snappedX, snappedY, shapeId] or null if no snap.
 */
function snapArrowToShape(px, py, instructions) {
  let best = null
  let bestDist = Infinity
  const THRESH = 40

  for (const inst of instructions) {
    if (!/^(draw_rect|draw_circle|draw_ellipse)$/.test(inst.action)) continue
    const bounds = getElementBoundsArr(inst.action, inst.params || {})
    if (!bounds) continue

    const [l, t, r, b] = bounds
    const dxInside = px < l ? l - px : (px > r ? px - r : 0)
    const dyInside = py < t ? t - py : (py > b ? py - b : 0)
    const dist = Math.sqrt(dxInside * dxInside + dyInside * dyInside)

    if (dist < THRESH && dist < bestDist) {
      bestDist = dist
      const [ex, ey] = getEdgeBounds(bounds, px, py)
      best = [Math.round(ex * 10) / 10, Math.round(ey * 10) / 10, inst.id]
    }
  }

  return best
}

/**
 * After snapping an arrow endpoint to a shape edge, snap the whole arrow
 * to horizontal or vertical axis so it doesn't cut through shapes diagonally.
 * Adjusts the dragged endpoint to align with the fixed endpoint's axis.
 */
function snapArrowToAxis(arrowParams, instructions) {
  const sx = arrowParams.startX, sy = arrowParams.startY
  const ex = arrowParams.endX, ey = arrowParams.endY
  if (sx == null || sy == null || ex == null || ey == null) return null

  let startShape = null, endShape = null
  for (const inst of instructions) {
    if (!/^(draw_rect|draw_circle|draw_ellipse)$/.test(inst.action)) continue
    const p = inst.params || {}
    const b = getElementBoundsArr(inst.action, p)
    if (!b) continue
    const [l, t, r, bot] = b
    const onLeft = Math.abs(sx - l) <= 2 && sy >= t && sy <= bot
    const onRight = Math.abs(sx - r) <= 2 && sy >= t && sy <= bot
    const onTop = Math.abs(sy - t) <= 2 && sx >= l && sx <= r
    const onBot = Math.abs(sy - bot) <= 2 && sx >= l && sx <= r
    if (onLeft || onRight || onTop || onBot) startShape = { p, b }

    const onLeft2 = Math.abs(ex - l) <= 2 && ey >= t && ey <= bot
    const onRight2 = Math.abs(ex - r) <= 2 && ey >= t && ey <= bot
    const onTop2 = Math.abs(ey - t) <= 2 && ex >= l && ex <= r
    const onBot2 = Math.abs(ey - bot) <= 2 && ex >= l && ex <= r
    if (onLeft2 || onRight2 || onTop2 || onBot2) endShape = { p, b }
  }

  if (!startShape || !endShape) return null

  const scx = (startShape.b[0] + startShape.b[2]) / 2
  const scy = (startShape.b[1] + startShape.b[3]) / 2
  const ecx = (endShape.b[0] + endShape.b[2]) / 2
  const ecy = (endShape.b[1] + endShape.b[3]) / 2

  const result = {}

  if (Math.abs(ecx - scx) >= Math.abs(ecy - scy)) {
    let sy2, ey2
    if (ecx > scx) {
      result.startX = Math.round(startShape.b[2])
      result.endX = Math.round(endShape.b[0])
    } else {
      result.startX = Math.round(startShape.b[0])
      result.endX = Math.round(endShape.b[2])
    }
    sy2 = Math.max(startShape.b[1], Math.min(startShape.b[3], Math.round(scy)))
    ey2 = Math.max(endShape.b[1], Math.min(endShape.b[3], Math.round(ecy)))
    result.startY = Math.round(sy2)
    result.endY = Math.round(ey2)

    if (Math.abs(sy2 - ey2) > 1) {
      if (ecx > scx) {
        result.midX = Math.round((startShape.b[2] + endShape.b[0]) / 2)
      } else {
        result.midX = Math.round((startShape.b[0] + endShape.b[2]) / 2)
      }
    }
  } else {
    let sx2, ex2
    if (ecy > scy) {
      result.startY = Math.round(startShape.b[3])
      result.endY = Math.round(endShape.b[1])
    } else {
      result.startY = Math.round(startShape.b[1])
      result.endY = Math.round(endShape.b[3])
    }
    sx2 = Math.max(startShape.b[0], Math.min(startShape.b[2], Math.round(scx)))
    ex2 = Math.max(endShape.b[0], Math.min(endShape.b[2], Math.round(ecx)))
    result.startX = Math.round(sx2)
    result.endX = Math.round(ex2)

    if (Math.abs(sx2 - ex2) > 1) {
      if (ecy > scy) {
        result.midY = Math.round((startShape.b[3] + endShape.b[1]) / 2)
      } else {
        result.midY = Math.round((startShape.b[1] + endShape.b[3]) / 2)
      }
    }
  }

  return result
}

function isPointOnElement(px, py, element) {
  if (!element) return false
  const p = element.params || {}
  const action = element.action

  if (action === 'draw_rect') {
    const x = p.x || 0, y = p.y || 0, w = p.w || 100, h = p.h || 100
    return px >= x && px <= x + w && py >= y && py <= y + h
  }
  if (action === 'draw_circle') {
    const cx = p.x || 0, cy = p.y || 0, r = p.r || 30
    const dx = px - cx, dy = py - cy
    return dx * dx + dy * dy <= r * r
  }
  if (action === 'draw_ellipse') {
    const cx = p.x || 0, cy = p.y || 0
    const rw = (p.w || 80) / 2, rh = (p.h || 40) / 2
    if (rw <= 0 || rh <= 0) return false
    const edx = (px - cx) / rw, edy = (py - cy) / rh
    return edx * edx + edy * edy <= 1
  }
  if (action === 'draw_text') {
    const x = p.x || 0, y = p.y || 0
    const textW = (p.text || '').length * (p.fontSize || 14) * 0.6
    const textH = p.fontSize || 14
    return px >= x && px <= x + textW && py >= y && py <= y + textH
  }
  if (action === 'draw_label') {
    const x = p.x || 0, y = p.y || 0
    return px >= x && px <= x + 70 && py >= y && py <= y + 10
  }
  return false
}

function computeArrowUpdates(elementId, offsetX, offsetY, instructions) {
  const updates = []
  const element = instructions.find(i => i.id === elementId)
  if (!element) return updates

  for (const inst of instructions) {
    if (!/^(draw_arrow|draw_line|draw_dashed_line)$/.test(inst.action)) continue
    const p = inst.params || {}
    const nearStart = isPointOnElement(p.startX, p.startY, element)
    const nearEnd = isPointOnElement(p.endX, p.endY, element)
    if (nearStart || nearEnd) {
      const update = { id: inst.id, params: {} }
      if (nearStart) {
        update.params.startX = Math.round((p.startX + offsetX) * 10) / 10
        update.params.startY = Math.round((p.startY + offsetY) * 10) / 10
      }
      if (nearEnd) {
        update.params.endX = Math.round((p.endX + offsetX) * 10) / 10
        update.params.endY = Math.round((p.endY + offsetY) * 10) / 10
      }
      updates.push(update)
    }
  }
  return updates
}
