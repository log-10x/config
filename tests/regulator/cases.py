"""Regulator cases for tests/regulator/run.sh: write each case's input and policy
files, then check what the engine routed.

  python3 cases.py list
  python3 cases.py prepare <case> <dir>   writes <dir>/events.log, <dir>/policy/*, <dir>/args, <dir>/env
  python3 cases.py check <case> <dir>     reads <dir>/routed.jsonl and <dir>/exit, prints PASS or FAIL

Every line of a pattern has the same byte length, so caps and totals in bytes are
exact line counts. Floors are 0 on the shipped configuration, so the expected
counts are exact, not statistical.
"""
import json
import os
import random
import sys
from collections import Counter, defaultdict

FUTURE = 4102444800  # 2100-01-01, an expiry that never passes during a run
# Words the engine names as constants; a word it reads as a variable (lima, quebec, romeo)
# would merge two patterns into one.
WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india",
         "juliet", "kilo", "billing", "mike", "november", "oscar", "papa", "search", "session",
         "sierra", "tango"]


def record(container, msg):
    return json.dumps({"stream": "stdout", "log": msg,
                       "kubernetes": {"container_name": container, "namespace_name": "default",
                                      "pod_name": container + "-7d9f8b6c5-x2k4p", "host": "node-1"}},
                      separators=(",", ":"))


def info_line(container, word, i):
    return record(container, "2026-10-18T10:00:00.000Z INFO %s request served id=%06d" % (word, i))


def error_line(container, i):
    return record(container, "2026-10-18T10:00:00.000Z ERROR payment failed for order %06d: upstream timeout" % i)


def size(line):
    return len(line.encode("utf-8"))


def csv(header, rows):
    return header + "\n" + "".join("%s,%s\n" % r for r in rows)


def shuffled(lines, seed):
    lines = list(lines)
    random.Random(seed).shuffle(lines)
    return lines


# Each case returns (lines, files, args, env, expect). `files` maps policy file
# names to contents; `env` names the policy files the engine reads; `expect` is
# what check() asserts on the fix.

