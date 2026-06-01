"""Layout optimizer — post-processing step that auto-aligns and distributes diagram elements.

Runs after LLM generation to fix alignment issues and ensure publication-quality layout.
"""

import json
from typing import Any

SHAPE_ACTIONS = {"draw_rect", "draw_circle", "draw_ellipse", "draw_pie_slice"}
TEXT_ACTIONS = {"draw_text"}
ROW_TOLERANCE = 35

# Hierarchy-based text styling (auto-applied to free-standing text)
HIERARCHY_COLORS = {
    1: {"fontColor": "#1A1A2E", "fontSize": 20},   # Title
    2: {"fontColor": "#2C3E50", "fontSize": 16},   # Section header
    3: {"fontColor": "#475569", "fontSize": 13},   # Body / detail
}


def _get_params(inst: dict) -> dict:
    """Ensure params is a dict, parsing from JSON string if needed."""
    params = inst.get("params", {})
    if isinstance(params, str):
        try:
            return json.loads(params)
        except (json.JSONDecodeError, TypeError):
            return {}
    return params


def _set_params(inst: dict, params: dict):
    """Set params back on instruction (as dict — not JSON string)."""
    inst["params"] = params


def _get_shape_bounds(p: dict) -> tuple:
    """Get (left, top, right, bottom) for a shape or text instruction."""
    action = p.get("_action", "")
    if action == "draw_rect":
        x = p.get("x", 0)
        y = p.get("y", 0)
        w = p.get("w", 100)
        h = p.get("h", 100)
        return x, y, x + w, y + h
    elif action == "draw_circle":
        cx = p.get("x", 0)
        cy = p.get("y", 0)
        r = p.get("r", 30)
        return cx - r, cy - r, cx + r, cy + r
    elif action == "draw_ellipse":
        cx = p.get("x", 0)
        cy = p.get("y", 0)
        rx = p.get("w", 80) / 2
        ry = p.get("h", 40) / 2
        return cx - rx, cy - ry, cx + rx, cy + ry
    elif action == "draw_text":
        return _get_text_bounds(p)
    elif action == "draw_pie_slice":
        cx = p.get("x", 0)
        cy = p.get("y", 0)
        r = p.get("r", 50)
        return cx - r, cy - r, cx + r, cy + r
    return 0, 0, 0, 0


def _get_text_bounds(p: dict) -> tuple:
    """Estimate (left, top, right, bottom) for a draw_text element.
    CJK-aware: Chinese characters are ~2x wider than Latin characters.
    """
    text = p.get("text", "")
    font_size = p.get("fontSize", 14)
    if not text:
        return 0, 0, 0, 0

    # CJK-aware width: Chinese chars ~2x Latin chars
    cjk_count = sum(1 for c in text if '一' <= c <= '鿿' or '　' <= c <= '〿')
    latin_count = len(text) - cjk_count
    text_width = cjk_count * font_size * 1.0 + latin_count * font_size * 0.55
    text_width += 4  # small safety margin
    text_height = font_size * 1.5

    align = p.get("textAlign", "left")
    x = p.get("x", 0)
    y = p.get("y", 0)

    if align == "center":
        left = x - text_width / 2
    elif align == "right":
        left = x - text_width
    else:
        left = x

    return left, y, left + text_width, y + text_height


def _get_shape_center(p: dict) -> tuple:
    """Get (center_x, center_y) for a shape."""
    if p.get("_action") == "draw_rect":
        x = p.get("x", 0)
        y = p.get("y", 0)
        w = p.get("w", 100)
        h = p.get("h", 100)
        return x + w / 2, y + h / 2
    else:
        return p.get("x", 0), p.get("y", 0)


