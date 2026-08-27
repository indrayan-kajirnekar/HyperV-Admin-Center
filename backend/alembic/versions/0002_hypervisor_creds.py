"""Add winrm_username and winrm_password to hypervisors

Revision ID: 0002_hypervisor_creds
Revises: 0001_initial
Create Date: 2024-01-02 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0002_hypervisor_creds'
down_revision = '0001_initial'
branch_labels = None
depends_on = None


def _col_exists(table: str, col: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": col})
    return result.fetchone() is not None


def upgrade() -> None:
    if not _col_exists('hypervisors', 'winrm_username'):
        op.add_column('hypervisors', sa.Column('winrm_username', sa.String(255), nullable=True))
    if not _col_exists('hypervisors', 'winrm_password'):
        op.add_column('hypervisors', sa.Column('winrm_password', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('hypervisors', 'winrm_password')
    op.drop_column('hypervisors', 'winrm_username')
