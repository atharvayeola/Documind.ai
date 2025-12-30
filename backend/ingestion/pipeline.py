"""
Document Processing Pipeline
Orchestrates the full ingestion flow: parse -> OCR (if needed) -> chunk -> embed -> store
"""
import asyncio
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from config import settings
from models import Document, DocumentChunk, DocumentStatus
from ingestion.parser import PDFParser
from ingestion.ocr import OCREngine
from ingestion.chunker import TextChunker
from ingestion.embedder import EmbeddingService


# Create separate engine for background tasks
bg_engine = create_async_engine(settings.database_url, echo=False)
bg_session = async_sessionmaker(bg_engine, class_=AsyncSession, expire_on_commit=False)


async def process_document(
    document_id: int, 
    local_path: Optional[str] = None, 
    storage_path: Optional[str] = None
) -> bool:
    """
    Main entry point for document processing.
    Called as a background task after upload.
    
    Args:
        document_id: ID of the document to process
        local_path: Local file path (used for processing)
        storage_path: Supabase storage path (for serving after processing)
        
    Returns:
        True if successful, False otherwise
    """
    async with bg_session() as db:
        try:
            # Get document
            result = await db.execute(
                select(Document).where(Document.id == document_id)
            )
            document = result.scalar_one_or_none()
            
            if not document:
                print(f"Document {document_id} not found")
                return False
            
            # Update status to processing
            document.status = DocumentStatus.PROCESSING
            await db.commit()
            
            # Initialize components
            parser = PDFParser(max_pages=settings.max_pages)
            ocr_engine = OCREngine()
            chunker = TextChunker()
            embedder = EmbeddingService()
            
            # Step 1: Parse PDF
            print(f"Parsing document {document_id}...")
            loop = asyncio.get_running_loop()
            try:
                parsed = await loop.run_in_executor(None, parser.parse, document.file_path)
            except ValueError as e:
                # Page limit exceeded
                document.status = DocumentStatus.FAILED
                await db.commit()
                print(f"Parse error: {e}")
                return False
            
            document.page_count = parsed.page_count
            
            # Step 2: Check if OCR is needed
            # Run needs_ocr in thread pool too
            needs_ocr = await loop.run_in_executor(None, parser.needs_ocr, document.file_path)
            if needs_ocr:
                print(f"Document {document_id} needs OCR, processing...")
                # Run OCR in thread pool
                parsed = await loop.run_in_executor(
                    None, 
                    _process_with_ocr,
                    document.file_path, 
                    parser, 
                    ocr_engine,
                    parsed.page_count
                )
            
            # Step 3: Chunk the document
            print(f"Chunking document {document_id}...")
            chunks = await loop.run_in_executor(None, chunker.chunk_document, parsed)
            print(f"Created {len(chunks)} chunks")
            
            # Step 4: Generate embeddings
            print(f"Generating embeddings for document {document_id}...")
            chunk_texts = [chunk.content for chunk in chunks]
            
            embeddings = [None] * len(chunks)  # Default to no embeddings
            if settings.openai_api_key:
                try:
                    embeddings = await embedder.embed_texts(chunk_texts)
                except Exception as embed_error:
                    print(f"Warning: Embedding failed (API key may be invalid): {embed_error}")
                    print("Continuing without embeddings - chat will not work but document will be viewable")
            else:
                print("Warning: No OpenAI API key, skipping embeddings")
            
            # Step 5: Store chunks with embeddings
            print(f"Storing chunks for document {document_id}...")
            for i, chunk in enumerate(chunks):
                db_chunk = DocumentChunk(
                    document_id=document_id,
                    content=chunk.content,
                    page_number=chunk.page_number,
                    chunk_index=chunk.chunk_index,
                    bbox={"coords": chunk.bbox} if chunk.bbox else None,
                    section_heading=chunk.section_heading,
                    embedding=embeddings[i] if embeddings[i] else None,
                )
                db.add(db_chunk)
            
            # Update document status
            document.status = DocumentStatus.READY
            document.processed_at = datetime.utcnow()
            
            # If we have a storage path, update file_path to use it and delete local file
            if storage_path and local_path:
                document.file_path = storage_path  # Use Supabase path for serving
                await db.commit()
                
                # Delete local file to save space
                import os
                if os.path.exists(local_path):
                    os.remove(local_path)
                    print(f"Cleaned up local file: {local_path}")
            else:
                await db.commit()
            
            print(f"Document {document_id} processed successfully")
            return True
            
        except Exception as e:
            print(f"Error processing document {document_id}: {e}")
            import traceback
            traceback.print_exc()
            
            # Update status to failed
            try:
                document.status = DocumentStatus.FAILED
                await db.commit()
            except:
                pass
            
            return False


def _process_with_ocr(
    file_path: str,
    parser: PDFParser,
    ocr_engine: OCREngine,
    page_count: int,
) -> "ParsedDocument":
    """
    Process a scanned PDF using OCR.
    """
    from ingestion.parser import ParsedDocument, PageContent
    
    pages = []
    
    for page_num in range(1, page_count + 1):
        # Render page to image
        img_bytes = parser.get_page_image(file_path, page_num, dpi=300)
        
        # OCR the image
        page_content = ocr_engine.process_to_page_content(
            img_bytes,
            page_num,
            612,  # Standard letter width
            792,  # Standard letter height
        )
        pages.append(page_content)
    
    return ParsedDocument(
        page_count=page_count,
        pages=pages,
        metadata={},
    )


# Sync wrapper for background tasks
def process_document_sync(document_id: int) -> bool:
    """Synchronous wrapper for use with background task runners"""
    return asyncio.run(process_document(document_id))
