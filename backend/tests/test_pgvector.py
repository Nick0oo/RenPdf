from pgvector import Vector
from sqlalchemy import text

from app.core.db import engine


def test_vector_round_trip_and_nearest_neighbor() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TEMP TABLE vector_test "
                "(id integer, embedding vector(3)) ON COMMIT DROP"
            )
        )
        connection.execute(
            text("INSERT INTO vector_test VALUES (:id, :embedding)"),
            [
                {"id": 1, "embedding": Vector([1, 2, 3])},
                {"id": 2, "embedding": Vector([9, 8, 7])},
            ],
        )
        row = connection.execute(
            text(
                "SELECT id, embedding, embedding <-> :query AS distance "
                "FROM vector_test ORDER BY distance LIMIT 1"
            ),
            {"query": Vector([1, 2, 3])},
        ).one()

        assert row.id == 1
        assert row.embedding.tolist() == [1, 2, 3]
        assert row.distance == 0
