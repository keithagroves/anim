# A/B: `exp001-A-baseline` (A) vs `exp001-B-treatment` (B)

7 paired cases.

| case | gate A | gate B | turns A | turns B | latency A | latency B | est. cost A | est. cost B | entries A | entries B | targeted friction A | B | overall p A | B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kubernetes-01-what-is-k8s-s1 | ✅ | ✅ | 22 | 19 | 190s | 204s | $1.11 | $1.03 | 17 | 9 | 1 | 1 | 0.33 | 0.30 |
| kubernetes-01-what-is-k8s-s2 | ✅ | ✅ | 24 | 21 | 87s | 82s | $0.81 | $0.57 | 11 | 8 | 1 | 0 | 0.55 | 0.63 |
| kubernetes-01-what-is-k8s-s3 | ✅ | ✅ | 17 | 18 | 80s | 83s | $0.68 | $0.51 | 17 | 16 | 0 | 0 | 0.40 | 0.42 |
| transformers-01-transformers-s1 | ✅ | ✅ | 23 | 16 | 87s | 96s | $0.64 | $0.58 | 17 | 9 | 1 | 0 | 0.41 | 0.43 |
| transformers-01-transformers-s2 | ✅ | ✅ | 25 | 24 | 186s | 147s | $1.16 | $0.90 | 28 | 11 | 3 | 1 | 0.61 | 0.56 |
| transformers-01-transformers-s3 | ✅ | ✅ | 37 | 19 | 159s | 150s | $1.04 | $0.80 | 16 | 15 | 0 | 1 | 0.62 | 0.63 |
| transformers-01-transformers-s4 | ✅ | ✅ | 33 | 28 | 156s | 139s | $1.04 | $0.89 | 24 | 18 | 3 | 0 | 0.73 | 0.71 |

## Summary (B − A, paired bootstrap over cases)

| metric | median A | median B | mean diff | 95% CI |
|---|---|---|---|---|
| turns | 24.0 | 19.0 | -5.1 | [-10.0, -1.6] |
| gate pass | 1.00 | 1.00 | 0.00 | [0.00, 0.00] |
| latency (s) | 156 | 139 | -6 | [-19, 5] |
| est. cost ($) | 1.04 | 0.80 | -0.17 | [-0.22, -0.12] |
| timeline entries | 17.0 | 11.0 | -6.3 | [-10.6, -3.0] |
| targeted friction mentions (total) | 9 | 3 | -6 | – |
| judge p(overall) | 0.55 | 0.56 | 0.01 | [-0.02, 0.04] |

## Decision rule

1. median turns B ≤ A: ✅
2. gate-pass interval for B − A not entirely below 0: ✅ ([0.00, 0.00])
3. targeted friction B < A: ✅ (3 vs 9)

**Verdict: ACCEPT** (n=7, 1 trial each: directional, not an effect-size claim).

