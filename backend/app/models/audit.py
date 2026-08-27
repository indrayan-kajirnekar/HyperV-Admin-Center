from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_user_id", "user_id"),
        Index("ix_audit_logs_resource_type", "resource_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)         # e.g. "vm.stop"
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)   # e.g. "vm", "folder"
    resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    resource_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)       # JSON blob
    status: Mapped[str] = mapped_column(String(20), default="success")       # success | failure | warning
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
