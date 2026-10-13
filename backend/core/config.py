import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://hrh_user:hrh_password@localhost:5432/hrh_db")

# The key that signs sign-in tokens. Anyone who knows it can sign in as anybody, so there is no default:
# a missing, short or published placeholder key stops the server from starting.
SECRET_KEY = os.getenv("SECRET_KEY", "")
_KNOWN_KEYS = {"dev-insecure-secret-change-me-0123456789", "replace-with-at-least-32-random-characters"}
if len(SECRET_KEY) < 32 or SECRET_KEY in _KNOWN_KEYS or "insecure" in SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set to at least 32 random characters (see .env.example)")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
TIMEZONE = os.getenv("APP_TIMEZONE", "Africa/Dar_es_Salaam")

SMS_GATEWAY_TYPE = os.getenv("SMS_GATEWAY_TYPE", "mock")
# Development only: echo OTP codes in API responses when using the mock gateway.
EXPOSE_DEV_OTP = SMS_GATEWAY_TYPE == "mock" and os.getenv("EXPOSE_DEV_OTP", "false").lower() == "true"

ENABLE_API_DOCS = os.getenv("ENABLE_API_DOCS", "false").lower() == "true"
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_IMPORT_BYTES = int(os.getenv("MAX_IMPORT_BYTES", str(5 * 1024 * 1024)))  # roster and budget-tracker CSV files

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
# Only used when a fresh database creates the first administrator (who must change it at first sign-in).
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_PHONE = os.getenv("ADMIN_PHONE", "+255700000000")
