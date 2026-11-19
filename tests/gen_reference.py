"""
Genera valores de referencia de alta precisión (50 dígitos) con mpmath.

Uso:
    pip install mpmath
    python tests/gen_reference.py > tests/reference.json
"""
import json
from mpmath import mp, mpf, ncdf, npdf, gammainc, betainc, binomial, gamma, beta, exp, log, sqrt, pi, inf, nsum, factorial

mp.dps = 50

cases = []


def add(dist, fn, params, x, val):
    cases.append({"dist": dist, "fn": fn, "params": params, "x": x, "expected": float(val)})


# ---------------- Normal ----------------
for mu, s in [(0, 1), (100, 16), (-3, 0.25)]:
    for z in [-38, -20, -8.5, -3, -1.96, -0.5, 0, 0.3, 1, 1.96, 5, 9, 25]:
        x = mu + s * z
        add("normal", "cdf", {"mu": mu, "sigma": s}, x, ncdf(x, mu, s))
        add("normal", "sf", {"mu": mu, "sigma": s}, x, ncdf(-x, -mu, s))
        add("normal", "pdf", {"mu": mu, "sigma": s}, x, npdf(x, mu, s))

# ---------------- t de Student ----------------
def t_sf(t, nu):
    t, nu = mpf(t), mpf(nu)
    if t >= 0:
        return betainc(nu / 2, mpf(1) / 2, 0, nu / (nu + t * t), regularized=True) / 2
    return 1 - t_sf(-t, nu)


def t_pdf(t, nu):
    t, nu = mpf(t), mpf(nu)
    return gamma((nu + 1) / 2) / (sqrt(nu * pi) * gamma(nu / 2)) * (1 + t * t / nu) ** (-(nu + 1) / 2)


for nu in [1, 2.5, 5, 30, 1000]:
    for t in [-50, -6, -2.1, -0.4, 0, 0.1, 1.3, 2.5, 8, 200]:
        add("t", "sf", {"nu": nu}, t, t_sf(t, nu))
        add("t", "cdf", {"nu": nu}, t, 1 - t_sf(t, nu) if t >= 0 else t_sf(-t, nu))
        add("t", "pdf", {"nu": nu}, t, t_pdf(t, nu))

# ---------------- Chi-cuadrado ----------------
for k in [1, 2, 5, 17, 150]:
    for x in [0.001, 0.5, 1, 4, 11.07, 30, 120, 200]:
        add("chisq", "cdf", {"k": k}, x, gammainc(mpf(k) / 2, 0, mpf(x) / 2, regularized=True))
        add("chisq", "sf", {"k": k}, x, gammainc(mpf(k) / 2, mpf(x) / 2, inf, regularized=True))
        kk = mpf(k)
        add("chisq", "pdf", {"k": k}, x, mpf(x) ** (kk / 2 - 1) * exp(-mpf(x) / 2) / (2 ** (kk / 2) * gamma(kk / 2)))

# ---------------- F ----------------
for d1, d2 in [(1, 1), (3, 12), (10, 40), (50, 7)]:
    for x in [0.01, 0.4, 1, 2.5, 6, 40]:
        X = mpf(x)
        z = d1 * X / (d1 * X + d2)
        add("f", "cdf", {"d1": d1, "d2": d2}, x, betainc(mpf(d1) / 2, mpf(d2) / 2, 0, z, regularized=True))
        add("f", "sf", {"d1": d1, "d2": d2}, x, betainc(mpf(d1) / 2, mpf(d2) / 2, z, 1, regularized=True))
        dens = sqrt((d1 * X) ** d1 * mpf(d2) ** d2 / (d1 * X + d2) ** (d1 + d2)) / (X * beta(mpf(d1) / 2, mpf(d2) / 2))
        add("f", "pdf", {"d1": d1, "d2": d2}, x, dens)

# ---------------- Gamma ----------------
for k, th in [(0.5, 1), (2, 2), (9, 0.5), (60, 3)]:
    for x in [0.01, 0.5, 2, 5, 20, 150, 300]:
        add("gamma", "cdf", {"k": k, "theta": th}, x, gammainc(mpf(k), 0, mpf(x) / th, regularized=True))
        add("gamma", "sf", {"k": k, "theta": th}, x, gammainc(mpf(k), mpf(x) / th, inf, regularized=True))
        X = mpf(x)
        add("gamma", "pdf", {"k": k, "theta": th}, x, X ** (k - 1) * exp(-X / th) / (gamma(mpf(k)) * mpf(th) ** k))