def optimize_layout(instructions: list[dict]) -> list[dict]:
    """Post-process instructions to fix alignment and spacing.

    Args:
        instructions: List of instruction dicts with params as dicts (not JSON strings).

    Returns:
        Modified instructions with optimized layout.
    """
    if not instructions:
        return instructions

    # Deep copy to avoid mutating originals
    result = []
    for inst in instructions:
        result.append({
            "id": inst.get("id", ""),
            "action": inst.get("action", ""),
            "params": dict(_get_params(inst)),
            "description": inst.get("description", ""),
        })

    # Tag each param dict with its action for helper functions
    for item in result:
        item["params"]["_action"] = item["action"]

    # ── Step 1: Group shape elements into rows ──
    shapes = [item for item in result if item["action"] in SHAPE_ACTIONS]
    if len(shapes) >= 2:
        # Sort shapes by y position
        shapes.sort(key=lambda s: s["params"].get("y", 0))

        # Group into rows
        rows = []
        current_row = [shapes[0]]
        for s in shapes[1:]:
            prev_y = current_row[-1]["params"].get("y", 0)
            curr_y = s["params"].get("y", 0)
            if abs(curr_y - prev_y) <= ROW_TOLERANCE:
                current_row.append(s)
            else:
                rows.append(current_row)
                current_row = [s]
        if current_row:
            rows.append(current_row)

        # ── Step 2: Size boxes to fit their text labels ──
        _size_boxes_to_text(shapes)

        # ── Step 3: Prevent overlaps while preserving LLM's intended layout ──
        for row in rows:
            if len(row) < 2:
                continue

            # Sort left to right
            row.sort(key=lambda s: s["params"].get("x", 0))

            # Only fix overlaps: ensure minimum 15px gap between adjacent shapes
            for i in range(1, len(row)):
                prev = row[i - 1]["params"]
                curr = row[i]["params"]
                prev_right = prev.get("x", 0) + prev.get("w", 100)
                curr_x = curr.get("x", 0)
                min_gap = 25
                if curr_x < prev_right + min_gap:
                    curr["x"] = prev_right + min_gap

        # ── Step 3b: Global overlap resolution (across rows) ──
        # After text sizing and row overlap fixes, check ALL shape pairs
        # for bounding-box overlap and push the lower one downward.
        for _ in range(5):
            any_fixed = False
            for i in range(len(shapes)):
                for j in range(i + 1, len(shapes)):
                    bi = _get_shape_bounds(shapes[i]["params"])
                    bj = _get_shape_bounds(shapes[j]["params"])
                    overlap_x = min(bi[2], bj[2]) - max(bi[0], bj[0])
                    overlap_y = min(bi[3], bj[3]) - max(bi[1], bj[1])
                    if overlap_x > 2 and overlap_y > 2:
                        any_fixed = True
                        pi = shapes[i]["params"]
                        pj = shapes[j]["params"]
                        if pi.get("y", 0) <= pj.get("y", 0):
                            pj["y"] = bi[3] + 25  # push j below i
                        else:
                            pi["y"] = bj[3] + 25  # push i below j
            if not any_fixed:
                break

        # ── Step 3f: Apply even distribution for row symmetry ──
        _apply_row_symmetry(rows)

    # ── Step 3c: Text-text & text-shape overlap resolution ──
    _resolve_text_overlaps(result)

    # ── Step 3d: Apply hierarchy-based text styling ──
    _apply_hierarchy_styling(result)

    # ── Step 3e: Apply layer-based depth styling to shapes ──
    _apply_layer_styling(result)


    # ── Step 4: Fix arrow endpoints to connect edge-to-edge ──
    arrows = [item for item in result if item["action"] in ("draw_arrow", "draw_dashed_line", "draw_line")]
    for arrow in arrows:
        ap = arrow["params"]
        ax1 = ap.get("startX", 0)
        ay1 = ap.get("startY", 0)
        ax2 = ap.get("endX", 100)
        ay2 = ap.get("endY", 100)

        # Find closest shapes using direction-aware edge proximity
        start_shape = _find_closest_shape(ax1, ay1, shapes, other_x=ax2, other_y=ay2)
        end_shape = _find_closest_shape(ax2, ay2, shapes, other_x=ax1, other_y=ay1)

        # Fallback: if no shape found, try without direction hint
        if not start_shape:
            start_shape = _find_closest_shape(ax1, ay1, shapes)
        if not end_shape:
            end_shape = _find_closest_shape(ax2, ay2, shapes)

        # Safety: skip if both ends map to the same shape (avoids zero-length arrows)
        if start_shape and end_shape and start_shape is end_shape:
            continue

        if start_shape:
            sx, sy = _get_edge_point(
                _get_shape_bounds(start_shape["params"]),
                ax2, ay2  # connect toward the end point
            )
            ap["startX"] = sx
            ap["startY"] = sy

        if end_shape:
            # Use snapped start as target so both ends connect cleanly
            target_x = ap.get("startX", ax1)
            target_y = ap.get("startY", ay1)
            ex, ey = _get_edge_point(
                _get_shape_bounds(end_shape["params"]),
                target_x, target_y
            )
            ap["endX"] = ex
            ap["endY"] = ey

    # ── Step 4b: Snap arrows to horizontal/vertical axis ──
    _snap_arrows_to_axis(result, shapes)

    # ── Step 3f: Push text away from nearby arrow lines ──
    _separate_text_from_arrows(result)

    # ── Step 3g: Final overlap sweep — text-arrow separation may cause new overlaps ──
    _resolve_text_overlaps(result)

    # ── Step 4c: Validate all arrows — force-connect any disconnected endpoints ──
    _validate_arrow_connections(result, shapes)

    # ── Step 5: Center the overall diagram ──

    all_params = [item["params"] for item in result]
    bounds_elements = [p for p in all_params if p.get("_action") in (SHAPE_ACTIONS | TEXT_ACTIONS)]
    if not bounds_elements:
        _cleanup(result)
        return result
    min_x = min(_get_shape_bounds(p)[0] for p in bounds_elements)
    max_x = max(_get_shape_bounds(p)[2] for p in bounds_elements)
    min_y = min(_get_shape_bounds(p)[1] for p in bounds_elements)
    max_y = max(_get_shape_bounds(p)[3] for p in bounds_elements)

    content_w = max_x - min_x
    content_h = max_y - min_y
    canvas_w = 1200
    canvas_h = 800

    if content_w > 0 and content_h > 0:
        offset_x = (canvas_w - content_w) / 2 - min_x
        offset_y = (canvas_h - content_h) / 2 - min_y

        # Only shift if the content is significantly off-center (>100px)
        if abs(offset_x) > 100 or abs(offset_y) > 100:
            for item in result:
                p = item["params"]
                action = item["action"]
                if action in SHAPE_ACTIONS:
                    p["x"] = p.get("x", 0) + offset_x
                    p["y"] = p.get("y", 0) + offset_y
                elif action in ("draw_text", "draw_label"):
                    p["x"] = p.get("x", 0) + offset_x
                    p["y"] = p.get("y", 0) + offset_y
                elif action in ("draw_arrow", "draw_line", "draw_dashed_line"):
                    p["startX"] = p.get("startX", 0) + offset_x
                    p["startY"] = p.get("startY", 0) + offset_y
                    p["endX"] = p.get("endX", 100) + offset_x
                    p["endY"] = p.get("endY", 100) + offset_y
    # ── Step 6: Normalize layer order by element type ──
    _normalize_layer_order(result)

    # ── Step 7: Final text overlap check after all position changes ──
    _resolve_text_overlaps(result)

    # Clean up internal tags
    _cleanup(result)

    return result


