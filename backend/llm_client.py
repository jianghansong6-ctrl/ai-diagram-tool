import json
import asyncio
import random
from typing import AsyncGenerator
from backend.config import LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_API_BASE

from backend.prompt_templates import (
    SYSTEM_PROMPT as _SYSTEM_PROMPT_TEMPLATE,
    MINDMAP_SYSTEM_PROMPT as _MINDMAP_SYSTEM_PROMPT_TEMPLATE,
    TABLE_SYSTEM_PROMPT as _TABLE_SYSTEM_PROMPT_TEMPLATE,
    CHART_SYSTEM_PROMPT as _CHART_SYSTEM_PROMPT_TEMPLATE,
    PIE_CHART_SYSTEM_PROMPT as _PIE_CHART_SYSTEM_PROMPT_TEMPLATE,
    FLOWCHART_SYSTEM_PROMPT as _FLOWCHART_SYSTEM_PROMPT_TEMPLATE,
    FRAMEWORK_SYSTEM_PROMPT as _FRAMEWORK_SYSTEM_PROMPT_TEMPLATE,
    LOGIC_DIAGRAM_SYSTEM_PROMPT as _LOGIC_DIAGRAM_SYSTEM_PROMPT_TEMPLATE,
)

LANGUAGE_INSTRUCTION = {
    "zh": "IMPORTANT LANGUAGE RULE: All labels, all text in shapes (the 'label' field), all title, and all callouts MUST be in Chinese (Simplified). Keep English for technical terms like 'EGFR', 'ATP', 'DNA' if they are standard acronyms.",
    "en": "IMPORTANT LANGUAGE RULE: All labels, all text, and the title MUST be in English.",
}

LAYOUT_STYLES = [
    "Use a TOP-DOWN FLOWCHART layout: arrange elements vertically from top to bottom, with clear downward flow between connected elements.",
    "Use a LEFT-TO-RIGHT CASCADE layout: arrange elements horizontally from left to right, creating a linear pathway view.",
    "Use a NETWORK/CLUSTER layout: group related elements into spatial clusters and show interactions between clusters with arrows.",
    "Use a STRUCTURAL layout: place background compartments (membrane, nucleus) first, then arrange elements inside them by function.",
    "Use a BOTTOM-UP layout: place the final outcome at the top, and build the pathway upward from the bottom.",
    "Use a HUB-AND-SPOKE layout: place the key molecule/process at center, and arrange related elements around it with connecting arrows.",
    "Use a TWO-COLUMN layout: arrange the pathway in two parallel columns for side-by-side comparison of related processes.",
    "Use a RADIAL/TREE layout: root concept at top center, branching outward and downward hierarchically.",
]


def _get_layout_style() -> str:
    """Return a random layout style directive for diversity on each generation."""
    return random.choice(LAYOUT_STYLES)

PROMPT_MAP = {
    "table": _TABLE_SYSTEM_PROMPT_TEMPLATE,
    "bar_chart": _CHART_SYSTEM_PROMPT_TEMPLATE,
    "line_chart": _CHART_SYSTEM_PROMPT_TEMPLATE,
    "pie_chart": _PIE_CHART_SYSTEM_PROMPT_TEMPLATE,
    "flowchart": _FLOWCHART_SYSTEM_PROMPT_TEMPLATE,
    "framework": _FRAMEWORK_SYSTEM_PROMPT_TEMPLATE,
    "mindmap": _MINDMAP_SYSTEM_PROMPT_TEMPLATE,
    "logic_diagram": _LOGIC_DIAGRAM_SYSTEM_PROMPT_TEMPLATE,
}

