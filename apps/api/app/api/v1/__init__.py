from fastapi import APIRouter

from . import auth, imports, insights, projects, reference, transactions

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(reference.router)
api_router.include_router(projects.router)
api_router.include_router(transactions.router)
api_router.include_router(imports.router)
api_router.include_router(insights.router)
