"""
PDF Parser using PyMuPDF
Extracts text, structure, and coordinates from PDF documents
"""
import fitz  # PyMuPDF
from dataclasses import dataclass
from typing import List, Optional, Tuple
from config import settings


@dataclass
class TextBlock:
    """Represents a block of text from a PDF page"""
    text: str
    page_number: int
    bbox: Tuple[float, float, float, float]  # x0, y0, x1, y1
    block_type: str = "text"  # text, heading, table
    section_heading: Optional[str] = None


@dataclass
class PageContent:
    """Represents all content from a single PDF page"""
    page_number: int
    width: float
    height: float
    blocks: List[TextBlock]
    raw_text: str


@dataclass
class ParsedDocument:
    """Complete parsed PDF document"""
    page_count: int
    pages: List[PageContent]
    metadata: dict


class PDFParser:
    """
    Parses PDF documents to extract text and structure.
    """
    
    def __init__(self, max_pages: int = None):
        self.max_pages = max_pages or settings.max_pages
    
    def parse(self, file_path: str) -> ParsedDocument:
        """
        Parse a PDF file and extract all text content with coordinates.
        
        Args:
            file_path: Path to the PDF file
            
        Returns:
            ParsedDocument with pages, text blocks, and metadata
        """
        doc = fitz.open(file_path)
        
        # Check page limit
        if doc.page_count > self.max_pages:
            doc.close()
            raise ValueError(
                f"PDF has {doc.page_count} pages, exceeding maximum of {self.max_pages}"
            )
        
        pages = []
        
        for page_num in range(doc.page_count):
            page = doc[page_num]
            page_content = self._extract_page_content(page, page_num + 1)
            pages.append(page_content)
        
        # Extract document metadata
        metadata = {
            "title": doc.metadata.get("title", ""),
            "author": doc.metadata.get("author", ""),
            "subject": doc.metadata.get("subject", ""),
            "creator": doc.metadata.get("creator", ""),
            "producer": doc.metadata.get("producer", ""),
            "created": doc.metadata.get("creationDate", ""),
            "modified": doc.metadata.get("modDate", ""),
        }
        
        doc.close()
        
        return ParsedDocument(
            page_count=len(pages),
            pages=pages,
            metadata=metadata,
        )
    
    def _extract_page_content(self, page: fitz.Page, page_number: int) -> PageContent:
        """Extract all content from a single page"""
        blocks = []
        current_heading = None
        
        # Get text blocks with positions
        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        
        for block in text_dict.get("blocks", []):
            if block.get("type") == 0:  # Text block
                block_text = ""
                max_font_size = 0
                
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "")
                        font_size = span.get("size", 12)
                        block_text += text
                        max_font_size = max(max_font_size, font_size)
                    block_text += "\n"
                
                block_text = block_text.strip()
                if not block_text:
                    continue
                
                # Determine if this is a heading (larger font, short text)
                is_heading = max_font_size > 14 and len(block_text) < 200
                block_type = "heading" if is_heading else "text"
                
                if is_heading:
                    current_heading = block_text
                
                bbox = tuple(block.get("bbox", (0, 0, 0, 0)))
                
                text_block = TextBlock(
                    text=block_text,
                    page_number=page_number,
                    bbox=bbox,
                    block_type=block_type,
                    section_heading=current_heading,
                )
                blocks.append(text_block)
        
        # Get raw text for full-text search
        raw_text = page.get_text("text")
        
        return PageContent(
            page_number=page_number,
            width=page.rect.width,
            height=page.rect.height,
            blocks=blocks,
            raw_text=raw_text,
        )
    
    def needs_ocr(self, file_path: str) -> bool:
        """
        Check if a PDF needs OCR (scanned document with little/no text).
        
        Args:
            file_path: Path to the PDF file
            
        Returns:
            True if OCR is recommended
        """
        doc = fitz.open(file_path)
        
        total_text_length = 0
        sample_pages = min(5, doc.page_count)  # Check first 5 pages
        
        for i in range(sample_pages):
            text = doc[i].get_text("text").strip()
            total_text_length += len(text)
        
        doc.close()
        
        # If average text per page is very low, likely needs OCR
        avg_text_per_page = total_text_length / sample_pages if sample_pages > 0 else 0
        return avg_text_per_page < 100  # Less than 100 chars avg suggests scanned
    
    def get_page_image(self, file_path: str, page_number: int, dpi: int = 150) -> bytes:
        """
        Render a page as an image (for thumbnails or OCR).
        
        Args:
            file_path: Path to the PDF
            page_number: 1-indexed page number
            dpi: Resolution for rendering
            
        Returns:
            PNG image bytes
        """
        doc = fitz.open(file_path)
        page = doc[page_number - 1]
        
        # Calculate zoom for desired DPI
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        
        doc.close()
        return img_bytes
