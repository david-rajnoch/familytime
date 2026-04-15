from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    db_path: str = "/Users/davidrajnoch/code/familytime/data/familytime.db"
    cache_dir: str = "/Users/davidrajnoch/code/familytime/data/cache"
    host: str = "localhost"
    port: int = 8000

    model_config = {"env_file": "/Users/davidrajnoch/code/familytime/.env", "extra": "ignore"}

    @property
    def thumbs_dir(self) -> Path:
        return Path(self.cache_dir) / "thumbs"


settings = Settings()