def _build_system_prompt(language: str = "zh", mode: str = "diagram", chart_type: str = "") -> str:
    lang_rule = LANGUAGE_INSTRUCTION.get(language, LANGUAGE_INSTRUCTION["zh"])
    key = chart_type or mode
    template = PROMPT_MAP.get(key, _SYSTEM_PROMPT_TEMPLATE)
    prompt = template + f"\n\n─── LANGUAGE ───\n{lang_rule}"
    
    # Inject chart-type instruction so LLM generates the correct chart
    if key == "bar_chart":
        prompt = "─── CHART TYPE: BAR CHART (柱状图) ───\nYou MUST generate a BAR CHART. Use tall rectangles for bars. DO NOT generate a line chart.\n\n" + prompt
    elif key == "line_chart":
        prompt = "─── CHART TYPE: LINE CHART (折线图) ───\nYou MUST generate a LINE CHART. Use data points connected by lines. DO NOT generate a bar chart.\n\n" + prompt
    # Append LOGIC SUMMARY to ALL prompt types so the panel always shows
    prompt += (
        "\n\n─── LOGIC SUMMARY ───\n"
        "After all drawing instructions, output exactly ONE additional instruction describing the diagram's overall logic:\n"
        '{"action":"logic_summary","params":{"text":"<2-4 sentence paragraph>"},"description":"Logic summary of the diagram"}\n'
        "Place this as the VERY LAST instruction. The text must be a coherent, academic-style paragraph explaining:\n"
        "  • What the diagram depicts and its overall structure\n"
        "  • The key relationships or flow being shown\n"
        "  • The significance of the process or system\n"
        "Write the summary in the same language as the diagram labels.\n"
    )
    return prompt


def _is_reasoning_model() -> bool:
    name = (LLM_MODEL or "").lower()
    return "pro" in name or "reasoner" in name or "o1" in name or "o3" in name


def _build_messages(prompt: str, context: str = "", language: str = "zh", mode: str = "diagram", chart_type: str = ""):
    system = _build_system_prompt(language, mode, chart_type)
    key = chart_type or mode
    if key in ("flowchart", "logic_diagram", "diagram"):
        system += f"\n\n─── LAYOUT STYLE ───\n{_get_layout_style()}"
    # Add specific instruction making the logic_summary reference the user's input
    system += f"\n\n─── LOGIC SUMMARY TOPIC ───\nThe logic_summary instruction MUST directly reference the specific topic the user requested. The user's request is about: \"{prompt}\". Write the 2-4 sentence paragraph specifically about this topic — do NOT write a generic summary."
    if key == "mindmap":
        user = f"Create a mind map from this content:\n{prompt}\n"
    else:
        user = f"Create a scientific diagram showing: {prompt}\n"
    if context:
        user += f"\nModification context: {context}"
    if _is_reasoning_model():
        return [
            {"role": "user", "content": f"{system}\n\n{user}"}
        ]
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user}
    ]


async def generate_instructions(prompt: str, context: str = "", language: str = "zh", mode: str = "diagram", chart_type: str = "") -> AsyncGenerator[str, None]:
    if not LLM_API_KEY:
        mock = _generate_mock_instructions(prompt, chart_type or mode)
        for inst in mock:
            yield json.dumps(inst)
            await asyncio.sleep(0.005)
        return

    messages = _build_messages(prompt, context, language, mode, chart_type)
    buffer = ""

    if LLM_PROVIDER == "openai":
        from openai import AsyncOpenAI
        client_kwargs = {"api_key": LLM_API_KEY}
        if LLM_API_BASE:
            client_kwargs["base_url"] = LLM_API_BASE
        client = AsyncOpenAI(**client_kwargs)

        resp = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            stream=True,
            temperature=0.3,
            timeout=120
        )
        async for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            # Only use content (not reasoning_content which is chain-of-thought)
            content = delta.content or ""
            if not content:
                continue
            buffer += content
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if line and not line.startswith("#"):
                    yield line

    elif LLM_PROVIDER == "anthropic":
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=LLM_API_KEY)

        # Anthropic uses system param, not system role in messages
        system_msgs = [m for m in messages if m["role"] == "system"]
        other_msgs = [m for m in messages if m["role"] != "system"]

        async with client.messages.stream(
            model=LLM_MODEL,
            messages=other_msgs,
            system=system_msgs[0]["content"] if system_msgs else _build_system_prompt(language),
            max_tokens=4096,
            temperature=0.3
        ) as stream:
            async for text in stream.text_stream:
                if not text:
                    continue
                buffer += text
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if line and not line.startswith("#"):
                        yield line

    # Flush remaining buffer
    remaining = buffer.strip()
    if remaining and not remaining.startswith("#"):
        yield remaining


