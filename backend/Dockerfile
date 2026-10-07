FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt ./
ARG INSTALL_DEV=false
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_DEV" = "true" ]; then pip install --no-cache-dir -r requirements-dev.txt; fi

COPY . ./backend

EXPOSE 8000

# Apply migrations and the idempotent seed, then serve.
CMD ["sh", "-c", "alembic -c backend/alembic.ini upgrade head && python -m backend.seed && uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
