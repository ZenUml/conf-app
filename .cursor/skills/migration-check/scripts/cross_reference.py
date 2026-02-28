#!/usr/bin/env python3
"""Cross-reference forge_sites.txt, connect_sites.txt, and mixpanel_active.txt.

Run after the three query scripts. All files should be in the current directory.

Usage: python3 cross_reference.py
"""
from pathlib import Path


def load_file(name):
    p = Path(name)
    if not p.exists():
        print(f"Warning: {name} not found, treating as empty")
        return set()
    return set(line.strip() for line in p.read_text().splitlines() if line.strip())


forge_sites = load_file("forge_sites.txt")
connect_domains = load_file("connect_sites.txt")
mixpanel_domains = load_file("mixpanel_active.txt")

# Normalize: forge_sites have .atlassian.net, connect/mixpanel may not
forge_normalized = set(s.replace(".atlassian.net", "") for s in forge_sites)

on_forge = connect_domains & forge_normalized
connect_only = connect_domains - forge_normalized
active_connect_only = sorted(mixpanel_domains & connect_only)
active_on_forge = mixpanel_domains & forge_normalized
ghost = sorted(mixpanel_domains - connect_only - forge_normalized)

print("=" * 60)
print("MIGRATION STATUS REPORT")
print("=" * 60)
print()
print(f"{'Forge installations:':<35} {len(forge_sites)}")
print(f"{'Connect installations (D1):':<35} {len(connect_domains)}")
print(f"{'Active clients (Mixpanel):':<35} {len(mixpanel_domains)}")
print()
print(f"{'On both Connect + Forge:':<35} {len(on_forge)}")
print(f"{'Connect only:':<35} {len(connect_only)}")
print(f"{'Active on Forge:':<35} {len(active_on_forge)}")
print(f"{'Active connect-only:':<35} {len(active_connect_only)}")
print(f"{'Ghost (Mixpanel only):':<35} {len(ghost)}")
print()

if active_connect_only:
    print(f"Active connect-only ({len(active_connect_only)}):")
    for d in active_connect_only:
        print(f"  {d}.atlassian.net")
    print()

if ghost:
    print(f"Ghost — in Mixpanel but not in D1 or Forge ({len(ghost)}):")
    for d in ghost:
        print(f"  {d}")
    print()

inactive_connect = sorted(connect_only - mixpanel_domains)
print(f"Inactive connect-only ({len(inactive_connect)}):")
if len(inactive_connect) <= 20:
    for d in inactive_connect:
        print(f"  {d}.atlassian.net")
else:
    for d in inactive_connect[:10]:
        print(f"  {d}.atlassian.net")
    print(f"  ... and {len(inactive_connect) - 10} more")
