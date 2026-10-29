"""FastAPI application used by Vercel and local development."""

from datetime import date
from pathlib import Path
import base64
import logging
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .workflow import app as blog_graph
from .rag import chunk_text, embed_documents, embed_query, extract_text, retrieve

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
logger = logging.getLogger(__name__)
app = FastAPI(title="InkForge", version="1.0.0")
app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class PrivateChunk(BaseModel):
    source: str = Field(max_length=200)
    text: str = Field(min_length=1, max_length=4_000)
    embedding: list[float] = Field(min_length=768, max_length=768)


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=500)
    as_of: date = Field(default_factory=date.today)
    private_chunks: list[PrivateChunk] = Field(default_factory=list, max_length=120)


class IngestRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    content_base64: str = Field(min_length=1, max_length=4_194_304)


def _api_key(user_api_key: str | None) -> str:
    key = user_api_key or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Add a Google AI API key for this session before using private documents or generating a draft.")
    return key


def _provider_error(exc: Exception) -> HTTPException:
    message = str(exc).lower()
    if "api key" in message and any(marker in message for marker in ("invalid", "not valid", "required", "unauthorized")):
        return HTTPException(status_code=401, detail="Google rejected this API key. Check that it is valid and Gemini API access is enabled.")
    if any(marker in message for marker in ("quota", "resource_exhausted", "rate limit", "429")):
        return HTTPException(status_code=429, detail="Google AI quota or rate limit reached. Check the key's project quota and try again later.")
    logger.exception("InkForge Google AI request failed")
    return HTTPException(status_code=502, detail="Google AI could not complete this request. Check the function logs and try again.")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "inkforge"}


@app.post("/api/ingest")
def ingest_document(request: IngestRequest, user_api_key: str | None = Header(default=None, alias="X-Google-API-Key")):
    api_key = _api_key(user_api_key)
    filename = Path(request.filename).name
    try:
        content = base64.b64decode(request.content_base64, validate=True)
        text = extract_text(filename, content)
        chunks = chunk_text(text)
        vectors = embed_documents(filename, chunks, api_key)
        return {
            "filename": filename,
            "chunks": [
                {"source": filename, "text": chunk, "embedding": vector}
                for chunk, vector in zip(chunks, vectors)
            ],
        }
    except ValueError as exc:
        if "base64" in str(exc).lower():
            raise HTTPException(status_code=400, detail="The uploaded file could not be decoded.") from None
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception as exc:
        raise _provider_error(exc) from None


@app.post("/api/generate")
def generate_blog(request: GenerateRequest, user_api_key: str | None = Header(default=None, alias="X-Google-API-Key")):
    api_key = _api_key(user_api_key)

    try:
        private_context = []
        if request.private_chunks:
            query_vector = embed_query(request.topic.strip(), api_key)
            private_context = retrieve(
                query_vector,
                [chunk.model_dump() for chunk in request.private_chunks],
            )
    except Exception as exc:
        raise _provider_error(exc) from None

    inputs = {
        "topic": request.topic.strip(),
        "save_artifacts": False,
        "google_api_key": api_key,
        "private_context": private_context,
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
            "private_context_count": len(private_context),
        }
    except Exception as exc:
        logger.exception("InkForge generation failed")
        raise _provider_error(exc) from None


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    candidate = (FRONTEND / path).resolve()
    root = FRONTEND.resolve()
    if path and candidate.is_relative_to(root) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(FRONTEND / "index.html")
