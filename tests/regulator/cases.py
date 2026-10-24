"""Regulator cases for tests/regulator/run.sh: write each case's input and policy
files, then check what the engine routed.

  python3 cases.py list
  python3 cases.py prepare <case> <dir>   writes <dir>/events.log, <dir>/policy/*, <dir>/args, <dir>/env
  python3 cases.py check <case> <dir>     reads <dir>/routed.jsonl and <dir>/exit, prints PASS or FAIL
  python3 cases.py send <dir> <port>      sends a paced case's batches over the Forward protocol

A paced case (expect "pace") runs on paced.yaml: run.sh starts the engine with the Forward
input and `send` sends each batch, a gap of seconds apart (or at the offsets in "at"), so
the batches land in consecutive regulator windows, which start at the first line.

Every line of a pattern has the same byte length, so caps and totals in bytes are
exact line counts. Floors are 0 on the shipped configuration, so the expected
counts are exact, not statistical.
"""
import json
import os
import random
import socket
import struct
import sys
import time
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


FORWARD_TAG = "kube.var.log.containers.paced"


def forward_size(line):
    """The bytes of a line the Forward input emits: the record as compact JSON, the tag first."""
    return len(('{"tag":"%s",' % FORWARD_TAG + line[1:]).encode("utf-8"))


def pack(o):
    """The msgpack subset the Forward protocol needs: str, int, list, dict."""
    if isinstance(o, str):
        b = o.encode()
        n = len(b)
        return (bytes([0xa0 | n]) if n < 32 else b"\xd9" + bytes([n]) if n < 256 else b"\xda" + struct.pack(">H", n)) + b
    if isinstance(o, int):
        return b"\xce" + struct.pack(">I", o)
    if isinstance(o, list):
        return bytes([0x90 | len(o)]) + b"".join(pack(x) for x in o)
    if isinstance(o, dict):
        return bytes([0x80 | len(o)]) + b"".join(pack(k) + pack(v) for k, v in o.items())
    raise TypeError(type(o))


def send(out, port):
    pace = json.load(open(os.path.join(out, "pace")))
    lines = open(os.path.join(out, "events.log")).read().splitlines()
    start = 0
    t0 = time.time()
    for i, n in enumerate(pace["batches"]):
        if "at" in pace:
            time.sleep(max(0, t0 + pace["at"][i] - time.time()))
        elif i:
            time.sleep(pace["gap"])
        with socket.create_connection(("127.0.0.1", int(port)), timeout=10) as s:
            for l in lines[start:start + n]:
                s.sendall(pack([FORWARD_TAG, int(time.time()), json.loads(l)]))
            time.sleep(1)
        print("sent batch %d: %d records" % (i + 1, n))
        start += n


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


def case_g0_gitops_off():
    """Ruling 17 regression: GH_ENABLED unset and no lookup env. (The lane itself is checked
    live by gitops-live.sh.) The cap file stays unset, so the
    regulator loads no cap table and every line passes, as on main."""
    lines = [error_line("svc", i) for i in range(300)]
    return lines, {"caps.csv": csv("container,cap", [("svc", 1)])}, ["rateReceiverWarmupMs", "0"], [], {
        "pass": {"ERROR": 300}}


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


