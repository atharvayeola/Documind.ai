"""
Application configuration using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/autophile"
    
    # Storage
    upload_dir: str = "./storage/uploads"
    max_file_size_mb: int = 50
    max_pages: int = 100  # Maximum 100 pages per PDF
    
    # OpenAI
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"
    
    # RAG Settings
    chunk_size: int = 800
    chunk_overlap: int = 200
    top_k_retrieval: int = 5
    
    # App
    debug: bool = True
    
    # Auth
    secret_key: str = "changeme"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 43200
    google_client_id: str = ""
    
    # Supabase (for storage and future features)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
