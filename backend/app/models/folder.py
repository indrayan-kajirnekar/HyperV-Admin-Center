from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Quota ceilings (None = unlimited)
    quota_storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # GB hard ceiling
    quota_memory_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)        # GB hard ceiling
    quota_cpu_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)          # % of total physical
    quota_max_vms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)          # absolute VM count

    # soft quota thresholds (trigger warning, not block)
    soft_quota_storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    soft_quota_memory_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    children: Mapped[List["Folder"]] = relationship("Folder", back_populates="parent", cascade="all, delete-orphan")
    parent: Mapped[Optional["Folder"]] = relationship("Folder", back_populates="children", remote_side="Folder.id")
    hypervisors: Mapped[List["Hypervisor"]] = relationship("Hypervisor", back_populates="folder", lazy="selectin")


class Hypervisor(Base):
    __tablename__ = "hypervisors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    hostname: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    folder_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    is_online: Mapped[bool] = mapped_column(default=True)
    total_cpu_cores: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_memory_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_storage_gb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Per-server WinRM credentials (stored plaintext — encrypt at rest in production)
    winrm_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    winrm_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    folder: Mapped[Optional["Folder"]] = relationship("Folder", back_populates="hypervisors")
