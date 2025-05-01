#!/bin/bash
# Script to delete draft GitHub releases from the previous month
# Usage: ./delete-draft-releases.sh [YYYY.MM]

# Get current date info
CURRENT_YEAR=$(date +"%Y")
CURRENT_MONTH=$(date +"%m")

# Calculate previous month
if [ "$CURRENT_MONTH" == "01" ]; then
  PREV_MONTH="12"
  PREV_YEAR=$((CURRENT_YEAR - 1))
else
  PREV_MONTH=$(printf "%02d" $((10#$CURRENT_MONTH - 1)))
  PREV_YEAR=$CURRENT_YEAR
fi

# Format as YYYY.MM
TARGET_MONTH="${PREV_YEAR}.${PREV_MONTH}"

# Allow override via command line argument
if [ $# -eq 1 ]; then
  TARGET_MONTH=$1
fi

echo "Searching for draft releases from $TARGET_MONTH..."

# List draft releases for the target month and delete them
RELEASES=$(gh release list --limit 100 | grep "Draft" | grep "$TARGET_MONTH" | awk '{print $1}')

if [ -z "$RELEASES" ]; then
  echo "No draft releases found for $TARGET_MONTH."
  exit 0
fi

echo "Found the following draft releases to delete:"
echo "$RELEASES"
echo ""

# Confirm before deletion
read -p "Do you want to delete these draft releases? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
  echo "Operation cancelled."
  exit 0
fi

# Delete each release
echo "$RELEASES" | xargs -t -n1 gh release delete

echo "Completed deleting draft releases for $TARGET_MONTH."
