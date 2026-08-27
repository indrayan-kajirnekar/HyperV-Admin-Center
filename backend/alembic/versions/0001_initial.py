"""Initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2024-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True, index=True),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('role', sa.String(50), nullable=False, server_default='read_only'),
        sa.Column('is_active', sa.Boolean, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'groups',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False, unique=True),
        sa.Column('description', sa.String(512)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'user_group_members',
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('group_id', sa.String(36), sa.ForeignKey('groups.id', ondelete='CASCADE'), primary_key=True),
    )
    op.create_table(
        'permissions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('group_id', sa.String(36), sa.ForeignKey('groups.id', ondelete='CASCADE'), nullable=True),
        sa.Column('resource_type', sa.String(50), nullable=False),
        sa.Column('resource_id', sa.String(36), nullable=False),
        sa.Column('role', sa.String(50), nullable=False),
    )
    op.create_table(
        'folders',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('parent_id', sa.String(36), sa.ForeignKey('folders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('description', sa.String(512)),
        sa.Column('quota_storage_gb', sa.Float, nullable=True),
        sa.Column('quota_memory_gb', sa.Float, nullable=True),
        sa.Column('quota_cpu_pct', sa.Float, nullable=True),
        sa.Column('quota_max_vms', sa.Integer, nullable=True),
        sa.Column('soft_quota_storage_gb', sa.Float, nullable=True),
        sa.Column('soft_quota_memory_gb', sa.Float, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        'hypervisors',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('hostname', sa.String(255), nullable=False, unique=True),
        sa.Column('display_name', sa.String(255), nullable=True),
        sa.Column('folder_id', sa.String(36), sa.ForeignKey('folders.id', ondelete='SET NULL'), nullable=True),
        sa.Column('is_online', sa.Boolean, server_default='true'),
        sa.Column('total_cpu_cores', sa.Integer, nullable=True),
        sa.Column('total_memory_gb', sa.Float, nullable=True),
        sa.Column('total_storage_gb', sa.Float, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), nullable=True),
        sa.Column('user_email', sa.String(255), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=False),
        sa.Column('resource_id', sa.String(255), nullable=True),
        sa.Column('resource_name', sa.String(255), nullable=True),
        sa.Column('detail', sa.Text, nullable=True),
        sa.Column('status', sa.String(20), server_default='success'),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])
    op.create_index('ix_audit_logs_resource_type', 'audit_logs', ['resource_type'])


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('hypervisors')
    op.drop_table('folders')
    op.drop_table('permissions')
    op.drop_table('user_group_members')
    op.drop_table('groups')
    op.drop_table('users')
