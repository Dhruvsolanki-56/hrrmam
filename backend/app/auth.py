"""Who is calling. DEMO identity: the client sends the chosen user's id (header `X-User-Id`, or `?uid=` for file downloads).
There are no passwords yet; replace `current_user` with real sign-in (SSO / email + password) before production use.
Permissions are enforced on the server from the user's role, so the rules below hold whichever sign-in is used."""
from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


def current_user(x_user_id: int | None = Header(default=None), uid: int | None = Query(default=None),
                 db: Session = Depends(get_db)) -> User:
    user_id = x_user_id or uid
    user = db.get(User, user_id) if user_id else None
    if not user or not user.active:
        raise HTTPException(401, "Please sign in.")
    return user
