import json
import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from sse_starlette.sse import EventSourceResponse
from backend.models import GenerateRequest, ModifyRequest, ModifyBatchRequest
from backend.session_manager import manager
from backend.database import (
    init_db, get_instructions as db_get_instructions,
    get_all_sessions, get_session, delete_session as db_delete_session
)
from backend.pptx_exporter import instructions_to_pptx
from backend.svg_exporter import instructions_to_svg
from backend.file_parser import parse_file
from backend.config import HOST, PORT


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI Scientific Diagram Drawer", lifespan=lifespan)


class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        ct = response.headers.get("content-type", "")
        if ct.startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        elif request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

app.add_middleware(CacheControlMiddleware)


# --- SSE Generate ---

async def event_generator(session_id: str):
    session = manager.get_session(session_id)
    if not session:
        yield {"event": "error", "data": json.dumps({"message": "Session not found"})}
        return

    yield {"event": "session_start", "data": json.dumps({"session_id": session_id})}

    try:
        async for inst in session.run_generation():
            if "error" in inst:
                yield {"event": "error", "data": json.dumps({"message": inst["error"]})}
                return
            yield {"event": "instruction", "data": json.dumps(inst)}

            total = len(session.instructions)
            yield {
                "event": "progress",
                "data": json.dumps({
                    "completed": total,
                    "total": total,
                    "current_desc": inst.get("description", "")
                })
            }
        # no artificial delay — instructions yield as fast as possible
        if session.completed:
            yield {
                "event": "complete",
                "data": json.dumps({
                    "session_id": session_id,
                    "total_instructions": len(session.instructions)
                })
            }
    except asyncio.CancelledError:
        yield {"event": "error", "data": json.dumps({"message": "Generation cancelled"})}


@app.post("/api/generate")
async def start_generation(req: GenerateRequest):
    session = manager.create_session(req.prompt, language=req.language, mode=req.mode, chart_type=req.chart_type)
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


# --- Delete ---

@app.delete("/api/session/{session_id}/element/{element_id}")
async def delete_element(session_id: str, element_id: str):
    success = manager.delete_element(session_id, element_id)
    if not success:
        raise HTTPException(404, "Element or session not found")
    return {"status": "deleted", "element_id": element_id}


@app.post("/api/session/{session_id}/clear")
async def clear_elements(session_id: str):
    success = manager.clear_elements(session_id)
    if not success:
        raise HTTPException(404, "Session not found")
    return {"status": "cleared"}


# --- Modify ---

@app.post("/api/session/{session_id}/modify")
async def modify_element(session_id: str, req: ModifyRequest):
    print(f"DEBUG modify: session={session_id}, element={req.element_id}, instruction={req.instruction[:60]}")
    session_obj = manager.get_session(session_id)
    print(f"DEBUG modify: get_session={'FOUND' if session_obj else 'NOT FOUND'}")
    if session_obj:
        ids = [i.get("id") for i in session_obj.instructions]
        print(f"DEBUG modify: IDs={ids}")
        print(f"DEBUG modify: element={req.element_id} in IDs={req.element_id in ids}")
    result = await manager.modify_element(session_id, req.element_id, req.instruction)
    if not result:
        print(f"DEBUG modify: RESULT IS NONE!")
        raise HTTPException(404, "Element or session not found")
    return {"event": "instruction_updated", "data": result}


@app.post("/api/session/{session_id}/modify-batch")
async def modify_elements_batch(session_id: str, req: ModifyBatchRequest):
    results = await manager.batch_modify_elements(session_id, req.element_ids, req.instruction)
    if not results:
        raise HTTPException(404, "No elements found to modify")
    return {"event": "instructions_updated", "data": results}


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
    return FileResponse(
        output_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{session_id}.pptx"
    )


@app.get("/api/session/{session_id}/export/svg")
async def export_svg(session_id: str):
    instructions = db_get_instructions(session_id)
    if not instructions:
        raise HTTPException(404, "Session not found")
    svg_content = instructions_to_svg(instructions)
    return Response(
        content=svg_content,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'attachment; filename="{session_id}.svg"'}
    )


# --- File Parse ---

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

@app.post("/api/parse-document")
async def parse_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("txt", "pdf", "docx", "png", "jpg", "jpeg", "gif", "bmp"):
        raise HTTPException(400, f"Unsupported file type: .{ext} (supported: .txt, .pdf, .docx, .png, .jpg, .jpeg, .gif, .bmp)")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large (max 10 MB)")
    try:
        text = parse_file(content, file.filename)
    except Exception as e:
        raise HTTPException(500, f"Failed to parse file: {str(e)}")
    return {"text": text, "filename": file.filename}


# --- History ---

@app.get("/api/history")
async def list_history():
    return get_all_sessions()


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


# --- Static Files ---

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
