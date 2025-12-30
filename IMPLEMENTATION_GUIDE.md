# Autophile - Implementation Guide

This document outlines the step-by-step implementation plan for the Autophile PDF Copilot.

---

## Phase 1: Foundation & Setup ✅

### 1.1 Project Structure
```
autophile/
├── backend/               # FastAPI backend
│   ├── api/               # API endpoints
│   │   ├── documents.py   # Upload, list, delete
│   │   └── chat.py        # RAG chat endpoints
│   ├── ingestion/         # Document processing
│   │   ├── parser.py      # PDF text extraction
│   │   ├── ocr.py         # Scanned PDF OCR
│   │   ├── chunker.py     # Text chunking for RAG
│   │   ├── embedder.py    # OpenAI embeddings
│   │   ├── pipeline.py    # Full processing pipeline
│   │   └── rag.py         # RAG retrieval engine
│   ├── main.py            # FastAPI app
│   ├── models.py          # SQLAlchemy models
│   ├── database.py        # DB configuration
│   ├── config.py          # App settings
│   └── requirements.txt
├── frontend/              # Next.js frontend
│   └── src/
│       ├── app/           # Next.js app router
│       ├── components/    # React components
│       │   ├── pdf-viewer/
│       │   ├── chat/
│       │   └── layout/
│       ├── lib/           # API client
│       └── store/         # Zustand state
├── docker-compose.yml     # Local development
└── README.md
```

### 1.2 Quick Start

**Option A: Docker (Recommended)**
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

**Option B: Manual Setup**
```bash
# 1. Start PostgreSQL with pgvector
docker run -d \
  --name autophile-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autophile \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# 2. Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Edit with your OpenAI API key
uvicorn main:app --reload

# 3. Frontend
cd frontend
npm install
npm run dev
```

---

## Phase 2: Document Ingestion ✅

### 2.1 Upload Flow
1. User uploads PDF via drag-and-drop or button
2. Backend validates file (type, size, page count ≤100)
3. File saved to storage, database record created with `UPLOADED` status
4. Background task triggered for processing

### 2.2 Processing Pipeline
1. **Parse PDF** (`parser.py`)
   - Extract text with positions using PyMuPDF
   - Detect headings, paragraphs, tables
   
2. **OCR if needed** (`ocr.py`)
   - Check if PDF is scanned (low text content)
   - Apply Tesseract OCR to page images
   
3. **Chunk text** (`chunker.py`)
   - Split into ~800 token chunks with 200 token overlap
   - Preserve paragraph/section boundaries
   
4. **Generate embeddings** (`embedder.py`)
   - Call OpenAI text-embedding-3-small
   - Batch process for efficiency
   
5. **Store in database**
   - Save chunks with embeddings to pgvector
   - Update document status to `READY`

---

## Phase 3: PDF Viewer ✅

### 3.1 Features
- Page thumbnails in sidebar
- Zoom controls (50% - 300%)
- Page navigation (prev/next, jump to page)
- Text selection support
- Citation highlighting when clicked from chat

### 3.2 Component Structure
```
PDFViewer
├── Thumbnails sidebar (collapsible)
├── Toolbar (zoom, pagination)
└── Main canvas (react-pdf)
```

---

## Phase 4: AI Chat with RAG ✅

### 4.1 RAG Flow
1. User sends question
2. Generate query embedding
3. Vector search for top-K relevant chunks
4. Build prompt with context + system instructions
5. Stream LLM response
6. Extract and map citations to pages

### 4.2 Prompt Strategy
```
System: You are a document assistant. Only answer from provided context.
Always cite with [Page X] references. Quote relevant text.

Context: [Retrieved chunks with page numbers]

User: [Question]
```

### 4.3 Citation Mapping
- Track which chunks are referenced in response
- Return page numbers, text snippets, and chunk IDs
- Frontend highlights and navigates to cited pages

---

## Phase 5: Remaining Features (TODO)

### 5.1 Annotations
- [ ] Highlight text in PDF viewer
- [ ] Add margin comments/notes
- [ ] Store annotations per user
- [ ] Share annotations with workspace

### 5.2 Search
- [ ] Global search across all documents
- [ ] In-document keyword search (Ctrl+F)
- [ ] Hybrid search (keyword + semantic)

### 5.3 Export
- [ ] Export chat answers as Markdown
- [ ] Export document summary
- [ ] Export extracted clauses as CSV

### 5.4 Workspace & Auth
- [ ] User authentication (OAuth/SSO)
- [ ] Workspace management
- [ ] Role-based access control
- [ ] Activity logging

---

## API Reference

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload PDF |
| GET | `/api/documents/` | List documents |
| GET | `/api/documents/{id}` | Get document |
| DELETE | `/api/documents/{id}` | Delete document |
| GET | `/api/documents/{id}/pdf` | Stream PDF file |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/` | Send message (sync) |
| POST | `/api/chat/stream` | Send message (streaming) |
| GET | `/api/chat/sessions/{doc_id}` | List chat sessions |
| GET | `/api/chat/history/{session_id}` | Get chat history |

---

## Configuration

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://...` | PostgreSQL connection |
| `OPENAI_API_KEY` | (required) | OpenAI API key |
| `MAX_PAGES` | `100` | Maximum PDF pages |
| `CHUNK_SIZE` | `800` | Tokens per chunk |
| `TOP_K_RETRIEVAL` | `5` | Chunks retrieved per query |

### Frontend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend URL |

---

## Architecture Decisions

### Why pgvector over Pinecone/Weaviate?
- Simpler deployment (single database)
- No additional service to manage
- Sufficient for MVP scale
- Easy migration path to dedicated vector DB later

### Why PyMuPDF for PDF parsing?
- Fast and lightweight
- Extracts text with positions (for citations)
- Built-in rendering for thumbnails
- Active maintenance

### Why OpenAI over local LLMs?
- Better quality for professional use cases
- Consistent latency
- Easy to switch models via config
- Can add local LLM option later

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Upload to Ready | ≤90 seconds for 100-page PDF |
| Chat response | ≤5 seconds |
| PDF page load | ≤1 second |
| Ingestion throughput | 10 docs/min (100 pages each) |

---

## Security Considerations

- All file uploads scanned for malicious content
- PDF rendering sandboxed in browser
- API rate limiting per user
- Document access scoped by workspace
- Encryption at rest and in transit
