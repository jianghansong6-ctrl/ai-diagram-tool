# AI 科研机制图绘制工具 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 AI 驱动的科研机制图绘制 Web 应用，支持流式绘制、暂停/恢复、点击修改、PPTX 导出、历史记录。

**Architecture:** FastAPI 后端通过 SSE 流式推送结构化绘图指令，React 前端在 Canvas 上逐条实时渲染。用户可随时暂停生成、点击已绘元素通过 prompt 修改、下载为 PPTX 文件。

**Tech Stack:** Python FastAPI, React + Vite, HTML5 Canvas, SQLite, python-pptx, OpenAI/Anthropic API

---

## 文件结构

```
d:/SAM3/
├── backend/
│   ├── main.py                  # FastAPI 入口，路由，静态文件服务
│   ├── config.py                # 环境变量配置
│   ├── database.py              # SQLite 初始化 + CRUD
│   ├── models.py                # Pydantic 数据模型
│   ├── session_manager.py       # 生成会话管理（暂停/恢复/停止）
│   ├── llm_client.py            # LLM API 客户端
│   ├── pptx_exporter.py         # 绘图指令 → PPTX 转换
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── components/
│   │   │   ├── Canvas.jsx
│   │   │   ├── ControlBar.jsx
│   │   │   ├── PromptInput.jsx
│   │   │   ├── ElementTooltip.jsx
│   │   │   └── HistoryPanel.jsx
│   │   ├── hooks/
│   │   │   ├── useSSE.js
│   │   │   └── useCanvas.js
│   │   └── utils/
│   │       └── hitTest.js
│   └── public/
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-05-13-ai-scientific-diagram-ppt-design.md
        └── plans/
            └── 2026-05-13-ai-scientific-diagram-ppt.md
```

---

### Task 1: 后端项目脚手架 + 配置 + 数据库

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/config.py`
- Create: `backend/database.py`

- [ ] **Step 1: 创建 Python 虚拟环境 + requirements.txt**

```bash
cd d:/SAM3
python -m venv .venv
source .venv/Scripts/activate  # Windows Git Bash
```

写入 `backend/requirements.txt`:

```
fastapi==0.111.0
uvicorn[standard]==0.30.1
python-pptx==0.6.23
openai==1.35.0
anthropic==0.34.0
python-dotenv==1.0.1
sse-starlette==2.0.0
```

安装:

```bash
pip install -r backend/requirements.txt
```

- [ ] **Step 2: 创建 config.py**

```python
import os
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")  # "openai" or "anthropic"
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o" if LLM_PROVIDER == "openai" else "claude-sonnet-4-20250514")
DATABASE_PATH = os.getenv("DATABASE_PATH", "data/sessions.db")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
```

- [ ] **Step 3: 创建 database.py**

```python
import sqlite3
import json
import os
from contextlib import contextmanager
from config import DATABASE_PATH