def _estimate_text_width(text: str, font_size: int) -> int:
    """CJK-aware text width estimation in canvas pixels."""
    if not text:
        return 0
    cjk = sum(1 for c in text if '一' <= c <= '鿿' or '　' <= c <= '〿')
    latin = len(text) - cjk
    return int(cjk * font_size * 1.0 + latin * font_size * 0.55)


def _size_boxes_to_text(shapes: list):
    """Expand boxes to wrap their text labels if the LLM made them too small."""
    for s in shapes:
        p = s["params"]
        label = p.get("label", "")
        if not label:
            continue
        font_size = p.get("fontSize", 13)
        padding = 30  # 15 px each side

        text_width = _estimate_text_width(label, font_size)
        min_w = text_width + padding
        cur_w = p.get("w", 100)
        if min_w > cur_w:
            p["w"] = round(min_w, 1)

        # Multi-line height: if text wraps, grow the box vertically
        avg_char_w = _estimate_text_width(label, font_size) / max(len(label), 1)
        max_chars_line = max(1, int(cur_w / avg_char_w)) if avg_char_w > 0 else 999
        num_lines = (len(label) + max_chars_line - 1) // max_chars_line
        min_h = num_lines * font_size * 1.4 + 16
        cur_h = p.get("h", 50)
        if min_h > cur_h:
            p["h"] = round(min_h, 1)


def _apply_hierarchy_styling(result: list):
    """Auto-detect hierarchy level for draw_text elements and apply consistent styling.

    Levels are determined by font size (larger = higher level).
    After detecting the level, applies standardized fontColor and fontSize.
    """
    texts = [item for item in result if item["action"] in TEXT_ACTIONS]
    if not texts:
        return

    for item in texts:
        p = item["params"]
        font_size = p.get("fontSize", 14)

        # Detect level based on font size
        if font_size >= 18:
            level = 1
        elif font_size >= 14:
            level = 2
        else:
            level = 3

        # Apply consistent styling for this level
        style = HIERARCHY_COLORS[level]
        p["fontColor"] = style["fontColor"]
        p["fontSize"] = style["fontSize"]


