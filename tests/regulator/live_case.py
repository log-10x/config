"""The live GitHub policy lane case, driven by gitops-live.sh.

  python3 live_case.py policy <checkout> <v1|v2>   write log10x/policy/*.csv (and test/placeholder.csv)
  python3 live_case.py send <port> <A|B>           send a batch over the Forward protocol
  python3 live_case.py check <routed.jsonl> <main|fix>

Batch A: container svca, 10 patterns x 30 lines. Its caps.csv row allows 20 lines per pattern
and its totals.csv row 120 lines, so the total, not the caps, decides what passes.
Batch B: container svcb, one pattern x 100 lines. Its cap is 20 lines in v1 and 60 lines in v2;
batch B is sent after v2 is pushed and pulled, so 60 lines pass only if the lookup reloaded.
"""
import json
import os
import socket
import struct
import sys
import time

TAG = "kube.var.log.containers.live"
WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]
WIDTH = max(len(w) for w in WORDS) + 6


def record(container, word, i):
    msg = "2026-10-18T10:00:00.000Z INFO %s request served id=%0*d" % (word, WIDTH - len(word), i)
    return {"stream": "stdout", "log": msg,
            "kubernetes": {"container_name": container, "namespace_name": "default",
                           "pod_name": container + "-7d9f8b6c5-x2k4p", "host": "node-1"}}


def line_size(rec):
    # The input emits each record as compact JSON with the tag first.
    return len(('{"tag":"%s",' % TAG + json.dumps(rec, separators=(",", ":"))[1:]).encode())


SIZE_A = line_size(record("svca", WORDS[0], 0))
SIZE_B = line_size(record("svcb", WORDS[0], 0))
CAP_A, TOTAL_A = 20, 120
CAP_B = {"v1": 20, "v2": 60}


def batch(name):
    if name == "A":
        return [record("svca", WORDS[w], i) for i in range(30) for w in range(10)]
    return [record("svcb", WORDS[0], i) for i in range(100)]


def policy(checkout, version):
    d = os.path.join(checkout, "log10x", "policy")
    os.makedirs(d, exist_ok=True)
    files = {
        "caps.csv": "container,cap\nsvca,%d\nsvcb,%d\n" % (CAP_A * SIZE_A, CAP_B[version] * SIZE_B),
        "totals.csv": "container,total\nsvca,%d\n" % (TOTAL_A * SIZE_A),
        "actions.csv": "container,action\n*,tier_down\n",
        "config-generation.csv": "key,value\ngeneration,live%s\n" % version,
    }
    for n, c in files.items():
        with open(os.path.join(d, n), "w") as f:
            f.write(c)
    # main's single github lane pulls test/*.csv, so the branch carries one.
    os.makedirs(os.path.join(checkout, "test"), exist_ok=True)
    with open(os.path.join(checkout, "test", "placeholder.csv"), "w") as f:
        f.write("key,value\nplaceholder,1\n")
    print("svcb,%d" % (CAP_B[version] * SIZE_B))


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


def send(port, name):
    with socket.create_connection(("127.0.0.1", int(port)), timeout=10) as s:
        for rec in batch(name):
            s.sendall(pack([TAG, int(time.time()), rec]))
        time.sleep(2)
    print("sent batch %s: %d records" % (name, len(batch(name))))


def check(routed, arm):
    rows = [json.loads(l) for l in open(routed)] if os.path.exists(routed) else []
    a = [r for r in rows if r.get("k8s_container") == "svca"]
    b = [r for r in rows if r.get("k8s_container") == "svcb"]
    pa = [r for r in a if r["routeState"] == "pass"]
    pb = [r for r in b if r["routeState"] == "pass"]
    sa = max((r["utfeightSize_of"] for r in a), default=0)
    sb = max((r["utfeightSize_of"] for r in b), default=0)
    facts = "svca %d of %d pass (%d B, total %d B); svcb %d of %d pass" % (
        len(pa), len(a), sum(r["utfeightSize_of"] for r in pa), TOTAL_A * SIZE_A, len(pb), len(b))
    problems = []
    if len(a) != 300 or len(b) != 100:
        problems.append("routed %d svca and %d svcb lines, want 300 and 100" % (len(a), len(b)))
    if sa != SIZE_A or sb != SIZE_B:
        problems.append("line sizes %d/%d, predicted %d/%d" % (sa, sb, SIZE_A, SIZE_B))
    if arm == "main":
        if len(pa) != len(a) or len(pb) != len(b):
            problems.append("main should pass every line: no policy lane reads the files")
    else:
        bound = TOTAL_A * SIZE_A + 5 * 10 * SIZE_A
        if not (sum(r["utfeightSize_of"] for r in pa) <= bound and len(pa) < CAP_A * 10):
            problems.append("svca passed %d lines; the 120-line total should hold it under the 200 its caps allow" % len(pa))
        if len(pb) != CAP_B["v2"]:
            problems.append("svcb passed %d, want %d (the v2 cap after the reload; v1 allows %d)" % (len(pb), CAP_B["v2"], CAP_B["v1"]))
    print("%s live-%s: %s" % ("PASS" if not problems else "FAIL", arm, facts))
    for p in problems:
        print("    " + p)
    return not problems


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "policy":
        policy(sys.argv[2], sys.argv[3])
    elif cmd == "send":
        send(sys.argv[2], sys.argv[3])
    elif cmd == "check":
        sys.exit(0 if check(sys.argv[2], sys.argv[3]) else 1)