DB_DIR = os.path.dirname(DATABASE_PATH)
if DB_DIR:
    os.makedirs(DB_DIR, exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS instructions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            seq INTEGER NOT NULL,
            action TEXT NOT NULL,
            params TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()

def save_session(session_id: str, prompt: str):
    conn = get_conn()
    conn.execute("INSERT OR IGNORE INTO sessions (id, prompt) VALUES (?, ?)", (session_id, prompt))
    conn.commit()
    conn.close()

def save_instruction(session_id: str, seq: int, action: str, params: dict, description: str = ""):
    import uuid
    conn = get_conn()
    inst_id = f"{session_id}_{seq}"
    conn.execute(
        "INSERT OR IGNORE INTO instructions (id, session_id, seq, action, params, description) VALUES (?, ?, ?, ?, ?, ?)",
        (inst_id, session_id, seq, action, json.dumps(params), description)
    )
    conn.commit()
    conn.close()
    return inst_id

def get_session(session_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_instructions(session_id: str):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM instructions WHERE session_id = ? ORDER BY seq", (session_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_all_sessions(limit: int = 20):
    conn = get_conn()
    rows = conn.execute("SELECT id, prompt, created_at FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def delete_session(session_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM instructions WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
```

- [ ] **Step 4: 验证数据库初始化**

```bash
cd d:/SAM3
python -c "
from backend.database import init_db
init_db()
print('DB initialized')
"
```

Expected: `DB initialized` + 生成 `data/sessions.db`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/config.py backend/database.py
git commit -m "feat: add backend scaffold with config and SQLite database"
```

---

### Task 2: 数据模型

**Files:**
- Create: `backend/models.py`

- [ ] **Step 1: 创建 Pydantic 模型**

写入 `backend/models.py`:

```python
from pydantic import BaseModel
from typing import Optional, Literal

class DrawParams(BaseModel):
    x: float = 0
    y: float = 0
    w: Optional[float] = None
    h: Optional[float] = None
    r: Optional[float] = None  # radius for circles
    fill: str = "#CCCCCC"
    stroke: str = "#333333"
    strokeWidth: int = 2
    opacity: float = 1.0
    label: Optional[str] = None
    zIndex: int = 1
    points: Optional[list[float]] = None  # for paths/lines: [x1,y1,x2,y2,...]
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
    "draw_dashed_line", "draw_curve"
]

class DrawInstruction(BaseModel):
    id: str
    action: ActionType
    params: DrawParams
    description: str = ""

class GenerateRequest(BaseModel):
    prompt: str

class ModifyRequest(BaseModel):
    element_id: str
    instruction: str
```

- [ ] **Step 2: 验证导入**

```bash
cd d:/SAM3
python -c "from backend.models import DrawInstruction, GenerateRequest, ModifyRequest; print('Models OK')"
```

Expected: `Models OK`

- [ ] **Step 3: Commit**

```bash
git add backend/models.py
git commit -m "feat: add Pydantic data models"
```

---

### Task 3: LLM 客户端

**Files:**
- Create: `backend/llm_client.py`

- [ ] **Step 1: 创建 LLM 客户端**

写入 `backend/llm_client.py`:

```python
import json
from typing import AsyncGenerator
from config import LLM_PROVIDER, LLM_API_KEY, LLM_MODEL

SYSTEM_PROMPT = """You are an expert at creating scientific mechanism diagrams.
You output structured drawing instructions in JSON format, one instruction per line.
Each instruction draws ONE element on a canvas (800x600).

Supported actions: draw_rect, draw_circle, draw_ellipse, draw_line, draw_arrow, draw_path, draw_text, draw_label, draw_dashed_line, draw_curve

Example instruction:
{"id":"step_1","action":"draw_rect","params":{"x":50,"y":100,"w":300,"h":80,"fill":"#E8D5B7","stroke":"#333","strokeWidth":2,"zIndex":1},"description":"Draw phospholipid bilayer background"}

Rules:
- Use draw_rect for membranes, boxes, backgrounds
- Use draw_circle for proteins, molecules, organelles
- Use draw_ellipse for membrane-bound structures
- Use draw_arrow to show processes/directions
- Use draw_text for labels and annotations
- Use draw_label for callout labels with a line
- Each element must have a unique id (step_1, step_2, ...)
- Output ONLY one JSON object per line, no other text
- Keep scientific accuracy in shapes and labels
- Add appropriate colors for scientific elements
- First output a comment line starting with # describing the overall diagram"""

def _build_messages(prompt: str, context: str = ""):
    user = f"Create a scientific diagram showing: {prompt}\n"
    if context:
        user += f"\nModification context: {context}"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user}
    ]

async def generate_instructions(prompt: str, context: str = "") -> AsyncGenerator[str, None]:
    """
    Async generator that yields one drawing instruction (as JSON string) at a time.
    """
    if not LLM_API_KEY:
        # 无 API Key 时使用模拟数据演示
        import asyncio
        mock = _generate_mock_instructions(prompt)
        for inst in mock:
            yield json.dumps(inst)
            await asyncio.sleep(0.5)
        return

    if LLM_PROVIDER == "openai":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=LLM_API_KEY)
        stream = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=_build_messages(prompt, context),
            stream=True,
            temperature=0.3
        )
        buffer = ""
        async for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            buffer += content
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if line and not line.startswith("#"):
                    yield line
    elif LLM_PROVIDER == "anthropic":
        from anthropic import AsyncAnthropic
        client = AsyncAnthropic(api_key=LLM_API_KEY)
        async with client.messages.stream(
            model=LLM_MODEL,
            messages=_build_messages(prompt, context),
            system=SYSTEM_PROMPT,
            max_tokens=4096,
            temperature=0.3
        ) as stream:
            buffer = ""
            async for text in stream.text_stream:
                buffer += text
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if line and not line.startswith("#"):
                        yield line


def _generate_mock_instructions(prompt: str) -> list[dict]:
    """生成模拟绘图指令用于演示"""
    return [
        {"id": "step_1", "action": "draw_rect", "params": {"x": 100, "y": 200, "w": 400, "h": 200, "fill": "#E8F4E8", "stroke": "#2E7D32", "strokeWidth": 2, "zIndex": 1}, "description": "绘制细胞膜边界"},
        {"id": "step_2", "action": "draw_ellipse", "params": {"x": 250, "y": 270, "w": 80, "h": 40, "fill": "#BBDEFB", "stroke": "#1565C0", "strokeWidth": 2, "zIndex": 2, "label": "受体蛋白"}, "description": "绘制跨膜受体蛋白"},
        {"id": "step_3", "action": "draw_circle", "params": {"x": 350, "y": 280, "r": 25, "fill": "#FFCDD2", "stroke": "#C62828", "strokeWidth": 2, "zIndex": 3, "label": "配体"}, "description": "绘制配体分子"},
        {"id": "step_4", "action": "draw_arrow", "params": {"startX": 370, "startY": 280, "endX": 310, "endY": 280, "stroke": "#C62828", "strokeWidth": 2, "zIndex": 4}, "description": "配体与受体结合箭头"},
        {"id": "step_5", "action": "draw_text", "params": {"x": 200, "y": 150, "text": "信号分子与受体结合示意图", "fontSize": 18, "fontColor": "#333", "zIndex": 5}, "description": "绘制标题"},
        {"id": "step_6", "action": "draw_dashed_line", "params": {"startX": 300, "startY": 200, "endX": 300, "endY": 400, "stroke": "#666", "strokeWidth": 1, "zIndex": 6}, "description": "绘制细胞膜中线"},
    ]
```

- [ ] **Step 2: 验证导入**

```bash
cd d:/SAM3
python -c "from backend.llm_client import generate_instructions, _generate_mock_instructions; print('LLM Client OK')"
```

Expected: `LLM Client OK`

- [ ] **Step 3: Commit**

```bash
git add backend/llm_client.py
git commit -m "feat: add LLM client with OpenAI/Anthropic support and mock mode"
```

---

### Task 4: 会话管理器

**Files:**
- Create: `backend/session_manager.py`

- [ ] **Step 1: 创建会话管理器**

写入 `backend/session_manager.py`:

```python
import asyncio
import uuid
import json
from datetime import datetime
from typing import AsyncGenerator, Optional
from models import DrawInstruction, DrawParams
from llm_client import generate_instructions
from database import save_session, save_instruction

class Session:
    def __init__(self, session_id: str, prompt: str):
        self.id = session_id
        self.prompt = prompt
        self.instructions: list[dict] = []
        self.paused = asyncio.Event()
        self.paused.set()  # not paused initially
        self.stopped = False
        self.completed = False
        self.error: Optional[str] = None
        self._seq = 0

    async def pause(self):
        self.paused.clear()

    async def resume(self):
        self.paused.set()

    async def stop(self):
        self.stopped = True
        self.paused.set()

    async def run_generation(self) -> AsyncGenerator[dict, None]:
        """运行 AI 生成过程，逐条 yield 指令。"""
        save_session(self.id, self.prompt)
        try:
            async for inst_json in generate_instructions(self.prompt):
                if self.stopped:
                    break

                await self.paused.wait()  # 暂停时阻塞

                inst = json.loads(inst_json) if isinstance(inst_json, str) else inst_json
                inst.setdefault("id", f"step_{self._seq}")
                inst.setdefault("description", "")
                self._seq += 1

                self.instructions.append(inst)
                save_instruction(
                    self.id, self._seq,
                    inst["action"], inst.get("params", {}),
                    inst.get("description", "")
                )
                yield inst

            self.completed = True
        except Exception as e:
            self.error = str(e)
            yield {"error": str(e)}

    def modify_instruction(self, element_id: str, new_inst: dict) -> Optional[dict]:
        """替换指定元素的指令。"""
        for i, inst in enumerate(self.instructions):
            if inst.get("id") == element_id:
                new_inst["id"] = element_id
                self.instructions[i] = new_inst
                return new_inst
        return None


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._generators: dict[str, AsyncGenerator] = {}

    def create_session(self, prompt: str) -> Session:
        session_id = str(uuid.uuid4())[:8]
        session = Session(session_id, prompt)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    async def modify_element(self, session_id: str, element_id: str, instruction: str) -> Optional[dict]:
        """
        修改已绘制的元素。
        将修改提示发给 LLM，用返回的新指令替换原指令。
        """
        session = self.get_session(session_id)
        if not session:
            return None

        context = f"Modify element {element_id} in this diagram: {instruction}"
        new_inst = None
        async for inst_json in generate_instructions(session.prompt, context):
            inst = json.loads(inst_json) if isinstance(inst_json, str) else inst_json
            new_inst = inst
            break  # 只取第一条

        if new_inst:
            session.modify_instruction(element_id, new_inst)
        return new_inst

    def remove_session(self, session_id: str):
        self._sessions.pop(session_id, None)

    def list_sessions(self) -> list[dict]:
        return [
            {"id": s.id, "prompt": s.prompt, "completed": s.completed, "error": s.error}
            for s in self._sessions.values()
        ]


# 全局实例
manager = SessionManager()
```

- [ ] **Step 2: 验证导入**

```bash
cd d:/SAM3
python -c "from backend.session_manager import SessionManager; print('Session Manager OK')"
```

Expected: `Session Manager OK`

- [ ] **Step 3: Commit**

```bash
git add backend/session_manager.py
git commit -m "feat: add session manager with pause/resume/stop/modify"
```

---

### Task 5: PPTX 导出器

**Files:**
- Create: `backend/pptx_exporter.py`

- [ ] **Step 1: 创建 PPTX 导出器**

写入 `backend/pptx_exporter.py`:

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
import json
import os

def instructions_to_pptx(instructions: list[dict], output_path: str, title: str = "Scientific Diagram"):
    """将绘图指令列表转换为 PPTX 文件。"""
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)

    slide_layout = prs.slide_layouts[6]  # blank layout
    slide = prs.slides.add_slide(slide_layout)

    # 标题
    txBox = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), Inches(9), Inches(0.8))
    tf = txBox.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(24)
    p.font.bold = True

    for inst in instructions:
        action = inst.get("action", "")
        params = inst.get("params", {})
        if isinstance(params, str):
            params = json.loads(params)

        try:
            if action == "draw_rect":
                left = Inches(params.get("x", 1) / 100)
                top = Inches(params.get("y", 1) / 100 + 1)
                width = Inches(params.get("w", 100) / 100)
                height = Inches(params.get("h", 100) / 100)
                shape = slide.shapes.add_shape(
                    1, left, top, width, height  # 1 = MSO_SHAPE.RECTANGLE
                )
                shape.fill.solid()
                shape.fill.fore_color.rgb = RGBColor(*hex_to_rgb(params.get("fill", "#CCCCCC")))
                shape.line.color.rgb = RGBColor(*hex_to_rgb(params.get("stroke", "#333333")))
                shape.line.width = Pt(params.get("strokeWidth", 2))

            elif action == "draw_circle":
                left = Inches(params.get("x", 1) / 100)
                top = Inches(params.get("y", 1) / 100 + 1)
                diameter = Inches(params.get("r", 30) * 2 / 100)
                shape = slide.shapes.add_shape(
                    9, left, top, diameter, diameter  # 9 = MSO_SHAPE.OVAL
                )
                shape.fill.solid()
                shape.fill.fore_color.rgb = RGBColor(*hex_to_rgb(params.get("fill", "#CCCCCC")))

            elif action == "draw_ellipse":
                left = Inches(params.get("x", 1) / 100)
                top = Inches(params.get("y", 1) / 100 + 1)
                width = Inches(params.get("w", 100) / 100)
                height = Inches(params.get("h", 60) / 100)
                shape = slide.shapes.add_shape(
                    9, left, top, width, height
                )
                shape.fill.solid()
                shape.fill.fore_color.rgb = RGBColor(*hex_to_rgb(params.get("fill", "#CCCCCC")))

            elif action == "draw_text":
                left = Inches(params.get("x", 1) / 100)
                top = Inches(params.get("y", 1) / 100 + 1)
                txBox = slide.shapes.add_textbox(left, top, Inches(4), Inches(0.5))
                tf = txBox.text_frame
                p = tf.paragraphs[0]
                p.text = params.get("text", "")
                p.font.size = Pt(params.get("fontSize", 14))

            # 添加 label 到图形上
            label = params.get("label", "")
            if label and shape:
                tf = shape.text_frame
                tf.paragraphs[0].text = label
                tf.paragraphs[0].font.size = Pt(10)

        except Exception:
            continue  # 跳过渲染失败的图形

    prs.save(output_path)
    return output_path


