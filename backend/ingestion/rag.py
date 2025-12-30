"""
RAG Engine
Retrieval-Augmented Generation for document Q&A
"""
from typing import List, Tuple, Optional, AsyncGenerator
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from config import settings
from models import DocumentChunk
from ingestion.embedder import EmbeddingService


@dataclass
class Citation:
    """A citation reference to a document location"""
    page: int
    text: str
    chunk_id: int
    section: Optional[str] = None
    
    def model_dump(self):
        return {
            "page": self.page,
            "text": self.text,
            "chunk_id": self.chunk_id,
            "section": self.section,
        }


class RAGEngine:
    """
    RAG engine for document question answering.
    Combines retrieval from vector store with LLM generation.
    """
    
    def __init__(self):
        self.embedder = EmbeddingService()
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.chat_model
        self.top_k = settings.top_k_retrieval
    
    async def retrieve_chunks(
        self,
        document_id: int,
        query: str,
        db: AsyncSession,
        top_k: int = None,
    ) -> List[DocumentChunk]:
        """
        Retrieve the most relevant chunks for a query.
        
        Args:
            document_id: ID of document to search
            query: User's question
            db: Database session
            top_k: Number of chunks to retrieve
            
        Returns:
            List of relevant DocumentChunk objects
        """
        top_k = top_k or self.top_k
        
        # First check if document has embeddings
        check_result = await db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document_id)
            .where(DocumentChunk.embedding.isnot(None))
            .limit(1)
        )
        has_embeddings = check_result.scalar_one_or_none() is not None
        
        if has_embeddings:
            # Generate query embedding for vector search
            query_embedding = await self.embedder.embed_query(query)
            
            # Vector similarity search using pgvector
            # Embed all values directly to avoid asyncpg parameter issues
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
            sql = text(f"""
                SELECT id, content, page_number, chunk_index, bbox, section_heading,
                       1 - (embedding <=> '{embedding_str}'::vector) as similarity
                FROM document_chunks
                WHERE document_id = {document_id}
                AND embedding IS NOT NULL
                ORDER BY embedding <=> '{embedding_str}'::vector
                LIMIT {top_k}
            """)
            
            result = await db.execute(sql)
            rows = result.fetchall()
        else:
            # Fallback: return first chunks if no embeddings (keyword fallback)
            print(f"Warning: Document {document_id} has no embeddings, using fallback retrieval")
            result = await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id == document_id)
                .order_by(DocumentChunk.chunk_index)
                .limit(top_k)
            )
            chunks = list(result.scalars().all())
            return chunks
        
        # Convert to DocumentChunk objects
        chunks = []
        for row in rows:
            chunk = DocumentChunk(
                id=row.id,
                document_id=document_id,
                content=row.content,
                page_number=row.page_number,
                chunk_index=row.chunk_index,
                bbox=row.bbox,
                section_heading=row.section_heading,
            )
            chunks.append(chunk)
        
        return chunks
    
    def _build_prompt(
        self,
        query: str,
        chunks: List[DocumentChunk],
        history: List[Tuple[str, str]] = None,
    ) -> List[dict]:
        """
        Build the prompt for the LLM with retrieved context.
        """
        # System message with formatting instructions
        system_message = """You are Autophile, an intelligent document assistant. Your role is to provide clear, well-formatted answers about documents.

RESPONSE FORMAT:
- Use **bold** for key terms and emphasis
- Use bullet points or numbered lists for multiple items
- Use headers (## or ###) to organize longer responses
- Keep paragraphs short and scannable
- Include citations in the format [p. X] inline when referencing specific content

RULES:
1. Only answer based on the provided document context
2. If information is not found, clearly state "This information was not found in the document"
3. Be concise but comprehensive
4. For summaries, structure with clear sections
5. Quote key text in "quotes" when relevant"""

        # Format context from retrieved chunks
        context_parts = []
        for i, chunk in enumerate(chunks):
            section_info = f" ({chunk.section_heading})" if chunk.section_heading else ""
            context_parts.append(
                f"[Source {i+1} - Page {chunk.page_number}{section_info}]\n{chunk.content}"
            )
        
        context = "\n\n---\n\n".join(context_parts)
        
        messages = [{"role": "system", "content": system_message}]
        
        # Add conversation history
        if history:
            for role, content in history[-6:]:
                messages.append({"role": role, "content": content})
        
        # Add current query with context
        user_message = f"""Answer based on these document excerpts:

{context}

---

**Question:** {query}

Provide a clear, well-formatted response with page citations."""
        
        messages.append({"role": "user", "content": user_message})
        
        return messages
    
    def _extract_citations(
        self,
        response: str,
        chunks: List[DocumentChunk],
    ) -> List[Citation]:
        """
        Extract citations from the response and map to chunks.
        """
        citations = []
        seen_pages = set()
        
        # Include chunks that were likely used (referenced by page number in response)
        for chunk in chunks:
            page_ref = f"Page {chunk.page_number}"
            if page_ref in response and chunk.page_number not in seen_pages:
                citations.append(Citation(
                    page=chunk.page_number,
                    text=chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content,
                    chunk_id=chunk.id,
                    section=chunk.section_heading,
                ))
                seen_pages.add(chunk.page_number)
        
        # If no explicit citations found, include top chunks
        if not citations and chunks:
            for chunk in chunks[:3]:
                if chunk.page_number not in seen_pages:
                    citations.append(Citation(
                        page=chunk.page_number,
                        text=chunk.content[:200] + "..." if len(chunk.content) > 200 else chunk.content,
                        chunk_id=chunk.id,
                        section=chunk.section_heading,
                    ))
                    seen_pages.add(chunk.page_number)
        
        return citations
    
    async def generate_response(
        self,
        document_id: int,
        query: str,
        db: AsyncSession,
        history: List[Tuple[str, str]] = None,
    ) -> Tuple[str, List[Citation]]:
        """
        Generate a response to a question about a document.
        
        Args:
            document_id: ID of the document
            query: User's question
            db: Database session
            history: Conversation history
            
        Returns:
            Tuple of (response text, list of citations)
        """
        # Retrieve relevant chunks
        chunks = await self.retrieve_chunks(document_id, query, db)
        
        if not chunks:
            return (
                "I couldn't find any relevant information in the document for your question. "
                "Please try rephrasing or ask about something else.",
                []
            )
        
        # Build prompt
        messages = self._build_prompt(query, chunks, history)
        
        # Generate response
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.3,  # Lower temperature for factual responses
            max_tokens=1000,
        )
        
        content = response.choices[0].message.content
        
        # Extract citations
        citations = self._extract_citations(content, chunks)
        
        return content, citations
    
    async def stream_response(
        self,
        document_id: int,
        query: str,
        db: AsyncSession,
        history: List[Tuple[str, str]] = None,
    ) -> AsyncGenerator[dict, None]:
        """
        Stream a response for real-time display.
        
        Yields:
            Dict with 'type' and 'content' keys
            Types: 'thinking', 'citations', 'content', 'done'
        """
        # 1. Send "thinking" status - searching
        yield {
            "type": "thinking",
            "stage": "searching",
            "content": f"Searching document for relevant information..."
        }
        
        # Retrieve chunks first
        chunks = await self.retrieve_chunks(document_id, query, db)
        
        if not chunks:
            yield {
                "type": "thinking",
                "stage": "complete",
                "content": "No relevant sections found."
            }
            yield {
                "type": "content",
                "content": "I couldn't find any relevant information in the document.",
            }
            yield {
                "type": "citations",
                "citations": [],
            }
            return
        
        # 2. Send "thinking" status - found context
        thinking_context = []
        for i, chunk in enumerate(chunks[:5]):  # Show up to 5 chunks
            page_info = f"Page {chunk.page_number}" if chunk.page_number else "Unknown page"
            section_info = f" • {chunk.section_heading}" if chunk.section_heading else ""
            preview = chunk.content[:150] + "..." if len(chunk.content) > 150 else chunk.content
            thinking_context.append({
                "page": chunk.page_number,
                "section": chunk.section_heading,
                "preview": preview
            })
        
        yield {
            "type": "thinking",
            "stage": "reading",
            "content": f"Reading {len(chunks)} relevant sections...",
            "context": thinking_context
        }
        
        # 3. Send citations
        citations = [
            Citation(
                page=c.page_number,
                text=c.content[:150] + "..." if len(c.content) > 150 else c.content,
                chunk_id=c.id,
                section=c.section_heading,
            ).model_dump()
            for c in chunks[:3]
        ]
        yield {"type": "citations", "citations": citations}
        
        # 4. Send "thinking" status - generating
        yield {
            "type": "thinking",
            "stage": "generating",
            "content": "Generating response..."
        }
        
        # Build prompt and stream
        messages = self._build_prompt(query, chunks, history)
        
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.3,
            max_tokens=1000,
            stream=True,
        )
        
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield {
                    "type": "content",
                    "content": chunk.choices[0].delta.content,
                }
        
        yield {"type": "done"}
