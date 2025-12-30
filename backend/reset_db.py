import asyncio
from database import engine, Base, async_session
from models import Workspace, User

async def reset_db():
    print("Resetting database...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    
    print("Seeding default workspace...")
    async with async_session() as db:
        ws = Workspace(name="Default Workspace")
        db.add(ws)
        await db.commit()
    print("Done!")

if __name__ == "__main__":
    asyncio.run(reset_db())
