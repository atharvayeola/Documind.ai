from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import User
from core.security import verify_password, get_password_hash, create_access_token, verify_google_token
from api.dependencies import get_current_user

router = APIRouter()

# --- Schemas ---

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class Token(BaseModel):
    access_token: str
    token_type: str

class GoogleLogin(BaseModel):
    token: str

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str
    picture: Optional[str] = None
    role: str
    workspace_id: int

    class Config:
        from_attributes = True

# --- Endpoints ---

@router.post("/register", response_model=UserResponse)
async def register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check existing
    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pw = get_password_hash(user_in.password)
    new_user = User(
        email=user_in.email,
        hashed_password=hashed_pw,
        name=user_in.name,
        workspace_id=1 
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user

@router.post("/token", response_model=Token)
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()
    
    print(f"DEBUG: Login attempt for user email: {form_data.username}")
    if not user:
        print("DEBUG: User not found in DB")
    elif not user.hashed_password:
        print("DEBUG: User has no password set")
    else:
        is_valid = verify_password(form_data.password, user.hashed_password)
        print(f"DEBUG: Password verification result: {is_valid}")
        if not is_valid:
             print(f"DEBUG: Hashed password in DB: {user.hashed_password[:10]}...") 
    
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        print("DEBUG: Raising 401")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(subject=user.email)
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/google", response_model=Token)
async def google_login(login_data: GoogleLogin, db: AsyncSession = Depends(get_db)):
    id_info = verify_google_token(login_data.token)
    if not id_info:
        raise HTTPException(status_code=400, detail="Invalid Google token")
    
    email = id_info['email']
    name = id_info.get('name', email.split('@')[0])
    picture = id_info.get('picture', '')
    
    # Check if user exists
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    
    if not user:
        # Register new user
        user = User(
            email=email,
            name=name,
            picture=picture,
            workspace_id=1,
            is_active=True
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # Update picture if changed
        if picture and user.picture != picture:
            user.picture = picture
            db.add(user)
            await db.commit()
    
    access_token = create_access_token(subject=user.email)
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user
