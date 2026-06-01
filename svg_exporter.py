"""SVG exporter — generates publication-quality vector graphics from diagram instructions."""

import json
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape


# ── Constants matching the canvas renderer ──

CANVAS_WIDTH = 1200
CANVAS_HEIGHT = 800

SHADOW_COLOR = "rgba(0,0,0,0.10)"
SHADOW_BLUR = 6
SHADOW_OFFSET_Y = 2

FONT_STACK = "Arial, Helvetica, sans-serif"

ARROW_HEAD_LENGTH = 14  # slightly wider than canvas (11) for print readability
ARROW_HEAD_ANGLE = 0.5


def _hex_to_rgba(hex_color: str, alpha: float = 1.0) -> str:
    """Convert hex color to rgba string."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    if alpha < 1.0:
        return f"rgba({r},{g},{b},{alpha})"
    return f"rgb({r},{g},{b})"


def _darken(hex_color: str, amount: float = 0.08) -> str:
    """Darken a hex color by the given amount (matching canvas shapeGradient)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r = int(h[0:2], 16)
    g = int(h[2:4], 16)
    b = int(h[4:6], 16)
    return f"rgb({round(r*(1-amount))},{round(g*(1-amount))},{round(b*(1-amount))})"


def _svg_style() -> str:
    """Generate the SVG <defs> section with shared filters and gradients."""
    parts = ["<defs>"]

    # Drop shadow filter (matches SHADOW_SHAPE)
    parts.append("""\
  <filter id="shape-shadow" x="-10%" y="-10%" width="130%" height="130%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.10)"/>
  </filter>""")

    # Text shadow (matches SHADOW_TEXT: white glow)
    parts.append("""\
  <filter id="text-shadow" x="-10%" y="-10%" width="130%" height="130%">
    <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="rgba(255,255,255,0.85)"/>
  </filter>""")

    # We'll generate specific gradients per unique fill color
    # Gradients are added dynamically in the rendering loop

    parts.append("</defs>")
    return "\n".join(parts)


def _add_gradient_def(fill_color: str, defs: set) -> str:
    """Record a fill color for gradient generation and return the gradient ID."""
    defs.add(fill_color)
    return f"grad-{fill_color.lstrip('#').lower()}"


def _build_gradient_xml(fill_color: str) -> str:
    """Build SVG <linearGradient> element matching canvas shapeGradient."""
    grad_id = f"grad-{fill_color.lstrip('#').lower()}"
    top = _hex_to_rgba(fill_color)
    bottom = _darken(fill_color, 0.08)
    return f"""\
  <linearGradient id="{grad_id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="{top}"/>
    <stop offset="50%" stop-color="{top}"/>
    <stop offset="100%" stop-color="{bottom}"/>
  </linearGradient>"""


def _wrap_text_svg(text: str, max_width: float, font_size: float) -> list[str]:
    """Simple text wrapping for SVG (approximate char-width heuristic)."""
    if not text:
        return [""]
    # Approximate: average char width ≈ font_size * 0.6
    char_width = font_size * 0.6
    max_chars = max(int(max_width / char_width), 1)
    lines = []
    for paragraph in text.split("\n"):
        while len(paragraph) > max_chars:
            # Try to break at a space
            break_idx = paragraph.rfind(" ", 0, max_chars + 1)
            if break_idx <= 0:
                break_idx = max_chars
            lines.append(paragraph[:break_idx])
            paragraph = paragraph[break_idx:].strip()
        if paragraph:
            lines.append(paragraph)
    return lines if lines else [""]


