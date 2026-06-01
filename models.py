from pydantic import BaseModel
from typing import Optional, Literal


class DrawParams(BaseModel):
    x: float = 0
    y: float = 0
    w: Optional[float] = None
    h: Optional[float] = None
    r: Optional[float] = None
    fill: str = "#CCCCCC"
    stroke: str = "#333333"
    strokeWidth: int = 2
    opacity: float = 1.0
    label: Optional[str] = None
    zIndex: int = 1
    points: Optional[list[float]] = None
    text: Optional[str] = None
    fontSize: Optional[int] = None
    fontColor: Optional[str] = None
    startX: Optional[float] = None
    startY: Optional[float] = None
    endX: Optional[float] = None
    endY: Optional[float] = None


ActionType = Literal[
    "draw_rect", "draw_circle", "draw_ellipse", "draw_line",
    "draw_arrow", "draw_path", "draw_text", "draw_label",
    "draw_dashed_line", "draw_curve", "draw_pie_slice", "logic_summary"
]

# All draw actions supported by the renderer
DRAW_ACTIONS = frozenset({
    "draw_rect", "draw_circle", "draw_ellipse", "draw_line",
    "draw_dashed_line", "draw_arrow", "draw_text", "draw_label",
    "draw_pie_slice"
})


class DrawInstruction(BaseModel):
    id: str
    action: ActionType
    params: DrawParams
    description: str = ""


class GenerateRequest(BaseModel):
    prompt: str
    language: str = "zh"
    mode: str = "diagram"  # "diagram" | "mindmap" (kept for backward compat)
    chart_type: str = ""   # "table" | "bar_chart" | "line_chart" | "pie_chart" | "flowchart" | "framework" | "mindmap" | "logic_diagram" | "" (uses mode)


class ModifyRequest(BaseModel):
    element_id: str
    instruction: str

class ModifyBatchRequest(BaseModel):
    element_ids: list[str]
    instruction: str
