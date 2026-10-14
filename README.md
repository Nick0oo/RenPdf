# RenPdf

Aplicación con backend en FastAPI, frontend en React y TypeScript, y PostgreSQL
con pgvector.

## Desarrollo

Requisitos: Python 3.14, uv, Bun y Docker.

Mantén un `.env` local en la raíz con `SECRET_KEY`, `POSTGRES_PASSWORD`,
`DATABASE_URL`, `FIRST_SUPERUSER` y `FIRST_SUPERUSER_PASSWORD`. Usa valores propios
para las claves y contraseñas. `DATABASE_URL` debe apuntar a PostgreSQL, por ejemplo
`postgresql://postgres:<contraseña>@localhost:5433/app` para Docker o
`postgresql://postgres:<contraseña>@localhost:5432/renpdf` para PostgreSQL
instalado en Windows.
Los archivos `.env` se mantienen fuera de Git y del contexto de Docker.

Inicia los servicios locales desde la raíz:

```sh
docker compose up -d db mailpit
```

Docker usa PostgreSQL 18 con pgvector 0.8.7 y publica el puerto `5433` para
coexistir con PostgreSQL local en `5432`. Puedes cambiarlo con `POSTGRES_PORT`.

Inicia el backend desde `backend/`:

```sh
uv sync
uv run bash scripts/prestart.sh
uv run fastapi dev
```

Inicia el frontend desde la raíz, en otra terminal:

```sh
bun install
bun run dev
```

Frontend: `http://localhost:5173`. API: `http://localhost:8000`.

Las migraciones de Alembic activan la extensión `vector` en la base de datos.
Para PostgreSQL local, instala primero la extensión para la misma versión del
servidor. El backend incluye `pgvector` y registra sus tipos con Psycopg.

Para conectar el backend local con Mailpit, configura `SMTP_HOST=localhost`,
`SMTP_PORT=1025`, `SMTP_TLS=false` y `EMAILS_FROM_EMAIL` en tu `.env`.

## Comandos

- `bun run build`: compilar el frontend para servirlo desde el backend.
- `bun run test`: ejecutar las pruebas del frontend con el backend disponible.
- `bash scripts/generate-client.sh`: regenerar el cliente de la API.
- `bun run email:dev`: abrir el editor de correos.

## Licencia

[MIT](LICENSE).
