from datetime import datetime, timedelta
from typing import Optional, Union, Any
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
import bcrypt
from jose import jwt
from config import settings

# pwd_context removed

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password: return False
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt

def verify_google_token(token: str) -> Optional[dict]:
    try:
        id_info = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.google_client_id
        )
        return id_info
    except ValueError:
        return None
