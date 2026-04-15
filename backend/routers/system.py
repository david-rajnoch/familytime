"""
System utilities — native macOS folder picker dialog.
"""
import subprocess
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/system")


@router.get("/pick-folder")
def pick_folder():
    """
    Open a native macOS folder selection dialog via osascript.
    Returns the selected POSIX path, or raises 204 if user cancelled.
    """
    script = (
        'set f to choose folder with prompt "Select a folder to index"\n'
        'return POSIX path of f'
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=120,  # user has 2 min to pick
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder picker timed out")

    if result.returncode != 0:
        # Exit 1 with -128 = user cancelled — not an error
        if "-128" in result.stderr:
            raise HTTPException(status_code=204, detail="User cancelled")
        raise HTTPException(status_code=500, detail=f"osascript error: {result.stderr.strip()}")

    path = result.stdout.strip().rstrip("/")
    if not path:
        raise HTTPException(status_code=204, detail="No path returned")

    return {"path": path}