MODIFY_SYSTEM_PROMPT = """You replace ONE element in a scientific diagram. Output EXACTLY ONE JSON instruction with the same action type as the original element.

Canvas: 1200×800. Use proper coordinates so the element fits with surrounding elements.

Actions and their parameters (all use zIndex, description):
  draw_rect:    {"x","y","w","h","fill":"#hex","stroke":"#hex","strokeWidth":N,"rx":8,"label":"text"}
  draw_circle:  {"x","y","r","fill":"#hex","stroke":"#hex","strokeWidth":N,"label":"text"}
  draw_ellipse: {"x","y","w","h","fill":"#hex","stroke":"#hex","strokeWidth":N,"label":"text"}
  draw_arrow:   {"startX","startY","endX","endY","stroke":"#hex","strokeWidth":N}
  draw_dashed_line: {"startX","startY","endX","endY","stroke":"#hex","strokeWidth":N}
  draw_text:    {"x","y","text","fontSize":N,"fontColor":"#hex","textAlign":"center|left|right"}

Color palette (colorblind-safe):
  #EBF5FB/#2980B9 = membrane/structural   #FEF9E7/#D4AC0D = proteins/receptors
  #FDEDEC/#C0392B = signaling/active      #F4ECF7/#7D3C98 = genetic/nucleus
  #E8F8F5/#1ABC9C = inhibition/inactive   #F8F9FA/#7F8C8D = neutral/structural
  Arrows: #7F8C8D   Title text: #1A1A2E   Body text: #2C3E50

IMPORTANT: Prefer draw_arrow for connections. Only use draw_dashed_line for membrane/compartment boundaries.""";


MODIFY_BATCH_SYSTEM_PROMPT = """You replace MULTIPLE elements in a scientific diagram. Output one JSON instruction per line, maintaining the same count and order.

Canvas: 1200×800.

Actions and parameters:
  draw_rect:    {"x","y","w","h","fill":"#hex","stroke":"#hex","strokeWidth":N,"rx":8,"label":"text","zIndex":N}
  draw_circle:  {"x","y","r","fill":"#hex","stroke":"#hex","strokeWidth":N,"label":"text","zIndex":N}
  draw_ellipse: {"x","y","w","h","fill":"#hex","stroke":"#hex","strokeWidth":N,"label":"text","zIndex":N}
  draw_arrow:   {"startX","startY","endX","endY","stroke":"#hex","strokeWidth":N,"zIndex":N}
  draw_dashed_line: {"startX","startY","endX","endY","stroke":"#hex","strokeWidth":N,"zIndex":N}
  draw_text:    {"x","y","text","fontSize":N,"fontColor":"#hex","textAlign":"center|left|right","zIndex":N}

Colors: membranes #EBF5FB/#2980B9, proteins #FEF9E7/#D4AC0D, signaling #FDEDEC/#C0392B, genetic #F4ECF7/#7D3C98, inhibition #E8F8F5/#1ABC9C, structural #F8F9FA/#BDC3C7, arrows #7F8C8D, body text #2C3E50, title text #1A1A2E.

IMPORTANT: Prefer draw_arrow for connections. Only use draw_dashed_line for membrane/compartment boundaries."""


def _extract_json(text: str) -> str | None:
    """Find the first complete, valid JSON object in text via brace-matching."""
    i = 0
    while i < len(text):
        start = text.find("{", i)
        if start < 0:
            return None
        depth = 0
        for j in range(start, len(text)):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:j+1]
                    try:
                        json.loads(candidate)
                        return candidate
                    except json.JSONDecodeError:
                        i = start + 1
                        break
        else:
            return None
    return None


