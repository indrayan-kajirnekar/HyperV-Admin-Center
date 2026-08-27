from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

# Association: users <-> groups
user_group_table = Table(
    "user_group_members",
    Base.metadata,
    Column("user_id", String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("group_id", String(36), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="read_only")
    # roles: super_admin | cluster_admin | vm_operator | read_only
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    groups: Mapped[List["Group"]] = relationship("Group", secondary=user_group_table, back_populates="members", lazy="selectin")
    permissions: Mapped[List["Permission"]] = relationship("Permission", back_populates="user", cascade="all, delete-orphan")


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    members: Mapped[List["User"]] = relationship("User", secondary=user_group_table, back_populates="groups", lazy="selectin")
    permissions: Mapped[List["Permission"]] = relationship("Permission", back_populates="group", cascade="all, delete-orphan")


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    group_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    resource_type: Mapped[str] = mapped_column(String(50))  # folder | hypervisor
    resource_id: Mapped[str] = mapped_column(String(36))
    role: Mapped[str] = mapped_column(String(50))

    user: Mapped[Optional["User"]] = relationship("User", back_populates="permissions")
    group: Mapped[Optional["Group"]] = relationship("Group", back_populates="permissions")
