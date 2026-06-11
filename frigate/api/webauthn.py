"""
WebAuthn (FIDO2 / Passkey) registration and authentication endpoints.

Requires:  pip install webauthn>=2.0.0
Config:    auth.webauthn_rp_id (defaults to hostname)
           auth.webauthn_rp_name (defaults to "Argus NVR")

Flow:
  Register:  POST /auth/webauthn/register/begin  → options JSON
             POST /auth/webauthn/register/complete → stores credential
  Authenticate: POST /auth/webauthn/auth/begin   → options JSON
                POST /auth/webauthn/auth/complete → returns JWT (same as TOTP flow)
"""

import base64
import json
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from frigate.api.auth import require_role

router = APIRouter(prefix="/auth/webauthn", tags=["webauthn"])
logger = logging.getLogger(__name__)

# In-memory challenge store (per session — replace with Redis for multi-process).
# Bounded to avoid unbounded growth from an attacker flooding /auth/begin with
# unique usernames; oldest pending challenges are evicted first.
_MAX_PENDING_CHALLENGES = 1024
_pending_challenges: dict[str, bytes] = {}


def _store_challenge(key: str, challenge: bytes) -> None:
    """Store a pending challenge, evicting the oldest if the store is full."""
    if len(_pending_challenges) >= _MAX_PENDING_CHALLENGES:
        # dict preserves insertion order; drop the oldest entry
        oldest = next(iter(_pending_challenges))
        _pending_challenges.pop(oldest, None)
    _pending_challenges[key] = challenge


def _credential_id_to_hex(raw_id: str) -> str:
    """Decode a base64url WebAuthn credential id to the hex form we store."""
    padded = raw_id + "=" * (-len(raw_id) % 4)
    return base64.urlsafe_b64decode(padded).hex()


def _authenticated_user(request: Request) -> str | None:
    """Return the trusted username set by the /auth endpoint (never the body)."""
    user = request.headers.get("remote-user")
    if not user or user == "anonymous":
        return None
    return user


class WebAuthnRegistrationCompleteBody(BaseModel):
    username: str
    credential: dict  # raw registration response from browser


class WebAuthnAuthBeginBody(BaseModel):
    username: str


class WebAuthnAuthCompleteBody(BaseModel):
    username: str
    credential: dict
    challenge_token: str  # the 2FA challenge token from /login


@router.post("/register/begin", dependencies=[Depends(require_role(["admin"]))])
async def register_begin(request: Request):
    """Begin WebAuthn credential registration. Returns PublicKeyCredentialCreationOptions.

    The credential is always enrolled for the authenticated user (from the
    trusted remote-user header), never a username supplied in the request body.
    """
    try:
        import webauthn
        from webauthn.helpers.structs import (
            AuthenticatorSelectionCriteria,
            UserVerificationRequirement,
        )
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="webauthn package not installed. Run: pip install webauthn>=2.0.0",
        )

    username = _authenticated_user(request)
    if not username:
        raise HTTPException(status_code=401, detail="Authentication required")

    rp_id = (
        getattr(request.app.frigate_config.auth, "webauthn_rp_id", None)
        or request.url.hostname
    )
    rp_name = (
        getattr(request.app.frigate_config.auth, "webauthn_rp_name", None)
        or "Argus NVR"
    )

    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name=rp_name,
        user_name=username,
        user_display_name=username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    _store_challenge(f"reg:{username}", options.challenge)
    return json.loads(webauthn.options_to_json(options))


@router.post("/register/complete", dependencies=[Depends(require_role(["admin"]))])
async def register_complete(body: WebAuthnRegistrationCompleteBody, request: Request):
    """Complete registration and persist the WebAuthn credential."""
    try:
        import webauthn
    except ImportError:
        raise HTTPException(status_code=501, detail="webauthn package not installed")

    username = _authenticated_user(request)
    if not username:
        raise HTTPException(status_code=401, detail="Authentication required")

    challenge = _pending_challenges.pop(f"reg:{username}", None)
    if not challenge:
        raise HTTPException(status_code=400, detail="No pending registration challenge")

    rp_id = (
        getattr(request.app.frigate_config.auth, "webauthn_rp_id", None)
        or request.url.hostname
    )
    expected_origin = f"https://{request.url.hostname}"

    try:
        verification = webauthn.verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=expected_origin,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Registration verification failed: {e}"
        )

    # Store credential in DB for the authenticated user
    from frigate.models import WebAuthnCredential

    WebAuthnCredential.create(
        username=username,
        credential_id=verification.credential_id.hex(),
        public_key=verification.credential_public_key.hex(),
        sign_count=verification.sign_count,
        name=f"Passkey ({request.headers.get('User-Agent', 'unknown')[:40]})",
    )
    return {"status": "ok"}


