import json
import logging
import re


def redact(message: str) -> str:
    message = re.sub(r"AIza[A-Za-z0-9_-]{20,}", "[REDACTED]", message)
    message = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9_.-]+", r"\1[REDACTED]", message)
    message = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[REDACTED]", message)
    message = re.sub(
        r"(?i)((?:api[_-]?key|password|token)\s*[=:]\s*)[^\s,;]+",
        r"\1[REDACTED]",
        message,
    )
    return message[:1000]


class SafeJSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "level": record.levelname,
                "logger": record.name,
                "event": redact(record.getMessage()),
            },
            ensure_ascii=False,
        )


def configure_logging() -> None:
    formatter = SafeJSONFormatter()
    for name in (None, "uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        for handler in logger.handlers:
            handler.setFormatter(formatter)
    # SDK requests need not produce verbose HTTP logs in normal operation.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("google.genai").setLevel(logging.WARNING)