def _apply_layer_styling(result: list):
    """Apply layer-based depth styling to shapes based on zIndex.

    Groups shapes into 3 layers (bottom/mid/top) by zIndex range so the
    canvas renderer can apply variable shadow/opacity for visual depth.
    """
    shape_items = [item for item in result if item["action"] in SHAPE_ACTIONS]
    if len(shape_items) < 2:
        return

    z_vals = [item["params"].get("zIndex", 0) for item in shape_items]
    min_z = min(z_vals)
    max_z = max(z_vals)
    if max_z <= min_z:
        # No zIndex variation — mark all as mid-layer
        for item in shape_items:
            item["params"]["_layerDepth"] = "mid"
        return

    lo = min_z + (max_z - min_z) / 3
    hi = min_z + (max_z - min_z) * 2 / 3

    for item in shape_items:
        z = item["params"].get("zIndex", 0)
        if z <= lo:
            item["params"]["_layerDepth"] = "bottom"
        elif z >= hi:
            item["params"]["_layerDepth"] = "top"
        else:
            item["params"]["_layerDepth"] = "mid"


def _separate_text_from_arrows(result: list):
    """Push text elements away from nearby arrow lines using point-to-line distance."""
    texts = [item for item in result if item["action"] in TEXT_ACTIONS]
    arrows = [item for item in result if item["action"] in ("draw_arrow", "draw_line", "draw_dashed_line")]
    if not texts or not arrows:
        return
    for t_item in texts:
        tp = t_item["params"]
        tx = tp.get("x", 0)
        ty = tp.get("y", 0)
        font_size = tp.get("fontSize", 14)
        text_w = _estimate_text_width(tp.get("text", ""), font_size)
        text_h = font_size * 1.5
        align = tp.get("textAlign", "left")
        if align == "center":
            tx -= text_w / 2
        elif align == "right":
            tx -= text_w
        # Text center
        cx = tx + text_w / 2
        cy = ty + text_h / 2
        min_dist = font_size * 0.8
        for a_item in arrows:
            ap = a_item["params"]
            ax1, ay1 = ap.get("startX", 0), ap.get("startY", 0)
            ax2, ay2 = ap.get("endX", 100), ap.get("endY", 100)
            # Perpendicular distance from text center to arrow line segment
            dx_line = ax2 - ax1
            dy_line = ay2 - ay1
            length_sq = dx_line * dx_line + dy_line * dy_line
            if length_sq == 0:
                continue
            t = max(0, min(1, ((cx - ax1) * dx_line + (cy - ay1) * dy_line) / length_sq))
            px = ax1 + t * dx_line
            py = ay1 + t * dy_line
            dist = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
            if dist < min_dist:
                # Push text directly away from arrow line
                if dist > 0:
                    nx = (cx - px) / dist
                    ny = (cy - py) / dist
                else:
                    nx, ny = 0, 1
                push = min_dist - dist + 4
                tp["x"] = round(tp.get("x", 0) + nx * push, 1)
                tp["y"] = round(tp.get("y", 0) + ny * push, 1)
                break


def _resolve_text_overlaps(result: list):
    """Resolve overlaps between text-text and text-shape elements.

    Tries rightward push first (preserves vertical reading flow), falls
    back to downward push. Clamps positions to canvas bounds.
    """
    CANVAS_W = 1200
    CANVAS_H = 800
    MIN_GAP = 15

    all_elements = [item for item in result
                    if item["action"] in SHAPE_ACTIONS | TEXT_ACTIONS]
    if len(all_elements) < 2:
        return

    for _ in range(5):
        any_fixed = False
        for i in range(len(all_elements)):
            for j in range(i + 1, len(all_elements)):
                bi = _get_shape_bounds(all_elements[i]["params"])
                bj = _get_shape_bounds(all_elements[j]["params"])
                overlap_x = min(bi[2], bj[2]) - max(bi[0], bj[0])
                overlap_y = min(bi[3], bj[3]) - max(bi[1], bj[1])
                if overlap_x > 0 and overlap_y > 0:
                    any_fixed = True
                    pi = all_elements[i]["params"]
                    pj = all_elements[j]["params"]
                    is_text_i = pi.get("_action", "") in TEXT_ACTIONS
                    is_text_j = pj.get("_action", "") in TEXT_ACTIONS

                    # Determine which element to move (prefer moving text; if both same type, move lower one)
                    move_i = False
                    if is_text_i and not is_text_j:
                        move_i = True   # move the text element
                    elif is_text_j and not is_text_i:
                        move_i = False  # move the text element (j)
                    else:
                        move_i = pi.get("y", 0) > pj.get("y", 0)  # move the lower one

                    if move_i:
                        # Try rightward first, then down
                        new_x = bj[2] + MIN_GAP
                        if new_x + (bi[2] - bi[0]) < CANVAS_W:
                            pi["x"] = round(new_x, 1)
                        else:
                            pi["y"] = round(bj[3] + MIN_GAP, 1)
                    else:
                        new_x = bi[2] + MIN_GAP
                        if new_x + (bj[2] - bj[0]) < CANVAS_W:
                            pj["x"] = round(new_x, 1)
                        else:
                            pj["y"] = round(bi[3] + MIN_GAP, 1)
        if not any_fixed:
            break

    # Clamp all text elements to stay within canvas
    for item in all_elements:
        p = item["params"]
        bounds = _get_shape_bounds(p)
        w = bounds[2] - bounds[0]
        h = bounds[3] - bounds[1]
        if p.get("_action", "") in TEXT_ACTIONS:
            # For text, 'x' is left (or center/right adjusted)
            align = p.get("textAlign", "left")
            if align == "center":
                p["x"] = round(max(w / 2, min(CANVAS_W - w / 2, p.get("x", 0))), 1)
            elif align == "right":
                p["x"] = round(max(w, min(CANVAS_W, p.get("x", 0))), 1)
            else:
                p["x"] = round(max(0, min(CANVAS_W - w, p.get("x", 0))), 1)
            p["y"] = round(max(0, min(CANVAS_H - h, p.get("y", 0))), 1)
        else:
            # Shapes: clamp x,y so box stays on canvas
            p["x"] = round(max(0, min(CANVAS_W - (p.get("w", 100)), p.get("x", 0))), 1)
            p["y"] = round(max(0, min(CANVAS_H - (p.get("h", 100)), p.get("y", 0))), 1)


