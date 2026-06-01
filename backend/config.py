import os
from dotenv import load_dotenv

_env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(_env_path)

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o" if LLM_PROVIDER == "openai" else "claude-sonnet-4-20250514")
LLM_API_BASE = os.getenv("LLM_API_BASE", "")
DATABASE_PATH = os.getenv("DATABASE_PATH", "data/sessions.db")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))
