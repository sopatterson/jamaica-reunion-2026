#!/bin/zsh
# deploy.sh — Commit and push changes to trigger GitHub Pages deployment

MESSAGE="${1:-Update website content}"

git add -A
git commit -m "$MESSAGE"
git push origin main

echo ""
echo "✓ Pushed to GitHub. Site will update at:"
echo "  https://sopatterson.github.io/jamaica-reunion-2026/"
