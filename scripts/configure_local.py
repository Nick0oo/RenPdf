"""Non-destructive local bootstrap. Never prints credentials or touches the old DB."""
import secrets
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / ".env"
values = dotenv_values(path)
if not path.exists():
    raise SystemExit("Copy .env.example to .env and configure POSTGRES_PASSWORD first.")
backup = ROOT / ".env.before-chatpdf"
if not backup.exists():
    backup.write_bytes(path.read_bytes())
password = values.get("POSTGRES_PASSWORD")
if not password:
    raise SystemExit("POSTGRES_PASSWORD is required for the dedicated Docker databases.")
host = "127.0.0.1"
port = int(values.get("POSTGRES_PORT") or 5433)
app_password = values.get("REN_DATABASE_PASSWORD") or secrets.token_urlsafe(36)
with psycopg.connect(host=host, port=port, user="postgres", password=password, dbname="postgres", autocommit=True) as connection:
    if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname='renpdf_app'").fetchone():
        connection.execute(sql.SQL("CREATE ROLE renpdf_app LOGIN PASSWORD {}").format(sql.Literal(app_password)))
    for name in ("renpdf_chat", "renpdf_chat_test"):
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        connection.execute(sql.SQL("ALTER DATABASE {} OWNER TO renpdf_app").format(sql.Identifier(name)))
        with psycopg.connect(host=host, port=port, user="postgres", password=password, dbname=name, autocommit=True) as app_connection:
            app_connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
            # Only the two dedicated app DBs are affected, never Windows renpdf.
            for table in app_connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'").fetchall():
                app_connection.execute(sql.SQL("ALTER TABLE {} OWNER TO renpdf_app").format(sql.Identifier(table[0])))
from urllib.parse import quote  # noqa: E402

updates = {
    "DATABASE_URL": f"postgresql://renpdf_app:{quote(app_password, safe='')}@{host}:{port}/renpdf_chat",
    "REN_DATABASE_PASSWORD": app_password,
    "REDIS_URL": "redis://127.0.0.1:6380/0",
    "DEFAULT_CHAT_MODEL": values.get("DEFAULT_CHAT_MODEL") or "gemini-2.5-flash",
}
if values.get("SECRET_KEY") in {None, "changethis"}:
    updates["SECRET_KEY"] = secrets.token_urlsafe(48)
if values.get("FIRST_SUPERUSER_PASSWORD") in {None, "changethis"}:
    updates["FIRST_SUPERUSER_PASSWORD"] = secrets.token_urlsafe(24)
lines = path.read_text(encoding="utf-8-sig").splitlines()
for key, value in updates.items():
    replacement = f"{key}={value}"
    found = False
    for index, line in enumerate(lines):
        if line.startswith(key + "="):
            lines[index] = replacement
            found = True
    if not found:
        lines.append(replacement)
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("Dedicated databases prepared; local configuration updated. Credentials stay in .env.")
