#!/usr/bin/env sh
# L0 (authid R7): a local CA + a host cert whose IP SAN is the pilot LAN origin.
# The pilot origin is an IP address (serve.js listens on the LAN IP), so the cert
# MUST carry that IP as an IP SAN — a DNS-only cert fails the browser secure-context
# probe. ECDSA P-256 for broad browser support (the app's Ed25519 identity keys are
# a separate, app-layer concern). Output is gitignored; the CA private key stays on
# the relay host; install ca.pem on each device (a device without it gets a trust
# error — that is the fence working, not a bug).
#
# Usage:  sh census/make-cert.sh <lan-ip> [outdir]
set -e
IP="${1:?usage: make-cert.sh <lan-ip> [outdir]}"
OUT="${2:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/runtime/tls}"
mkdir -p "$OUT"

# Local CA
openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/ca.key"
openssl req -x509 -new -key "$OUT/ca.key" -sha256 -days 90 \
  -out "$OUT/ca.pem" -subj "/CN=MPR pilot CA"

# Host key + CSR, signed by the CA with the IP SAN
openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/host.key"
openssl req -new -key "$OUT/host.key" -out "$OUT/host.csr" -subj "/CN=$IP"
printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\n' "$IP" > "$OUT/host.ext"
openssl x509 -req -in "$OUT/host.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca.key" \
  -CAcreateserial -sha256 -days 90 -extfile "$OUT/host.ext" -out "$OUT/host.pem"

rm -f "$OUT/host.csr" "$OUT/host.ext" "$OUT/ca.srl"
echo "wrote:"
echo "  $OUT/host.pem   (IP SAN $IP)  <- serve.js CELL_TLS_CERT"
echo "  $OUT/host.key                 <- serve.js CELL_TLS_KEY"
echo "  $OUT/ca.pem                   <- install on BOTH devices"
