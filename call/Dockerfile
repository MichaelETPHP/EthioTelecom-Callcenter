FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# calls.db lives on a mounted volume in production so data survives
# container restarts/rebuilds (see docker-compose.yml).
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/calls.db

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "60", "app:app"]