@router.post("/auth/begin")
async def auth_begin(body: WebAuthnAuthBeginBody, request: Request):
    """Begin WebAuthn authentication. Returns PublicKeyCredentialRequestOptions."""
    try:
        import webauthn
        from webauthn.helpers.structs import UserVerificationRequirement
    except ImportError:
        raise HTTPException(status_code=501, detail="webauthn package not installed")

    from frigate.models import WebAuthnCredential

    creds = list(
        WebAuthnCredential.select().where(WebAuthnCredential.username == body.username)
    )
    if not creds:
        raise HTTPException(
            status_code=404,
            detail="No WebAuthn credentials registered for this user",
        )

    rp_id = (
        getattr(request.app.frigate_config.auth, "webauthn_rp_id", None)
        or request.url.hostname
    )
    allow_credentials = [
        {"id": bytes.fromhex(c.credential_id), "type": "public-key"} for c in creds
    ]

    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    _store_challenge(f"auth:{body.username}", options.challenge)
    return json.loads(webauthn.options_to_json(options))


@router.post("/auth/complete")
async def auth_complete(
    body: WebAuthnAuthCompleteBody, request: Request, response: Response
):
    """Complete WebAuthn authentication and exchange for a session JWT."""
    try:
        import webauthn
    except ImportError:
        raise HTTPException(status_code=501, detail="webauthn package not installed")

    challenge = _pending_challenges.pop(f"auth:{body.username}", None)
    if not challenge:
        raise HTTPException(
            status_code=400, detail="No pending authentication challenge"
        )

    from frigate.models import WebAuthnCredential

    # Decode the client-supplied base64url credential id to the hex form we
    # store, then match byte-for-byte (constant-time). A substring match would
    # let a crafted id collide with the wrong stored credential.
    try:
        cred_id_hex = _credential_id_to_hex(body.credential.get("id", ""))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid credential id")

    creds = list(
        WebAuthnCredential.select().where(WebAuthnCredential.username == body.username)
    )
    matching = next(
        (c for c in creds if secrets.compare_digest(c.credential_id, cred_id_hex)),
        None,
    )
    if not matching:
        raise HTTPException(status_code=400, detail="Unknown credential")

    rp_id = (
        getattr(request.app.frigate_config.auth, "webauthn_rp_id", None)
        or request.url.hostname
    )
    expected_origin = f"https://{request.url.hostname}"

    try:
        verification = webauthn.verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=expected_origin,
            credential_public_key=bytes.fromhex(matching.public_key),
            credential_current_sign_count=matching.sign_count,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {e}")

    # Update sign count
    WebAuthnCredential.update(sign_count=verification.new_sign_count).where(
        WebAuthnCredential.id == matching.id
    ).execute()

    # Exchange the challenge_token (from /login step 1) for a final session JWT
    # Reuse the 2FA token exchange logic from auth.py
    from frigate.api.auth import _exchange_2fa_challenge_for_session

    return await _exchange_2fa_challenge_for_session(
        body.username, body.challenge_token, request, response
    )


@router.get(
    "/credentials/{username}", dependencies=[Depends(require_role(["admin"]))]
)
async def list_credentials(username: str, request: Request):
    """List registered WebAuthn credentials for a user (admin only)."""
    from frigate.models import WebAuthnCredential

    creds = list(
        WebAuthnCredential.select().where(WebAuthnCredential.username == username)
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "credential_id_prefix": c.credential_id[:16] + "...",
        }
        for c in creds
    ]


@router.delete(
    "/credentials/{credential_id}", dependencies=[Depends(require_role(["admin"]))]
)
async def delete_credential(credential_id: int, request: Request):
    """Delete a WebAuthn credential.

    Admins may delete any credential; non-admins (should not reach here given the
    admin dependency, but enforced defensively) may only delete their own.
    """
    from frigate.models import WebAuthnCredential

    try:
        cred = WebAuthnCredential.get_by_id(credential_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Credential not found")

    requester = _authenticated_user(request)
    role = request.headers.get("remote-role")
    if role != "admin" and cred.username != requester:
        raise HTTPException(status_code=403, detail="Not permitted")

    cred.delete_instance()
    return {"status": "ok"}
