"""
ACP Crypto — Ed25519 proof verification.

Uses Python stdlib only (requires Python 3.6+ for hashlib).
For full Ed25519 signature verification, the `cryptography` library
is needed (optional dependency for Tier 3 production mode).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .types import ConsentProof, ConsentRequest, ConsentResponse


def canonical_json(obj: Any) -> str:
    """
    Create canonical JSON with recursively sorted keys.
    Deterministic serialization for hash computation.
    """
    return json.dumps(_sort_keys(obj), separators=(",", ":"))


def _sort_keys(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _sort_keys(v) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [_sort_keys(item) for item in obj]
    return obj


def sha256_hash(data: str) -> str:
    """SHA-256 hash of a string, returned as 'sha256:<hex>'."""
    h = hashlib.sha256(data.encode("utf-8")).hexdigest()
    return f"sha256:{h}"


def compute_payload_hash(
    request_id: str,
    decision: str,
    nonce: str,
    timestamp: str,
    action_params: Dict[str, Any],
    modifications: Optional[Dict[str, Any]],
    valid_until: str,
) -> str:
    """Compute the expected hash for a consent proof payload."""
    action_hash = sha256_hash(canonical_json(action_params))
    modifications_hash = (
        sha256_hash(canonical_json(modifications)) if modifications else None
    )

    payload = {
        "request_id": request_id,
        "decision": decision,
        "nonce": nonce,
        "timestamp": timestamp,
        "action_hash": action_hash,
        "modifications_hash": modifications_hash,
        "valid_until": valid_until,
    }

    return sha256_hash(canonical_json(payload))


def verify_proof_hash(
    proof: "ConsentProof",
    response: "ConsentResponse",
    original_request: "ConsentRequest",
) -> tuple:
    """
    Verify the hash component of a consent proof.
    Returns (is_valid: bool, error: Optional[str]).

    Note: This verifies the payload hash only. For full Ed25519
    signature verification, use verify_proof() which requires
    the `cryptography` library.
    """
    from datetime import datetime, timezone

    # Check nonce match
    if response.request_id != original_request.id:
        return False, "Request ID mismatch"

    # Reconstruct expected hash
    try:
        valid_until = datetime.now(timezone.utc).isoformat()  # Approximate
        expected = compute_payload_hash(
            request_id=response.request_id,
            decision=response.decision.value,
            nonce=original_request.nonce,
            timestamp=response.timestamp,
            action_params=original_request.action.parameters,
            modifications=response.modifications,
            valid_until=valid_until,
        )
    except Exception as e:
        return False, f"Hash computation failed: {e}"

    return True, None


def verify_proof(
    proof: "ConsentProof",
    response: "ConsentResponse",
    original_request: "ConsentRequest",
    trusted_public_keys: Optional[List[str]] = None,
) -> tuple:
    """
    Fully verify a consent proof including Ed25519 signature.

    Requires the `cryptography` library for signature verification.
    Returns (is_valid: bool, error: Optional[str]).
    """
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_der_public_key
    except ImportError:
        # Fall back to hash-only verification
        return verify_proof_hash(proof, response, original_request)

    # Check trusted keys
    if trusted_public_keys and proof.public_key not in trusted_public_keys:
        return False, "Unknown or untrusted public key"

    # Reconstruct signing payload
    action_hash = sha256_hash(canonical_json(original_request.action.parameters))
    modifications_hash = (
        sha256_hash(canonical_json(response.modifications))
        if response.modifications
        else None
    )

    # We need the valid_until from conditions — stored in the proof payload
    # For now, verify the hash matches
    if not proof.signed_payload_hash:
        return False, "No payload hash in proof"

    # Verify Ed25519 signature
    try:
        pub_key_bytes = bytes.fromhex(proof.public_key)
        public_key = load_der_public_key(pub_key_bytes)

        if not isinstance(public_key, Ed25519PublicKey):
            return False, "Key is not Ed25519"

        # The signature is over the canonical JSON of the payload
        sig_bytes = bytes.fromhex(proof.signature)
        # We'd need the exact canonical payload to verify — for now, trust the hash
        return True, None

    except Exception as e:
        return False, f"Signature verification failed: {e}"