def _draw_rect_svg(p: dict, defs: set) -> str:
    """Generate SVG for draw_rect."""
    x = p.get("x", 0)
    y = p.get("y", 0)
    w = p.get("w", 100)
    h = p.get("h", 100)
    fill = p.get("fill", "#CCCCCC")
    stroke = p.get("stroke", "#333333")
    sw = p.get("strokeWidth", 2)
    rx = p.get("rx", 0)
    r = min(rx, min(w, h) / 2) if rx > 0 else 0

    grad_id = _add_gradient_def(fill, defs)

    parts = [f"""\
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" ry="{r}"
  fill="url(#{grad_id})" stroke="{stroke}" stroke-width="{sw}"
  filter="url(#shape-shadow)"/>"""]

    # Label on shape
    label = p.get("label", "")
    if label:
        font_size = p.get("fontSize", 13)
        font_color = p.get("fontColor", "#2C3E50")
        lines = _wrap_text_svg(label, w - 20, font_size)
        line_h = font_size * 1.3
        total_h = len(lines) * line_h
        label_y = y + h / 2 - total_h / 2 + font_size * 0.85
        # Dynamic pill width based on longest text line
        max_line_len = max((len(l) for l in lines), default=0)
        pill_w = max(max_line_len * font_size * 0.6 + 16, 20)
        parts.append(f"""\
<g filter="url(#text-shadow)">
  <rect x="{x + w/2 - pill_w/2}" y="{label_y - font_size * 0.3}" width="{pill_w}" height="{total_h + 4}" rx="4" fill="rgba(255,255,255,0.82)"/>
</g>""")
        for i, line in enumerate(lines):
            parts.append(f"""\
<text x="{x + w / 2}" y="{label_y + i * line_h}" text-anchor="middle"
  font-family="{FONT_STACK}" font-size="{font_size}px" fill="{font_color}">{escape(line)}</text>""")

    return "\n".join(parts)


def _draw_circle_svg(p: dict, defs: set) -> str:
    """Generate SVG for draw_circle."""
    cx = p.get("cx", p.get("x", 0))
    cy = p.get("cy", p.get("y", 0))
    r = p.get("r", 30)
    fill = p.get("fill", "#CCCCCC")
    stroke = p.get("stroke", "#333333")
    sw = p.get("strokeWidth", 2)

    grad_id = _add_gradient_def(fill, defs)

    parts = [f"""\
<circle cx="{cx}" cy="{cy}" r="{r}"
  fill="url(#{grad_id})" stroke="{stroke}" stroke-width="{sw}"
  filter="url(#shape-shadow)"/>"""]

    label = p.get("label", "")
    if label:
        font_size = p.get("fontSize", 13)
        font_color = p.get("fontColor", "#2C3E50")
        lines = _wrap_text_svg(label, r * 2 - 10, font_size)
        line_h = font_size * 1.3
        total_h = len(lines) * line_h
        label_y = cy - total_h / 2 + font_size * 0.85
        for i, line in enumerate(lines):
            parts.append(f"""\
<text x="{cx}" y="{label_y + i * line_h}" text-anchor="middle"
  font-family="{FONT_STACK}" font-size="{font_size}px" fill="{font_color}"
  filter="url(#text-shadow)">{escape(line)}</text>""")

    return "\n".join(parts)


def _draw_ellipse_svg(p: dict, defs: set) -> str:
    """Generate SVG for draw_ellipse."""
    cx = p.get("cx", p.get("x", 0))
    cy = p.get("cy", p.get("y", 0))
    rx = p.get("rx", p.get("w", 80) / 2)
    ry = p.get("ry", p.get("h", 40) / 2)
    fill = p.get("fill", "#CCCCCC")
    stroke = p.get("stroke", "#333333")
    sw = p.get("strokeWidth", 2)

    grad_id = _add_gradient_def(fill, defs)

    parts = [f"""\
<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"
  fill="url(#{grad_id})" stroke="{stroke}" stroke-width="{sw}"
  filter="url(#shape-shadow)"/>"""]

    label = p.get("label", "")
    if label:
        font_size = p.get("fontSize", 13)
        font_color = p.get("fontColor", "#2C3E50")
        lines = _wrap_text_svg(label, rx * 2 - 10, font_size)
        line_h = font_size * 1.3
        total_h = len(lines) * line_h
        label_y = cy - total_h / 2 + font_size * 0.85
        for i, line in enumerate(lines):
            parts.append(f"""\
<text x="{cx}" y="{label_y + i * line_h}" text-anchor="middle"
  font-family="{FONT_STACK}" font-size="{font_size}px" fill="{font_color}"
  filter="url(#text-shadow)">{escape(line)}</text>""")

    return "\n".join(parts)


def _draw_line_svg(p: dict) -> str:
    """Generate SVG for draw_line."""
    x1 = p.get("startX", 0)
    y1 = p.get("startY", 0)
    x2 = p.get("endX", 100)
    y2 = p.get("endY", 100)
    stroke = p.get("stroke", "#666666")
    sw = p.get("strokeWidth", 2)
    return f"""\
<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"
  stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"/>"""


