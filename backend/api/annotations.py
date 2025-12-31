"""
Annotation API endpoints
Handles creation, retrieval, and deletion of document annotations
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from datetime import datetime

from database import get_db
from models import Annotation, Document, User
from api.dependencies import get_current_user

router = APIRouter()


# ==================== Schemas ====================

class AnnotationCreate(BaseModel):
    document_id: int
    annotation_type: str  # highlight, note, text
    page_number: int
    bbox: dict
    selected_text: Optional[str] = None
    note: Optional[str] = None
    color: str = "#FFEB3B"
    is_shared: bool = False


class AnnotationUpdate(BaseModel):
    page_number: Optional[int] = None
    bbox: Optional[dict] = None
    selected_text: Optional[str] = None
    note: Optional[str] = None
    color: Optional[str] = None
    is_shared: Optional[bool] = None


class AnnotationResponse(AnnotationCreate):
    id: int
    user_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# ==================== Endpoints ====================

@router.post("/", response_model=AnnotationResponse)
async def create_annotation(
    annotation: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new annotation for a document.
    """
    # Verify document access
    result = await db.execute(select(Document).where(Document.id == annotation.document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Check if user has access (owner or workspace member)
    # Simple check: if doc has owner, must be that owner (or shared workspace logic later)
    if document.owner_id is not None and document.owner_id != current_user.id:
         raise HTTPException(status_code=403, detail="Not authorized to annotate this document")

    new_annotation = Annotation(
        document_id=annotation.document_id,
        user_id=current_user.id,
        annotation_type=annotation.annotation_type,
        page_number=annotation.page_number,
        bbox=annotation.bbox,
        selected_text=annotation.selected_text,
        note=annotation.note,
        color=annotation.color,
        is_shared=annotation.is_shared
    )
    
    db.add(new_annotation)
    await db.commit()
    await db.refresh(new_annotation)
    
    return new_annotation


@router.get("/{document_id}", response_model=List[AnnotationResponse])
async def list_annotations(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    List all annotations for a document.
    """
    # Verify document access
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if document.owner_id is not None and document.owner_id != current_user.id:
         raise HTTPException(status_code=403, detail="Not authorized to view annotations")

    # Fetch annotations
    result = await db.execute(
        select(Annotation)
        .where(Annotation.document_id == document_id)
        .order_by(Annotation.created_at)
    )
    annotations = result.scalars().all()
    
    return annotations


@router.put("/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: int,
    update_data: AnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update an annotation.
    """
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
        
    if annotation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this annotation")
        
    # Update fields
    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(annotation, field, value)
        
    await db.commit()
    await db.refresh(annotation)
    
    return annotation


@router.delete("/{annotation_id}")
async def delete_annotation(
    annotation_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete an annotation. Only the creator can delete it.
    """
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
        
    if annotation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this annotation")
        
    await db.delete(annotation)
    await db.commit()
    
    return {"message": "Annotation deleted"}
