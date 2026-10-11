---
name: cve-lookup
description: Identify whether a detected technology or confirmed flaw maps to a known CVE, and verify the match rather than assuming it
---

# CVE Lookup

A CVE is an identity, not proof. Matching a banner string to a CVE is a hypothesis — it only becomes a finding when you show the vulnerable behavior on this target.

## Finding the CVE

**From the technology itself.** First pin down the exact product and version, not the family. `Server: nginx/1.18.0` is a version; `nginx` is not.

**From the vulnerability class.** Search the class plus the product: `OpenSSL 1.1.1 CVE`, `Apache HTTP Server 2.4.49 path traversal CVE`.

**From the behaviour you already saw.** When a scan or response matches a known advisory signature, the identifier often arrives with it — nuclei templates embed it, nikto prints it, scanner output names it. Prefer that over guessing.

**Offline sources in this sandbox:**

```bash
# Exact product and version
searchsploit <term>

# Local exploit database — pairs CVE with a working PoC
searchsploit -t <product> <version>
searchsploit --cve <CVE-YYYY-NNNN>

# CVE and exploit listings for a product
curl -s "https://cve.circl.lu/api/search/<product>" | jq '.data[0:5]'
```

## Verifying the match

A CVE applies only if all of these hold:

1. **The product matches.** Same project, not a lookalike.
2. **The version is inside the affected range.** `>= 2.4.49 < 2.4.51` means 2.4.50 is affected and 2.4.52 is not.
3. **The vulnerable configuration matches.** Many advisories require a specific module, directive, or platform.
4. **You demonstrated the behaviour.** The CVE ID alone is a lead, not a finding.

Check the version boundary against your evidence before writing it down. "This version is affected" is a claim that can be checked in one command, and getting it wrong is how CVE lists go stale.

## Using the result

- If the vulnerable path is in scope and you can reach it, confirm the behaviour with a PoC from the exploit database, then treat the CVE as identification for a finding you already proved.
- If the version is affected but you cannot reach the path, record it as an unverified candidate in `not_tested`, with the advisory reference and why you could not test it.
- If the version is outside the range, say so explicitly. "2.4.52 ships the fix" is a real result and stops the reader from chasing a dead advisory.

## Honesty rules

- Never attach a CVE to a finding you did not demonstrate. The severity comes from what you proved; the CVE is a label on top of it.
- Do not claim a CVE because the product name matches — forks and rebuilds often carry different patch levels, and distro backports break version-based reasoning entirely.
- State the range that makes it apply. "Affected < 2.4.51" is checkable; "this might be related to a CVE" is noise.
- If the local exploit database has a PoC, treat that as a starting point and read what it actually does before running it against the target.