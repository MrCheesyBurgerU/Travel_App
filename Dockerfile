FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# /data is where Fly.io mounts the persistent volume
RUN mkdir -p /data

EXPOSE 8080

# Single worker — SQLite doesn't support concurrent writes across workers
CMD ["gunicorn", "app:app", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--timeout", "120", \
     "--access-logfile", "-"]
