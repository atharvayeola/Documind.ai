"""
Document API endpoints
Handles upload, list, and management of PDF documents
"""
import os
import uuid
import aiofiles
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func
from pydantic import BaseModel

from database import get_db
from models import Document, DocumentStatus, User
from config import settings
from ingestion.pipeline import process_document
from ingestion.storage import storage_client
from api.dependencies import get_current_user_optional, get_current_user

router = APIRouter()


# ==================== Schemas ====================

class DocumentResponse(BaseModel):
    id: int
    filename: str
    original_filename: str
    file_size: int
    page_count: Optional[int]
    status: str
    tags: Optional[dict]
    created_at: datetime
    processed_at: Optional[datetime]

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int


# ==================== Endpoints ====================

@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """
    Upload a PDF document for processing.
    Maximum 100 pages supported.
    Deduplicates by content hash - returns existing doc if same file was already uploaded.
    """
    import hashlib
    
    # Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    # Validate file size
    contents = await file.read()
    file_size = len(contents)
    if file_size > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=400, 
            detail=f"File size exceeds maximum of {settings.max_file_size_mb}MB"
        )
    
    # Calculate content hash for deduplication
    content_hash = hashlib.sha256(contents).hexdigest()
    print(f"Receiving file upload: {file.filename}, size: {file_size}, hash: {content_hash[:16]}...")
    
    # Check if this file was already uploaded by this user
    if current_user:
        existing_doc = await db.execute(
            select(Document).where(
                and_(
                    Document.content_hash == content_hash,
                    Document.owner_id == current_user.id
                )
            )
        )
        existing = existing_doc.scalar_one_or_none()
        if existing:
            print(f"Duplicate found! Returning existing document ID: {existing.id}")
            return DocumentResponse(
                id=existing.id,
                filename=existing.filename,
                original_filename=existing.original_filename,
                file_size=existing.file_size,
                page_count=existing.page_count,
                status=existing.status.value if isinstance(existing.status, DocumentStatus) else existing.status,
                tags=existing.tags,
                created_at=existing.created_at,
                processed_at=existing.processed_at,
            )
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    filename = f"{file_id}.pdf"
    file_path = os.path.join(settings.upload_dir, filename)
    storage_path = None
    
    # Try uploading to Supabase Storage first
    if storage_client.is_available:
        storage_path = await storage_client.upload_file(
            file_content=contents,
            filename=filename,
            owner_id=current_user.id if current_user else None,
            content_type="application/pdf"
        )
        if storage_path:
            print(f"✅ File uploaded to Supabase Storage: {storage_path}")
    
    # Also save locally as fallback for processing
    os.makedirs(settings.upload_dir, exist_ok=True)
    print(f"Saving file to {file_path}")
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)
    print("File saved successfully")
    
    # Create database record
    print("Creating database record")
    
    document = Document(
        filename=filename,
        original_filename=file.filename,
        file_path=file_path,  # Always use local path for processing
        file_size=file_size,
        content_hash=content_hash,
        status=DocumentStatus.UPLOADED,
        owner_id=current_user.id if current_user else None,
        workspace_id=current_user.workspace_id if current_user else 1, # Default workspace
    )
    db.add(document)
    await db.flush()
    await db.refresh(document)
    await db.commit()  # Commit before background task runs
    print(f"Document record created with ID: {document.id}")
    
    # Trigger background processing - pass storage_path for later cleanup
    background_tasks.add_task(
        process_document, 
        document.id, 
        local_path=file_path, 
        storage_path=storage_path
    )
    
    return DocumentResponse(
        id=document.id,
        filename=document.filename,
        original_filename=document.original_filename,
        file_size=document.file_size,
        page_count=document.page_count,
        status=document.status.value if isinstance(document.status, DocumentStatus) else document.status,
        tags=document.tags,
        created_at=document.created_at,
        processed_at=document.processed_at,
    )


class ClaimRequest(BaseModel):
    document_ids: List[int]


