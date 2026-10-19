// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- NO-MUTE, NO-CAP-FILE variant.
//
// This is one of FOUR regulator-decision classes split across the (mute,
// cap) cartesian. Each variant has its own getter name dispatched by
// settings.yaml's groupFilters 4-way ternary, because TenXLookup.get is
// parse-validated against runtime-registered tables -- a class that
// references a lookup table that may not be loaded fails engine init.
//
//   shouldLoad gates:                           Getter:
//   - rateReceiverObject:             !mute && !cap   shouldRetainEvent
//   - rateReceiverCapObject:          !mute &&  cap   shouldRetainEventWithCap
//   - rateReceiverLookupObject:        mute && !cap   shouldRetainEventWithMute
//   - rateReceiverLookupCapObject:     mute &&  cap   shouldRetainEventWithMuteAndCap
//
// This file is the NO-MUTE NO-CAP-FILE variant: no lookups at all, cap
// comes from the fleet-wide `rateReceiverAbsoluteCap` env var only. If the
// env var is 0 (default), the regulator does nothing.
//
// Cross-class composition was attempted first (a per-event getter
// `rateReceiverResolvedCap` on a separate cap-class read via
// `this.rateReceiverResolvedCap`) and verified BROKEN on the demo cluster:
// the getter never fired from this class's regulator. TenX DSL does not
// compose property-style getters across separately-declared TenXObject
// classes the way the aspect model suggested. Inlining the lookup didn't
// work either: parse-validation walks every loaded class and rejects
// TenXLookup.get when the table is not registered, regardless of runtime
// if-guards. The 4-class cartesian is the structurally honest answer.
//
// WHAT THE CAP DOES: once a log pattern has spent its resolved cap in a
// container within the `rateReceiverResetIntervalMs` window, counted in
// `rateReceiverUnit` (bytes or events), its further lines are held. Cap
// resolution priority:
//   1. `rateReceiverCapLookupFile` (cap-file variants only): the container's
//      row, then the `*` row
//   2. `rateReceiverAbsoluteCap` env var (this variant)
//   3. No cap: the over-cap branch is skipped, event retained, no counter
//      state accumulated. Protection is strictly opt-in.
// The cap-file variants also read a per-service total
// (`rateReceiverTotalLookupFile`) and route held lines by the action file.
//
// Decision order per event (only runs when a cap IS resolved):
//   1. Warmup: container left unregulated for `warmupMs` after this regulator
//      instance first sees its events (per-instance). Default 0, off.
//   2. Baseline: first `baselineCount` events of each pattern kept per
//      window for forensic visibility.
//   3. Cap: under the cap (scaled down by the total in the cap-file variants)
//      -> keep.
//   4. Share guard: pattern below `minSharePercent` of its container -> keep.
//      Default 0, off.
//   5. Levels in `rateReceiverKeepCounts`: the first K held lines of a pattern
//      per window -> keep. Other levels: keep with probability = floor
//      (`rateReceiverSeverityFloors`, 0 as shipped).
//   6. Otherwise the line is held: marked drop here, the container's action in
//      the cap-file variants.
//
// ENGINE NOTES:
//   - Counter keyspace is bounded by AtomicCounterRegistry (~262K LRU);
//     evicted counters re-baseline gracefully.
//   - Counter increments only happen when a cap is resolved, so unprotected
//     containers accumulate zero counter cardinality.
//   - Fail-open: an exception in a receive-stage filter must result in
//     retain. Engine-wide policy.

export class rateReceiverInput extends TenXInput {

    // Validation runs whenever there is no mute file; this Input is shared by
    // both the no-cap (rate-object-local.js) and with-cap (rate-object-cap.js)
    // regulator-object classes -- we don't want to validate twice or split
    // the validation across files.
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

        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 0);

        if (!(warmupMs >= 0)) {
            throw new Error("the 'rateReceiverWarmupMs' argument must be >= 0, received: " + warmupMs);
        }

        var unit = TenXEnv.get("rateReceiverUnit", "bytes");

        if (unit != "bytes" && unit != "events") {
            throw new Error("the 'rateReceiverUnit' argument must be 'bytes' or 'events', received: " + unit);
        }

        var maxShare = TenXEnv.get("rateReceiverMaxSharePerFieldSet", 0.2);

        if (!((maxShare > 0) && (maxShare <= 1))) {
            throw new Error("the 'rateReceiverMaxSharePerFieldSet' argument must be in (0, 1], received: " + maxShare);
        }
    }
}

export class rateReceiverObject extends TenXObject {

    // No mute file AND no cap file: pure env-var cap path.
    static shouldLoad(config) {
        return !TenXEnv.get("rateReceiverLookupFile") && !TenXEnv.get("rateReceiverCapLookupFile");
    }

    // The regulator algorithm runs in the groupFilter getter (the correct
    // pipeline phase: post-grouping, on the whole event), dispatched by
    // settings.yaml's groupFilters slot. `this.route("drop")` here MARKS the event
    // routeState="drop"; the marked event keeps flowing. The encoder no longer filters
    // marked events out of output (engine change), so each output stream's
    // filter decides: isObject = emit (soft-drop), isObject && !this.isRoute("drop")
    // = suppress (hard-drop). The getter always returns true so the engine
    // does not remove the event at the group stage -- the mark is the signal.
    get shouldRetainEvent() {

        if ((!this.isObject) || (this.isRoute("drop"))) return true;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true;

        // Inline the env lookup; a local var passed to this.get() is treated as an event field.
        var container = this.get(TenXEnv.get("rateReceiverContainerField"));
        if (!container) container = "__node__";

        // No cap-file path here -- fleet-wide env var only.
        var absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 0);
        if (absoluteCap == 0) return true;

        var key = fieldSetKey + "@" + container;
        var units = (TenXEnv.get("rateReceiverUnit", "bytes") == "events") ? 1 : this.utf8Size();

        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = TenXString.length(floorRaw) > 0 ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0);
        var keepMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverKeepCounts"));
        var keepRaw = TenXMap.get(keepMap, level, "");
        var keepCount = TenXString.length(keepRaw) > 0 ? TenXMath.parseDouble(keepRaw) : -1;

        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);
        var patternUnits = TenXCounter.getAndInc("rg_num_" + key, units, windowMs);
        var containerUnits = TenXCounter.getAndInc("rg_den_" + container, units, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);

        var now = TenXDate.now();
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            // getAndSet is atomic: one event gets 0 back, a racing one gets the stored time.
            firstSeen = TenXCounter.getAndSet("rg_seen_" + container, now);
            if (firstSeen == 0) firstSeen = now;
        }
        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 0);
        if (warmupMs > 0 && (now - firstSeen) < warmupMs) return true;
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) return true;
        if ((patternUnits + units) <= absoluteCap) return true;
        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0);
        var share = (patternUnits + units) / (containerUnits + units);
        if (share < minSharePercent) return true;
        if (keepCount < 0 && TenXMath.random() < floor) return true;

        // Error-class levels with a keep count: the first K held lines of a pattern pass each window.
        var keptBefore = -1;
        if (keepCount >= 0) keptBefore = TenXCounter.getAndInc("rg_kc_" + key, 1, windowMs);
        if (keptBefore >= 0 && keptBefore < keepCount) return true;

        this.route("drop");
        return true;
    }
}
