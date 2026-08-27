from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    create_access_token, get_current_user,
    verify_password, hash_password,
)
from app.services.user_service import authenticate_user
from app.services.audit_service import record_event

router = APIRouter(prefix="/auth", tags=["auth"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    role: str
    full_name: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


@router.post("/token", response_model=TokenResponse)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    user = await authenticate_user(db, form.username, form.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(subject=user.id, extra={"role": user.role, "email": user.email})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        email=user.email,
        role=user.role,
        full_name=user.full_name,
    )


@router.post("/change-password", status_code=200)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Change the authenticated user's own password.
    Requires current password to be correct — works immediately after a reset.
    """
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current password.",
        )
    current_user.hashed_password = hash_password(body.new_password)
    await db.flush()
    await record_event(
        db, action="auth.change_password", resource_type="user",
        resource_id=current_user.id, resource_name=current_user.email,
        user_id=current_user.id, user_email=current_user.email,
        status="success",
        ip_address=request.client.host if request.client else None,
    )
    return {"changed": True, "email": current_user.email}
