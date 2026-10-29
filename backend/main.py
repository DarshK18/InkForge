"""FastAPI application used by Vercel and local development."""

from datetime import date
from pathlib import Path
import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .workflow import app as blog_graph

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
logger = logging.getLogger(__name__)
app = FastAPI(title="InkForge", version="1.0.0")
app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=500)
    as_of: date = Field(default_factory=date.today)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "inkforge"}


@app.post("/api/generate")
def generate_blog(request: GenerateRequest):
    if not os.getenv("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="Generation is not configured. Add GOOGLE_API_KEY in the deployment environment settings.")

    inputs = {
        "topic": request.topic.strip(),
        "save_artifacts": False,
        "mode": "",
        "needs_research": False,
        "queries": [],
        "evidence": [],
        "plan": None,
        "as_of": request.as_of.isoformat(),
        "recency_days": 7,
        "sections": [],
        "merged_md": "",
        "md_with_placeholders": "",
        "image_specs": [],
        "final": "",
    }
    try:
        result = blog_graph.invoke(inputs)
        plan = result.get("plan")
        return {
            "title": plan.blog_title if plan else "Generated blog",
            "markdown": result.get("final", ""),
            "mode": result.get("mode", "closed_book"),
            "evidence": [item.model_dump() for item in result.get("evidence", [])],
            "images": result.get("image_specs", []),
        }
    except Exception:
        logger.exception("InkForge generation failed")
        raise HTTPException(status_code=502, detail="Generation failed. Check the configured model and search API keys, then try again.") from None


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    candidate = (FRONTEND / path).resolve()
    root = FRONTEND.resolve()
    if path and candidate.is_relative_to(root) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(FRONTEND / "index.html")
