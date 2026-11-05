import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://hrh_user:hrh_password@localhost:5432/hrh_db")
# SQLAlchemy 2.1 defaults plain PostgreSQL URLs to psycopg3; this project uses psycopg2.
if DATABASE_URL.startswith(("postgresql://", "postgres://")):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL.split("://", 1)[1]
# Anyone who knows this key can sign in as anybody, so there is no default: a missing, short or published key stops the server.
SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("SESSION_SECRET") or ""
if len(SECRET_KEY) < 32 or SECRET_KEY in {"dev-insecure-secret-change-me-0123456789", "replace-with-at-least-32-random-characters"}:
    raise RuntimeError("SECRET_KEY must be set to at least 32 random characters (see .env.example)")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
TIMEZONE = os.getenv("APP_TIMEZONE", "Africa/Dar_es_Salaam")

SMS_GATEWAY_TYPE = os.getenv("SMS_GATEWAY_TYPE", "mock")
# Development only: echo OTP codes in API responses when using the mock gateway.
EXPOSE_DEV_OTP = SMS_GATEWAY_TYPE == "mock" and os.getenv("EXPOSE_DEV_OTP", "false").lower() == "true"

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_IMPORT_BYTES = int(os.getenv("MAX_IMPORT_BYTES", str(5 * 1024 * 1024)))  # roster and budget-tracker CSV files
# Interactive API docs map every endpoint, so they are off unless asked for (e.g. on a developer machine).
ENABLE_API_DOCS = os.getenv("ENABLE_API_DOCS", "false").lower() == "true"

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
# Only used when a fresh database creates the first administrator, who must change it at first sign-in.
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_PHONE = os.getenv("ADMIN_PHONE", "+255700000000")