async def _call_llm(messages: list[dict], max_tokens: int = 1024) -> str | None:
    """Unified non-streaming LLM call for modify operations."""
    if not LLM_API_KEY:
        return None

    # Handle reasoning models: merge system into user message
    use_messages = messages
    if _is_reasoning_model():
        sys_content = None
        other_msgs = []
        for m in messages:
            if m["role"] == "system":
                sys_content = m["content"]
            else:
                other_msgs.append(m)
        if sys_content:
            use_messages = [
                {"role": "user", "content": f"{sys_content}\n\n{other_msgs[0]['content']}" if other_msgs else sys_content}
            ] + other_msgs[1:]
        else:
            use_messages = [m for m in messages if m["role"] != "system"]

    if LLM_PROVIDER == "openai":
        from openai import AsyncOpenAI
        client_kwargs = {"api_key": LLM_API_KEY}
        if LLM_API_BASE:
            client_kwargs["base_url"] = LLM_API_BASE
        client = AsyncOpenAI(**client_kwargs)
        resp = await client.chat.completions.create(
            model=LLM_MODEL, messages=use_messages,
            temperature=0.3, max_tokens=max_tokens,
            timeout=120
        )
        msg = resp.choices[0].message
        content = msg.content or ""
        if not content:
            content = getattr(msg, "reasoning_content", None) or ""
        return content or None

    elif LLM_PROVIDER == "anthropic":
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=LLM_API_KEY)
        system_msgs = [m for m in use_messages if m["role"] == "system"]
        other_msgs = [m for m in use_messages if m["role"] != "system"]
        resp = await client.messages.create(
            model=LLM_MODEL,
            messages=other_msgs,
            system=system_msgs[0]["content"] if system_msgs else "",
            max_tokens=max_tokens,
            temperature=0.3
        )
        return resp.content[0].text if resp.content else None
    return None


async def modify_instruction(prompt_and_context: str) -> str | None:
    """Generate exactly one replacement instruction JSON string."""
    if not LLM_API_KEY:
        # Mock: find the original element JSON after the "Element to replace" marker
        marker = "Element to replace"
        idx = prompt_and_context.find(marker)
        if idx >= 0:
            return _extract_json(prompt_and_context[idx:])
        return None
    content = await _call_llm([
        {"role": "system", "content": MODIFY_SYSTEM_PROMPT},
        {"role": "user", "content": prompt_and_context}
    ], max_tokens=1024)
    if content:
        return _extract_json(content)
    return None


async def batch_modify_instruction(prompt_and_context: str) -> list[str] | None:
    """Generate replacement instructions for multiple elements."""
    if not LLM_API_KEY:
        # Mock: find JSON objects after the "Elements to replace" marker
        marker = "Elements to replace"
        idx = prompt_and_context.find(marker)
        if idx >= 0:
            rest = prompt_and_context[idx:]
            results = []
            for line in rest.split("\n"):
                extracted = _extract_json(line)
                if extracted:
                    results.append(extracted)
            return results if results else None
        return None
    content = await _call_llm([
        {"role": "system", "content": MODIFY_BATCH_SYSTEM_PROMPT},
        {"role": "user", "content": prompt_and_context}
    ], max_tokens=2048)
    if not content:
        return None
    results = []
    for line in content.split("\n"):
        line = line.strip()
        extracted = _extract_json(line)
        if extracted:
            results.append(extracted)
    return results if results else None