@router.post("/claim")
async def claim_documents(
    claim: ClaimRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Claim anonymous documents after login.
    """
    if not claim.document_ids:
        return {"message": "No documents to claim", "claimed": 0}

    result = await db.execute(
        select(Document).where(
            and_(Document.id.in_(claim.document_ids), Document.owner_id.is_(None))
        )
    )
    docs = result.scalars().all()
    
    for doc in docs:
        doc.owner_id = current_user.id
        doc.workspace_id = current_user.workspace_id
    
    await db.commit()
    return {"message": f"Claimed {len(docs)} documents", "claimed": len(docs)}


@router.get("/", response_model=DocumentListResponse)
@router.get("", response_model=DocumentListResponse)  # Also match without trailing slash
async def list_documents(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    ids: Optional[List[int]] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """
    List documents. 
    If logged in, returns user's documents.
    If 'ids' provided, also includes those specific documents if they are anonymous.
    """
    base_query = select(Document)
    
    # Apply ownership and ID filtering
    if current_user:
        if ids:
            # Logged in, with specific IDs:
            # Show my documents OR (specific IDs that are anonymous)
            base_query = base_query.where(
                or_(
                    Document.owner_id == current_user.id,
                    and_(Document.id.in_(ids), Document.owner_id.is_(None))
                )
            )
        else:
            # Logged in, no specific IDs: Show only my documents
            base_query = base_query.where(Document.owner_id == current_user.id)
    else:
        # Not logged in (anonymous user)
        if ids:
            # Anonymous, with specific IDs: Show only those specific IDs if they are anonymous
            base_query = base_query.where(
                and_(Document.id.in_(ids), Document.owner_id.is_(None))
            )
        else:
            # Anonymous, no specific IDs: Return empty list
            return DocumentListResponse(documents=[], total=0)

    # Apply search filter
    if search:
        base_query = base_query.where(Document.original_filename.ilike(f"%{search}%"))
    
    # Get total count before applying limit and offset
    count_query = select(func.count(Document.id)).select_from(Document)
    
    # Apply same filters to count query
    if current_user:
        if ids:
            count_query = count_query.where(
                or_(
                    Document.owner_id == current_user.id,
                    and_(Document.id.in_(ids), Document.owner_id.is_(None))
                )
            )
        else:
            count_query = count_query.where(Document.owner_id == current_user.id)
    else:
        if ids:
            count_query = count_query.where(
                and_(Document.id.in_(ids), Document.owner_id.is_(None))
            )
    
    if search:
        count_query = count_query.where(Document.original_filename.ilike(f"%{search}%"))
    
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Apply ordering, limit, and offset for the actual document retrieval
    query = base_query.order_by(Document.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    documents = result.scalars().all()
    
    return DocumentListResponse(
        documents=[
            DocumentResponse(
                id=doc.id,
                filename=doc.filename,
                original_filename=doc.original_filename,
                file_size=doc.file_size,
                page_count=doc.page_count,
                status=doc.status.value if isinstance(doc.status, DocumentStatus) else doc.status,
                tags=doc.tags,
                created_at=doc.created_at,
                processed_at=doc.processed_at,
            )
            for doc in documents
        ],
        total=total,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific document by ID.
    """
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return DocumentResponse(
        id=document.id,
        filename=document.filename,
        original_filename=document.original_filename,
        file_size=document.file_size,
        page_count=document.page_count,
        status=document.status.value if isinstance(document.status, DocumentStatus) else document.status,
        tags=document.tags,
        created_at=document.created_at,
        processed_at=document.processed_at,
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a document and all associated data.
    """
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete file from storage
    if os.path.exists(document.file_path):
        os.remove(document.file_path)
    
    # Delete from database (cascades to chunks, annotations, etc.)
    await db.delete(document)
    
    return {"message": "Document deleted successfully"}


@router.get("/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the PDF file for viewing.
    Returns local file or redirects to Supabase signed URL.
    """
    from fastapi.responses import FileResponse, RedirectResponse
    
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Check if file is stored in Supabase Storage (path starts with user_ or anonymous/)
    if document.file_path and (document.file_path.startswith("user_") or document.file_path.startswith("anonymous/")):
        # Get signed URL from Supabase
        signed_url = storage_client.get_signed_url(document.file_path, expires_in=3600)
        if signed_url:
            return RedirectResponse(url=signed_url, status_code=302)
        # Fallback: try to download and serve
        content = await storage_client.download_file(document.file_path)
        if content:
            from fastapi.responses import Response
            return Response(content=content, media_type="application/pdf")
    
    # Local file fallback
    local_path = os.path.join(settings.upload_dir, document.filename)
    if os.path.exists(local_path):
        return FileResponse(
            local_path,
            media_type="application/pdf",
            filename=document.original_filename,
        )
    
    if os.path.exists(document.file_path):
        return FileResponse(
            document.file_path,
            media_type="application/pdf",
            filename=document.original_filename,
        )
    
    raise HTTPException(status_code=404, detail="PDF file not found")


@router.get("/{document_id}/search")
async def search_document(
    document_id: int,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Search within a document's content.
    Returns pages containing the search query.
    """
    from models import DocumentChunk
    from sqlalchemy import func
    
    # Verify document exists
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Search in chunks
    search_query = select(
        DocumentChunk.page_number,
        func.count(DocumentChunk.id).label('count')
    ).where(
        DocumentChunk.document_id == document_id,
        DocumentChunk.content.ilike(f"%{q}%")
    ).group_by(
        DocumentChunk.page_number
    ).order_by(
        DocumentChunk.page_number
    )
    
    result = await db.execute(search_query)
    matches = result.fetchall()
    
    return {
        "query": q,
        "document_id": document_id,
        "results": [
            {"page": row.page_number, "count": row.count}
            for row in matches
        ],
        "total_pages": len(matches),
    }
