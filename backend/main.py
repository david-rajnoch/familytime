from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import index, persons, files, search, system


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Mark any jobs that were running when the process last died as interrupted
    from database import get_conn
    from datetime import datetime
    conn = get_conn()
    conn.execute(
        """UPDATE indexing_jobs
           SET status = 'error', error_msg = 'Interrupted (server restart)',
               finished_at = ?
           WHERE status IN ('running', 'clustering')""",
        (datetime.utcnow().isoformat(),),
    )
    conn.commit()
    conn.close()
    yield


app = FastAPI(title="FamilyTime API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(index.router)
app.include_router(persons.router)
app.include_router(files.router)
app.include_router(search.router)
app.include_router(system.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
