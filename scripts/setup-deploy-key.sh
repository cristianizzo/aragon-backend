#!/bin/bash
# Setup GitHub deploy key for aragon-backend repo

mkdir -p ~/.ssh

# Generate deploy key if it doesn't exist
if [ ! -f ~/.ssh/aragon_deploy ]; then
  ssh-keygen -t ed25519 -C "aragon-indexer-deploy" -f ~/.ssh/aragon_deploy -N ""
  echo ""
  echo "=== PUBLIC KEY (add to GitHub repo Settings > Deploy Keys > Add deploy key) ==="
  echo "=== Enable 'Allow write access' ==="
  echo "=== URL: https://github.com/cristianizzo/aragon-backend/settings/keys ==="
  echo ""
  cat ~/.ssh/aragon_deploy.pub
  echo ""
fi

# Write SSH config
printf 'Host github-aragon\n  HostName github.com\n  User git\n  IdentityFile %s/.ssh/aragon_deploy\n  IdentitiesOnly yes\n' "$HOME" > ~/.ssh/config
chmod 600 ~/.ssh/config

# Update git remote
cd /opt/workspace/aragon-indexer
git remote set-url origin git@github-aragon:cristianizzo/aragon-backend.git 2>/dev/null

# Test connection
echo ""
echo "Testing SSH connection..."
ssh -T git@github-aragon 2>&1
