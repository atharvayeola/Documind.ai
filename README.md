# Autophile - PDF Copilot for Professional Services

> Enable professionals to answer document-based client questions in minutes instead of hours, with trusted, auditable citations.

## Overview

Autophile is an AI-powered PDF assistant designed for insurance brokers, accountants, legal analysts, and other professionals who need to quickly extract information from large documents. It combines:

- **Intelligent Document Viewer**: Navigate large PDFs with thumbnails, zoom, and text selection.
- **AI Chat with Citations**: Ask natural language questions and receive accurate answers grounded in the document, complete with page and section references.
- **Annotation & Export**: Highlight, comment, and export summaries or clause extracts.

## Architecture

```
┌─────────────────┐     ┌─────────────────────────────────────────┐
│   Next.js       │     │            FastAPI Backend              │
│   Frontend      │────▶│  ┌─────────────┐  ┌─────────────────┐  │
│                 │     │  │ Document    │  │ Chat Orchestrator│  │
│  - PDF Viewer   │     │  │ Service     │  │ (RAG Engine)     │  │
│  - Chat Panel   │     │  └─────────────┘  └─────────────────┘  │
│  - Library      │     │         │                  │           │
└─────────────────┘     │         ▼                  ▼           │
                        │  ┌─────────────────────────────────┐   │
                        │  │  PostgreSQL + pgvector          │   │
                        │  │  (Metadata, Embeddings, Search) │   │
                        │  └─────────────────────────────────┘   │
                        └─────────────────────────────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 16, React, Tailwind CSS, pdf.js
- **Backend**: FastAPI, SQLAlchemy, PyMuPDF, OpenAI API
- **Database**: PostgreSQL with pgvector extension
- **Storage**: Local filesystem (dev) / S3-compatible (prod)

---

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Access the app at http://localhost:3000
```

### Option 2: Manual Setup

#### Prerequisites
- Python 3.9+
- Node.js 18+
- PostgreSQL 15+ with pgvector extension
- Tesseract OCR (for scanned PDFs)

#### 1. Start PostgreSQL with pgvector

```bash
# Using Docker
docker run -d \
  --name autophile-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autophile \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Initialize the database
docker exec -i autophile-db psql -U postgres -d autophile -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

#### 2. Backend Setup

```bash
cd backend

# Virtual environment is already created! Just activate it:
source venv/bin/activate

# Or create a new one if needed:
# python3 -m venv venv && source venv/bin/activate
# pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Run the backend
uvicorn main:app --reload --port 8000
```

#### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run the frontend
npm run dev
```

#### 4. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

---

## Configuration

### Backend Environment Variables

Create `backend/.env` from `backend/.env.example`:

```env
# Database
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/autophile

# OpenAI (required for chat)
OPENAI_API_KEY=sk-your-key-here

# Storage
UPLOAD_DIR=./storage/uploads
MAX_FILE_SIZE_MB=50
MAX_PAGES=100

# RAG Settings
CHUNK_SIZE=800
CHUNK_OVERLAP=200
TOP_K_RETRIEVAL=5

# App
DEBUG=true
```

### Frontend Environment Variables

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Project Structure

```
autophile/
├── backend/
│   ├── venv/              # Python virtual environment ✅
│   ├── api/               # FastAPI endpoints
│   ├── ingestion/         # PDF processing & RAG
│   ├── storage/           # Uploaded files
│   ├── main.py            # FastAPI app
│   ├── models.py          # SQLAlchemy models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/           # Next.js pages
│   │   ├── components/    # React components
│   │   ├── lib/           # API client
│   │   └── store/         # Zustand state
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## Limits

- Maximum PDF size: **100 pages**
- Supported formats: PDF (native and scanned with OCR)
- File size limit: 50MB

---

## Development

```bash
# Run backend with auto-reload
cd backend && source venv/bin/activate && uvicorn main:app --reload

# Run frontend with hot reload
cd frontend && npm run dev

# Build frontend for production
cd frontend && npm run build
```

---

## API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
