FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json /app/
COPY frontend/package.json /app/frontend/
COPY packages/react-email/package.json /app/packages/react-email/
RUN npm ci --ignore-scripts
COPY frontend /app/frontend
RUN npm run build --workspace frontend
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 UV_LINK_MODE=copy OMP_NUM_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY backend/pyproject.toml /app/backend/
RUN uv sync --frozen --no-dev --no-install-workspace --package app
COPY backend/app /app/backend/app
COPY backend/alembic.ini /app/backend/
COPY --from=frontend-build /app/backend/app/frontend /app/backend/app/frontend
RUN uv sync --frozen --no-dev --package app
RUN groupadd -r renpdf && useradd -r -g renpdf renpdf && mkdir -p /data/documents && chown -R renpdf:renpdf /data /app
ENV PATH="/app/.venv/bin:$PATH"
WORKDIR /app/backend
USER renpdf
CMD ["fastapi", "run", "--host", "0.0.0.0", "--workers", "1"]
