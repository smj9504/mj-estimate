"""Drop photo_analysis_cache table to fix duplicate index issue"""
from sqlalchemy import create_engine, text
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL)

with engine.connect() as conn:
    conn.execute(text('DROP TABLE IF EXISTS photo_analysis_cache CASCADE'))
    conn.commit()
    print('SUCCESS: photo_analysis_cache table dropped successfully')
