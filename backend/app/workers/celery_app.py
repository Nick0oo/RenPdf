from celery import Celery

from app.core.config import settings

celery_app = Celery("renpdf", broker=settings.REDIS_URL, include=["app.workers.tasks"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_connection_timeout=2,
    broker_transport_options={"visibility_timeout": 3600},
    task_time_limit=1800,
    beat_schedule={
        "recover-durable-jobs": {"task": "research.dispatch", "schedule": 30.0}
    },
)
