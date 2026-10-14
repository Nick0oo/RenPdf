"""Create server-only development secrets once, without overwriting existing keys."""
import secrets
from pathlib import Path

from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
target = root / ".env"
already_configured = target.exists()
if not target.exists():
    target.write_bytes((root / ".env.example").read_bytes())
values = dotenv_values(target)
updates = {}
for key in ("SECRET_KEY", "FIRST_SUPERUSER_PASSWORD", "POSTGRES_PASSWORD", "REN_DATABASE_PASSWORD"):
    value = values.get(key)
    if key == "POSTGRES_PASSWORD" and already_configured and value and not value.startswith("replace_"):
        continue  # Existing volume credentials must not be silently changed.
    if not value or value == "changethis" or value.startswith("replace_"):
        updates[key] = secrets.token_urlsafe(36)
lines = target.read_text(encoding="utf-8-sig").splitlines()
for key, value in updates.items():
    for index, line in enumerate(lines):
        if line.startswith(key + "="):
            lines[index] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
target.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("Local secrets prepared in .env. Existing non-placeholder values preserved.")