def _find_closest_shape(x: float, y: float, shapes: list,
                         other_x: float | None = None,
                         other_y: float | None = None) -> dict | None:
    """Find the shape whose EDGE is closest to (x, y), direction-aware.

    Uses edge-to-point distance (not center distance) so that a point near
    a wide shape's edge correctly matches that shape instead of a narrower
    neighbor whose center happens to be closer.

    When *other_* is provided, determines whether the arrow is primarily
    horizontal or vertical and adds an alignment bonus (Y-alignment for
    horizontal arrows, X-alignment for vertical arrows) to prefer shapes
    lying along the arrow's axis.
    """
    if not shapes:
        return None

    # Determine direction; only apply axis bonus when clearly axis-aligned
    is_horizontal = None
    if other_x is not None and other_y is not None:
        dx_total = abs(other_x - x)
        dy_total = abs(other_y - y)
        if dx_total > dy_total * 2:       # at least 2× more horizontal
            is_horizontal = True
        elif dy_total > dx_total * 2:      # at least 2× more vertical
            is_horizontal = False
        # else diagonal — no axis bonus

    best = None
    best_score = float("inf")

    for s in shapes:
        bounds = _get_shape_bounds(s["params"])
        left, top, right, bottom = bounds

        # Shortest distance from (x, y) to bounding-box edge
        dx = 0.0
        if x < left:
            dx = left - x
        elif x > right:
            dx = x - right

        dy = 0.0
        if y < top:
            dy = top - y
        elif y > bottom:
            dy = y - bottom

        edge_dist = dx * dx + dy * dy      # squared, fine for comparison

        # Axis alignment bonus
        if is_horizontal is True:
            cy = (top + bottom) / 2
            score = edge_dist + abs(cy - y) * 0.5
        elif is_horizontal is False:
            cx = (left + right) / 2
            score = edge_dist + abs(cx - x) * 0.5
        else:
            score = edge_dist

        if score < best_score:
            best_score = score
            best = s

    return best


def _get_edge_point(bounds: tuple, target_x: float, target_y: float) -> tuple:
    """Get the point on the bounding box edge that a ray from center toward target first hits.

    Checks each edge individually to ensure the result lies on the actual edge segment,
    not on the infinite line extension.
    """
    left, top, right, bottom = bounds
    cx = (left + right) / 2
    cy = (top + bottom) / 2

    dx = target_x - cx
    dy = target_y - cy

    if dx == 0 and dy == 0:
        return cx, cy

    candidates = []

    # Right edge (x = right)
    if dx > 0:
        t = (right - cx) / dx
        y = cy + dy * t
        if top <= y <= bottom:
            candidates.append((t, right, y))
    # Left edge (x = left)
    elif dx < 0:
        t = (left - cx) / dx
        y = cy + dy * t
        if top <= y <= bottom:
            candidates.append((t, left, y))

    # Bottom edge (y = bottom)
    if dy > 0:
        t = (bottom - cy) / dy
        x = cx + dx * t
        if left <= x <= right:
            candidates.append((t, x, bottom))
    # Top edge (y = top)
    elif dy < 0:
        t = (top - cy) / dy
        x = cx + dx * t
        if left <= x <= right:
            candidates.append((t, x, top))

    if not candidates:
        # Fallback: clamp target to nearest box edge
        return round(max(left, min(right, target_x)), 1), \
               round(max(top, min(bottom, target_y)), 1)

    # Pick the closest valid intersection (smallest positive t)
    t, x, y = min(candidates, key=lambda c: c[0])
    return round(x, 1), round(y, 1)


