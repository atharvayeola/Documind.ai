import asyncio
from database import async_session
from models import User
from core.security import get_password_hash

async def create_user():
    async with async_session() as db:
        user = User(
            email="demo@example.com",
            name="Demo User",
            hashed_password=get_password_hash("demo123"),
            role="admin",
            is_active=True,
            workspace_id=1
        )
        db.add(user)
        try:
            await db.commit()
            print("User created: demo@example.com / demo123")
        except Exception as e:
            print(f"Error creating user: {e}")

if __name__ == "__main__":
    asyncio.run(create_user())
