from __future__ import annotations
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.core.security import hash_password, verify_password
from app.models.user import User, Group, Permission

log = structlog.get_logger()

VALID_ROLES = {"super_admin", "cluster_admin", "vm_operator", "read_only"}


async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    user = await get_user_by_email(db, email)
    if not user or not verify_password(password, user.hashed_password):
        return None
    if not user.is_active:
        return None
    return user


async def create_user(
    db: AsyncSession,
    email: str,
    full_name: str,
    password: str,
    role: str = "read_only",
) -> User:
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}. Must be one of {VALID_ROLES}")
    user = User(
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        role=role,
    )
    db.add(user)
    await db.flush()
    return user


async def list_users(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[User]:
    result = await db.execute(select(User).offset(skip).limit(limit))
    return list(result.scalars().all())


async def update_user(
    db: AsyncSession,
    user_id: str,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    password: Optional[str] = None,
) -> Optional[User]:
    user = await get_user_by_id(db, user_id)
    if not user:
        return None
    if full_name is not None:
        user.full_name = full_name
    if role is not None:
        if role not in VALID_ROLES:
            raise ValueError(f"Invalid role: {role}")
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    if password is not None:
        user.hashed_password = hash_password(password)
    await db.flush()
    return user


async def delete_user(db: AsyncSession, user_id: str) -> bool:
    user = await get_user_by_id(db, user_id)
    if not user:
        return False
    await db.delete(user)
    return True


async def create_group(db: AsyncSession, name: str, description: str = "") -> Group:
    group = Group(name=name, description=description)
    db.add(group)
    await db.flush()
    return group


async def list_groups(db: AsyncSession) -> List[Group]:
    result = await db.execute(select(Group))
    return list(result.scalars().all())


async def add_user_to_group(db: AsyncSession, user_id: str, group_id: str) -> bool:
    user = await get_user_by_id(db, user_id)
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if not user or not group:
        return False
    if group not in user.groups:
        user.groups.append(group)
    await db.flush()
    return True


async def assign_permission(
    db: AsyncSession,
    resource_type: str,
    resource_id: str,
    role: str,
    user_id: Optional[str] = None,
    group_id: Optional[str] = None,
) -> Permission:
    perm = Permission(
        user_id=user_id,
        group_id=group_id,
        resource_type=resource_type,
        resource_id=resource_id,
        role=role,
    )
    db.add(perm)
    await db.flush()
    return perm