def _closest_point_on_box(bounds: tuple, px: float, py: float) -> tuple:
    """Clamp a point to the nearest point on the box perimeter."""
    left, top, right, bottom = bounds
    if left <= px <= right and top <= py <= bottom:
        # Point is inside — push to nearest edge
        d_left = px - left
        d_right = right - px
        d_top = py - top
        d_bot = bottom - py
        min_d = min(d_left, d_right, d_top, d_bot)
        if min_d == d_left:
            return left, py
        elif min_d == d_right:
            return right, py
        elif min_d == d_top:
            return px, top
        else:
            return px, bottom
    else:
        # Outside — clamp
        return max(left, min(right, px)), max(top, min(bottom, py))


def _cleanup(result: list[dict]):
    """Remove internal tags from params."""
    for item in result:
        item["params"].pop("_action", None)
        item["params"].pop("_layerDepth", None)


def _snap_arrows_to_axis(result, shapes):
    """Snap arrows to horizontal or vertical alignment with L-shaped bends.

    When connected shapes are staggered (no overlap in perpendicular axis),
    inserts midX/midY bend points so the arrow follows an L-shaped path
    that is purely horizontal/vertical and never cuts through box interiors.
    """
    arrows = [item for item in result if item["action"] in ("draw_arrow", "draw_dashed_line")]
    if not arrows or len(shapes) < 2:
        return
    for arrow in arrows:
        ap = arrow["params"]
        # Clear any previous bend
        ap.pop("midX", None)
        ap.pop("midY", None)

        start_shape = _find_closest_shape(
            ap.get("startX", 0), ap.get("startY", 0), shapes,
            other_x=ap.get("endX", 100), other_y=ap.get("endY", 100))
        end_shape = _find_closest_shape(
            ap.get("endX", 100), ap.get("endY", 100), shapes,
            other_x=ap.get("startX", 0), other_y=ap.get("startY", 0))
        if not start_shape:
            start_shape = _find_closest_shape(ap.get("startX", 0), ap.get("startY", 0), shapes)
        if not end_shape:
            end_shape = _find_closest_shape(ap.get("endX", 100), ap.get("endY", 100), shapes)
        if not start_shape or not end_shape or start_shape is end_shape:
            continue

        sb = _get_shape_bounds(start_shape["params"])
        eb = _get_shape_bounds(end_shape["params"])
        scx = (sb[0] + sb[2]) / 2
        scy = (sb[1] + sb[3]) / 2
        ecx = (eb[0] + eb[2]) / 2
        ecy = (eb[1] + eb[3]) / 2

        if abs(ecx - scx) >= abs(ecy - scy):
            # ── Horizontal primary ──
            if ecx > scx:
                ap["startX"] = round(sb[2], 1)
                ap["endX"] = round(eb[0], 1)
            else:
                ap["startX"] = round(sb[0], 1)
                ap["endX"] = round(eb[2], 1)

            sy = max(sb[1], min(sb[3], scy))
            ey = max(eb[1], min(eb[3], ecy))
            ap["startY"] = round(sy, 1)
            ap["endY"] = round(ey, 1)

            # If staggered, insert a vertical bend at the midpoint between edges
            if abs(sy - ey) > 1:
                if ecx > scx:
                    ap["midX"] = round((sb[2] + eb[0]) / 2, 1)
                else:
                    ap["midX"] = round((sb[0] + eb[2]) / 2, 1)
        else:
            # ── Vertical primary ──
            if ecy > scy:
                ap["startY"] = round(sb[3], 1)
                ap["endY"] = round(eb[1], 1)
            else:
                ap["startY"] = round(sb[1], 1)
                ap["endY"] = round(eb[3], 1)

            sx = max(sb[0], min(sb[2], scx))
            ex = max(eb[0], min(eb[2], ecx))
            ap["startX"] = round(sx, 1)
            ap["endX"] = round(ex, 1)

            # If staggered, insert a horizontal bend at the midpoint between edges
            if abs(sx - ex) > 1:
                if ecy > scy:
                    ap["midY"] = round((sb[3] + eb[1]) / 2, 1)
                else:
                    ap["midY"] = round((sb[1] + eb[3]) / 2, 1)

        # Avoid passing through intermediate shapes
        _avoid_path_collisions(ap, start_shape, end_shape, shapes)



