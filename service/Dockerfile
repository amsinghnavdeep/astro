FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    CHROME_BIN=/usr/bin/chromium \
    KUNDLI_STATE_DIR=/tmp/kundli-state

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        chromium \
        build-essential \
        fonts-lohit-deva \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY service/requirements.txt /app/service/requirements.txt
RUN pip install --no-cache-dir -r /app/service/requirements.txt \
    && apt-get update \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY service/__init__.py service/app.py /app/service/
COPY service/kundli /app/service/kundli
COPY scripts/kundli/generate_report.py scripts/kundli/send_email.py scripts/kundli/report.html /app/scripts/kundli/

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /tmp/kundli-state \
    && chown -R appuser:appuser /app /tmp/kundli-state

USER appuser

CMD ["sh", "-c", "exec uvicorn service.app:app --host 0.0.0.0 --port ${PORT:-8080}"]
