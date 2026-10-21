"""A stale HTML shell must not keep importing chunks removed by a deployment."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import security_headers


def frontend_client(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>Current workspace build</html>")
    (tmp_path / "assets" / "workspace-new.js").write_text("export const ready=true;")
    application = FastAPI()
    application.middleware("http")(security_headers)
    application.frontend("/", directory=tmp_path)
    return TestClient(application)


def test_workspace_html_is_fresh_even_with_a_previous_conditional_request(tmp_path):
    with frontend_client(tmp_path) as client:
        response = client.get("/workspaces/existing", headers={"Accept": "text/html"})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        stale = client.get(
            "/workspaces/existing",
            headers={
                "Accept": "text/html",
                "If-None-Match": response.headers["etag"],
                "If-Modified-Since": response.headers["last-modified"],
            },
        )
        assert stale.status_code == 200
        assert stale.text == "<html>Current workspace build</html>"
        assert stale.headers["cache-control"] == "no-store"


def test_missing_chunks_are_not_cached_or_replaced_with_the_html_shell(tmp_path):
    with frontend_client(tmp_path) as client:
        missing = client.get("/assets/workspace-old.js")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store"
        assert "text/html" not in missing.headers["content-type"]
        current = client.get("/assets/workspace-new.js")
        assert current.status_code == 200
        cached = client.get(
            "/assets/workspace-new.js",
            headers={"If-None-Match": current.headers["etag"]},
        )
        assert cached.status_code == 304
        api_missing = client.get(
            "/api/v1/missing", headers={"Accept": "application/json"}
        )
        assert api_missing.status_code == 404
        assert api_missing.json() == {"detail": "Not Found"}
