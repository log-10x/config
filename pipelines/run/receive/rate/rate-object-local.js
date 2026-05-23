// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXConsole } from '@tenx/tenx'

// Per-container noise regulator -- NO-MUTE-FILE variant. HYBRID algorithm.
//
// Loaded only when `rateReceiverLookupFile` is empty. When a mute file IS
// configured, the mute-file variant (rateReceiverLookupObject in
// rate-object-lookup.js) loads instead and handles BOTH the mute check and the
// regulator inline in a single filter. Exactly one variant is loaded at any
// time, so `settings.yaml groupFilters` carries a single entry and there is no
// inter-filter coordination problem.
//
// The split exists because `TenXLookup.get` is parse-validated against
// registered tables at engine init -- it cannot live in this class even behind
// a runtime if-guard, so the lookup code is in its own file with its own
// `shouldLoad` gate.
//
// HEADLINE GUARANTEE: no single log pattern can exceed `rateReceiverAbsoluteCap`
// bytes per container per `rateReceiverResetIntervalMs` window (default 10 MB
// per container per 5 minutes). The customer can compute the worst-case monthly
// spend per pattern per container from this number alone.
//
// Decision order per event:
//   1. Warmup: a brand-new container is left unregulated for a grace period so
//      startup transients (init logs, queue burn-down, cache warming) are not
//      mistaken for a dominating pattern. This is a DELAY only -- no learned
//      baseline survives the warmup; the only state is the container's first-seen
//      timestamp.
//   2. Baseline: the first N events of each (pattern, container) per window are
//      always kept, so even a heavily-capped pattern leaves a forensic sample.
//   3. ABSOLUTE CAP (primary trigger): if patternBytes (after this event) is at
//      or below `rateReceiverAbsoluteCap`, retain. This is the headline guarantee.
//   4. SHARE GUARD (sanity check): if the pattern is over the cap BUT below
//      `rateReceiverMinSharePercent` of its container's volume, retain anyway.
//      Prevents false positives on legitimately high-volume containers (busy
//      API gateways, access log workloads) where the pattern is small relative
//      to the chatter.
//   5. Severity floor wins over cap: keep with probability = the severity floor
//      (Error 0.50 / Warn 0.30 / Info,Debug 0.10). Drop attribution per
//      (pattern, container) comes from the receive aggregator's `all_events`
//      minus `emitted_events`; no separate floor counter is needed.
//
// Identity: the pattern key is the joined `rateReceiverFieldNames` (usually
// `symbolMessage`); the container is `rateReceiverContainerField` (the k8s
// container name, stable across pod replicas -- never the pod). When no container
// field is present (non-k8s input), the regulator falls back to a single
// node-wide bucket.
//
// ENGINE NOTES:
//   - Counter keyspace is bounded by the engine: AtomicCounterRegistry is a
//     prunable cache (~262K entries) that resets idle counters and evicts the
//     least-recently-used. An evicted cold (pattern, container) counter simply
//     re-baselines if it reappears, so high cardinality degrades gracefully
//     rather than growing without bound. No overflow handling needed here.
//   - Fail-open: an exception in a receive-stage filter must result in retain.
//     This is an engine-wide policy, not specific to this module.

export class rateReceiverInput extends TenXInput {

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        return !TenXEnv.get("rateReceiverLookupFile");
    }

    constructor() {

        if (!TenXEnv.get("quiet")) {
            TenXConsole.log("🚦 Applying rate regulator to: " + this.inputName);
        }

        if (!TenXEnv.get("levelField")) {
            throw new Error("the rate receiver module requires 'level' enrichment: https://doc.log10x.com/run/initialize/level/");
        }

        var resetIntervalMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);

        if (!(resetIntervalMs >= 60000)) {
            throw new Error("the 'rateReceiverResetIntervalMs' argument must be at least 60000 (1 minute), received: " + resetIntervalMs);
        }

        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 900000);

        if (!(warmupMs >= 0)) {
            throw new Error("the 'rateReceiverWarmupMs' argument must be >= 0, received: " + warmupMs);
        }

        var maxShare = TenXEnv.get("rateReceiverMaxSharePerFieldSet", 0.2);

        if (!((maxShare > 0) && (maxShare <= 1))) {
            throw new Error("the 'rateReceiverMaxSharePerFieldSet' argument must be in (0, 1], received: " + maxShare);
        }
    }
}

