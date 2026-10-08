import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://hrh_user:hrh_password@localhost:5432/hrh_db")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-insecure-secret-change-me-0123456789")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
TIMEZONE = os.getenv("APP_TIMEZONE", "Africa/Dar_es_Salaam")

SMS_GATEWAY_TYPE = os.getenv("SMS_GATEWAY_TYPE", "mock")
# Development only: echo OTP codes in API responses when using the mock gateway.
EXPOSE_DEV_OTP = SMS_GATEWAY_TYPE == "mock" and os.getenv("EXPOSE_DEV_OTP", "false").lower() == "true"

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin12345")
ADMIN_PHONE = os.getenv("ADMIN_PHONE", "+255700000000")
