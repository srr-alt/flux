#!/usr/bin/env bash
# Generates a dedicated GPG keypair for signing the Flux apt repo, kept in
# its own homedir so it never touches the user's personal GPG keyring.
# Run once; re-running with an existing key here is a no-op check.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GNUPGHOME="$DIR/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

if gpg --homedir "$GNUPGHOME" --list-secret-keys | grep -q "Flux Package Signing"; then
  echo "Signing key already exists in $GNUPGHOME"
  exit 0
fi

gpg --homedir "$GNUPGHOME" --batch --gen-key <<'EOF'
%no-protection
Key-Type: RSA
Key-Length: 4096
Name-Real: Flux Package Signing
Name-Email: ydvsahil0003@gmail.com
Expire-Date: 0
%commit
EOF

gpg --homedir "$GNUPGHOME" --armor --export "Flux Package Signing" > "$DIR/pubkey.gpg"
echo "Public key exported to $DIR/pubkey.gpg"
