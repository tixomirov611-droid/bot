FROM python:3.12-slim
WORKDIR /app
COPY taxi-staging/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY taxi-staging/ /app/
ENV PYTHONUNBUFFERED=1 REGISTRY_PATH=/data/nikcar_registrations.sqlite3 ENABLE_TELEGRAM_WEBHOOK=0
RUN mkdir -p /data
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "app:app"]
