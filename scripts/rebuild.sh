#!/bin/bash
# Rebuild Pixel Agents extension VSIX with the correct Node environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Pixel Agents Rebuild Script ==="

# Load nvm
if [ -f "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    echo "Loading nvm from Homebrew..."
    source "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -f "$HOME/.nvm/nvm.sh" ]; then
    echo "Loading nvm from user home..."
    source "$HOME/.nvm/nvm.sh"
fi

if command -v nvm &> /dev/null; then
    if [ -f "$PROJECT_ROOT/.nvmrc" ]; then
        REQUIRED_NODE=$(cat "$PROJECT_ROOT/.nvmrc")
        echo "Found .nvmrc specifying Node version $REQUIRED_NODE"
        nvm use "$REQUIRED_NODE" || nvm install "$REQUIRED_NODE"
    else
        echo "Using default stable Node version..."
        nvm use stable || nvm use v24.14.0
    fi
else
    echo "Warning: nvm command not found. Using current system Node ($(node -v))."
fi

cd "$PROJECT_ROOT"
echo "Starting package build..."
npm run vsix