export class rateReceiverObject extends TenXObject {

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        return !TenXEnv.get("rateReceiverLookupFile");
    }

    get shouldRetainEvent() {

        if ((!this.isObject) || (this.isDropped)) return true;

        // ---- identity ----
        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true; // cannot identify the pattern -> leave it alone

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__"; // no-container fallback: regulate node-wide

        var key = fieldSetKey + "@" + container;
        var bytes = this.utf8Size();

        // Severity floor for this event (absolute, NOT a multiplier). Used by the
        // over-cap path so high-severity events are never fully suppressed.
        // severityFloors map values are strings ("0.5"); parse to a number so
        // arithmetic/comparison works. Map miss -> numeric minRetentionThreshold.
        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = floorRaw ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0.1);

        // ---- counters (windowed: reflect recent volume) ----
        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);
        var patternBytes = TenXCounter.getAndInc("rg_num_" + key, bytes, windowMs);
        var containerBytes = TenXCounter.getAndInc("rg_den_" + container, bytes, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);

        // ---- 1. warmup gate (delay only; no learned baseline) ----
        // Only state that survives the grace period is the first-seen timestamp,
        // stored in a counter with NO reset interval so it persists across the
        // windowed resets above. Its sole job is to answer "has this container been
        // alive long enough to judge?". Do NOT add baseline/profile state here.
        var now = TenXDate.now();
        // Read the persisted timestamp as a NUMBER. TenXCounter.get returns a
        // counter object (breaks arithmetic); getAndInc(name, 0) returns the
        // numeric value without changing it.
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            TenXCounter.getAndSet("rg_seen_" + container, now); // no reset interval -> persists
            return true; // brand-new container, in warmup
        }
        if ((now - firstSeen) < TenXEnv.get("rateReceiverWarmupMs", 900000)) {
            return true; // still within the startup grace period
        }

        // ---- 2. baseline: keep the first N of each pattern per window ----
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) {
            return true;
        }

        // ---- 3. absolute cap (PRIMARY TRIGGER, HEADLINE GUARANTEE) ----
        var absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 10485760);
        if ((patternBytes + bytes) <= absoluteCap) {
            return true; // under the cap -> keep
        }

        // ---- 4. share guard (sanity check: protect legitimately busy containers) ----
        // The pattern is over the absolute cap. If it is ALSO above this share of
        // its container's volume, it is a noisy outlier worth sampling. If it is
        // BELOW this share, the container is genuinely high-volume and the
        // pattern is part of normal operation -- leave it alone.
        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0.05);
        var share = (patternBytes + bytes) / (containerBytes + bytes);
        if (share < minSharePercent) {
            return true; // small share of a chatty container -> don't sample
        }

        // ---- 5. over the cap AND over the share guard: severity floor wins ----
        // The engine's receive aggregator already attributes drops per (pattern,
        // container) via `all_events - emitted_events`; a separate floor-overshoot
        // counter would be redundant. If the operator wants to confirm the floor
        // is preserving ERROR/WARN visibility, they query the emitted events
        // filtered by severity directly.
        if (TenXMath.random() < floor) {
            return true;
        }

        // ---- drop ----
        // groupFilters retain on a truthy return, so dropping = return false.
        // this.drop() also marks the object dropped so the receive-stage
        // aggregators (emitted_events filters !isDropped) attribute the saving:
        // a dropped event is in all_events but not emitted_events.
        this.drop();

        if (TenXLog.isDebug()) {
            TenXLog.debug("drop by regulator. key={}, patternBytes={}, cap={}, share={}, minShare={}, floor={}, level={}, bytes={}",
                key, (patternBytes + bytes), absoluteCap, share, minSharePercent, floor, level, bytes);
        }

        // Return TRUE so the dropped event continues into the receive aggregator
        // stage (downstream from group). The `this.drop()` above sets isDropped,
        // which excludes the event from emitted_events (filter: !isDropped) but
        // includes it in all_events (filter: isObject). The delta IS the savings
        // attribution per (pattern, container).
        return true;
    }
}
