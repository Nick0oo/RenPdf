# Seguridad

- Registro público y bootstrap privado del template desactivados. Bootstrap de
  cuenta desde entorno; hash Argon2 del template. Sesión cookie HttpOnly,
  SameSite=strict; en HTTPS activar COOKIE_SECURE. El browser sólo guarda un hint
  de sesión, nunca el JWT. Bearer permanece para clientes API autenticados.
- Mutaciones con cookie comprueban Origin; CORS sólo acepta FRONTEND_HOST.
  Bind publicado 127.0.0.1. PostgreSQL/Redis no publican puertos en compose base;
  el override de desarrollo publica sólo loopback. No se reutiliza la base Windows.
- Secretos exclusivamente en entorno/.env ignorado. Errores cloud sanitizados;
  sin logging de PDFs/prompts/respuestas ni telemetría Sentry. Nunca versionar .env,
  backups de .env, credenciales de Playwright ni storage personal.
- Consentimiento por documento/proveedor, cuatro alcances separados: embeddings,
  chat, vision, original_pdf. Se añade `multimodal_embeddings` para imágenes;
  un permiso textual no autoriza vectorizar imágenes. Caducidad y revocación. Una
  autorización no activa operaciones por sí misma. No hay subida automática del
  PDF completo; ese alcance queda preparado para una función futura explícita.
- PDF validado por firma/parser, tamaño y páginas. Nombres internos UUID;
  rutas arbitrarias, traversal, enlaces simbólicos y junctions rechazados.
  Escritura temporal, fsync y reemplazo atómico; auth en cada acceso a original.
- Prompt injection se trata como datos no confiables, sin herramientas o comandos
  en los adaptadores. Markdown no ejecuta HTML ni carga imágenes externas del LLM.
- Hosts de proveedores en allowlist del servidor; sin redirects, URLs con secretos
  o endpoints elegidos por el PDF. Los endpoints externos usan HTTPS.

No se usa SQLite ni un mock como sustituto de PostgreSQL/pgvector. Pytest falla si
su base no termina en `_test`. La limpieza no puede apuntar a la base personal.
No ejecutar `docker compose down -v` sobre volúmenes que se quieran conservar.

Parsing por página en proceso separado con timeout de 90 segundos, límite de
contenido serializado y 1536 MiB de espacio virtual en Linux. El límite se puede
ajustar para artefactos Docling; Windows aplica timeout pero no RLIMIT_AS.

Límites: no antivirus, sandbox completo de sistema operativo, aislamiento multi-tenant,
rate limiting distribuido ni auditoría de penetración. Exposición pública requiere
TLS, firewall y revisión adicional. Verificación de IDs no certifica verdad factual.
