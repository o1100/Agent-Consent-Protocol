"""
ACP — Cryptographic Proof Verification (Tier 3)

Optional. Only needed when verifying Ed25519 proofs from the gateway.
Uses hashlib (stdlib) for hashing, and optionally `cryptography` for Ed25519.

Install with: pip install acp-sdk[crypto]
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from .types import ConsentProof


def canonical_json(obj: Any) -> str:
    """Create canonical JSON: sorted keys, no whitespace."""
    return json.dumps(_sort_keys(obj), separators=(",", ":"))


def _sort_keys(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sort_keys(v) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [_sort_keys(item) for item in obj]
    return obj


def sha256_hash(data: str) -> str:
    """SHA-256 hash as 'sha256:<hex>'."""
    return f"sha256:{hashlib.sha256(data.encode()).hexdigest()}"


def verify_proof(
    proof: ConsentProof,
    request_id: str,
    decision: str,
    nonce: str,
    timestamp: str,
    action_parameters: Dict[str, Any],
    modifications: Optional[Dict[str, Any]],
    valid_until: str,
    trusted_public_keys: List[str],
) -> bool:
    """
    Verify a consent proof from the gateway.

    Returns True if valid, raises ValueError on failure.
    Requires `pip install acp-sdk[crypto]` for signature verification.
    """
    if proof.public_key not in trusted_public_keys:
        raise ValueError(f"Unknown public key: {proof.public_key[:20]}...")

    action_hash = sha256_hash(canonical_json(action_parameters))
    mods_hash = sha256_hash(canonical_json(modifications)) if modifications else None

    payload = {
        "action_hash": action_hash,
        "decision": decision,
        "modifications_hash": mods_hash,
        "nonce": nonce,
        "request_id": request_id,
        "timestamp": timestamp,
        "valid_until": valid_until,
    }

    canonical = canonical_json(payload)
    expected_hash = sha256_hash(canonical)

    if proof.signed_payload_hash != expected_hash:
        raise ValueError("Payload hash mismatch — data may have been tampered with")

    # Ed25519 verification (optional dependency)
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_der_public_key

        public_key = load_der_public_key(bytes.fromhex(proof.public_key))
        if not isinstance(public_key, Ed25519PublicKey):
            raise ValueError("Key is not Ed25519")
        public_key.verify(
            bytes.fromhex(proof.signature),
            canonical.encode(),
        )
    except ImportError:
        import warnings
        warnings.warn(
            "Ed25519 verification skipped — install with: pip install acp-sdk[crypto]",
            stacklevel=2,
        )

    return True
