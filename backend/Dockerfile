FROM python:3.12-slim

WORKDIR /app

# System deps for pypsrp / cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libkrb5-dev libssl-dev gcc curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--loop", "uvloop", "--http", "httptools"]
