"""
Supabase Storage Client
Handles file uploads/downloads to Supabase Storage buckets
"""
import os
from typing import Optional
from supabase import create_client, Client
from config import settings


class StorageClient:
    """
    Client for interacting with Supabase Storage.
    Handles PDF uploads and signed URL generation.
    """
    
    BUCKET_NAME = "documents"
    
    def __init__(self):
        self.client: Optional[Client] = None
        self._init_client()
    
    def _init_client(self):
        """Initialize Supabase client if credentials are available."""
        if settings.supabase_url and settings.supabase_anon_key:
            self.client = create_client(
                settings.supabase_url,
                settings.supabase_anon_key
            )
            print(f"✅ Supabase Storage client initialized")
        else:
            print("⚠️ Supabase credentials not configured, using local storage")
    
    def _ensure_bucket_exists(self):
        """Ensure the documents bucket exists."""
        if not self.client:
            return False
        try:
            # Try to get bucket info
            self.client.storage.get_bucket(self.BUCKET_NAME)
            return True
        except Exception:
            try:
                # Create bucket if it doesn't exist
                self.client.storage.create_bucket(
                    self.BUCKET_NAME,
                    options={"public": False}
                )
                print(f"✅ Created storage bucket: {self.BUCKET_NAME}")
                return True
            except Exception as e:
                print(f"⚠️ Could not create bucket: {e}")
                return False
    
    async def upload_file(
        self,
        file_content: bytes,
        filename: str,
        owner_id: Optional[int] = None,
        content_type: str = "application/pdf"
    ) -> Optional[str]:
        """
        Upload a file to Supabase Storage.
        
        Args:
            file_content: Raw file bytes
            filename: Name for the file in storage
            owner_id: Optional owner ID for folder organization
            content_type: MIME type
            
        Returns:
            Storage path if successful, None otherwise
        """
        if not self.client:
            return None
        
        self._ensure_bucket_exists()
        
        # Organize by owner
        folder = f"user_{owner_id}" if owner_id else "anonymous"
        storage_path = f"{folder}/{filename}"
        
        try:
            self.client.storage.from_(self.BUCKET_NAME).upload(
                path=storage_path,
                file=file_content,
                file_options={"content-type": content_type}
            )
            print(f"✅ Uploaded to Supabase: {storage_path}")
            return storage_path
        except Exception as e:
            print(f"❌ Upload failed: {e}")
            return None
    
    def get_public_url(self, storage_path: str) -> Optional[str]:
        """Get public URL for a file (only works for public buckets)."""
        if not self.client:
            return None
        try:
            result = self.client.storage.from_(self.BUCKET_NAME).get_public_url(storage_path)
            return result
        except Exception:
            return None
    
    def get_signed_url(self, storage_path: str, expires_in: int = 3600) -> Optional[str]:
        """
        Get a signed URL for private file access.
        
        Args:
            storage_path: Path in storage bucket
            expires_in: URL expiry time in seconds (default 1 hour)
            
        Returns:
            Signed URL if successful, None otherwise
        """
        if not self.client:
            return None
        try:
            result = self.client.storage.from_(self.BUCKET_NAME).create_signed_url(
                path=storage_path,
                expires_in=expires_in
            )
            return result.get("signedURL")
        except Exception as e:
            print(f"❌ Failed to create signed URL: {e}")
            return None
    
    async def download_file(self, storage_path: str) -> Optional[bytes]:
        """Download a file from Supabase Storage."""
        if not self.client:
            return None
        try:
            result = self.client.storage.from_(self.BUCKET_NAME).download(storage_path)
            return result
        except Exception as e:
            print(f"❌ Download failed: {e}")
            return None
    
    async def delete_file(self, storage_path: str) -> bool:
        """Delete a file from storage."""
        if not self.client:
            return False
        try:
            self.client.storage.from_(self.BUCKET_NAME).remove([storage_path])
            return True
        except Exception as e:
            print(f"❌ Delete failed: {e}")
            return False
    
    @property
    def is_available(self) -> bool:
        """Check if Supabase storage is configured and available."""
        return self.client is not None


# Global instance
storage_client = StorageClient()
