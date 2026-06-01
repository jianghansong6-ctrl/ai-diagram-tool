# AI 科研机制图绘制工具 — 设计文档

## 概述

一个 AI 驱动的科研机制图绘制 Web 应用。用户输入文字 prompt，AI 逐步生成结构化的绘图指令，前端 Canvas 实时流式渲染绘制过程，支持随时暂停/恢复、点击图中元素直接修改、导出为可编辑的 PPTX 文件。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python FastAPI + SSE (Server-Sent Events) |
| AI | LLM API (输出结构化 JSON 绘图指令序列)。用户自备 API Key (OpenAI / Anthropic)，通过环境变量 `LLM_API_KEY`、`LLM_PROVIDER` 配置 |
| 前端 | React + HTML5 Canvas |
| PPT 导出 | python-pptx |
| 构建工具 | Vite |

所有文件仅在 `d:/SAM3/` 目录下，如需在外操作需用户同意。

## 架构

```
┌─────────────────────────────────────────────────┐
│                  浏览器 (React SPA)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Prompt    │ │ Canvas   │ │ 控制栏           │  │
│  │ 输入区    │ │ 渲染区    │ │ ▶ ⏸ ✏️ 下载      │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────────────────────────────────────┐    │
│  │ 历史侧栏 (最近会话列表)                    │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────┘
                       │ SSE + HTTP
┌──────────────────────▼──────────────────────────┐
│              FastAPI 后端                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ 生成会话  │ │ LLM      │ │ 指令 → PPTX      │  │
│  │ 管理器    │ │ 客户端    │ │ 转换器           │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 前端界面布局

```
┌──────────────────────────────────────────────────────────┐
│  🧪 AI科研机制图绘制                            用户: ⚡ │
├──────────────────────────────────────────────────────────┤
│ ┌──────────┬──────────────────────────┬──────────────┐   │
│ │          │                          │              │   │
│ │  ╰ . .   │                          │   右侧面板    │   │
│ │  历史     │      Canvas              │   ┌────────┐ │   │
│ │  侧栏     │     绘制区域              │   │ 提示词  │ │   │
│ │          │                          │   │ 输入框  │ │   │
│ │  最近1:   │    [AI正在绘制...]       │   │ [生成]  │ │   │
│ │  细胞膜   │                          │   ├────────┤ │   │
│ │  最近2:   │                          │   │ ▶ 暂停  │ │   │
│ │  DNA复制  │   ○ 选中某元素时         │   │ 🎨 修改  │ │   │
│ │  最近3:   │   弹出修改框             │   │ ⬇ 下载  │ │   │
│ │  光合作用 │   ┌──────────┐          │   ├────────┤ │   │
│ │          │   │改成红色…│          │   │ 历史    │ │   │
│ │          │   └──────────┘          │   │ 记录    │ │   │
│ │          │                          │   │ 记录    │ │   │
│ └──────────┴──────────────────────────┴──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 交互流程

```
用户输入 prompt → POST /api/generate → SSE 连接建立
    │
    ▼
AI 逐条推送绘图指令 (event: instruction)
    │
    ├──→ Canvas 实时渲染该元素
    ├──→ 状态栏显示"正在绘制：xxx..."
    │
用户点击 [暂停] → POST /api/pause → 生成器挂起
    │
用户点击 Canvas 上某已绘元素
    │
    ▼
弹出浮动修改框 → 输入修改提示
    │
    ▼
POST /api/modify → LLM 重新生成该元素
    │
    ▼
SSE 推送 event: instruction_updated → Canvas 更新
    │
用户点击 [恢复] → POST /api/resume → 继续绘制
    │
    ▼
绘制完成 (event: complete)
    │
    ▼
可下载 PPTX / 保存到历史
```

## 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/generate` | 新建会话，启动 SSE 流。Body: `{ prompt }` |
| POST | `/api/session/{id}/pause` | 暂停当前生成 |
| POST | `/api/session/{id}/resume` | 恢复生成 |
| POST | `/api/session/{id}/stop` | 终止生成 |
| POST | `/api/session/{id}/modify` | 修改指定元素。Body: `{ element_id, instruction }` |
| GET | `/api/session/{id}/export/pptx` | 下载 PPTX 文件 |
| GET | `/api/history` | 历史会话列表 |
| GET | `/api/history/{id}` | 历史会话详情 |
| DELETE | `/api/history/{id}` | 删除历史记录 |

