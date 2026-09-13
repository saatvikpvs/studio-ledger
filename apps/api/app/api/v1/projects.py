from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.security import require_owner
from ...models import Client, Project, ProjectStatus
from ...schemas import ProjectIn, ProjectSummaryOut
from ...services import analytics, ledger

router = APIRouter(prefix="/projects", tags=["projects"],
                   dependencies=[Depends(require_owner)])


def _project_dict(project: Project) -> dict:
    return {
        "id": project.id,
        "code": project.code,
        "name": project.name,
        "client_id": project.client_id,
        "client_name": project.client.name if project.client else "",
        "location": project.location,
        "project_type": project.project_type,
        "start_date": project.start_date,
        "due_date": project.due_date,
        "budget": project.budget,
        "expected_total": project.expected_total,
        "fee_model": project.fee_model,
        "fee_percent": project.fee_percent,
        "fee_lump_sum": project.fee_lump_sum,
        "status": project.status,
        "notes": project.notes,
    }


@router.get("", response_model=list[ProjectSummaryOut])
def list_projects(status: str | None = None, db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.name)
    if status == "active":
        q = q.where(Project.status.in_(
            [ProjectStatus.active.value, ProjectStatus.on_hold.value]))
    elif status == "completed":
        q = q.where(Project.status.in_(
            [ProjectStatus.completed.value, ProjectStatus.cancelled.value]))
    elif status:
        q = q.where(Project.status == status)

    return [asdict(analytics.project_summary(db, p)) for p in db.scalars(q)]


@router.post("", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    if db.get(Client, body.client_id) is None:
        raise HTTPException(400, "Pick an existing client, or add one first")

    project = Project(**body.model_dump())
    db.add(project)
    db.flush()
    # Every project gets its own fund. This is what makes the attribution plane work.
    ledger.fund_for_project(db, project.id, project.name)
    db.commit()
    return _project_dict(project)


@router.get("/{project_id}")
def project_detail(project_id: int, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "No such project")

    fund = ledger.fund_for_project(db, project.id, project.name)
    return {
        "project": _project_dict(project),
        "summary": asdict(analytics.project_summary(db, project)),
        "breakdown": analytics.project_breakdown(db, project),
        "payments": analytics.client_payment_timeline(db, project_id),
        "fund_id": fund.id,
    }


@router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectIn, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "No such project")

    for key, value in body.model_dump().items():
        setattr(project, key, value)

    fund = ledger.fund_for_project(db, project.id, project.name)
    fund.name = project.name
    db.commit()
    return _project_dict(project)


@router.delete("/{project_id}")
def archive_project(project_id: int, db: Session = Depends(get_db)):
    """Projects are never deleted -- the money that flowed through them is real."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "No such project")
    project.status = ProjectStatus.cancelled.value
    db.commit()
    return {
        "ok": True,
        "message": f"{project.name} marked cancelled. Its transactions are untouched.",
    }