def _avoid_path_collisions(ap, start_shape, end_shape, all_shapes):
    """After setting midX/midY for an L-shaped arrow path, check if any
    segment passes through a shape INTERIOR and adjust the bend point
    to route around it. This prevents arrows from cutting through boxes.
    """
    midX = ap.get("midX")
    midY = ap.get("midY")
    if midX is None and midY is None:
        return  # straight arrow — no bend to adjust

    sx = ap.get("startX", 0)
    sy = ap.get("startY", 0)
    ex = ap.get("endX", 100)
    ey = ap.get("endY", 100)

    # Collect shapes to avoid (excluding the two connected shapes)
    avoid = []
    for s in all_shapes:
        if s is start_shape or s is end_shape:
            continue
        avoid.append(_get_shape_bounds(s["params"]))

    if not avoid:
        return

    GAP = 8  # min px between arrow path and any shape edge

    if midX is not None:
        # Three segments: H(startX→midX at sy), V(midX at sy→ey), H(midX→endX at ey)
        # Check horizontal segments first
        for seg_sx, seg_ex, seg_y in [(sx, midX, sy), (midX, ex, ey)]:
            x1, x2 = (seg_sx, seg_ex) if seg_sx < seg_ex else (seg_ex, seg_sx)
            for b in avoid:
                l, t, r, bot = b
                # Strict interior: totally inside the shape, not touching edge
                if not (t < seg_y < bot):
                    continue
                overlap_l = max(x1, l)
                overlap_r = min(x2, r)
                if overlap_l < overlap_r:
                    # This segment goes through the shape — push midX past it
                    if seg_y == sy:
                        # Segment 1: push midX left of shape
                        new_midX = l - GAP
                        if new_midX > sx:
                            ap["midX"] = round(new_midX, 1)
                    else:
                        # Segment 3: push midX right of shape
                        new_midX = r + GAP
                        if new_midX < ex:
                            ap["midX"] = round(new_midX, 1)

        # Re-check vertical segment with adjusted midX
        midX = ap["midX"]
        if midX is not None:
            y1, y2 = (sy, ey) if sy < ey else (ey, sy)
            for b in avoid:
                l, t, r, bot = b
                if not (l < midX < r):
                    continue
                overlap_t = max(y1, t)
                overlap_b = min(y2, bot)
                if overlap_t < overlap_b:
                    # Vertical segment goes through shape — push midX to nearest clear side
                    dist_left = midX - l
                    dist_right = r - midX
                    if dist_left >= dist_right:
                        new_midX = r + GAP
                    else:
                        new_midX = l - GAP
                    # Ensure new_midX is between start and end
                    seg_min, seg_max = (sx, ex) if sx < ex else (ex, sx)
                    new_midX = max(seg_min + GAP, min(seg_max - GAP, new_midX))
                    ap["midX"] = round(new_midX, 1)

    if midY is not None:
        # Three segments: V(startY→midY at sx), H(midY at sx→ex), V(midY→endY at ex)
        for seg_sy, seg_ey, seg_x in [(sy, midY, sx), (midY, ey, ex)]:
            y1, y2 = (seg_sy, seg_ey) if seg_sy < seg_ey else (seg_ey, seg_sy)
            for b in avoid:
                l, t, r, bot = b
                if not (l < seg_x < r):
                    continue
                overlap_t = max(y1, t)
                overlap_b = min(y2, bot)
                if overlap_t < overlap_b:
                    if seg_x == sx:
                        new_midY = t - GAP
                        if new_midY > sy:
                            ap["midY"] = round(new_midY, 1)
                    else:
                        new_midY = bot + GAP
                        if new_midY < ey:
                            ap["midY"] = round(new_midY, 1)

        midY = ap["midY"]
        if midY is not None:
            x1, x2 = (sx, ex) if sx < ex else (ex, sx)
            for b in avoid:
                l, t, r, bot = b
                if not (t < midY < bot):
                    continue
                overlap_l = max(x1, l)
                overlap_r = min(x2, r)
                if overlap_l < overlap_r:
                    dist_top = midY - t
                    dist_bot = bot - midY
                    new_midY = bot + GAP if dist_top >= dist_bot else t - GAP
                    seg_min, seg_max = (sy, ey) if sy < ey else (ey, sy)
                    new_midY = max(seg_min + GAP, min(seg_max - GAP, new_midY))
                    ap["midY"] = round(new_midY, 1)


