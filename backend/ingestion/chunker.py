"""
Text Chunker for RAG
Splits document text into semantically meaningful chunks
"""
from dataclasses import dataclass
from typing import List, Optional, Tuple
import tiktoken

from config import settings
from ingestion.parser import ParsedDocument, TextBlock


@dataclass
class Chunk:
    """A text chunk ready for embedding"""
    content: str
    page_number: int
    chunk_index: int
    bbox: Optional[Tuple[float, float, float, float]]
    section_heading: Optional[str]
    token_count: int


class TextChunker:
    """
    Splits parsed document text into chunks optimized for RAG retrieval.
    Uses semantic boundaries (paragraphs, sections) when possible.
    """
    
    def __init__(
        self,
        chunk_size: int = None,
        chunk_overlap: int = None,
        model: str = "gpt-4",
    ):
        """
        Initialize chunker.
        
        Args:
            chunk_size: Target tokens per chunk
            chunk_overlap: Overlap tokens between chunks
            model: Model name for tokenizer
        """
        self.chunk_size = chunk_size or settings.chunk_size
        self.chunk_overlap = chunk_overlap or settings.chunk_overlap
        
        try:
            self.tokenizer = tiktoken.encoding_for_model(model)
        except KeyError:
            self.tokenizer = tiktoken.get_encoding("cl100k_base")
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        return len(self.tokenizer.encode(text))
    
    def chunk_document(self, document: ParsedDocument) -> List[Chunk]:
        """
        Chunk an entire parsed document.
        
        Args:
            document: ParsedDocument from parser
            
        Returns:
            List of Chunk objects
        """
        all_chunks = []
        
        for page in document.pages:
            page_chunks = self._chunk_page(page.blocks, page.page_number)
            all_chunks.extend(page_chunks)
        
        # Re-index chunks
        for i, chunk in enumerate(all_chunks):
            chunk.chunk_index = i
        
        return all_chunks
    
    def _chunk_page(self, blocks: List[TextBlock], page_number: int) -> List[Chunk]:
        """
        Chunk a single page's content.
        
        Strategy:
        1. Try to keep paragraphs/headings together
        2. Split large blocks at sentence boundaries
        3. Merge small adjacent blocks
        """
        chunks = []
        current_text = ""
        current_heading = None
        current_bbox = None
        
        for block in blocks:
            block_tokens = self.count_tokens(block.text)
            current_tokens = self.count_tokens(current_text)
            
            # Track current section heading
            if block.block_type == "heading":
                current_heading = block.text
            
            # If block alone exceeds chunk size, split it
            if block_tokens > self.chunk_size:
                # First, flush current buffer
                if current_text:
                    chunks.append(Chunk(
                        content=current_text.strip(),
                        page_number=page_number,
                        chunk_index=len(chunks),
                        bbox=current_bbox,
                        section_heading=current_heading,
                        token_count=current_tokens,
                    ))
                    current_text = ""
                    current_bbox = None
                
                # Split large block
                split_chunks = self._split_large_text(
                    block.text,
                    page_number,
                    block.bbox,
                    current_heading,
                )
                chunks.extend(split_chunks)
                continue
            
            # Would adding this block exceed limit?
            if current_tokens + block_tokens > self.chunk_size:
                # Save current chunk
                if current_text:
                    chunks.append(Chunk(
                        content=current_text.strip(),
                        page_number=page_number,
                        chunk_index=len(chunks),
                        bbox=current_bbox,
                        section_heading=current_heading,
                        token_count=current_tokens,
                    ))
                
                # Start new chunk with overlap
                overlap_text = self._get_overlap_text(current_text)
                current_text = overlap_text + "\n\n" + block.text if overlap_text else block.text
                current_bbox = block.bbox
            else:
                # Add to current chunk
                if current_text:
                    current_text += "\n\n" + block.text
                else:
                    current_text = block.text
                    current_bbox = block.bbox
        
        # Flush remaining text
        if current_text.strip():
            chunks.append(Chunk(
                content=current_text.strip(),
                page_number=page_number,
                chunk_index=len(chunks),
                bbox=current_bbox,
                section_heading=current_heading,
                token_count=self.count_tokens(current_text),
            ))
        
        return chunks
    
    def _split_large_text(
        self,
        text: str,
        page_number: int,
        bbox: Tuple[float, float, float, float],
        section_heading: Optional[str],
    ) -> List[Chunk]:
        """Split a large text block into smaller chunks at sentence boundaries"""
        chunks = []
        sentences = self._split_sentences(text)
        
        current_text = ""
        current_tokens = 0
        
        for sentence in sentences:
            sentence_tokens = self.count_tokens(sentence)
            
            if current_tokens + sentence_tokens > self.chunk_size:
                if current_text:
                    chunks.append(Chunk(
                        content=current_text.strip(),
                        page_number=page_number,
                        chunk_index=len(chunks),
                        bbox=bbox,
                        section_heading=section_heading,
                        token_count=current_tokens,
                    ))
                
                overlap_text = self._get_overlap_text(current_text)
                current_text = overlap_text + " " + sentence if overlap_text else sentence
                current_tokens = self.count_tokens(current_text)
            else:
                current_text += " " + sentence if current_text else sentence
                current_tokens += sentence_tokens
        
        if current_text.strip():
            chunks.append(Chunk(
                content=current_text.strip(),
                page_number=page_number,
                chunk_index=len(chunks),
                bbox=bbox,
                section_heading=section_heading,
                token_count=current_tokens,
            ))
        
        return chunks
    
    def _split_sentences(self, text: str) -> List[str]:
        """Simple sentence splitting"""
        import re
        # Split on sentence-ending punctuation followed by space
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in sentences if s.strip()]
    
    def _get_overlap_text(self, text: str) -> str:
        """Get the last N tokens worth of text for overlap"""
        if not text or self.chunk_overlap == 0:
            return ""
        
        tokens = self.tokenizer.encode(text)
        if len(tokens) <= self.chunk_overlap:
            return text
        
        overlap_tokens = tokens[-self.chunk_overlap:]
        return self.tokenizer.decode(overlap_tokens)
