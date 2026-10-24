#!/usr/bin/env python3
"""Retired outbound entry point.

Customer communication now belongs to customer-followup. This old CLI created
support tickets on behalf of technical contacts and used reseller presence to
choose the offer. It must not silently turn a draft request into a ticket.
The grant helper remains available in grant_extension.py.
"""
import sys


def main():
    print("outbound_contact.py is retired. Use customer-followup to prepare a role-appropriate "
          "draft, use the user's authorised channel/recipients, and verify the actual result. "
          "No message or ticket was created.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