# ---------------- Beta ----------------
for a, b in [(0.5, 0.5), (2, 5), (30, 40), (200, 3)]:
    for x in [0.001, 0.1, 0.3, 0.5, 0.42857, 0.9, 0.999]:
        add("beta", "cdf", {"alpha": a, "beta": b}, x, betainc(mpf(a), mpf(b), 0, mpf(x), regularized=True))
        add("beta", "sf", {"alpha": a, "beta": b}, x, betainc(mpf(a), mpf(b), mpf(x), 1, regularized=True))
        X = mpf(x)
        add("beta", "pdf", {"alpha": a, "beta": b}, x, X ** (a - 1) * (1 - X) ** (b - 1) / beta(mpf(a), mpf(b)))

# ---------------- Binomial ----------------
def binom_pmf(k, n, p):
    return binomial(n, k) * mpf(p) ** k * (1 - mpf(p)) ** (n - k)


for n, p in [(20, 0.5), (100, 0.22), (1000, 0.03), (5000, 0.7)]:
    ks = sorted(set([0, 1, int(n * p) - 1, int(n * p), int(n * p) + 3, n // 2, n - 1, max(0, int(n * p * 0.5)), min(n, int(n * p * 1.5) + 1)]))
    for k in ks:
        add("binomial", "pmf", {"n": n, "p": p}, k, binom_pmf(k, n, p))
        cdf = sum(binom_pmf(i, n, p) for i in range(0, k + 1))
        sf = sum(binom_pmf(i, n, p) for i in range(k + 1, n + 1))
        add("binomial", "cdf", {"n": n, "p": p}, k, cdf)
        add("binomial", "sf", {"n": n, "p": p}, k, sf)

# ---------------- Poisson ----------------
for lam in [0.3, 4, 37.5, 2500]:
    for k in sorted(set([0, 1, int(lam * 0.5), int(lam), int(lam) + 2, int(lam * 1.6) + 3, int(lam * 3) + 10])):
        L = mpf(lam)
        add("poisson", "pmf", {"lambda": lam}, k, exp(-L) * L ** k / factorial(k))
        add("poisson", "cdf", {"lambda": lam}, k, gammainc(k + 1, L, inf, regularized=True))
        add("poisson", "sf", {"lambda": lam}, k, gammainc(k + 1, 0, L, regularized=True))

# ---------------- Hipergeométrica ----------------
def hyp_pmf(k, N, K, n):
    return binomial(K, k) * binomial(N - K, n - k) / binomial(N, n)


for N, K, n in [(50, 15, 10), (500, 200, 120), (10000, 30, 2000)]:
    lo, hi = max(0, n + K - N), min(n, K)
    for k in sorted(set([lo, lo + 1, (lo + hi) // 3, (lo + hi) // 2, int(n * K / N) + 2, hi - 1, hi])):
        add("hypergeometric", "pmf", {"N": N, "K": K, "n": n}, k, hyp_pmf(k, N, K, n))
        add("hypergeometric", "cdf", {"N": N, "K": K, "n": n}, k, sum(hyp_pmf(i, N, K, n) for i in range(lo, k + 1)))
        add("hypergeometric", "sf", {"N": N, "K": K, "n": n}, k, sum(hyp_pmf(i, N, K, n) for i in range(k + 1, hi + 1)))

# ---------------- Binomial negativa (fracasos) ----------------
def nb_pmf(j, r, p):
    return binomial(j + r - 1, j) * mpf(p) ** r * (1 - mpf(p)) ** j


for r, p in [(3, 0.4), (25, 0.8), (10, 0.05)]:
    for j in [0, 1, 4, 10, 40, 300]:
        params = {"r": r, "p": p, "variant": "failures"}
        add("negbinomial", "pmf", params, j, nb_pmf(j, r, p))
        add("negbinomial", "cdf", params, j, betainc(mpf(r), mpf(j + 1), 0, mpf(p), regularized=True))
        add("negbinomial", "sf", params, j, betainc(mpf(r), mpf(j + 1), mpf(p), 1, regularized=True))

print(json.dumps(cases))