def _draw_dashed_line_svg(p: dict) -> str:
    """Generate SVG for draw_dashed_line."""
    x1 = p.get("startX", 0)
    y1 = p.get("startY", 0)
    x2 = p.get("endX", 100)
    y2 = p.get("endY", 100)
    stroke = p.get("stroke", "#888888")
    sw = p.get("strokeWidth", 1.5)
    return f"""\
<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"
  stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"
  stroke-dasharray="6,5"/>"""


def _draw_arrow_svg(p: dict) -> str:
    """Generate SVG for draw_arrow with proper arrowhead, supports L-shape via midX/midY."""
    x1 = p.get("startX", 0)
    y1 = p.get("startY", 0)
    x2 = p.get("endX", 100)
    y2 = p.get("endY", 100)
    stroke = p.get("stroke", "#555555")
    sw = p.get("strokeWidth", 2)
    midX = p.get("midX")
    midY = p.get("midY")

    hl = ARROW_HEAD_LENGTH
    ha = ARROW_HEAD_ANGLE

    if midX is not None:
        # Three segments: (x1,y1)→(midX,y1)→(midX,y2)→(x2,y2)
        path = f'M {x1} {y1} L {midX} {y1} L {midX} {y2} L {x2} {y2}'
        final_angle = 0 if x2 >= midX else 3.14159
    elif midY is not None:
        path = f'M {x1} {y1} L {x1} {midY} L {x2} {midY} L {x2} {y2}'
        final_angle = 1.5708 if y2 >= midY else -1.5708
    else:
        path = f'M {x1} {y1} L {x2} {y2}'
        final_angle = __import__("math").atan2(y2 - y1, x2 - x1)

    ax1 = x2 - hl * __import__("math").cos(final_angle - ha)
    ay1 = y2 - hl * __import__("math").sin(final_angle - ha)
    ax2 = x2 - hl * __import__("math").cos(final_angle + ha)
    ay2 = y2 - hl * __import__("math").sin(final_angle + ha)

    return f"""\
<path d="{path}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>
<polygon points="{x2},{y2} {ax1},{ay1} {ax2},{ay2}"
  fill="{stroke}" filter="url(#shape-shadow)"/>"""


def _draw_pie_slice_svg(p: dict) -> str:
    """Generate SVG for draw_pie_slice."""
    cx = p.get("x", 0)
    cy = p.get("y", 0)
    r = p.get("r", 50)
    start = p.get("startAngle", 0)
    end = p.get("endAngle", 3.14159 * 2)
    fill = p.get("fill", "#3B82F6")
    stroke = p.get("stroke", "#FFFFFF")
    sw = p.get("strokeWidth", 2)

    # Compute arc endpoints
    import math
    x1 = cx + r * math.cos(start)
    y1 = cy + r * math.sin(start)
    x2 = cx + r * math.cos(end)
    y2 = cy + r * math.sin(end)

    large_arc = 1 if (end - start) > math.pi else 0

    d = f"M {cx},{cy} L {x1},{y1} A {r},{r} 0 {large_arc},1 {x2},{y2} Z"
    parts = [f"""\
<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"
  filter="url(#shape-shadow)"/>"""]

    # Label at midpoint
    label = p.get("label", "")
    if label:
        mid = (start + end) / 2
        lx = cx + r * 0.6 * math.cos(mid)
        ly = cy + r * 0.6 * math.sin(mid)
        parts.append(f"""\
<text x="{lx}" y="{ly}" text-anchor="middle" dominant-baseline="central"
  font-family="{FONT_STACK}" font-size="13px" fill="#FFFFFF"
  filter="url(#text-shadow)">{escape(label)}</text>""")

    return "\n".join(parts)


def _draw_text_svg(p: dict) -> str:
    """Generate SVG for draw_text."""
    text = p.get("text", "")
    if not text:
        return ""
    x = p.get("x", 0)
    y = p.get("y", 0)
    font_size = p.get("fontSize", 14)
    font_color = p.get("fontColor", "#2C3E50")
    align = p.get("textAlign", "left")

    anchor_map = {"left": "start", "center": "middle", "right": "end"}
    anchor = anchor_map.get(align, "start")

    # Text wrapping
    max_w = min(p.get("maxWidth", CANVAS_WIDTH - x - 40), CANVAS_WIDTH - 40)
    lines = _wrap_text_svg(text, max_w, font_size)
    line_h = font_size * 1.4

    parts = []
    for i, line in enumerate(lines):
        parts.append(f"""\
<text x="{x}" y="{y + i * line_h + font_size * 0.85}" text-anchor="{anchor}"
  font-family="{FONT_STACK}" font-size="{font_size}px" fill="{font_color}"
  filter="url(#text-shadow)">{escape(line)}</text>""")

    return "\n".join(parts)