def sample_burst(extra_args=(), files_extra=None):
    """200 new patterns of 2 lines each in one service whose total is 50 lines: every line is in
    its pattern's sample, so only the sample bound stops them."""
    lines = shuffled([pair_line(p, i) for p in range(200) for i in range(2)], 41)
    b = size(lines[0])
    assert len({size(l) for l in lines}) == 1
    files = {"caps.csv": csv("container,cap", [("svc", 100000 * b)]),
             "totals.csv": csv("container,total", [("svc", 50 * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    files.update(files_extra or {})
    return lines, files, ["rateReceiverWarmupMs", "0"] + list(extra_args), ["CAP", "ACTION", "TOTAL"]


def case_b1_sample_bound():
    """200 new patterns, a 50-line total: the service passes its total and then at most
    rateReceiverBaselineMaxOverTotal (50) more sample lines, 100 in all, not 400."""
    lines, files, args, env = sample_burst()
    return lines, files, args, env, {"pass_by_container": {"svc": 100}}


def case_b2_sample_bound_off():
    """rateReceiverBaselineMaxOverTotal 0 removes the bound: every sample line passes, as
    before the bound (the option is new, so the case runs on the fix only)."""
    lines, files, args, env = sample_burst(["rateReceiverBaselineMaxOverTotal", "0"])
    return lines, files, args, env, {"pass_by_container": {"svc": 400}, "config": "fix-only"}


def case_b3_sample_bound_mute():
    """the same burst with a mute file present (the mute + cap variant), the mute entry for
    a pattern that never prints: 100 pass."""
    lines, files, args, env = sample_burst(
        ["rateReceiverLookupFile", "/policy/mutes.csv"],
        {"mutes.csv": csv("fieldSet,value", [("never_printed_pattern", "0:%d:test" % FUTURE)])})
    return lines, files, args, env, {"pass_by_container": {"svc": 100}}


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


def case_w1_windows():
    """Ruling 21: the budget run's shape (a cap at the level L and a total of sum(min(rate, L)))
    over two windows. Window 1 has no previous window and takes the in-window scale, under the
    total. In window 2 the caps alone let the total through, so nothing scales and the service
    passes its total to within one line."""
    counts = [200, 120, 80, 40, 30, 20, 15, 10, 8, 6, 5, 4]
    width = max(len(w) for w in WORDS) + 6
    line = lambda w, i: record("svc", "2026-10-18T10:00:00.000Z INFO %s request served id=%0*d" % (w, width - len(w), i))
    batches = [shuffled([line(WORDS[p], b * 1000 + i) for p, n in enumerate(counts) for i in range(n)], 23 + b)
               for b in range(2)]
    b = forward_size(batches[0][0])
    assert len({forward_size(l) for l in batches[0] + batches[1]}) == 1
    cap = 29
    total = sum(min(n, cap) for n in counts)
    files = {"caps.csv": csv("container,cap", [("svc", cap * b)]),
             "totals.csv": csv("container,total", [("svc", total * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverResetIntervalMs", "60000"]
    return batches[0] + batches[1], files, args, ["CAP", "ACTION", "TOTAL"], {
        "pace": {"batches": [len(x) for x in batches], "gap": 75, "total": total},
        "window_pass": {0: (total - 30, total), 1: (total - 1, total)}}


PAIR_WIDTH = 2 * max(len(w) for w in WORDS) + 6


def pair_words(p):
    """Two different words per pattern: (w, the next word) for p < 20, (w, the one after) above."""
    return WORDS[p % 20], WORDS[(p % 20 + 1 + p // 20) % 20]


def pair_name(p):
    return "%s_%s_request_served_id" % pair_words(p)


def pair_line(p, i):
    w = "%s %s" % pair_words(p)
    return record("svc", "2026-10-18T10:00:00.000Z INFO %s request served id=%0*d" % (w, PAIR_WIDTH - len(w) + 1, i))


def scaled_windows(counts, cap, total, muted=None):
    """Two windows of the same lines. Every pattern of 60 lines is over its cap, so window 1's
    lines under their caps come to more than the total, and window 2's caps scale by
    total / that amount: the 60-line patterns are held at the scaled cap, the 7-line ones pass
    every line, and the total fills to within one line."""
    batches = [shuffled([pair_line(p, b * 1000 + i) for p, n in enumerate(counts) for i in range(n)], 31 + b)
               for b in range(2)]
    b = forward_size(batches[0][0])
    assert len({forward_size(l) for l in batches[0] + batches[1]}) == 1
    files = {"caps.csv": csv("container,cap", [("svc", cap * b)]),
             "totals.csv": csv("container,total", [("svc", total * b)]),
             "actions.csv": csv("container,action", [("svc", "tier_down")])}
    args = ["rateReceiverWarmupMs", "0", "rateReceiverResetIntervalMs", "60000"]
    if muted is not None:
        files["mutes.csv"] = csv("fieldSet,value", [(pair_name(muted), "1.0:%d:test" % FUTURE)])
        args += ["rateReceiverLookupFile", "/policy/mutes.csv"]
    small = [pair_name(p) for p, n in enumerate(counts) if n == 7]
    large = [pair_name(p) for p, n in enumerate(counts) if n == 60 and p != muted]
    allowance = 5 * len(counts) + (counts[muted] if muted is not None else 0)
    return batches[0] + batches[1], files, args, ["CAP", "ACTION", "TOTAL"], {
        "pace": {"batches": [len(x) for x in batches], "gap": 75, "total": total},
        "window_pass": {0: (total - 1, total + allowance), 1: (total - 1, total)},
        "window_all_pass": {1: small}, "window_moved": {1: large}}


def case_w2_windows_mute():
    """Ruling 21 in the mute and cap file variant: 24 patterns of 60 lines, one more muted at
    1.0 (it passes all 40 lines, and they count among what passed under the caps), three of
    7 lines; cap 27 lines, total 517. Window 1's count is 24 x 27 + 40 + 21 = 709, so window
    2's caps scale to 27 x 517 / 709 = 19.7 lines: 24 x 19 + 40 + 21 = 517."""
    counts = [40] + [60] * 24 + [7] * 3
    return scaled_windows(counts, 27, 517, muted=0)


def case_w3_windows_scaled():
    """Ruling 21, the scaling itself: 20 patterns of 60 lines and three of 7, cap 30 lines,
    total 301. Window 1's count is 20 x 30 + 21 = 621, so window 2's caps scale to
    30 x 301 / 621 = 14.5 lines: 20 x 14 + 21 = 301."""
    counts = [60] * 20 + [7] * 3
    return scaled_windows(counts, 30, 301)


def case_w4_windows_late():
    """Ruling 21, a window whose first line comes late: batches at +0, +110, +125 and +185 s,
    one per 60-second window. Window 1 is the three 7-line patterns alone; windows 2 to 4 are
    the w3 lines. Window 3 starts 15 s after window 2's first line and must still take window
    2's count, so windows 3 and 4 pass their total to within one line. Window 2 follows a
    quiet window and fills its total in arrival order."""
    counts = [60] * 20 + [7] * 3
    first = shuffled([pair_line(p, 1000 + i) for p in range(20, 23) for i in range(7)], 7)
    rest = [shuffled([pair_line(p, b * 10000 + i) for p, n in enumerate(counts) for i in range(n)], 31 + b)
            for b in range(1, 4)]
    lines, files, args, env, expect = scaled_windows(counts, 30, 301)
    batches = [first] + rest
    small = [pair_name(p) for p in range(20, 23)]
    large = [pair_name(p) for p in range(20)]
    expect = {"pace": {"batches": [len(x) for x in batches], "at": [0, 110, 125, 185], "total": 301},
              "window_pass": {0: (21, 21), 1: (300, 301 + 5 * 23), 2: (300, 301), 3: (300, 301)},
              "window_all_pass": {0: small, 2: small, 3: small}, "window_moved": {2: large, 3: large}}
    return [l for b in batches for l in b], files, args, env, expect


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
    "g0-gitops-off": case_g0_gitops_off,
    "t1-total": case_t1_total,
    "t2-noisiest": case_t2_noisiest,
    "s1-star": case_s1_star,
    "d1-defaults": case_d1_defaults,
    "b1-sample-bound": case_b1_sample_bound,
    "b2-sample-bound-off": case_b2_sample_bound_off,
    "b3-sample-bound-mute": case_b3_sample_bound_mute,
    "w1-windows": case_w1_windows,
    "w2-windows-mute": case_w2_windows_mute,
    "w3-windows-scaled": case_w3_windows_scaled,
    "w4-windows-late": case_w4_windows_late,
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
            f.write((e if "=" in e else "%s=/policy/%s" % ENV[e]) + "\n")
    with open(os.path.join(out, "config"), "w") as f:
        f.write(expect.get("config", "") + "\n")
    with open(os.path.join(out, "pace"), "w") as f:
        f.write(json.dumps(expect["pace"]) if "pace" in expect else "")


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
    if "pace" in expect:
        start = 0
        for i, n in enumerate(expect["pace"]["batches"]):
            win = rows[start:start + n]
            win_pass = [r for r in win if r.get("routeState") == "pass"]
            sizes = {r["utfeightSize_of"] for r in win}
            facts.append("window %d: %d of %d lines passed (total %d)" % (
                i + 1, len(win_pass), len(win), expect["pace"]["total"]))
            if len(sizes) > 1:
                problems.append("window %d has lines of %d sizes, want one" % (i + 1, len(sizes)))
            if i in expect.get("window_pass", {}):
                lo, hi = expect["window_pass"][i]
                if not lo <= len(win_pass) <= hi:
                    problems.append("window %d passed %d lines, want %d to %d" % (i + 1, len(win_pass), lo, hi))
            seen = Counter(r["message_pattern"] for r in win)
            got = Counter(r["message_pattern"] for r in win_pass)
            for p in expect.get("window_all_pass", {}).get(i, []):
                if seen[p] == 0 or got[p] != seen[p]:
                    problems.append("window %d: %s passed %d of %d" % (i + 1, p, got[p], seen[p]))
            if expect.get("window_all_pass", {}).get(i):
                ps = expect["window_all_pass"][i]
                facts.append("window %d small patterns passing every line: %d of %d" % (
                    i + 1, sum(1 for p in ps if seen[p] and got[p] == seen[p]), len(ps)))
            moved = expect.get("window_moved", {}).get(i, [])
            for p in moved:
                if seen[p] == 0 or got[p] == seen[p]:
                    problems.append("window %d: %s moved nothing (%d of %d passed)" % (i + 1, p, got[p], seen[p]))
            if moved:
                facts.append("window %d large patterns passed %d to %d lines each" % (
                    i + 1, min(got[p] for p in moved), max(got[p] for p in moved)))
            start += n
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
    elif cmd == "send":
        send(sys.argv[2], sys.argv[3])
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
    else:
        sys.exit("unknown command: " + cmd)
