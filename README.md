# InkForge

InkForge turns a topic into a structured technical blog draft. A LangGraph workflow plans the article, optionally gathers recent evidence with Tavily, writes sections in parallel, and returns a Markdown draft that can be downloaded from the web interface.

The frontend follows the dark, editorial visual language of [Darsh's portfolio](https://darshk18.github.io/): near-black surfaces, fine borders, a subtle dot field, compact mono labels, and soft pink highlights.

## Features

- Responsive writing studio with topic prompts and Markdown download.
- FastAPI backend that runs the existing LangGraph writing workflow.
- Gemini-based topic routing, planning, and parallel section writing.
- Optional Tavily search for topics that need current evidence.
- Sources returned alongside the article; generated image ideas are represented as notes in the Markdown draft.
- Single-project Vercel deployment for the frontend and Python API.
- Local development and dependency management with `uv`.

## Project structure

```text
.
├── backend/
│   ├── main.py             # FastAPI routes and static frontend serving
│   └── workflow.py         # LangGraph writing workflow
├── frontend/
│   ├── index.html          # Writing studio page
│   ├── styles.css          # Portfolio-inspired responsive design
│   └── app.js              # API requests, draft preview, and download
├── index.py                # Vercel Python entry point
├── vercel.json             # Vercel routing and function settings
├── pyproject.toml          # uv project dependencies
├── uv.lock                 # Locked dependency versions for deployment
├── .python-version         # Python runtime selection
├── .env.example            # Safe local environment template
└── README.md
```

The notebooks, notebook-only dependencies, and previous Streamlit interface were removed from the deployable project. The web app returns its result directly and does not depend on a writable deployment filesystem.

## Run locally

Use the existing `.venv` or let `uv` create/synchronize the project environment:

```powershell
uv sync
```

Create a local `.env` file from the example and add your keys:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

```dotenv
GOOGLE_API_KEY=your_google_ai_api_key
TAVILY_API_KEY=your_tavily_api_key
```

Start the web app:

```powershell
uv run uvicorn index:app --reload
```

Open <http://127.0.0.1:8000>. The API health check is <http://127.0.0.1:8000/api/health> and the interactive API documentation is <http://127.0.0.1:8000/docs>.

`GOOGLE_API_KEY` is required to generate a draft. `TAVILY_API_KEY` is optional; without it, the workflow can still plan and write but cannot retrieve current web evidence.

## Deploy to Vercel

1. Push the repository to GitHub and import it as a Vercel project. Keep the project root set to the repository root.
2. In **Project Settings → Environment Variables**, add `GOOGLE_API_KEY`. Add `TAVILY_API_KEY` if you want the research step enabled.
3. Select the desired environments and deploy. Vercel serves the frontend and API from the same project URL.

Do not put real keys in source files, `vercel.json`, or `.env.example`. `.env`, `.env.*` (except `.env.example`), and `.vercel/` are excluded by `.gitignore`. Set production keys in Vercel's environment settings; redeploy after changing a value.

The generation endpoint is public, and each request can use your model/search provider quota. Check provider billing and usage limits before sharing the deployment widely. A Vercel function has ephemeral storage, so drafts are delivered to the browser for download rather than saved on the server.

## API

### `GET /api/health`

Returns service status.

### `POST /api/generate`

Request body:

```json
{
  "topic": "How retrieval-augmented generation keeps AI answers grounded"
}
```

Optional `as_of` accepts an ISO date (`YYYY-MM-DD`). The response contains the article title, Markdown, writing mode, and research evidence.

## Security and configuration

- Keep production API keys in Vercel environment settings and local keys in `.env`.
- `.env.example` contains variable names and placeholders only.
- The frontend never receives provider keys; it calls the same-origin `/api/generate` endpoint.
- The API validates topic length and returns generic errors rather than provider exception details.

## License

No license file is included. Add a license before redistributing the project if you want to grant reuse rights.
