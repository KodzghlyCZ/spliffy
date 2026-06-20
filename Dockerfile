# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ENV VITE_API_BASE=
RUN npm run build


FROM python:3.12-slim AS backend-build
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SPLIFFY_CONFIG=/app/config.yaml \
    STATIC_DIR=/app/static

RUN adduser --disabled-password --gecos "" appuser

COPY --from=backend-build /install /usr/local
COPY backend/app ./app
COPY backend/config.yaml ./config.yaml
COPY --from=frontend /app/frontend/dist ./static

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
