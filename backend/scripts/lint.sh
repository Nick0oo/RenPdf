#!/usr/bin/env bash

set -e
set -x

# ty checks the application, including optional provider boundaries, without requiring
# third-party Celery/PyMuPDF stubs. See docs/DECISIONS.md.
ty check app
ruff check app
ruff format app --check
