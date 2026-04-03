from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database_factory import get_db
from app.domains.auth.dependencies import get_current_staff
from app.domains.insurance_extraction.schemas import (
    InsuranceExtractionResponse,
    InsuranceExtractionToEstimateResponse,
    InsuranceExtractionUpdateRequest,
)
from app.domains.insurance_extraction.service import InsuranceExtractionService
from app.domains.staff.models import Staff

router = APIRouter(tags=["Insurance Extractions"])


@router.post(
    "/from-file/{file_id}",
    response_model=InsuranceExtractionResponse,
    status_code=status.HTTP_201_CREATED,
)
def extract_from_file(
    file_id: str,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    service = InsuranceExtractionService(db)
    try:
        extraction = service.extract_from_file_id(file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return extraction


@router.get("/", response_model=list[InsuranceExtractionResponse])
def list_extractions(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    return InsuranceExtractionService(db).list_extractions(limit=limit)


@router.get("/{extraction_id}", response_model=InsuranceExtractionResponse)
def get_extraction(
    extraction_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    extraction = InsuranceExtractionService(db).get_extraction(extraction_id)
    if not extraction:
        raise HTTPException(status_code=404, detail="Extraction not found")
    return extraction


@router.put("/{extraction_id}", response_model=InsuranceExtractionResponse)
def update_extraction(
    extraction_id: UUID,
    request: InsuranceExtractionUpdateRequest,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    service = InsuranceExtractionService(db)
    try:
        extraction = service.update_extraction(extraction_id, request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return extraction


@router.delete("/{extraction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_extraction(
    extraction_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    service = InsuranceExtractionService(db)
    try:
        service.delete_extraction(extraction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return None


@router.post("/{extraction_id}/to-estimate", response_model=InsuranceExtractionToEstimateResponse)
def extraction_to_estimate(
    extraction_id: UUID,
    db: Session = Depends(get_db),
    current_staff: Staff = Depends(get_current_staff),
):
    service = InsuranceExtractionService(db)
    try:
        items = service.to_estimate_items(extraction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return InsuranceExtractionToEstimateResponse(extraction_id=extraction_id, items=items)
