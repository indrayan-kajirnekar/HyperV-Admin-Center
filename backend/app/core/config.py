from __future__ import annotations
from functools import lru_cache
from typing import List
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "HyperVision"
    APP_ENV: str = "production"
    APP_SECRET_KEY: str = "insecure-dev-key"
    APP_DEBUG: bool = False
    APP_PORT: int = 8000

    DATABASE_URL: str = "postgresql+asyncpg://hypervision:password@localhost:5432/hypervision"

    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_TTL_SECONDS: int = 30
    REDIS_VM_POLL_INTERVAL: int = 15

    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    HYPERV_HOSTS: str = ""
    HYPERV_USERNAME: str = ""
    HYPERV_PASSWORD: str = ""

    CORS_ORIGINS: str = "http://localhost:3000"

    BOOTSTRAP_ADMIN_EMAIL: str = "indrayan@corp.local"
    BOOTSTRAP_ADMIN_PASSWORD: str = "Indrayan@123pswd"
    BOOTSTRAP_ADMIN_NAME: str = "Indrayan"

    @property
    def hyperv_host_list(self) -> List[str]:
        return [h.strip() for h in self.HYPERV_HOSTS.split(",") if h.strip()]

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
