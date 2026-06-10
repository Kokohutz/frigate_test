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

import json
import logging

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/auth/webauthn", tags=["webauthn"])
logger = logging.getLogger(__name__)

# In-memory challenge store (per session — replace with Redis for multi-process)
_pending_challenges: dict[str, bytes] = {}


class WebAuthnRegistrationBeginBody(BaseModel):
    username: str


class WebAuthnRegistrationCompleteBody(BaseModel):
    username: str
    credential: dict  # raw registration response from browser


class WebAuthnAuthBeginBody(BaseModel):
    username: str


class WebAuthnAuthCompleteBody(BaseModel):
    username: str
    credential: dict
    challenge_token: str  # the 2FA challenge token from /login


@router.post("/register/begin")
async def register_begin(body: WebAuthnRegistrationBeginBody, request: Request):
    """Begin WebAuthn credential registration. Returns PublicKeyCredentialCreationOptions."""
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
        user_name=body.username,
        user_display_name=body.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    _pending_challenges[f"reg:{body.username}"] = options.challenge
    return json.loads(webauthn.options_to_json(options))


@router.post("/register/complete")
async def register_complete(body: WebAuthnRegistrationCompleteBody, request: Request):
    """Complete registration and persist the WebAuthn credential."""
    try:
        import webauthn
    except ImportError:
        raise HTTPException(status_code=501, detail="webauthn package not installed")

    challenge = _pending_challenges.pop(f"reg:{body.username}", None)
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

    # Store credential in DB
    from frigate.models import WebAuthnCredential

    WebAuthnCredential.create(
        username=body.username,
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
    _pending_challenges[f"auth:{body.username}"] = options.challenge
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

    cred_id_hex = body.credential.get("id", "").replace("-", "+").replace("_", "/")
    # Find matching credential
    creds = list(
        WebAuthnCredential.select().where(WebAuthnCredential.username == body.username)
    )
    matching = next(
        (
            c
            for c in creds
            if c.credential_id in cred_id_hex or cred_id_hex in c.credential_id
        ),
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


@router.get("/credentials/{username}")
async def list_credentials(username: str, request: Request):
    """List registered WebAuthn credentials for a user."""
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


@router.delete("/credentials/{credential_id}")
async def delete_credential(credential_id: int, request: Request):
    """Delete a WebAuthn credential."""
    from frigate.models import WebAuthnCredential

    deleted = (
        WebAuthnCredential.delete()
        .where(WebAuthnCredential.id == credential_id)
        .execute()
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"status": "ok"}
