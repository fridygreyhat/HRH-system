from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..core.config import DATABASE_URL

import os

# Database connections each server process may hold. The default of 5 (+10 overflow) made requests queue and time out
# with a few hundred people working at once. Keep (processes x (size + overflow)) under the server's max_connections.
POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "10"))
MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "10"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=POOL_SIZE, max_overflow=MAX_OVERFLOW,
                       pool_timeout=int(os.environ.get("DB_POOL_TIMEOUT", "30")), pool_recycle=1800)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
