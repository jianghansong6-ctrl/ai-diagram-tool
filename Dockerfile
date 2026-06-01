FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all source code
COPY . .

# Build frontend
WORKDIR /app/frontend
RUN apt-get install -y --no-install-recommends nodejs npm \
    && npm install && npm run build \
    && rm -rf node_modules

WORKDIR /app

EXPOSE 8000

CMD ["python", "-m", "backend.main"]
