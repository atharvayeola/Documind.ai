"""
Embedding Service
Generates vector embeddings for text chunks using OpenAI
"""
from typing import List
import asyncio
from openai import AsyncOpenAI

from config import settings


class EmbeddingService:
    """
    Generates embeddings for text chunks using OpenAI's embedding models.
    """
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.embedding_model
        self.batch_size = 100  # Process in batches to avoid rate limits
    
    async def embed_text(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text to embed
            
        Returns:
            1536-dimensional embedding vector
        """
        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding
    
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.
        
        Args:
            texts: List of texts to embed
            
        Returns:
            List of embedding vectors
        """
        all_embeddings = []
        
        # Process in batches
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            
            response = await self.client.embeddings.create(
                model=self.model,
                input=batch,
            )
            
            # Sort by index to maintain order
            sorted_data = sorted(response.data, key=lambda x: x.index)
            batch_embeddings = [item.embedding for item in sorted_data]
            all_embeddings.extend(batch_embeddings)
            
            # Small delay between batches to avoid rate limits
            if i + self.batch_size < len(texts):
                await asyncio.sleep(0.1)
        
        return all_embeddings
    
    async def embed_query(self, query: str) -> List[float]:
        """
        Generate embedding for a search query.
        Uses same model as document embeddings.
        
        Args:
            query: Search query text
            
        Returns:
            1536-dimensional embedding vector
        """
        return await self.embed_text(query)
