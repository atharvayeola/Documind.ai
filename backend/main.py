"""
Autophile Backend - FastAPI Application
PDF Copilot for Professional Services
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api import documents, chat, auth, annotations
from database import engine, Base
from sqlalchemy import text


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migration: Increase annotations.color column size (safe to run multiple times)
        try:
            await conn.execute(text(
                "ALTER TABLE annotations ALTER COLUMN color TYPE VARCHAR(255)"
            ))
        except Exception:
            pass  # Column already correct size or table doesn't exist yet
    yield
    # Shutdown: Close connections
    await engine.dispose()


app = FastAPI(
    title="Autophile API",
    description="PDF Copilot for Professional Services",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,  # Prevent 307 redirects that strip auth headers
)

# CORS for frontend
import os
allowed_origins = [
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", ""),  # Set this in Railway
]
# Also allow any vercel.app subdomain
allowed_origins = [origin for origin in allowed_origins if origin]  # Remove empty

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # Allow all Vercel preview URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(annotations.router, prefix="/api/annotations", tags=["Annotations"])


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "autophile-backend"}