### SSE 事件格式

```json
event: instruction
data: {"id":"step_3","action":"draw_rect","params":{"x":50,"y":100,"w":300,"h":80,"fill":"#E8D5B7"},"desc":"绘制磷脂双分子层"}

event: instruction_updated
data: {"id":"step_3","action":"draw_rect","params":{...}}

event: progress
data: {"completed":5,"total":20,"current_desc":"绘制嵌入蛋白"}

event: complete
data: {"session_id":"xxx","total_instructions":20}

event: error
data: {"message":"..."}
```

## 绘图指令模型

每条指令是一个结构化 JSON 对象，定义 AI 在 Canvas 上绘制一个基本图形元素：

```
{
  "id": "step_3",              // 唯一标识
  "action": "draw_rect",       // 指令类型
  "params": {                  // 绘图参数
    "x": 50, "y": 100,
    "w": 300, "h": 80,
    "fill": "#E8D5B7",
    "stroke": "#333",
    "strokeWidth": 2,
    "opacity": 1,
    "label": "磷脂双分子层",     // 可选标签文本
    "zIndex": 1
  },
  "desc": "绘制磷脂双分子层"     // 用于状态栏显示
}
```

支持的 action 类型：`draw_rect`, `draw_circle`, `draw_ellipse`, `draw_line`, `draw_arrow`, `draw_path`, `draw_text`, `draw_label`, `draw_dashed_line`, `draw_curve`

## Canvas 点击拾取（Hit Testing）

Canvas 上没有独立 DOM 元素，点击拾取采用**包围盒碰撞检测**：

1. 用户点击 Canvas，获取鼠标坐标 `(x, y)`
2. 按 `zIndex` 从高到低遍历所有已渲染指令
3. 对每个指令计算其包围盒（bbox），判断点击坐标是否在 bbox 内
4. 命中第一个（最上层）元素即为选中元素
5. 若未命中任何元素，取消当前选中

性能优化：元素数量超过 100 时启用**四叉树空间索引**，避免 O(n) 遍历。

## SSE 暂停保活

暂停期间 SSE 连接可能被浏览器或中间代理断开。解决方案：

- 服务器每 15 秒推送 `event: keepalive\ndata: {}` 维持连接
- 前端收到 `keepalive` 后重置 SSE 超时计时器
- 若 SSE 意外断开，前端自动重连，后端通过 `session_id` 恢复上下文
- 断连后恢复时，前端请求 `GET /api/session/{id}/sync` 获取断开期间错过的指令

## 会话持久化

使用 **SQLite**（Python 内置 sqlite3，零依赖）：

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instructions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    seq INTEGER NOT NULL,
    action TEXT NOT NULL,
    params TEXT NOT NULL,     -- JSON string
    desc TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

生成过程中每条指令实时写入数据库（而非批量落盘），确保意外中断时不会丢失已完成的步骤。

## 生产部署

- 前端构建产物（`vite build` -> `dist/`）由 FastAPI 作为静态文件 serve
- 单命令启动：`python backend/main.py` 即可访问网页
- 开发模式下前后端分离（Vite dev server + FastAPI），通过 proxy 转发 API 请求

## 历史功能

- 每次生成会话自动保存（会话 ID、prompt、完整指令列表、时间戳）
- 侧栏展示最近会话列表
- 点击历史记录可回溯查看之前生成的绘图
- 支持从历史记录中重新加载并继续修改

## 文件结构（计划）

```
d:/SAM3/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── session_manager.py   # 会话管理 + 生成器控制
│   ├── llm_client.py        # LLM API 调用
│   ├── pptx_exporter.py     # 指令 → PPTX 转换
│   ├── models.py            # 数据模型
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── Canvas.jsx        # Canvas 渲染
│   │   │   ├── ControlBar.jsx    # 暂停/恢复/下载
│   │   │   ├── PromptInput.jsx   # prompt 输入
│   │   │   ├── ElementTooltip.jsx# 元素浮动修改框
│   │   │   └── HistoryPanel.jsx  # 历史侧栏
│   │   ├── hooks/
│   │   │   ├── useSSE.js         # SSE 连接管理
│   │   │   └── useCanvas.js      # Canvas 渲染逻辑
│   │   └── utils/
│   │       └── hitTest.js        # 点击坐标 → 元素查找
│   └── package.json
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-13-ai-scientific-diagram-ppt-design.md
```