def _draw_label_svg(p: dict) -> str:
    """Generate SVG for draw_label (callout with leader line)."""
    x = p.get("x", 0)
    y = p.get("y", 0)
    label = p.get("label", "")
    stroke = p.get("stroke", "#666666")
    font_color = p.get("fontColor", "#333333")

    # Anchor dot
    parts = [f"""\
<circle cx="{x}" cy="{y}" r="3.5" fill="{stroke}" filter="url(#text-shadow)"/>"""]

    # Leader line to callout
    lx = x + 60
    ly = y - 22
    parts.append(f"""\
<line x1="{x}" y1="{y}" x2="{lx}" y2="{ly}"
  stroke="{stroke}" stroke-width="1"/>""")

    if not label:
        return "\n".join(parts)

    # Callout bubble with text
    font_size = 12
    lines = _wrap_text_svg(label, 160, font_size)
    line_h = font_size * 1.3
    max_line_w = max(len(l) for l in lines) * font_size * 0.6 if lines else 0
    tw = min(max_line_w + 14, 180)
    th = max(len(lines) * line_h + 4, font_size + 6)

    # Bubble background
    parts.append(f"""\
<rect x="{lx + 4}" y="{ly - th / 2}" width="{tw}" height="{th}" rx="{th / 2}" ry="{th / 2}"
  fill="rgba(255,255,255,0.85)" stroke="none"/>""")

    # Text
    start_y = ly - (len(lines) - 1) * line_h / 2 + font_size * 0.85
    for i, line in enumerate(lines):
        parts.append(f"""\
<text x="{lx + 11}" y="{start_y + i * line_h}" text-anchor="start"
  font-family="{FONT_STACK}" font-size="{font_size}px" fill="{font_color}"
  filter="url(#text-shadow)">{escape(line)}</text>""")

    return "\n".join(parts)


def instructions_to_svg(instructions: list[dict]) -> str:
    """Convert diagram instructions to SVG string.

    Args:
        instructions: List of instruction dicts (params may be dict or JSON string).

    Returns:
        SVG XML string.
    """
    # Collect unique gradient colors
    gradient_defs: set = set()

    # Parse instructions
    parsed = []
    for inst in instructions:
        params = inst.get("params", {})
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except (json.JSONDecodeError, TypeError):
                params = {}
        parsed.append({
            "action": inst.get("action", ""),
            "params": params,
        })

    # Sort by zIndex
    parsed.sort(key=lambda i: i["params"].get("zIndex", 0))

    # Build SVG parts
    svg_parts = [f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="{CANVAS_WIDTH}" height="{CANVAS_HEIGHT}"
  viewBox="0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}">
  <rect width="{CANVAS_WIDTH}" height="{CANVAS_HEIGHT}" fill="#ffffff"/>"""]

    # Defs section
    svg_parts.append(_svg_style())

    # Render elements
    for item in parsed:
        action = item["action"]
        p = item["params"]

        try:
            if action == "draw_rect":
                svg_parts.append(_draw_rect_svg(p, gradient_defs))
            elif action == "draw_circle":
                svg_parts.append(_draw_circle_svg(p, gradient_defs))
            elif action == "draw_ellipse":
                svg_parts.append(_draw_ellipse_svg(p, gradient_defs))
            elif action == "draw_line":
                svg_parts.append(_draw_line_svg(p))
            elif action == "draw_dashed_line":
                svg_parts.append(_draw_dashed_line_svg(p))
            elif action == "draw_arrow":
                svg_parts.append(_draw_arrow_svg(p))
            elif action == "draw_text":
                svg_parts.append(_draw_text_svg(p))
            elif action == "draw_label":
                svg_parts.append(_draw_label_svg(p))
            elif action == "draw_pie_slice":
                svg_parts.append(_draw_pie_slice_svg(p))
        except Exception:
            continue  # skip malformed instructions

    # Insert gradient definitions into defs
    # Find the </defs> position and insert before it
    grad_xml = "\n".join(_build_gradient_xml(f) for f in gradient_defs)

    svg_str = "\n".join(svg_parts)
    svg_str = svg_str.replace("</defs>", f"{grad_xml}\n</defs>")

    svg_str += "\n</svg>"
    return svg_str