def case_k1_errors():
    """4a.3: 1,000 ERROR lines over an 8-line cap pass the cap's 8, then exactly K = 50."""
    lines = [error_line("svc", i) for i in range(1000)]
    b = size(lines[0])
    files = {"caps.csv": csv("container,cap", [("svc", 8 * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    return lines, files, ["rateReceiverWarmupMs", "0"], ["CAP", "ACTION"], {"pass": {"ERROR": 58}}


def case_k2_mute():
    """Ruling 15: under a 0.0 mute (mute + cap file variant), ERROR passes exactly K = 50."""
    lines = [error_line("svc", i) for i in range(1000)]
    b = size(lines[0])
    files = {"caps.csv": csv("container,cap", [("svc", 8 * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")]),
             "mutes.csv": csv("fieldSet,value", [("payment_failed_order_upstream_timeout", "0:%d:test" % FUTURE)])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverLookupFile", "/policy/mutes.csv"]
    return lines, files, args, ["CAP", "ACTION"], {"pass": {"ERROR": 50}}


def case_k3_mute_nocap():
    """Ruling 15: under a 0.0 mute with no cap file (mute-only variant), ERROR passes exactly K = 50."""
    lines = [error_line("svc", i) for i in range(1000)]
    files = {"mutes.csv": csv("fieldSet,value", [("payment_failed_order_upstream_timeout", "0:%d:test" % FUTURE)])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverLookupFile", "/policy/mutes.csv"]
    return lines, files, args, [], {"pass": {"ERROR": 50}}


def case_k4_keepcounts_unset():
    """keepCounts removed from config: the module's settings.yaml still sets K = 50, so the launch
    works and ERROR passes the cap's 8 plus 50."""
    lines, files, args, env, _ = case_k1_errors()
    return lines, files, args, env, {"pass": {"ERROR": 58}, "config": "no-keepcounts"}


def case_u1_events():
    """4a.2: unit events, cap 40: exactly 40 lines pass whatever their byte size."""
    rng = random.Random(5)
    lines = [record("svc", "2026-10-18T10:00:00.000Z INFO upload stored blob=%s" %
                    ("".join(rng.choice("0123456789abcdef") for _ in range(rng.randint(4, 400)))))
             for _ in range(300)]
    files = {"caps.csv": csv("container,cap", [("svc", 40)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverUnit", "events"]
    return lines, files, args, ["CAP", "ACTION"], {"pass": {"INFO": 40}, "sizes_vary": True}


def case_u2_unit_typo():
    """4a.2: a unit other than bytes or events stops the launch (no-mute Input)."""
    lines, files, _, env, _ = case_k1_errors()
    return lines, files, ["rateReceiverWarmupMs", "0", "rateReceiverUnit", "event"], env, {
        "launch_fails_with": ["the 'rateReceiverUnit' argument must be 'bytes' or 'events', received: event"]}


def case_u3_unit_typo_mute():
    """4a.2: the same with a mute file (the mute Input validates)."""
    lines, files, args, env, _ = case_k2_mute()
    return lines, files, args + ["rateReceiverUnit", "event"], env, {
        "launch_fails_with": ["the 'rateReceiverUnit' argument must be 'bytes' or 'events', received: event"]}


def case_m1_mute_counts():
    """Ruling 16: a pattern muted at 0.5 still passes about half its lines, and those lines count
    toward the service total, so the service's other patterns (80 lines, under the 100-line
    total on their own) are held once the total is reached."""
    muted = "alpha"
    width = max(len(w) for w in WORDS) + 6
    line = lambda w, i: record("svc", "2026-10-18T10:00:00.000Z INFO %s request served id=%0*d" % (w, width - len(w), i))
    lines = [line(muted, i) for i in range(10000)]
    lines += [line(WORDS[w], i) for w in range(1, 11) for i in range(8)]
    lines = shuffled(lines, 13)
    b = size(lines[0])
    assert len({size(l) for l in lines}) == 1
    files = {"caps.csv": csv("container,cap", [("svc", 100000 * b)]),
             "totals.csv": csv("container,total", [("svc", 100 * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")]),
             "mutes.csv": csv("fieldSet,value", [("%s_request_served_id" % muted, "0.5:%d:test" % FUTURE)])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverLookupFile", "/policy/mutes.csv"]
    others = ["%s_request_served_id" % WORDS[w] for w in range(1, 11)]
    return lines, files, args, ["CAP", "ACTION", "TOTAL"], {
        "share": {"%s_request_served_id" % muted: (0.45, 0.55)},
        "held_in": {"patterns": others, "min": 1, "max_pass": 5 * 10 + 100}}


def case_t3_reservation():
    """Item 5: a line that does not fit the total hands its units back, so the service's small
    lines fill the total to within one small line. Baseline 0, every pattern under its cap."""
    big = [record("svc", "2026-10-18T10:00:00.000Z INFO upload stored blob=%s" % (("%06d" % i) * 300)) for i in range(300)]
    small = [info_line("svc", WORDS[0], i) for i in range(300)]
    lines = shuffled(big + small, 17)
    bs = size(small[0])
    total = 20000
    files = {"caps.csv": csv("container,cap", [("svc", 10 ** 9)]),
             "totals.csv": csv("container,total", [("svc", total)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    return lines, files, ["rateReceiverWarmupMs", "0", "rateReceiverBaselineCount", "0"], ["CAP", "ACTION", "TOTAL"], {
        "fill": {"svc": (total - bs, total)}}


def case_t1_total():
    """4a.1 (i, iii): every pattern under its cap, the service over its total: held on the fix,
    and passed bytes stay at or under the total plus the baseline and K allowances."""
    lines = [info_line("svc", WORDS[w], i) for w in range(10) for i in range(60)]
    lines += [error_line("svc", i) for i in range(100)]
    lines = shuffled(lines, 3)
    bi = size(info_line("svc", WORDS[0], 0))
    files = {"caps.csv": csv("container,cap", [("svc", 10000 * bi)]),
             "totals.csv": csv("container,total", [("svc", 200 * bi)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    return lines, files, ["rateReceiverWarmupMs", "0"], ["CAP", "ACTION", "TOTAL"], {
        "held_min": 1, "total": {"svc": 200 * bi}, "patterns": {"svc": 11}, "error_pass_min": 55}


def case_t2_noisiest():
    """4a.1 (ii): a storm over its cap, one large pattern under its cap and 20 small ones: every
    small one passes, the large one is moved, and the hard bound is never reached."""
    width = max(len(w) for w in WORDS) + 6
    line = lambda w, i: record("svc", "2026-10-18T10:00:00.000Z INFO %s request served id=%0*d" % (w, width - len(w), i))
    lines = [line("storm", i) for i in range(1000)]
    lines += [line("large", i) for i in range(90)]
    lines += [line(WORDS[w], i) for w in range(20) for i in range(10)]
    lines = shuffled(lines, 11)
    b = size(lines[0])
    assert len({size(l) for l in lines}) == 1
    files = {"caps.csv": csv("container,cap", [("svc", 100 * b)]),
             "totals.csv": csv("container,total", [("svc", 370 * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    smalls = ["%s_request_served_id" % WORDS[w] for w in range(20)]
    return lines, files, ["rateReceiverWarmupMs", "0"], ["CAP", "ACTION", "TOTAL"], {
        "all_pass": smalls, "moved_min": {"large_request_served_id": 1},
        "total": {"svc": 370 * b}, "below_total": {"svc": 370 * b}, "patterns": {"svc": 22}}


def case_s1_star():
    """Ruling 13: a container with no row is capped, totalled and actioned by the `*` rows; a
    container's own row wins; an own cap row of 0 exempts its container."""
    lines = []
    for c in ("other", "named", "exempt"):
        lines += [info_line(c, WORDS[w], i) for w in range(2) for i in range(100)]
    lines = shuffled(lines, 7)
    b = size(info_line("other", WORDS[0], 0))
    files = {"caps.csv": csv("container,cap", [("named", 10 * size(info_line("named", WORDS[0], 0))),
                                               ("exempt", 0), ("*", 60 * b)]),
             "totals.csv": csv("container,total", [("*", 80 * b)]),
             "actions.csv": csv("container,action", [("named", "offload"), ("*", "tier_down")])}
    return lines, files, ["rateReceiverWarmupMs", "0"], ["CAP", "ACTION", "TOTAL"], {
        "routes": {"other": {"tier_down"}, "named": {"offload"}},
        "pass_by_container": {"exempt": 200, "named": 20},
        "total": {"other": 80 * b}, "patterns": {"other": 2}}


def case_d1_defaults():
    """4a.4: no command-line overrides. A capped container first seen this window is held."""
    lines = [error_line("svc", i) for i in range(1000)]
    lines += [info_line("svc", WORDS[0], i) for i in range(200)]
    b = size(lines[0])
    bi = size(lines[-1])
    cap = 8 * b
    files = {"caps.csv": csv("container,cap", [("svc", cap)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    return lines, files, [], ["CAP", "ACTION"], {"pass": {"ERROR": 58, "INFO": cap // bi}}


CASES = {
    "k1-errors": case_k1_errors,
    "k2-mute": case_k2_mute,
    "k3-mute-nocap": case_k3_mute_nocap,
    "k4-keepcounts-unset": case_k4_keepcounts_unset,
    "u1-events": case_u1_events,
    "u2-unit-typo": case_u2_unit_typo,
    "u3-unit-typo-mute": case_u3_unit_typo_mute,
    "m1-mute-counts": case_m1_mute_counts,
    "t3-reservation": case_t3_reservation,
    "t1-total": case_t1_total,
    "t2-noisiest": case_t2_noisiest,
    "s1-star": case_s1_star,
    "d1-defaults": case_d1_defaults,
}

ENV = {"CAP": ("CAP_LOOKUP_FILE", "caps.csv"), "ACTION": ("ACTION_LOOKUP_FILE", "actions.csv"),
       "TOTAL": ("TOTAL_LOOKUP_FILE", "totals.csv")}


def prepare(name, out):
    lines, files, args, env, expect = CASES[name]()
    os.makedirs(os.path.join(out, "policy"), exist_ok=True)
    with open(os.path.join(out, "events.log"), "w") as f:
        f.write("\n".join(lines) + "\n")
    for fname, content in files.items():
        with open(os.path.join(out, "policy", fname), "w") as f:
            f.write(content)
    with open(os.path.join(out, "args"), "w") as f:
        f.write("\n".join(args) + ("\n" if args else ""))
    with open(os.path.join(out, "env"), "w") as f:
        for e in env:
            f.write("%s=/policy/%s\n" % ENV[e])
    with open(os.path.join(out, "config"), "w") as f:
        f.write(expect.get("config", "") + "\n")


def check(name, out):
    lines, files, args, env, expect = CASES[name]()
    code = open(os.path.join(out, "exit")).read().strip()
    routed = os.path.join(out, "routed.jsonl")
    if "launch_fails_with" in expect:
        log = open(os.path.join(out, "engine.log")).read()
        missing = [s for s in expect["launch_fails_with"] if s not in log]
        ok = code != "0" and not missing
        print("%s %s: exit %s%s" % ("PASS" if ok else "FAIL", name, code,
              ", log says: " + " / ".join(expect["launch_fails_with"]) if not missing else ", missing: %s" % missing))
        return ok
    if code != "0" or not os.path.exists(routed):
        log = open(os.path.join(out, "engine.log")).read().strip().splitlines()
        why = [l.strip() for l in log if "Unknown options" in l or "could not launch" in l or "could not parse" in l]
        print("FAIL %s: the engine exited %s: %s" % (name, code, " | ".join(why[:2] or log[-2:])))
        return False
    rows = [json.loads(l) for l in open(routed)]
    passed = [r for r in rows if r.get("routeState") == "pass"]
    problems = []
    facts = []

    by_level = Counter(r["severity_level"] for r in passed)
    held = len(rows) - len(passed)
    facts.append("%d lines, %d passed, %d held %s" % (len(rows), len(passed), held,
                 dict(Counter(r["routeState"] for r in rows if r["routeState"] != "pass"))))
    if len(rows) != len(lines):
        problems.append("routed %d of %d input lines" % (len(rows), len(lines)))
    for level, want in expect.get("pass", {}).items():
        facts.append("%s passed %d (want %d)" % (level, by_level[level], want))
        if by_level[level] != want:
            problems.append("%s passed %d, want exactly %d" % (level, by_level[level], want))
    if "held_min" in expect and held < expect["held_min"]:
        problems.append("nothing held")
    if expect.get("sizes_vary"):
        sizes = sorted(r["utfeightSize_of"] for r in passed)
        facts.append("passed sizes %d..%d bytes" % (sizes[0], sizes[-1]) if sizes else "no passes")
    if "error_pass_min" in expect and by_level["ERROR"] < expect["error_pass_min"]:
        problems.append("ERROR passed %d, want at least %d" % (by_level["ERROR"], expect["error_pass_min"]))

    by_pattern_all = Counter(r["message_pattern"] for r in rows)
    by_pattern_pass = Counter(r["message_pattern"] for r in passed)
    for p in expect.get("all_pass", []):
        if by_pattern_all[p] == 0 or by_pattern_pass[p] != by_pattern_all[p]:
            problems.append("%s passed %d of %d" % (p, by_pattern_pass[p], by_pattern_all[p]))
    if expect.get("all_pass"):
        ok = sum(1 for p in expect["all_pass"] if by_pattern_all[p] and by_pattern_pass[p] == by_pattern_all[p])
        facts.append("small patterns passing every line: %d of %d" % (ok, len(expect["all_pass"])))
    for p, want in expect.get("moved_min", {}).items():
        moved = by_pattern_all[p] - by_pattern_pass[p]
        facts.append("%s moved %d of %d" % (p, moved, by_pattern_all[p]))
        if moved < want:
            problems.append("%s moved %d, want at least %d" % (p, moved, want))

    for c, total in expect.get("total", {}).items():
        pas = [r for r in passed if r["k8s_container"] == c]
        pas_bytes = sum(r["utfeightSize_of"] for r in pas)
        sizes = defaultdict(int)
        for r in rows:
            if r["k8s_container"] == c:
                sizes[r["message_pattern"]] = max(sizes[r["message_pattern"]], r["utfeightSize_of"])
        baseline = 5 * sum(sizes.values())
        k = 50 * sum(s for p, s in sizes.items() if any(r["message_pattern"] == p and r["severity_level"] == "ERROR" for r in rows))
        bound = total + baseline + k
        facts.append("%s passed %d bytes, bound %d (total %d + baseline %d + K %d)" % (c, pas_bytes, bound, total, baseline, k))
        if pas_bytes > bound:
            problems.append("%s passed %d bytes, over the bound %d" % (c, pas_bytes, bound))
        if len(sizes) != expect["patterns"][c]:
            problems.append("%s has %d patterns, want %d" % (c, len(sizes), expect["patterns"][c]))
    for c, total in expect.get("below_total", {}).items():
        pas_bytes = sum(r["utfeightSize_of"] for r in passed if r["k8s_container"] == c)
        if pas_bytes > total:
            problems.append("%s passed %d bytes, over its total %d: the scaled cap alone should keep it under" % (c, pas_bytes, total))

    for p, (lo, hi) in expect.get("share", {}).items():
        got = by_pattern_pass[p] / max(1, by_pattern_all[p])
        facts.append("%s passed %d of %d" % (p, by_pattern_pass[p], by_pattern_all[p]))
        if not lo <= got <= hi:
            problems.append("%s passed %.3f of its lines, want %.2f to %.2f" % (p, got, lo, hi))
    if "held_in" in expect:
        h = expect["held_in"]
        pas = sum(by_pattern_pass[p] for p in h["patterns"])
        tot = sum(by_pattern_all[p] for p in h["patterns"])
        facts.append("other patterns passed %d of %d" % (pas, tot))
        if tot - pas < h["min"]:
            problems.append("other patterns held %d, want at least %d" % (tot - pas, h["min"]))
        if pas > h["max_pass"]:
            problems.append("other patterns passed %d, want at most %d" % (pas, h["max_pass"]))
    for c, (lo, hi) in expect.get("fill", {}).items():
        pas_bytes = sum(r["utfeightSize_of"] for r in passed if r["k8s_container"] == c)
        facts.append("%s passed %d bytes of a %d total" % (c, pas_bytes, hi))
        if not lo < pas_bytes <= hi:
            problems.append("%s passed %d bytes, want more than %d and at most %d" % (c, pas_bytes, lo, hi))
    for c, want in expect.get("routes", {}).items():
        got = {r["routeState"] for r in rows if r["k8s_container"] == c and r["routeState"] != "pass"}
        facts.append("%s held as %s" % (c, sorted(got) or "nothing"))
        if got != want:
            problems.append("%s held as %s, want %s" % (c, sorted(got) or "nothing", sorted(want)))
    for c, want in expect.get("pass_by_container", {}).items():
        got = sum(1 for r in passed if r["k8s_container"] == c)
        facts.append("%s passed %d (want %d)" % (c, got, want))
        if got != want:
            problems.append("%s passed %d, want %d" % (c, got, want))

    print("%s %s: %s" % ("PASS" if not problems else "FAIL", name, "; ".join(facts)))
    for p in problems:
        print("    " + p)
    return not problems


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "list":
        print("\n".join(CASES))
    elif cmd == "prepare":
        prepare(sys.argv[2], sys.argv[3])
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
    else:
        sys.exit("unknown command: " + cmd)
