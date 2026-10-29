"""Small document ingestion helpers for InkForge's browser-local vector store."""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any
from zipfile import ZipFile, BadZipFile
import xml.etree.ElementTree as ET

MAX_FILE_BYTES = 3 * 1024 * 1024
MAX_CHUNKS_PER_FILE = 40
CHUNK_CHARS = 1_200
CHUNK_OVERLAP = 180
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768


def extract_text(filename: str, content: bytes) -> str:
    """Extract text from supported user documents without writing them to disk."""
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("Each document must be 3 MB or smaller.")

    suffix = Path(filename).suffix.lower()
    if suffix in {".txt", ".md", ".markdown", ".csv"}:
        text = content.decode("utf-8-sig", errors="replace")
    elif suffix == ".docx":
        try:
            with ZipFile(io.BytesIO(content)) as archive:
                document_xml = archive.getinfo("word/document.xml")
                if document_xml.file_size > 12 * 1024 * 1024:
                    raise ValueError("The extracted DOCX text is too large to index.")
                root = ET.fromstring(archive.read("word/document.xml"))
            paragraph_tag = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"
            text_tag = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
            text = "\n".join(
                "".join(node.text or "" for node in paragraph.iter(text_tag))
                for paragraph in root.iter(paragraph_tag)
            )
        except (BadZipFile, KeyError, ET.ParseError):
            raise ValueError("That DOCX file could not be read.") from None
    else:
        raise ValueError("Use a DOCX, TXT, Markdown, or CSV document.")

    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        raise ValueError("No readable text was found in that document.")
    return text


def chunk_text(text: str) -> list[str]:
    """Create paragraph-aware, overlapping chunks within a bounded library size."""
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        while len(paragraph) > CHUNK_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(paragraph[:CHUNK_CHARS])
            paragraph = paragraph[CHUNK_CHARS - CHUNK_OVERLAP :]
        candidate = f"{current}\n{paragraph}".strip()
        if len(candidate) <= CHUNK_CHARS:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = paragraph
    if current:
        chunks.append(current)

    if len(chunks) > MAX_CHUNKS_PER_FILE:
        raise ValueError(
            f"This document is too long to index in one pass (limit: {MAX_CHUNKS_PER_FILE} chunks)."
        )
    return chunks


def embed_documents(filename: str, chunks: list[str], api_key: str) -> list[list[float]]:
    """Embed document chunks as retrieval documents using Google's Gemini model."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    vectors: list[list[float]] = []
    for start in range(0, len(chunks), 16):
        batch = chunks[start : start + 16]
        response = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[f"Document: {filename}\n{chunk}" for chunk in batch],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=EMBEDDING_DIMENSIONS,
            ),
        )
        embeddings = getattr(response, "embeddings", None) or []
        if len(embeddings) != len(batch):
            raise RuntimeError("Google returned an incomplete set of document embeddings.")
        vectors.extend([list(embedding.values) for embedding in embeddings])
    return vectors


def embed_query(query: str, api_key: str) -> list[float]:
    """Embed a writing topic in the same vector space as the private documents."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    response = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=query,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=EMBEDDING_DIMENSIONS,
        ),
    )
    embeddings: list[Any] = getattr(response, "embeddings", None) or []
    if not embeddings:
        raise RuntimeError("Google returned no query embedding.")
    return list(embeddings[0].values)


def retrieve(query_vector: list[float], chunks: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    """Rank browser-provided vectors by cosine similarity and keep relevant excerpts."""
    import math

    query_norm = math.sqrt(sum(value * value for value in query_vector))
    if not query_norm:
        return []
    ranked: list[tuple[float, dict[str, Any]]] = []
    for chunk in chunks[:400]:
        vector = chunk.get("embedding")
        text = chunk.get("text")
        if not isinstance(vector, list) or not isinstance(text, str) or len(vector) != len(query_vector):
            continue
        norm = math.sqrt(sum(float(value) * float(value) for value in vector))
        if not norm:
            continue
        score = sum(float(a) * float(b) for a, b in zip(query_vector, vector)) / (query_norm * norm)
        ranked.append((score, {"source": str(chunk.get("source", "private document"))[:200], "text": text[:4000]}))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [item for score, item in ranked[:limit] if score > 0]