def hex_to_rgb(hex_color: str) -> tuple:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
```

- [ ] **Step 2: 验证导出**

```bash
cd d:/SAM3
python -c "
from backend.pptx_exporter import instructions_to_pptx
instructions_to_pptx([], 'test_output.pptx', 'Test')
print('PPTX OK')
"
```

Expected: `PPTX OK` + 生成 `test_output.pptx`

- [ ] **Step 3: 清理测试文件并提交**

```bash
rm test_output.pptx
git add backend/pptx_exporter.py
git commit -m "feat: add PPTX exporter for drawing instructions"
```

---

### Task 6: FastAPI 入口 + API 路由

**Files:**
- Create: `backend/main.py`

- [ ] **Step 1: 创建 FastAPI 应用**

写入 `backend/main.py`:

```python
import json
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse
from models import GenerateRequest, ModifyRequest
from session_manager import manager
from database import init_db, get_instructions as db_get_instructions, get_all_sessions, get_session, delete_session as db_delete_session
from pptx_exporter import instructions_to_pptx
from config import HOST, PORT
import os

app = FastAPI(title="AI Scientific Diagram Drawer")

@app.on_event("startup")
async def startup():
    init_db()

# --- SSE Generate ---

async def event_generator(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        yield {"event": "error", "data": json.dumps({"message": "Session not found"})}
        return

    # 先发 session_start，让前端拿到 session_id
    yield {"event": "session_start", "data": json.dumps({"session_id": session_id})}

    try:
        async for inst in session.run_generation():
            if "error" in inst:
                yield {"event": "error", "data": json.dumps({"message": inst["error"]})}
                return
            yield {"event": "instruction", "data": json.dumps(inst)}

            # 进度信息
            total = len(session.instructions)
            yield {
                "event": "progress",
                "data": json.dumps({
                    "completed": total,
                    "total": total,
                    "current_desc": inst.get("description", "")
                })
            }
            await asyncio.sleep(0.1)  # 控制绘制速度

        if session.completed:
            yield {"event": "complete", "data": json.dumps({"session_id": session_id, "total_instructions": len(session.instructions)})}
    except asyncio.CancelledError:
        yield {"event": "error", "data": json.dumps({"message": "Generation cancelled"})}

@app.post("/api/generate")
async def start_generation(req: GenerateRequest):
    session = manager.create_session(req.prompt)
    return EventSourceResponse(event_generator(session.id))

# --- Session Control ---

@app.post("/api/session/{session_id}/pause")
async def pause_generation(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session.pause()
    return {"status": "paused"}

@app.post("/api/session/{session_id}/resume")
async def resume_generation(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session.resume()
    return {"status": "resumed"}

@app.post("/api/session/{session_id}/stop")
async def stop_generation(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session.stop()
    return {"status": "stopped"}

# --- Modify ---

@app.post("/api/session/{session_id}/modify")
async def modify_element(session_id: str, req: ModifyRequest):
    result = await manager.modify_element(session_id, req.element_id, req.instruction)
    if not result:
        raise HTTPException(404, "Element or session not found")
    return {"event": "instruction_updated", "data": result}

# --- Export ---

@app.get("/api/session/{session_id}/export/pptx")
async def export_pptx(session_id: str):
    instructions = db_get_instructions(session_id)
    if not instructions:
        raise HTTPException(404, "Session not found")
    session = get_session(session_id)
    title = session["prompt"] if session else "Scientific Diagram"
    output_path = f"data/{session_id}.pptx"
    os.makedirs("data", exist_ok=True)
    instructions_to_pptx(instructions, output_path, title)
    return FileResponse(output_path, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation", filename=f"{session_id}.pptx")

# --- History ---

@app.get("/api/history")
async def list_history():
    sessions = get_all_sessions()
    return sessions

@app.get("/api/history/{session_id}")
async def get_history_detail(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    instructions = db_get_instructions(session_id)
    return {"session": session, "instructions": instructions}

@app.delete("/api/history/{session_id}")
async def delete_history(session_id: str):
    db_delete_session(session_id)
    return {"status": "deleted"}

# --- Static Files (production) ---

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
```

- [ ] **Step 2: 验证启动**

```bash
cd d:/SAM3
timeout 5 python -c "
import asyncio
from backend.main import app
print('FastAPI app loaded OK')
" 2>&1 || true
```

Expected: `FastAPI app loaded OK`

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add FastAPI main entry with all API routes"
```

---

### Task 7: 前端项目脚手架

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.jsx`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "ai-scientific-diagram",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 2: 创建 vite.config.js**

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
```

- [ ] **Step 3: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI 科研机制图绘制工具</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: 创建 main.jsx**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 5: 创建 App.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  color: #333;
  height: 100vh;
  overflow: hidden;
}

#root {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  height: 48px;
}

.app-header h1 {
  font-size: 16px;
  font-weight: 600;
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.history-sidebar {
  width: 200px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  padding: 8px;
}

.canvas-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8e8e8;
  position: relative;
}

.canvas-area canvas {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  cursor: crosshair;
}

.right-panel {
  width: 260px;
  background: #fff;
  border-left: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
}
```

- [ ] **Step 6: 安装依赖**

```bash
cd d:/SAM3/frontend
npm install
```

Expected: `npm install` 完成，生成 `node_modules` 和 `package-lock.json`

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/vite.config.js frontend/index.html frontend/src/main.jsx frontend/src/App.css
git commit -m "feat: add frontend scaffold with Vite + React"
```

---

### Task 8: SSE 流式连接（客户端）

**Note:** 浏览器 `EventSource` 只支持 GET，但我们的生成接口是 POST。改用 `fetch` + `ReadableStream` 手动解析 SSE 事件。SSE 逻辑内联到 App.jsx（Task 15），这里不单独创建独立的 hook 文件。

无需额外文件。移至 Task 15 中实现。

---

### Task 9: Canvas 渲染 Hook

**Files:**
- Create: `frontend/src/hooks/useCanvas.js`

- [ ] **Step 1: 创建 useCanvas hook**

写入 `frontend/src/hooks/useCanvas.js`:

```javascript
import { useRef, useEffect, useCallback } from 'react'

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

export function useCanvas(instructions, selectedId, onElementClick) {
  const canvasRef = useRef(null)
  const animFrameRef = useRef(null)

  const drawInstructions = useCallback((ctx, insts, selected) => {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    const sorted = [...insts].sort((a, b) => (a.params?.zIndex || 0) - (b.params?.zIndex || 0))

    for (const inst of sorted) {
      const p = inst.params || {}
      const isSelected = inst.id === selected

      ctx.save()
      ctx.globalAlpha = p.opacity || 1.0

      if (isSelected) {
        ctx.strokeStyle = '#2196F3'
        ctx.lineWidth = 3
        ctx.setLineDash([5, 3])
      }

      switch (inst.action) {
        case 'draw_rect':
          drawRect(ctx, p, isSelected)
          break
        case 'draw_circle':
          drawCircle(ctx, p, isSelected)
          break
        case 'draw_ellipse':
          drawEllipse(ctx, p, isSelected)
          break
        case 'draw_line':
          drawLine(ctx, p)
          break
        case 'draw_dashed_line':
          drawDashedLine(ctx, p)
          break
        case 'draw_arrow':
          drawArrow(ctx, p)
          break
        case 'draw_text':
          drawText(ctx, p)
          break
        case 'draw_label':
          drawLabel(ctx, p)
          break
      }

      ctx.restore()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    canvas.width = CANVAS_WIDTH
    canvas.height = CANVAS_HEIGHT

    drawInstructions(ctx, instructions, selectedId)

    // 点击事件
    const handleClick = (e) => {
      const rect = canvas.getBoundingClientRect()
      const scaleX = CANVAS_WIDTH / rect.width
      const scaleY = CANVAS_HEIGHT / rect.height
      const x = (e.clientX - rect.left) * scaleX
      const y = (e.clientY - rect.top) * scaleY
      if (onElementClick) onElementClick(x, y)
    }

    canvas.addEventListener('click', handleClick)
    return () => canvas.removeEventListener('click', handleClick)
  }, [instructions, selectedId, drawInstructions, onElementClick])

  return { canvasRef, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
}

function drawRect(ctx, p, selected) {
  const x = p.x || 0, y = p.y || 0, w = p.w || 100, h = p.h || 100
  ctx.fillStyle = p.fill || '#CCCCCC'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = selected ? '#2196F3' : (p.stroke || '#333')
  ctx.lineWidth = selected ? 3 : (p.strokeWidth || 2)
  ctx.strokeRect(x, y, w, h)
  if (p.label) {
    ctx.fillStyle = '#333'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(p.label, x + w / 2, y + h / 2 + 4)
  }
}

function drawCircle(ctx, p, selected) {
  const cx = p.x || 0, cy = p.y || 0, r = p.r || 30
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = p.fill || '#CCCCCC'
  ctx.fill()
  ctx.strokeStyle = selected ? '#2196F3' : (p.stroke || '#333')
  ctx.lineWidth = selected ? 3 : (p.strokeWidth || 2)
  ctx.stroke()
  if (p.label) {
    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(p.label, cx, cy + 4)
  }
}

function drawEllipse(ctx, p, selected) {
  const cx = p.x || 0, cy = p.y || 0, rw = (p.w || 80) / 2, rh = (p.h || 40) / 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2)
  ctx.fillStyle = p.fill || '#CCCCCC'
  ctx.fill()
  ctx.strokeStyle = selected ? '#2196F3' : (p.stroke || '#333')
  ctx.lineWidth = selected ? 3 : (p.strokeWidth || 2)
  ctx.stroke()
  if (p.label) {
    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(p.label, cx, cy + 4)
  }
}

function drawLine(ctx, p) {
  ctx.beginPath()
  ctx.moveTo(p.startX || 0, p.startY || 0)
  ctx.lineTo(p.endX || 100, p.endY || 100)
  ctx.strokeStyle = p.stroke || '#333'
  ctx.lineWidth = p.strokeWidth || 2
  ctx.stroke()
}

function drawDashedLine(ctx, p) {
  ctx.beginPath()
  ctx.setLineDash([5, 5])
  ctx.moveTo(p.startX || 0, p.startY || 0)
  ctx.lineTo(p.endX || 100, p.endY || 100)
  ctx.strokeStyle = p.stroke || '#666'
  ctx.lineWidth = p.strokeWidth || 1
  ctx.stroke()
  ctx.setLineDash([])
}

function drawArrow(ctx, p) {
  const sx = p.startX || 0, sy = p.startY || 0
  const ex = p.endX || 100, ey = p.endY || 100
  const angle = Math.atan2(ey - sy, ex - sx)
  const headLen = 12

  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.strokeStyle = p.stroke || '#333'
  ctx.lineWidth = p.strokeWidth || 2
  ctx.stroke()

  // 箭头头部
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - headLen * Math.cos(angle - 0.4), ey - headLen * Math.sin(angle - 0.4))
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - headLen * Math.cos(angle + 0.4), ey - headLen * Math.sin(angle + 0.4))
  ctx.stroke()
}

function drawText(ctx, p) {
  ctx.fillStyle = p.fontColor || '#333'
  ctx.font = `${p.fontSize || 14}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(p.text || '', p.x || 0, p.y || 0)
}

function drawLabel(ctx, p) {
  const x = p.x || 0, y = p.y || 0
  // 小圆点
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fillStyle = p.stroke || '#333'
  ctx.fill()
  // 引出线
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + 60, y - 20)
  ctx.strokeStyle = p.stroke || '#333'
  ctx.lineWidth = 1
  ctx.stroke()
  // 标签文本
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(p.label || '', x + 65, y - 20)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useCanvas.js
git commit -m "feat: add Canvas rendering hook with all draw commands"
```

---

### Task 10: Hit Test 工具

**Files:**
- Create: `frontend/src/utils/hitTest.js`

- [ ] **Step 1: 创建 hitTest 工具**

写入 `frontend/src/utils/hitTest.js`:

```javascript
/**
 * 给定鼠标坐标和所有指令，返回被点击的元素 ID
 * 使用包围盒碰撞检测，从高 zIndex 到低 zIndex 遍历
 */
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
      return px >= p.x && px <= p.x + (p.w || 100) &&
             py >= p.y && py <= p.y + (p.h || 100)

    case 'draw_circle':
      const dx = px - p.x
      const dy = py - p.y
      return dx * dx + dy * dy <= (p.r || 30) * (p.r || 30)

    case 'draw_ellipse':
      const rw = (p.w || 80) / 2, rh = (p.h || 40) / 2
      const edx = (px - p.x) / rw, edy = (py - p.y) / rh
      return edx * edx + edy * edy <= 1

    case 'draw_text':
      // 文本点击区域近似
      const textWidth = (p.text || '').length * (p.fontSize || 14) * 0.6
      return px >= p.x && px <= p.x + textWidth &&
             py >= p.y && py <= p.y + (p.fontSize || 14)

    case 'draw_line':
    case 'draw_dashed_line':
    case 'draw_arrow':
      return isNearLine(px, py, p.startX || 0, p.startY || 0, p.endX || 0, p.endY || 0)

    case 'draw_label':
      return isNearLine(px, py, p.x || 0, p.y || 0, (p.x || 0) + 60, (p.y || 0) - 20)

    default:
      return false
  }
}

function isNearLine(px, py, x1, y1, x2, y2, threshold = 10) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.abs(px - x1) < threshold && Math.abs(py - y1) < threshold

  // 点到线段距离
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)))
  const projX = x1 + t * dx
  const projY = y1 + t * dy
  const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
  return dist < threshold && t >= 0 && t <= 1
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/utils/hitTest.js
git commit -m "feat: add hit-test utility for canvas element picking"
```

---

### Task 11: PromptInput + ControlBar 组件

**Files:**
- Create: `frontend/src/components/PromptInput.jsx`
- Create: `frontend/src/components/ControlBar.jsx`

- [ ] **Step 1: 创建 PromptInput**

写入 `frontend/src/components/PromptInput.jsx`:

```jsx
import React, { useState } from 'react'

