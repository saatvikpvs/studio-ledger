from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.db import get_db
from ...core.security import require_owner
from ...ingest.parsers.statement import SYNONYMS, StatementError
from ...models import Account, ImportBatch, StagedRow
from ...schemas import ImportBatchOut, MappingIn, StagedRowPatch
from ...services import importer

router = APIRouter(prefix="/import", tags=["import"],
                   dependencies=[Depends(require_owner)])

ALLOWED = (".csv", ".txt", ".xlsx", ".xlsm")


@router.get("/fields")
def mapping_fields():
    """What the mapping wizard offers, and what each field means."""
    return {
        "fields": [
            {"key": "date", "label": "Date", "required": True,
             "hint": "Value or transaction date"},
            {"key": "description", "label": "Description", "required": True,
             "hint": "Narration or particulars"},
            {"key": "debit", "label": "Withdrawal", "required": False,
             "hint": "Money out, if the statement uses two columns"},
            {"key": "credit", "label": "Deposit", "required": False,
             "hint": "Money in, if the statement uses two columns"},
            {"key": "amount", "label": "Amount", "required": False,
             "hint": "Single signed column, if there is no debit/credit pair"},
            {"key": "drcr", "label": "Dr/Cr flag", "required": False,
             "hint": "Only if the amount column is unsigned"},
            {"key": "balance", "label": "Balance", "required": False,
             "hint": "Lets us verify no rows are missing"},
            {"key": "ref", "label": "Reference / UTR", "required": False,
             "hint": "Improves duplicate detection"},
        ],
        "recognised_headers": SYNONYMS,
    }


@router.post("/upload")
async def upload(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if db.get(Account, account_id) is None:
        raise HTTPException(400, "Pick an account to import into")

    name = (file.filename or "").lower()
    if not name.endswith(ALLOWED):
        raise HTTPException(
            400,
            "Upload a CSV or .xlsx statement. If your bank only gives a PDF, "
            "export to Excel from net banking first.",
        )

    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"That file is over {settings.max_upload_mb} MB")

    digest = importer.file_digest(data)
    previous = importer.previous_import_of(db, account_id, digest)

    try:
        batch, result = importer.stage_file(
            db, account_id=account_id, filename=file.filename or "statement", data=data
        )
    except StatementError as exc:
        raise HTTPException(400, str(exc)) from exc

    db.commit()
    payload = importer.preview(db, batch)
    payload["warnings"] = result.warnings
    payload["needs_mapping"] = result.needs_mapping
    payload["preview_grid"] = result.preview
    payload["columns"] = result.columns
    payload["column_map"] = result.column_map
    payload["header_row"] = result.header_row
    if previous:
        payload["warnings"] = [
            f"You imported this exact file on "
            f"{previous.created_at.date().isoformat()}. Duplicate rows are already "
            "flagged below, so committing again is safe.",
            *payload["warnings"],
        ]
    return payload


@router.post("/{batch_id}/mapping")
async def remap(
    batch_id: int,
    body: MappingIn,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Re-parse an unrecognised statement with the user's own column mapping."""
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "No such import")
    if batch.status != "staged":
        raise HTTPException(400, "That import has already been committed")

    data = await file.read()
    db.delete(batch)
    db.flush()

    try:
        new_batch, result = importer.stage_file(
            db,
            account_id=batch.account_id,
            filename=batch.filename,
            data=data,
            column_map=body.column_map,
            header_row=body.header_row,
        )
    except StatementError as exc:
        raise HTTPException(400, str(exc)) from exc

    db.commit()
    payload = importer.preview(db, new_batch)
    payload["warnings"] = result.warnings
    return payload


@router.get("/{batch_id}/preview")
def preview(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "No such import")
    return importer.preview(db, batch)


@router.patch("/rows/{row_id}")
def patch_row(row_id: int, body: StagedRowPatch, db: Session = Depends(get_db)):
    """Adjust a staged row before committing -- include it, or change its suggestion."""
    row = db.get(StagedRow, row_id)
    if row is None:
        raise HTTPException(404, "No such row")

    if body.include is not None:
        row.include = body.include

    suggestion = dict(row.suggestion or {})
    if body.fund_id is not None:
        suggestion["fund_id"] = body.fund_id
        suggestion["auto_apply"] = True
        suggestion["reason"] = "You set this before importing"
        suggestion["confidence"] = 1.0
    if body.category_id is not None:
        suggestion["category_id"] = body.category_id
    if body.kind is not None:
        suggestion["kind"] = body.kind
    row.suggestion = suggestion

    db.commit()
    return {"id": row.id, "include": row.include, "suggestion": row.suggestion}


@router.post("/{batch_id}/commit")
def commit(
    batch_id: int,
    db: Session = Depends(get_db),
    owner_id: int = Depends(require_owner),
):
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "No such import")
    try:
        result = importer.commit(db, batch, actor_id=owner_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return result


@router.delete("/{batch_id}")
def revert(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(404, "No such import")
    result = importer.revert(db, batch)
    db.commit()
    if result["blocked"]:
        raise HTTPException(
            409,
            {
                "message": "Some rows from this import have been edited or reconciled "
                           "since, so it cannot be undone cleanly.",
                "blocked": result["blocked"],
            },
        )
    return result


@router.get("/history", response_model=list[ImportBatchOut])
def history(db: Session = Depends(get_db)):
    return list(db.scalars(select(ImportBatch).order_by(ImportBatch.id.desc())))
