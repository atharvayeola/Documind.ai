"""
Chat API endpoints
RAG-powered chat with PDF documents
"""
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_db
from models import Document, DocumentStatus, ChatSession, ChatMessage
from ingestion.rag import RAGEngine

router = APIRouter()
rag_engine = RAGEngine()


# ==================== Schemas ====================

class Citation(BaseModel):
    page: int
    text: str
    chunk_id: int
    section: Optional[str] = None


class ChatRequest(BaseModel):
    document_id: int
    message: str
    session_id: Optional[int] = None


class ChatResponse(BaseModel):
    session_id: int
    message_id: int
    content: str
    citations: List[Citation]


class ChatMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    citations: Optional[List[Citation]]
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    session_id: int
    document_id: int
    messages: List[ChatMessageResponse]


# ==================== Endpoints ====================

@router.post("/", response_model=ChatResponse)
async def chat_with_document(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Send a message to chat with a document.
    Uses RAG to retrieve relevant chunks and generate a grounded response.
    """
    # Verify document exists and is ready
    result = await db.execute(
        select(Document).where(Document.id == request.document_id)
    )
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if document.status != DocumentStatus.READY:
        raise HTTPException(
            status_code=400, 
            detail=f"Document is not ready for chat. Status: {document.status.value}"
        )
    
    # Get or create chat session
    if request.session_id:
        session_result = await db.execute(
            select(ChatSession).where(ChatSession.id == request.session_id)
        )
        session = session_result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=404, detail="Chat session not found")
    else:
        session = ChatSession(
            document_id=request.document_id,
            user_id=1,  # Placeholder - get from auth
            title=request.message[:50] + "..." if len(request.message) > 50 else request.message,
        )
        db.add(session)
        await db.flush()
        await db.refresh(session)
    
    # Save user message
    user_message = ChatMessage(
        session_id=session.id,
        role="user",
        content=request.message,
    )
    db.add(user_message)
    
    # Get chat history for context
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history = list(reversed(history_result.scalars().all()))
    
    # Generate response using RAG
    response_content, citations = await rag_engine.generate_response(
        document_id=request.document_id,
        query=request.message,
        history=[(msg.role, msg.content) for msg in history],
        db=db,
    )
    
    # Save assistant message
    assistant_message = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=response_content,
        citations=[c.model_dump() for c in citations] if citations else None,
    )
    db.add(assistant_message)
    await db.flush()
    await db.refresh(assistant_message)
    
    return ChatResponse(
        session_id=session.id,
        message_id=assistant_message.id,
        content=response_content,
        citations=[Citation(**c.model_dump()) for c in citations] if citations else [],
    )


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Stream a chat response for real-time display.
    """
    # Verify document exists and is ready
    result = await db.execute(
        select(Document).where(Document.id == request.document_id)
    )
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if document.status != DocumentStatus.READY:
        raise HTTPException(
            status_code=400, 
            detail=f"Document is not ready for chat. Status: {document.status.value}"
        )
    
    # Create a wrapper for the generator that handles persistence
    async def generate_and_persist():
        try:
            # 1. Get or create session
            session = None
            if request.session_id:
                result = await db.execute(select(ChatSession).where(ChatSession.id == request.session_id))
                session = result.scalar_one_or_none()
            
            if not session:
                title = request.message[:50] + "..." if len(request.message) > 50 else request.message
                session = ChatSession(
                    document_id=request.document_id,
                    user_id=1,  # Placeholder
                    title=title
                )
                db.add(session)
                await db.commit()
                await db.refresh(session)
            
            # 2. Save User Message
            user_msg = ChatMessage(
                session_id=session.id,
                role="user",
                content=request.message
            )
            db.add(user_msg)
            await db.commit()
            
            # 3. Stream and accumulate response
            full_content = ""
            citations = []
            
            # Need to get history for RAG context
            history_result = await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .where(ChatMessage.id != user_msg.id) # Exclude current message
                .order_by(ChatMessage.created_at.desc())
                .limit(6)
            )
            history_msgs = list(reversed(history_result.scalars().all()))
            history = [(m.role, m.content) for m in history_msgs]

            async for chunk in rag_engine.stream_response(
                document_id=request.document_id,
                query=request.message,
                history=history,
                db=db,
            ):
                if chunk.get("type") == "content":
                    full_content += chunk.get("content", "")
                elif chunk.get("type") == "citations":
                    citations = chunk.get("citations", [])
                
                yield f"data: {json.dumps(chunk)}\n\n"
            
            # 4. Save Assistant Message
            assistant_msg = ChatMessage(
                session_id=session.id,
                role="assistant",
                content=full_content,
                citations=citations if citations else None
            )
            db.add(assistant_msg)
            await db.commit()
            
            yield "data: [DONE]\n\n"
            
        except Exception as e:
            print(f"Streaming error: {e}")
            error_msg = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_msg)}\n\n"
            yield "data: [DONE]\n\n"
    
    return StreamingResponse(generate_and_persist(), media_type="text/event-stream")


@router.get("/sessions/{document_id}")
async def list_chat_sessions(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    List all chat sessions for a document.
    """
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.document_id == document_id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = result.scalars().all()
    
    return [
        {
            "id": s.id,
            "title": s.title,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@router.get("/history/{session_id}", response_model=ChatHistoryResponse)
async def get_chat_history(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get full chat history for a session.
    """
    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    
    messages_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
    )
    messages = messages_result.scalars().all()
    
    return ChatHistoryResponse(
        session_id=session.id,
        document_id=session.document_id,
        messages=[
            ChatMessageResponse(
                id=msg.id,
                role=msg.role,
                content=msg.content,
                citations=[Citation(**c) for c in msg.citations] if msg.citations else None,
                created_at=msg.created_at,
            )
            for msg in messages
        ],
    )


@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session."""
    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    
    await db.delete(session)
    await db.commit()
    return {"message": "Session deleted"}
