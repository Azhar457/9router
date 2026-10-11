---
name: cvss-scoring
description: Score a confirmed vulnerability with CVSS v3.1 base metrics and explain each vector choice
---

# CVSS v3.1 Scoring

Score what you actually proved, not what the finding feels like. Every metric must be defensible against the evidence in this run: if you never tested a path, you cannot claim Low complexity for it.

## Base metrics

| Metric | Values | Decide by asking |
| --- | --- | --- |
| **AV** Attack Vector | N / A / L / P | Can it be reached over the network? Over the same LAN? Only after stealing valid credentials? Only by physically using the machine? |
| **AC** Attack Complexity | L / H | Does it need a race condition, a specific sequence of operations, or conditions outside your control? |
| **PR** Privileges Required | N / L / H | None, or a normal account, or an admin account? |
| **UI** User Interaction | N / R | Reachable with zero clicks from the attacker, or must a victim visit a URL? |
| **S** Scope | U / C | Damage stays inside the vulnerable authority, or does it break out into a different security authority (e.g. sandbox escape, container escape)? |
| **C/I/A** Impact | N / L / H | Confidentiality, Integrity, Availability — judged on the worst realistic outcome you demonstrated. |

## Building the vector

Format: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`

The order after the prefix is fixed: AV, AC, PR, UI, S, C, I, A. Omit nothing.

## Scoring it

1. Convert each letter to its numeric value: `N=0`, `L=0.22`, `H=0.56`.
2. **ISS** (Impact Subscore) — for Scope Unchanged: `1 − (1−C) × (1−I) × (1−A)`
   For Scope Changed: `1.1 × (1−C) × (1−I) × (1−A)`
3. **Exploitability** = `8.22 × AV × AC × PR × UI`
   - AV: N=0.85, A=0.62, L=0.55, P=0.2
   - AC: L=0.77, H=0.44
   - PR (Scope Unchanged): N=0.85, L=0.62, H=0.27
   - PR (Scope Changed): N=0.85, L=0.68, H=0.50
   - UI: N=0.85, R=0.62
4. **BaseScore**: if Impact ≤ 0, score is `0`. Otherwise Scope Unchanged is `roundup(min(Impact+Exploitability, 10))`, Scope Changed is `roundup(min(1.08 × (Impact+Exploitability), 10))`.
5. **roundup** = round to one decimal, always upward.

## Rating bands

| Score | Rating |
| --- | --- |
| 0.0 | None |
| 0.1–3.9 | Low |
| 4.0–6.9 | Medium |
| 7.0–8.9 | High |
| 9.0–10.0 | Critical |

## Honesty rules

- If you proved read-only access to data you should not have, that is Confidentiality H, Integrity N — do not inflate to all three because the word "SQL injection" usually implies them all.
- Unauthenticated remote is not automatic Scope Changed. Scope only changes when the exploit compromises resources beyond the vulnerable component's authority.
- If you could not reach the vulnerable path, you have no vector at all. Say "not scored — not verified" instead of estimating.
- Record the vector you actually used, and be ready to explain each letter from evidence in this run.

## Worked example

An unauthenticated SQLi on a login form, proven by a real quote-based extraction returning the admin row: `AV:N`, `AC:L`, `PR:N`, `UI:N`, `S:U`, `C:H`, `I:H`, `A:L`.

ISS = 1 − (1−0.56)(1−0.56)(1−0.22) = 1 − 0.1936 = 0.8064
Exploitability = 8.22 × 0.85 × 0.77 × 0.85 × 0.85 = 4.07
Base = roundup(min(0.8064 + 4.07, 10)) = **8.8 → High**

If Availability were H as well, the same metrics give `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` = 9.8 Critical — but only claim A:H if you actually showed the service going down.