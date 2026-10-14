from pathlib import Path

root = Path(__file__).resolve().parents[1] / "frontend" / "src" / "client"
for path in root.rglob("*.ts"):
    content = path.read_text(encoding="utf-8")
    path.write_text("\n".join(line.rstrip() for line in content.splitlines()) + "\n", encoding="utf-8")
