"""Department setup, exceptions and audited department-scope rollout endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas.department import (
    DepartmentCandidateUserRead,
    DepartmentCreate,
    DepartmentExceptionRead,
    DepartmentExceptionUpdate,
    DepartmentPeopleUpdate,
    DepartmentRead,
    DepartmentScopingRead,
    DepartmentScopingUpdate,
    DepartmentServiceOption,
    DepartmentServicesUpdate,
    DepartmentUpdate,
    UnassignedEmployeeGroup,
)
from app.services import department_service

router = APIRouter(prefix="/departments", tags=["departments"])
Database = Annotated[Session, Depends(get_db)]
DepartmentAdmin = Annotated[User, Depends(require_capability("departments.manage"))]


@router.get("", response_model=list[DepartmentRead])
def list_departments(
    db: Database, _user: Annotated[User, Depends(get_current_user)]
) -> list[DepartmentRead]:
    return department_service.list_departments(db)


@router.post("", response_model=DepartmentRead, status_code=201)
def create_department(
    body: DepartmentCreate, db: Database, user: DepartmentAdmin
) -> DepartmentRead:
    return department_service.create_department(db, body, actor=user.email)


@router.get("/candidate-users", response_model=list[DepartmentCandidateUserRead])
def candidate_users(db: Database, _user: DepartmentAdmin) -> list[DepartmentCandidateUserRead]:
    return department_service.candidate_users(db)


@router.get("/service-options", response_model=list[DepartmentServiceOption])
def service_options(db: Database, _user: DepartmentAdmin) -> list[DepartmentServiceOption]:
    return department_service.service_options(db)


@router.get("/exceptions", response_model=list[DepartmentExceptionRead])
def list_exceptions(db: Database, _user: DepartmentAdmin) -> list[DepartmentExceptionRead]:
    return department_service.list_exceptions(db)


@router.put("/exceptions/{employee_id}", response_model=DepartmentExceptionRead)
def put_exception(
    employee_id: str, body: DepartmentExceptionUpdate, db: Database, user: DepartmentAdmin
) -> DepartmentExceptionRead:
    return department_service.put_exception(db, employee_id, body.department_id, actor=user.email)


@router.delete("/exceptions/{employee_id}", status_code=204)
def delete_exception(employee_id: str, db: Database, user: DepartmentAdmin) -> Response:
    department_service.delete_exception(db, employee_id, actor=user.email)
    return Response(status_code=204)


@router.get("/unassigned-employees", response_model=list[UnassignedEmployeeGroup])
def unassigned_employees(db: Database, _user: DepartmentAdmin) -> list[UnassignedEmployeeGroup]:
    return department_service.unassigned_employees(db)


@router.get("/scoping", response_model=DepartmentScopingRead)
def read_scoping(db: Database, _user: DepartmentAdmin) -> DepartmentScopingRead:
    return department_service.read_scoping(db)


@router.put("/scoping", response_model=DepartmentScopingRead)
def set_scoping(
    body: DepartmentScopingUpdate, db: Database, user: DepartmentAdmin
) -> DepartmentScopingRead:
    return department_service.set_scoping(db, body.enabled, actor=user.email)


@router.patch("/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: int, body: DepartmentUpdate, db: Database, user: DepartmentAdmin
) -> DepartmentRead:
    return department_service.update_department(db, department_id, body, actor=user.email)


@router.delete("/{department_id}", status_code=204)
def delete_department(department_id: int, db: Database, user: DepartmentAdmin) -> Response:
    department_service.delete_department(db, department_id, actor=user.email)
    return Response(status_code=204)


@router.put("/{department_id}/people", response_model=DepartmentRead)
def replace_people(
    department_id: int, body: DepartmentPeopleUpdate, db: Database, user: DepartmentAdmin
) -> DepartmentRead:
    return department_service.replace_people(
        db, department_id, body.deputy_user_ids, body.viewer_user_ids, actor=user.email
    )


@router.put("/{department_id}/services", response_model=DepartmentRead)
def replace_services(
    department_id: int, body: DepartmentServicesUpdate, db: Database, user: DepartmentAdmin
) -> DepartmentRead:
    return department_service.replace_services(
        db, department_id, body.service_ids, actor=user.email
    )
