import asyncio
import json
from typing import AsyncGenerator, Optional
from backend.llm_client import generate_instructions, modify_instruction, batch_modify_instruction
from backend.database import save_session, save_instruction, update_instruction_params, delete_instruction, delete_session_instructions
from backend.layout_optimizer import optimize_layout


class Session:
    def __init__(self, session_id: str, prompt: str, language: str = "zh", mode: str = "diagram", chart_type: str = ""):
        self.id = session_id
        self.prompt = prompt
        self.language = language
        self.mode = mode
        self.chart_type = chart_type or mode  # use chart_type, fall back to mode
        self.instructions: list[dict] = []
        self.paused = asyncio.Event()
        self.paused.set()
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
        save_session(self.id, self.prompt, language=self.language, mode=self.mode, chart_type=self.chart_type)
        try:
            async for inst_json in generate_instructions(self.prompt, language=self.language, mode=self.mode, chart_type=self.chart_type):
                if self.stopped:
                    break
                await self.paused.wait()

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

            # Post-process: optimize layout for diagrams only (skip for structured types)
            skip_types = {"mindmap", "table", "bar_chart", "line_chart", "pie_chart", "framework"}
            if not self.stopped and self.chart_type not in skip_types and len(self.instructions) > 1:
                self.instructions = optimize_layout(self.instructions)
                for i, inst in enumerate(self.instructions):
                    update_instruction_params(self.id, i + 1, inst.get("params", {}))

            self.completed = True
        except Exception as e:
            self.error = str(e)
            yield {"error": str(e)}

    def modify_instruction(self, element_id: str, new_inst: dict) -> Optional[dict]:
        for i, inst in enumerate(self.instructions):
            if inst.get("id") == element_id:
                self.instructions[i] = new_inst
                # Persist to database
                seq_str = element_id.split("_")[-1]
                try:
                    update_instruction_params(self.id, int(seq_str), new_inst.get("params", {}))
                except (ValueError, IndexError):
                    pass
                return new_inst
        return None


class SessionManager:
    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def create_session(self, prompt: str, language: str = "zh", mode: str = "diagram", chart_type: str = "") -> Session:
        import uuid
        session_id = str(uuid.uuid4())[:8]
        session = Session(session_id, prompt, language, mode, chart_type)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        session = self._sessions.get(session_id)
        if session:
            return session
        # Session not in memory — try to load from database (history restore)
        return self._load_from_db(session_id)

    def _load_from_db(self, session_id: str) -> Optional[Session]:
        """Reconstruct a Session from the database (for history restore)."""
        from backend.database import get_session as db_get_session, get_instructions as db_get_instructions
        row = db_get_session(session_id)
        if not row:
            return None
        session = Session(
            session_id,
            row.get("prompt", ""),
            language=row.get("language", "zh"),
            mode=row.get("mode", "diagram"),
            chart_type=row.get("chart_type", "")
        )
        session.completed = True
        db_insts = db_get_instructions(session_id)
        for i, inst_row in enumerate(db_insts):
            params = inst_row.get("params", "{}")
            if isinstance(params, str):
                try:
                    params = json.loads(params)
                except json.JSONDecodeError:
                    params = {}
            session.instructions.append({
                "id": f"step_{i}",
                "action": inst_row.get("action", ""),
                "params": params,
                "description": inst_row.get("description", ""),
            })
        self._sessions[session_id] = session
        return session

    async def modify_element(self, session_id: str, element_id: str, instruction: str) -> Optional[dict]:
        session = self.get_session(session_id)
        if not session:
            return None
        old = next((i for i in session.instructions if i.get("id") == element_id), None)
        if not old:
            return None
        context = (
            f"The diagram shows: {session.prompt}\n\n"
            f"Element to replace (id={element_id}):\n{json.dumps(old, indent=2)}\n\n"
            f"User request: {instruction}\n\n"
            f"Generate ONE replacement JSON instruction for this element."
        )
        inst_json = await modify_instruction(context)
        if not inst_json:
            return dict(old)
        inst = json.loads(inst_json)
        inst["id"] = element_id
        for i, existing in enumerate(session.instructions):
            if existing.get("id") == element_id:
                session.instructions[i] = inst
                return inst
        return None

    async def batch_modify_elements(self, session_id: str, element_ids: list[str], instruction: str) -> list[dict]:
        session = self.get_session(session_id)
        if not session:
            return []
        olds = [i for i in session.instructions if i.get("id") in element_ids]
        if not olds:
            return []
        context = f"The diagram shows: {session.prompt}\n\nElements to replace ({len(olds)} total):\n"
        for o in olds:
            context += f"{json.dumps(o)}\n"
        context += f"\nUser request: {instruction}\n\nGenerate {len(olds)} replacement JSON instructions, one per line, maintaining the same count."
        inst_jsons = await batch_modify_instruction(context)
        if not inst_jsons or len(inst_jsons) != len(olds):
            return [dict(o) for o in olds]
        results = []
        for old, inst_json in zip(olds, inst_jsons):
            try:
                inst = json.loads(inst_json)
                inst["id"] = old["id"]
                for i, existing in enumerate(session.instructions):
                    if existing.get("id") == old["id"]:
                        session.instructions[i] = inst
                        seq_str = old["id"].split("_")[-1]
                        try:
                            update_instruction_params(session.id, int(seq_str), inst.get("params", {}))
                        except (ValueError, IndexError):
                            pass
                        results.append(inst)
                        break
            except json.JSONDecodeError:
                continue
        return results if results else [dict(o) for o in olds]

    def delete_element(self, session_id: str, element_id: str) -> bool:
        session = self.get_session(session_id)
        if not session:
            return False
        for i, inst in enumerate(session.instructions):
            if inst.get("id") == element_id:
                session.instructions.pop(i)
                delete_instruction(f"{session_id}_{element_id.split('_')[-1]}")
                return True
        return False

    def clear_elements(self, session_id: str) -> bool:
        session = self.get_session(session_id)
        if not session:
            return False
        session.instructions.clear()
        delete_session_instructions(session_id)
        return True

    def remove_session(self, session_id: str):
        self._sessions.pop(session_id, None)

    def list_sessions(self) -> list[dict]:
        return [
            {"id": s.id, "prompt": s.prompt, "completed": s.completed, "error": s.error}
            for s in self._sessions.values()
        ]


manager = SessionManager()
