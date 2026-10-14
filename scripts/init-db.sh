#!/bin/sh
set -eu
# Runs only on a new volume; never removes or resets existing databases.
psql --username postgres --dbname app -v app_password="$REN_DATABASE_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE renpdf_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'renpdf_app') \gexec
SELECT 'CREATE DATABASE renpdf_chat OWNER renpdf_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'renpdf_chat') \gexec
\connect renpdf_chat
CREATE EXTENSION IF NOT EXISTS vector;
SQL
