"""任务状态查询：三个能力共用。前端提交后拿 job_id，轮询这里。"""
from fastapi import APIRouter, HTTPException
from ..schemas import Job
from ..store import get_job

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=Job)
async def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job