def _apply_row_symmetry(rows):
    """Apply even horizontal distribution within each row for visual symmetry.

    For rows with 3+ shapes of similar height, redistributes them so that
    the gaps between adjacent shapes are equal (or as close as possible).
    This creates a clean, publication-quality layout.
    """
    CANVAS_W = 1200
    MIN_GAP = 25

    for row in rows:
        if len(row) < 3:
            continue

        row.sort(key=lambda s: s["params"].get("x", 0))

        left_edge = row[0]["params"].get("x", 0)
        right_edge = row[-1]["params"].get("x", 0) + row[-1]["params"].get("w", 100)
        total_width = right_edge - left_edge

        content_w = sum(s["params"].get("w", 100) for s in row)
        gaps = len(row) - 1
        gap = (total_width - content_w) / gaps

        if gap < MIN_GAP:
            gap = MIN_GAP
            total_width = content_w + gap * gaps

        cur_x = left_edge
        for i, s in enumerate(row):
            p = s["params"]
            if i > 0:
                cur_x += gap
            p["x"] = round(cur_x, 1)
            cur_x += p.get("w", 100)


def _validate_arrow_connections(result, shapes):
    """Safety net: verify every arrow endpoint is on a shape edge.
    If an endpoint is disconnected (not on any shape), force-connect
    to the nearest shape's edge.
    """
    arrows = [item for item in result if item["action"] in ("draw_arrow", "draw_dashed_line", "draw_line")]
    if not arrows or not shapes:
        return
    for arrow in arrows:
        ap = arrow["params"]
        ax1, ay1 = ap.get("startX", 0), ap.get("startY", 0)
        ax2, ay2 = ap.get("endX", 100), ap.get("endY", 100)

        for endpoint, check_end in [((ax1, ay1), False), ((ax2, ay2), True)]:
            px, py = endpoint
            on_shape = False
            for s in shapes:
                b = _get_shape_bounds(s["params"])
                l, t, r, bot = b
                if (abs(px - l) <= 2 and t <= py <= bot) or                    (abs(px - r) <= 2 and t <= py <= bot) or                    (abs(py - t) <= 2 and l <= px <= r) or                    (abs(py - bot) <= 2 and l <= px <= r):
                    on_shape = True
                    break
            if on_shape:
                continue
            # Not on any shape edge — force-connect to nearest
            shape = _find_closest_shape(px, py, shapes)
            if not shape:
                continue
            if check_end:
                tx = ap.get("startX", ax1)
                ty = ap.get("startY", ay1)
                ex, ey = _get_edge_point(_get_shape_bounds(shape["params"]), tx, ty)
                ap["endX"] = ex
                ap["endY"] = ey
            else:
                tx = ap.get("endX", ax2)
                ty = ap.get("endY", ay2)
                sx, sy = _get_edge_point(_get_shape_bounds(shape["params"]), tx, ty)
                ap["startX"] = sx
                ap["startY"] = sy


def _normalize_layer_order(result):
    """Reassign zIndex by element type to enforce a clean visual layering.

    Bands (each type has room for 100 relative levels):
        0-99    Background containers (large shapes, low zIndex from LLM)
      100-199   Regular content shapes
      200-299   Arrows / lines / connectors
      300-399   Free-standing text (draw_text) — always topmost
    """
    CANVAS_AREA = 1200 * 800  # total canvas area in px²
    BACKGROUND_THRESHOLD = 0.20  # shape covering >20% of canvas = background

    for item in result:
        p = item["params"]
        action = item["action"]
        z = p.get("zIndex", 0)

        if action in TEXT_ACTIONS:
            p["zIndex"] = 300 + (z % 100)
        elif action in ("draw_arrow", "draw_line", "draw_dashed_line"):
            p["zIndex"] = 200 + (z % 100)
        elif action in SHAPE_ACTIONS:
            # Detect background shapes by area
            w = p.get("w", 0)
            h = p.get("h", 0)
            if action == "draw_circle":
                r = p.get("r", 0)
                area = 3.14 * r * r
            elif action == "draw_ellipse":
                rw = p.get("w", 0) / 2
                rh = p.get("h", 0) / 2
                area = 3.14 * rw * rh
            elif action == "draw_pie_slice":
                r = p.get("r", 50)
                area = 3.14 * r * r * 0.5  # half-circle estimate
            else:
                area = w * h

            if area > CANVAS_AREA * BACKGROUND_THRESHOLD:
                p["zIndex"] = (z % 50)  # background: 0-49
            else:
                p["zIndex"] = 100 + (z % 100)  # normal shapes: 100-199