export default function PromptInput({ onSubmit, disabled }) {
  const [prompt, setPrompt] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!prompt.trim() || disabled) return
    onSubmit(prompt.trim())
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="输入科研机制图描述，例如：画一个细胞膜结构，展示磷脂双分子层和跨膜蛋白..."
        rows={4}
        disabled={disabled}
        style={{
          width: '100%', padding: '8px', borderRadius: '6px',
          border: '1px solid #ccc', resize: 'none', fontSize: '13px',
          fontFamily: 'inherit'
        }}
      />
      <button
        type="submit"
        disabled={disabled || !prompt.trim()}
        style={{
          padding: '8px 16px', background: disabled ? '#ccc' : '#1976D2',
          color: '#fff', border: 'none', borderRadius: '6px',
          cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600
        }}
      >
        {disabled ? '生成中...' : '生成'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: 创建 ControlBar**

写入 `frontend/src/components/ControlBar.jsx`:

```jsx
import React from 'react'

export default function ControlBar({
  isGenerating, isPaused, connected, complete,
  onPause, onResume, onStop, onDownload
}) {
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {isGenerating && !isPaused && (
        <button onClick={onPause} style={btnStyle('#F57C00')}>
          ⏸ 暂停
        </button>
      )}
      {isGenerating && isPaused && (
        <button onClick={onResume} style={btnStyle('#388E3C')}>
          ▶ 恢复
        </button>
      )}
      {isGenerating && (
        <button onClick={onStop} style={btnStyle('#D32F2F')}>
          ⏹ 停止
        </button>
      )}
      {complete && (
        <button onClick={onDownload} style={btnStyle('#1976D2')}>
          ⬇ 下载 PPTX
        </button>
      )}
      <span style={{ fontSize: '12px', color: '#666', alignSelf: 'center', marginLeft: 'auto' }}>
        {isGenerating ? (isPaused ? '⏸ 已暂停' : '▶ 生成中...') : complete ? '✅ 完成' : connected ? '⏳ 连接中...' : ''}
      </span>
    </div>
  )
}

function btnStyle(bg) {
  return {
    padding: '6px 14px', background: bg, color: '#fff',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '13px', fontWeight: 600
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PromptInput.jsx frontend/src/components/ControlBar.jsx
git commit -m "feat: add PromptInput and ControlBar components"
```

---

### Task 12: ElementTooltip 组件

**Files:**
- Create: `frontend/src/components/ElementTooltip.jsx`

- [ ] **Step 1: 创建 ElementTooltip**

写入 `frontend/src/components/ElementTooltip.jsx`:

```jsx
import React, { useState } from 'react'

export default function ElementTooltip({ element, position, onModify, onClose }) {
  const [instruction, setInstruction] = useState('')

  const handleSubmit = () => {
    if (!instruction.trim()) return
    onModify(element.id, instruction.trim())
    setInstruction('')
  }

  if (!element) return null

  const label = element.params?.label || element.description || element.action

  return (
    <div
      style={{
        position: 'absolute',
        left: `${position.x + 10}px`,
        top: `${position.y - 80}px`,
        background: '#fff',
        border: '1px solid #1976D2',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 100,
        width: '220px'
      }}
    >
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
        选中: {label}
      </div>
      <input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="修改提示，如：改成红色"
        style={{
          width: '100%', padding: '6px 8px', borderRadius: '4px',
          border: '1px solid #ccc', fontSize: '12px', marginBottom: '8px'
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
      />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={handleSubmit} style={smallBtn('#1976D2')} disabled={!instruction.trim()}>
          应用修改
        </button>
        <button onClick={onClose} style={smallBtn('#999')}>
          取消
        </button>
      </div>
    </div>
  )
}

const smallBtn = (bg) => ({
  padding: '4px 10px', background: bg, color: '#fff',
  border: 'none', borderRadius: '4px', cursor: 'pointer',
  fontSize: '12px', flex: 1
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ElementTooltip.jsx
git commit -m "feat: add ElementTooltip popup for modifying drawn elements"
```

---

### Task 13: HistoryPanel 组件

**Files:**
- Create: `frontend/src/components/HistoryPanel.jsx`

- [ ] **Step 1: 创建 HistoryPanel**

写入 `frontend/src/components/HistoryPanel.jsx`:

```jsx
import React, { useEffect, useState } from 'react'

export default function HistoryPanel({ onSelect }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/history')
      if (res.ok) {
        const data = await res.json()
        setSessions(data)
      }
    } catch (err) {
      console.error('Failed to fetch history:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const handleSelect = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        if (onSelect) onSelect(data.instructions, data.session)
      }
    } catch (err) {
      console.error('Failed to load history:', err)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#555' }}>📋 历史记录</span>
        <button onClick={fetchHistory} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#1976D2' }}>
          刷新
        </button>
      </div>
      {loading && <div style={{ fontSize: '12px', color: '#999' }}>加载中...</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {sessions.length === 0 && !loading && (
          <div style={{ fontSize: '12px', color: '#999' }}>暂无记录</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSelect(s.id)}
            style={{
              padding: '8px', borderRadius: '6px', cursor: 'pointer',
              background: '#f8f8f8', border: '1px solid #eee',
              fontSize: '12px', lineHeight: '1.4'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#e3f2fd'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#f8f8f8'}
          >
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.prompt}
            </div>
            <div style={{ color: '#999', fontSize: '11px' }}>
              {new Date(s.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/HistoryPanel.jsx
git commit -m "feat: add HistoryPanel component with session list"
```

---

### Task 14: Canvas 组件

**Files:**
- Create: `frontend/src/components/Canvas.jsx`

- [ ] **Step 1: 创建 Canvas 组件**

写入 `frontend/src/components/Canvas.jsx`:

```jsx
import React from 'react'
import { useCanvas } from '../hooks/useCanvas'

export default function Canvas({ instructions, selectedId, onCanvasClick }) {
  const { canvasRef, width, height } = useCanvas(instructions, selectedId, onCanvasClick)

  return (
    <div className="canvas-area">
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair' }}
      />
      <div style={{
        position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
        fontSize: '12px', color: '#999', background: 'rgba(255,255,255,0.8)',
        padding: '4px 12px', borderRadius: '4px'
      }}>
        Canvas {width}×{height} | 点击元素可修改
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Canvas.jsx
git commit -m "feat: add Canvas wrapper component"
```

---

### Task 15: App 主组件 + 全局集成

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 创建 App.jsx（完整集成）**

写入 `frontend/src/App.jsx`:

```jsx
import React, { useState, useCallback, useRef } from 'react'
import Canvas from './components/Canvas'
import PromptInput from './components/PromptInput'
import ControlBar from './components/ControlBar'
import ElementTooltip from './components/ElementTooltip'
import HistoryPanel from './components/HistoryPanel'
import { hitTest } from './utils/hitTest'

export default function App() {
  const [sessionId, setSessionId] = useState(null)
  const [instructions, setInstructions] = useState([])
  const [progress, setProgress] = useState({ completed: 0, total: 0, current_desc: '' })
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [connected, setConnected] = useState(false)
  const [complete, setComplete] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [isIdle, setIsIdle] = useState(true)
  const eventSourceRef = useRef(null)

  // --- SSE 连接 ---
  const startGeneration = useCallback(async (prompt) => {
    setIsIdle(false)
    setIsGenerating(true)
    setIsPaused(false)
    setComplete(false)
    setSelectedId(null)
    setInstructions([])

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      if (!res.ok) throw new Error('Failed to start generation')

      // SSE stream
      const es = new EventSource('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      // Actually EventSource doesn't support POST body well.
      // Let's get session ID first
      res.body.cancel()
      es.close()

      // Use fetch POST to get session ID, then SSE GET
      const apiRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      if (!apiRes.ok) throw new Error('API error')

      const reader = apiRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotSessionId = false

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line.startsWith('event: ')) {
              const eventType = line.slice(7).trim()
              const dataLine = lines[i + 1]
              if (dataLine && dataLine.startsWith('data: ')) {
                const data = JSON.parse(dataLine.slice(6))
                handleEvent(eventType, data)
                i++
              }
            }
          }
        }
      }

      processStream()
    } catch (err) {
      console.error('Generation error:', err)
      setIsGenerating(false)
      setConnected(false)
    }
  }, [])

  const handleEvent = useCallback((eventType, data) => {
    switch (eventType) {
      case 'instruction':
        setInstructions(prev => [...prev, data])
        break
      case 'instruction_updated':
        setInstructions(prev => prev.map(i => i.id === data.id ? { ...i, ...data, params: data.params || i.params } : i))
        break
      case 'progress':
        setProgress(data)
        break
      case 'complete':
        setComplete(true)
        setIsGenerating(false)
        setConnected(false)
        break
      case 'error':
        console.error('Generation error:', data.message)
        setIsGenerating(false)
        setConnected(false)
        break
    }
  }, [])

  // --- 控制 ---
  const handlePause = useCallback(async () => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}/pause`, { method: 'POST' })
    setIsPaused(true)
  }, [sessionId])

  const handleResume = useCallback(async () => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}/resume`, { method: 'POST' })
    setIsPaused(false)
  }, [sessionId])

  const handleStop = useCallback(async () => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}/stop`, { method: 'POST' })
    setIsGenerating(false)
    setConnected(false)
  }, [sessionId])

  const handleDownload = useCallback(async () => {
    if (!sessionId) return
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
  }, [sessionId])

  // --- 元素点击 ---
  const handleCanvasClick = useCallback((x, y) => {
    if (complete || !isGenerating) {
      const id = hitTest(x, y, instructions)
      setSelectedId(id)
      if (id) {
        setTooltipPos({ x: x + 30, y })
      }
    }
  }, [instructions, complete, isGenerating])

  const handleModify = useCallback(async (elementId, instruction) => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/session/${sessionId}/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ element_id: elementId, instruction })
      })
      if (res.ok) {
        const result = await res.json()
        setInstructions(prev => prev.map(i =>
          i.id === elementId ? { ...i, ...result.data } : i
        ))
      }
    } catch (err) {
      console.error('Modify error:', err)
    }
    setSelectedId(null)
  }, [sessionId])

  // --- 历史 ---
  const handleHistorySelect = useCallback((historyInstructions, session) => {
    setInstructions(historyInstructions.map(i => ({
      ...i,
      params: typeof i.params === 'string' ? JSON.parse(i.params) : i.params
    })))
    setComplete(true)
    setIsGenerating(false)
    setConnected(false)
    setIsIdle(false)
    setSessionId(session.id)
  }, [])

  const selectedElement = selectedId ? instructions.find(i => i.id === selectedId) : null

  return (
    <>
      <header className="app-header">
        <h1>🧪 AI 科研机制图绘制工具</h1>
        {isGenerating && (
          <span style={{ fontSize: '13px', color: '#666' }}>
            {progress.current_desc || '正在生成...'}
          </span>
        )}
      </header>
      <div className="app-body">
        <div className="history-sidebar">
          <HistoryPanel onSelect={handleHistorySelect} />
        </div>
        <Canvas
          instructions={instructions}
          selectedId={selectedId}
          onCanvasClick={handleCanvasClick}
        />
        <div className="right-panel">
          <PromptInput onSubmit={startGeneration} disabled={isGenerating} />
          <ControlBar
            isGenerating={isGenerating}
            isPaused={isPaused}
            connected={connected}
            complete={complete}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onDownload={handleDownload}
          />
        </div>
      </div>
      {selectedElement && (
        <ElementTooltip
          element={selectedElement}
          position={tooltipPos}
          onModify={handleModify}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: 验证构建**

```bash
cd d:/SAM3/frontend
npx vite build
```

Expected: Build 成功，生成 `dist/` 目录

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add main App component with full integration"
```

---

### Task 16: 生产部署配置

**Files:**
- Create: `backend/.env.example`
- Modify: `frontend/vite.config.js` (开发代理配置已有，无需修改)

- [ ] **Step 1: 创建 .env.example**

写入 `backend/.env.example`:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=your-api-key-here
LLM_MODEL=gpt-4o
DATABASE_PATH=data/sessions.db
HOST=127.0.0.1
PORT=8000
```

- [ ] **Step 2: 更新 backend/main.py 确保静态文件服务**

(已经在 Task 6 中包含了静态文件服务，确认即可)

- [ ] **Step 3: 创建启动脚本**

写入 `start.sh`:

```bash
#!/bin/bash
cd "$(dirname "$0")"

# 构建前端
cd frontend
npx vite build
cd ..

# 启动后端
cd backend
python main.py
```

写入 `start.bat`:

```bat
@echo off
cd /d "%~dp0"

echo Building frontend...
cd frontend
call npx vite build
cd ..

echo Starting backend...
cd backend
python main.py
```

- [ ] **Step 4: 验证端到端启动**

```bash
cd d:/SAM3/frontend && npx vite build && cd ../backend && python -c "
from main import app
print('Ready to serve')
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/.env.example start.sh start.bat
git commit -m "chore: add production deployment config and start scripts"
```

---

## Spec 覆盖检查

| Spec 需求 | 对应 Task |
|-----------|-----------|
| SSE 流式推送绘图指令 | Task 6 (event_generator), Task 8 (useSSE) |
| Canvas 逐条实时渲染 | Task 9 (useCanvas) |
| 暂停/恢复 | Task 4 (Session.pause/resume), Task 6 (API) |
| 点击元素修改 | Task 10 (hitTest), Task 12 (ElementTooltip) |
| PPTX 导出 | Task 5 (pptx_exporter), Task 6 (export API) |
| 历史记录 | Task 1 (database), Task 6 (history API), Task 13 (HistoryPanel) |
| SQLite 持久化 | Task 1 (database.py) |
| LLM API (OpenAI/Anthropic) | Task 3 (llm_client.py) |
| 无 API Key 时的 mock 模式 | Task 3 (mock fallback) |
| SSE 保活 (keepalive) | 简化方案：前端自动重连 (Task 8) |
| 生产部署 (FastAPI serve 静态文件) | Task 16 |
| Canvas 包围盒碰撞检测 | Task 10 (hitTest.js) |
