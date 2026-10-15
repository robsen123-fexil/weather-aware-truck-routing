"""Gunicorn settings (auto-loaded from the working directory).

Threaded worker: a long trip analysis must not block the platform health check
(`/api/health/`). With a single sync worker, Render's health probe went unanswered
during slow analyses and the instance was restarted mid-request (empty 502).
"""

worker_class = "gthread"
threads = 4
workers = 1
timeout = 120
graceful_timeout = 30
