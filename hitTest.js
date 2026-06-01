export function hitTest(x, y, instructions) {
  const sorted = [...instructions].sort(
    (a, b) => (b.params?.zIndex || 0) - (a.params?.zIndex || 0)
  )

  for (const inst of sorted) {
    const p = inst.params || {}
    if (isPointInElement(x, y, inst.action, p)) {
      return inst.id
    }
  }

  return null
}

function isPointInElement(px, py, action, p) {
  switch (action) {
    case 'draw_rect':
      return px >= p.x && px <= (p.x + (p.w || 100)) &&
             py >= p.y && py <= (p.y + (p.h || 100))

    case 'draw_circle': {
      const dx = px - p.x
      const dy = py - p.y
      return dx * dx + dy * dy <= (p.r || 30) * (p.r || 30)
    }

    case 'draw_ellipse': {
      const rw = (p.w || 80) / 2, rh = (p.h || 40) / 2
      const edx = (px - p.x) / rw, edy = (py - p.y) / rh
      return edx * edx + edy * edy <= 1
    }

    case 'draw_text': {
      const textWidth = (p.text || '').length * (p.fontSize || 14) * 0.6
      return px >= p.x && px <= (p.x + textWidth) &&
             py >= p.y && py <= (p.y + (p.fontSize || 14))
    }

    case 'draw_line':
    case 'draw_dashed_line':
    case 'draw_arrow':
      return isNearLine(px, py, p.startX || 0, p.startY || 0, p.endX || 0, p.endY || 0)

    case 'draw_label':
      return isNearLine(px, py, p.x || 0, p.y || 0, (p.x || 0) + 60, (p.y || 0) - 20)

    case 'draw_pie_slice': {
      const cx = p.x || 0, cy = p.y || 0, r = p.r || 50
      const dx = px - cx, dy = py - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > r) return false
      // Check angle
      const angle = Math.atan2(dy, dx)
      let a = angle
      if (a < 0) a += Math.PI * 2
      const startAngle = (p.startAngle || 0) % (Math.PI * 2)
      const endAngle = (p.endAngle || Math.PI * 2) % (Math.PI * 2)
      if (startAngle <= endAngle) return a >= startAngle && a <= endAngle
      return a >= startAngle || a <= endAngle  // wraps around 0
    }

    default:
      return false
  }
}

function isNearLine(px, py, x1, y1, x2, y2, threshold = 10) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.abs(px - x1) < threshold && Math.abs(py - y1) < threshold

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)))
  const projX = x1 + t * dx
  const projY = y1 + t * dy
  const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
  return dist < threshold
}

export function getElementBounds(action, p) {
  switch (action) {
    case 'draw_rect':
      return { x: p.x || 0, y: p.y || 0, w: p.w || 100, h: p.h || 100 }
    case 'draw_circle': {
      const cx = p.cx ?? p.x ?? 0, cy = p.cy ?? p.y ?? 0, r = p.r || 30
      return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }
    }
    case 'draw_ellipse': {
      const cx = p.cx ?? p.x ?? 0, cy = p.cy ?? p.y ?? 0
      const rw = p.rx ?? ((p.w ?? 80) / 2), rh = p.ry ?? ((p.h ?? 40) / 2)
      return { x: cx - rw, y: cy - rh, w: rw * 2, h: rh * 2 }
    }
    case 'draw_line':
    case 'draw_dashed_line':
    case 'draw_arrow': {
      const x1 = p.startX || 0, y1 = p.startY || 0, x2 = p.endX || 0, y2 = p.endY || 0
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 10, h: Math.abs(y2 - y1) || 10 }
    }
    case 'draw_text': {
      const textW = (p.text || '').length * (p.fontSize || 14) * 0.6
      return { x: p.x || 0, y: p.y || 0, w: textW, h: p.fontSize || 14 }
    }
    case 'draw_label':
      return { x: Math.min(p.x || 0, (p.x || 0) + 60), y: Math.min(p.y || 0, (p.y || 0) - 20), w: 70, h: 30 }
    default:
      return { x: 0, y: 0, w: 100, h: 100 }
  }
}

export function rectsOverlap(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

export function hitTestBox(x1, y1, x2, y2, instructions) {
  const sx = Math.min(x1, x2), sy = Math.min(y1, y2)
  const sw = Math.abs(x2 - x1), sh = Math.abs(y2 - y1)
  const selRect = { x: sx, y: sy, w: sw, h: sh }
  return instructions
    .filter(inst => {
      const bounds = getElementBounds(inst.action, inst.params || {})
      return rectsOverlap(selRect, bounds)
    })
    .map(inst => inst.id)
}
