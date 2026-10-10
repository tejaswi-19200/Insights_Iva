from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate


def list_tasks(db: Session, tenant_id: int) -> list[Task]:
    stmt = (
        select(Task).where(Task.tenant_id == tenant_id).order_by(Task.due_date.is_(None), Task.due_date)
    )
    return list(db.scalars(stmt).all())


def get_task(db: Session, tenant_id: int, task_id: int) -> Task | None:
    return db.scalars(
        select(Task).where(Task.id == task_id, Task.tenant_id == tenant_id)
    ).first()


def create_task(db: Session, payload: TaskCreate) -> Task:
    task = Task(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(
    db: Session, tenant_id: int, task_id: int, payload: TaskUpdate
) -> Task | None:
    task = get_task(db, tenant_id, task_id)
    if not task:
        return None
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, tenant_id: int, task_id: int) -> bool:
    task = get_task(db, tenant_id, task_id)
    if not task:
        return False
    # Clean up child tasks if present
    child_tasks = list(
        db.scalars(
            select(Task).where(
                Task.tenant_id == tenant_id,
                Task.parent_id == task_id,
            )
        ).all()
    )
    for ct in child_tasks:
        db.delete(ct)
    db.delete(task)
    db.commit()
    return True
