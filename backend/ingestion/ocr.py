"""
OCR Engine for scanned PDFs
Uses Tesseract for text extraction from images
"""
import io
from typing import List, Optional
from PIL import Image
import pytesseract
from dataclasses import dataclass

from ingestion.parser import TextBlock, PageContent


@dataclass
class OCRResult:
    """Result from OCR processing"""
    text: str
    confidence: float
    bbox: tuple


class OCREngine:
    """
    OCR engine for extracting text from scanned PDF pages.
    """
    
    def __init__(self, language: str = "eng"):
        """
        Initialize OCR engine.
        
        Args:
            language: Tesseract language code (default: English)
        """
        self.language = language
    
    def process_image(self, image_bytes: bytes) -> List[OCRResult]:
        """
        Process an image and extract text with positions.
        
        Args:
            image_bytes: PNG image bytes
            
        Returns:
            List of OCR results with text and bounding boxes
        """
        image = Image.open(io.BytesIO(image_bytes))
        
        # Get detailed OCR data
        data = pytesseract.image_to_data(
            image, 
            lang=self.language,
            output_type=pytesseract.Output.DICT
        )
        
        results = []
        n_boxes = len(data['text'])
        
        for i in range(n_boxes):
            text = data['text'][i].strip()
            conf = int(data['conf'][i])
            
            # Skip empty or low-confidence results
            if not text or conf < 30:
                continue
            
            bbox = (
                data['left'][i],
                data['top'][i],
                data['left'][i] + data['width'][i],
                data['top'][i] + data['height'][i],
            )
            
            results.append(OCRResult(
                text=text,
                confidence=conf / 100.0,
                bbox=bbox,
            ))
        
        return results
    
    def process_to_page_content(
        self, 
        image_bytes: bytes, 
        page_number: int,
        image_width: float,
        image_height: float,
    ) -> PageContent:
        """
        Process an image and return PageContent matching parser output.
        
        Args:
            image_bytes: PNG image bytes
            page_number: Page number in document
            image_width: Original page width
            image_height: Original page height
            
        Returns:
            PageContent with OCR-extracted text blocks
        """
        ocr_results = self.process_image(image_bytes)
        
        # Group OCR results into text blocks (by line/paragraph)
        blocks = []
        current_line_texts = []
        current_line_top = None
        line_threshold = 10  # pixels
        
        for result in sorted(ocr_results, key=lambda r: (r.bbox[1], r.bbox[0])):
            if current_line_top is None:
                current_line_top = result.bbox[1]
            
            # Check if this is same line or new line
            if abs(result.bbox[1] - current_line_top) < line_threshold:
                current_line_texts.append(result)
            else:
                # Save current line as block
                if current_line_texts:
                    block = self._create_block_from_line(current_line_texts, page_number)
                    if block:
                        blocks.append(block)
                
                current_line_texts = [result]
                current_line_top = result.bbox[1]
        
        # Don't forget last line
        if current_line_texts:
            block = self._create_block_from_line(current_line_texts, page_number)
            if block:
                blocks.append(block)
        
        # Combine adjacent blocks into paragraphs
        raw_text = " ".join(b.text for b in blocks)
        
        return PageContent(
            page_number=page_number,
            width=image_width,
            height=image_height,
            blocks=blocks,
            raw_text=raw_text,
        )
    
    def _create_block_from_line(
        self, 
        results: List[OCRResult], 
        page_number: int
    ) -> Optional[TextBlock]:
        """Create a TextBlock from a line of OCR results"""
        if not results:
            return None
        
        # Combine text
        text = " ".join(r.text for r in results)
        
        # Calculate combined bounding box
        x0 = min(r.bbox[0] for r in results)
        y0 = min(r.bbox[1] for r in results)
        x1 = max(r.bbox[2] for r in results)
        y1 = max(r.bbox[3] for r in results)
        
        return TextBlock(
            text=text,
            page_number=page_number,
            bbox=(x0, y0, x1, y1),
            block_type="text",
        )
    
    def get_full_text(self, image_bytes: bytes) -> str:
        """
        Simple full-text OCR without position data.
        
        Args:
            image_bytes: PNG image bytes
            
        Returns:
            Extracted text as string
        """
        image = Image.open(io.BytesIO(image_bytes))
        return pytesseract.image_to_string(image, lang=self.language)
