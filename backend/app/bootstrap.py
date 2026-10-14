from alembic import command
from alembic.config import Config

from app.initial_data import init

if __name__ == "__main__":
    command.upgrade(Config("alembic.ini"), "head")
    init()