def _generate_mock_instructions(prompt: str, mode: str = "diagram") -> list[dict]:
    if mode == "pie_chart":
        return [
            {"id": "step_1", "action": "draw_text", "params": {"x": 400, "y": 28, "text": "数据分布", "fontSize": 18, "fontColor": "#1A1A2E", "textAlign": "center", "zIndex": 9}, "description": "饼图标题"},
            {"id": "step_2", "action": "draw_pie_slice", "params": {"x": 320, "y": 300, "r": 160, "startAngle": 0, "endAngle": 2.199, "fill": "#3B82F6", "stroke": "#FFFFFF", "strokeWidth": 2, "zIndex": 3, "label": "35%"}, "description": "数据系列A占比35%"},
            {"id": "step_3", "action": "draw_pie_slice", "params": {"x": 320, "y": 300, "r": 160, "startAngle": 2.199, "endAngle": 3.927, "fill": "#E74C3C", "stroke": "#FFFFFF", "strokeWidth": 2, "zIndex": 3, "label": "25%"}, "description": "数据系列B占比25%"},
            {"id": "step_4", "action": "draw_pie_slice", "params": {"x": 320, "y": 300, "r": 160, "startAngle": 3.927, "endAngle": 5.236, "fill": "#10B981", "stroke": "#FFFFFF", "strokeWidth": 2, "zIndex": 3, "label": "20%"}, "description": "数据系列C占比20%"},
            {"id": "step_5", "action": "draw_pie_slice", "params": {"x": 320, "y": 300, "r": 160, "startAngle": 5.236, "endAngle": 6.283, "fill": "#F59E0B", "stroke": "#FFFFFF", "strokeWidth": 2, "zIndex": 3, "label": "20%"}, "description": "数据系列D占比20%"},
            {"id": "step_6", "action": "draw_text", "params": {"x": 540, "y": 160, "text": "图例", "fontSize": 14, "fontColor": "#1A1A2E", "textAlign": "left", "zIndex": 9}, "description": "图例标题"},
            {"id": "step_7", "action": "draw_rect", "params": {"x": 540, "y": 190, "w": 14, "h": 14, "fill": "#3B82F6", "stroke": "none", "rx": 2, "zIndex": 2}, "description": "系列A图例"},
            {"id": "step_8", "action": "draw_text", "params": {"x": 562, "y": 191, "text": "系列A", "fontSize": 12, "fontColor": "#4B5563", "textAlign": "left", "zIndex": 9}, "description": "系列A标签"},
            {"id": "step_9", "action": "draw_rect", "params": {"x": 540, "y": 215, "w": 14, "h": 14, "fill": "#E74C3C", "stroke": "none", "rx": 2, "zIndex": 2}, "description": "系列B图例"},
            {"id": "step_10", "action": "draw_text", "params": {"x": 562, "y": 216, "text": "系列B", "fontSize": 12, "fontColor": "#4B5563", "textAlign": "left", "zIndex": 9}, "description": "系列B标签"},
            {"id": "step_11", "action": "draw_rect", "params": {"x": 540, "y": 240, "w": 14, "h": 14, "fill": "#10B981", "stroke": "none", "rx": 2, "zIndex": 2}, "description": "系列C图例"},
            {"id": "step_12", "action": "draw_text", "params": {"x": 562, "y": 241, "text": "系列C", "fontSize": 12, "fontColor": "#4B5563", "textAlign": "left", "zIndex": 9}, "description": "系列C标签"},
            {"id": "step_13", "action": "draw_rect", "params": {"x": 540, "y": 265, "w": 14, "h": 14, "fill": "#F59E0B", "stroke": "none", "rx": 2, "zIndex": 2}, "description": "系列D图例"},
            {"id": "step_14", "action": "draw_text", "params": {"x": 562, "y": 266, "text": "系列D", "fontSize": 12, "fontColor": "#4B5563", "textAlign": "left", "zIndex": 9}, "description": "系列D标签"},
            {"id": "summary", "action": "logic_summary", "params": {"text": f"该饼图以\"{prompt}\"为主题，展示了各数据系列的占比分布，共四个类别。"}, "description": "饼图逻辑说明"},
        ]
    if mode == "mindmap":
        return [
            {"id": "step_1", "action": "draw_text", "params": {"x": 400, "y": 28, "text": "知识结构：思维导图", "fontSize": 18, "fontColor": "#1A1A2E", "textAlign": "center", "zIndex": 9}, "description": "思维导图标题"},
            {"id": "step_2", "action": "draw_circle", "params": {"x": 400, "y": 100, "r": 38, "fill": "#3B82F6", "stroke": "#1D4ED8", "strokeWidth": 2, "zIndex": 3, "label": "中心主题"}, "description": "中心主题节点"},
            {"id": "step_3", "action": "draw_rect", "params": {"x": 80, "y": 200, "w": 140, "h": 40, "fill": "#FEF9E7", "stroke": "#D4AC0D", "strokeWidth": 2, "rx": 6, "zIndex": 3, "label": "分支一"}, "description": "一级分支：第一个主要类别"},
            {"id": "step_4", "action": "draw_line", "params": {"startX": 400, "startY": 138, "endX": 150, "endY": 200, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：中心主题到分支一"},
            {"id": "step_5", "action": "draw_rect", "params": {"x": 330, "y": 200, "w": 140, "h": 40, "fill": "#FEF9E7", "stroke": "#D4AC0D", "strokeWidth": 2, "rx": 6, "zIndex": 3, "label": "分支二"}, "description": "一级分支：第二个主要类别"},
            {"id": "step_6", "action": "draw_line", "params": {"startX": 400, "startY": 138, "endX": 400, "endY": 200, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：中心主题到分支二"},
            {"id": "step_7", "action": "draw_rect", "params": {"x": 580, "y": 200, "w": 140, "h": 40, "fill": "#FEF9E7", "stroke": "#D4AC0D", "strokeWidth": 2, "rx": 6, "zIndex": 3, "label": "分支三"}, "description": "一级分支：第三个主要类别"},
            {"id": "step_8", "action": "draw_line", "params": {"startX": 400, "startY": 138, "endX": 650, "endY": 200, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：中心主题到分支三"},
            {"id": "step_9", "action": "draw_rect", "params": {"x": 80, "y": 300, "w": 140, "h": 36, "fill": "#EBF5FB", "stroke": "#2980B9", "strokeWidth": 1.5, "rx": 6, "zIndex": 3, "label": "子节点A"}, "description": "二级子分支"},
            {"id": "step_10", "action": "draw_line", "params": {"startX": 150, "startY": 240, "endX": 150, "endY": 300, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：分支一到子节点"},
            {"id": "step_11", "action": "draw_rect", "params": {"x": 330, "y": 300, "w": 140, "h": 36, "fill": "#EBF5FB", "stroke": "#2980B9", "strokeWidth": 1.5, "rx": 6, "zIndex": 3, "label": "子节点B"}, "description": "二级子分支"},
            {"id": "step_12", "action": "draw_line", "params": {"startX": 400, "startY": 240, "endX": 400, "endY": 300, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：分支二到子节点"},
            {"id": "step_13", "action": "draw_rect", "params": {"x": 580, "y": 300, "w": 140, "h": 36, "fill": "#EBF5FB", "stroke": "#2980B9", "strokeWidth": 1.5, "rx": 6, "zIndex": 3, "label": "子节点C"}, "description": "二级子分支"},
            {"id": "step_14", "action": "draw_line", "params": {"startX": 650, "startY": 240, "endX": 650, "endY": 300, "stroke": "#94A3B8", "strokeWidth": 1.5, "zIndex": 1}, "description": "连接线：分支三到子节点"},
            {"id": "summary", "action": "logic_summary", "params": {"text": f"该思维导图以\"{prompt}\"为中心主题，分为三个主要分支，每个分支下包含若干子节点，系统地展示了该主题的结构化层次关系。"}, "description": "思维导图逻辑说明"},
        ]
    return [
        {"id": "step_1", "action": "draw_rect", "params": {"x": 100, "y": 200, "w": 400, "h": 200, "fill": "#E8F4E8", "stroke": "#2E7D32", "strokeWidth": 2, "zIndex": 1}, "description": "绘制细胞膜边界"},
        {"id": "step_2", "action": "draw_ellipse", "params": {"x": 250, "y": 270, "w": 80, "h": 40, "fill": "#BBDEFB", "stroke": "#1565C0", "strokeWidth": 2, "zIndex": 2, "label": "受体蛋白"}, "description": "绘制跨膜受体蛋白"},
        {"id": "step_3", "action": "draw_circle", "params": {"x": 350, "y": 280, "r": 25, "fill": "#FFCDD2", "stroke": "#C62828", "strokeWidth": 2, "zIndex": 3, "label": "配体"}, "description": "绘制配体分子"},
        {"id": "step_4", "action": "draw_arrow", "params": {"startX": 370, "startY": 280, "endX": 310, "endY": 280, "stroke": "#C62828", "strokeWidth": 2, "zIndex": 4}, "description": "配体与受体结合箭头"},
        {"id": "step_5", "action": "draw_text", "params": {"x": 200, "y": 150, "text": "信号分子与受体结合示意图", "fontSize": 18, "fontColor": "#1A1A2E", "zIndex": 5}, "description": "绘制标题"},
        {"id": "step_6", "action": "draw_dashed_line", "params": {"startX": 300, "startY": 200, "endX": 300, "endY": 400, "stroke": "#666", "strokeWidth": 1, "zIndex": 6}, "description": "绘制细胞膜中线"},
        {"id": "summary", "action": "logic_summary", "params": {"text": f"该示意图以\"{prompt}\"为主题，展示了其核心结构与关键组成部分之间的相互关系及各部分的功能定位。"}, "description": "示意图逻辑说明"},
    ]
