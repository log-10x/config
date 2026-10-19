// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- WITH-MUTE, NO-CAP-FILE variant.
//
// One of FOUR regulator-decision classes split across the (mute, cap)
// cartesian. See rate-object-local.js's header for the full overview.
// This file is the WITH-MUTE NO-CAP-FILE variant: per-event cap comes
// from the fleet-wide `rateReceiverAbsoluteCap` env var only.
//
// Two classes:
//   1. `rateReceiverLookupInput` (shouldLoad: muteFile is set): registers
//      the mute lookup table via TenXLookup.load. Independent of cap
//      state, so the with-mute-and-cap variant in rate-object-lookup-cap.js
//      can also use the table without duplicating the load.
//   2. `rateReceiverLookupObject` (shouldLoad: muteFile && !capFile):
//      mute-check (FILE WINS) + regulator algorithm + env-var cap.
//      Dispatched via `shouldRetainEventWithMute()` from settings.yaml's
//      groupFilters 4-way ternary.
//
// WHAT THE CAP DOES (cap variants): once a log pattern has spent its resolved
// cap in a container within the `rateReceiverResetIntervalMs` window, counted
// in `rateReceiverUnit`, its further lines are held, UNLESS a mute file entry
// overrides for that pattern (file wins).
//
// Decision order per event:
//   1. Mute file (FILE WINS): if the pattern is listed and active in the
//      file, levels in `rateReceiverKeepCounts` pass their first K lines per
//      pattern per window, so a 0.0 mute never silences ERROR/CRITICAL; the
//      file's `<sampleRate>` decides the rest, as max(sampleRate, severity
//      floor). Expired/malformed entries fall through to the regulator.
//   2. Cap resolution (env-var only here): if no cap, retain and skip the
//      regulator path entirely (no counters touched).
//   3. Warmup: container left unregulated for the grace period (default 0, off).
//   4. Baseline: first N events of each (pattern, container) per window kept.
//   5. Absolute cap: kept if the pattern's units (after this event) <= cap.
//   6. Share guard: kept if pattern is < minSharePercent of container (default 0, off).
//   7. Levels in `rateReceiverKeepCounts`: the first K held lines per pattern
//      per window kept; other levels kept with probability = severity floor
//      (0 as shipped); otherwise drop.

export class rateReceiverLookupInput extends TenXInput {

    // shouldLoad: mute file is set, regardless of cap state. Validation +
    // mute-lookup-table registration are shared by rateReceiverLookupObject
    // (no cap) and rateReceiverLookupCapObject (with cap).
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverLookupFile");
    }

    constructor() {

        if (!TenXEnv.get("quiet")) {
            TenXConsole.log("🚦 Applying rate regulator (with mute file) to: " + this.inputName);
            TenXConsole.log("🔇 Loading rate mute file: " + TenXEnv.get("rateReceiverLookupFile"));
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

        var lastModified = TenXLookup.load(TenXEnv.get("rateReceiverLookupFile"), true);
        var lookupRetain = TenXEnv.get("rateReceiverLookupRetain", 300000);

        if (TenXDate.now() - lastModified > lookupRetain) {
            if (!TenXEnv.get("quiet")) {
                TenXConsole.log("⚠️ rate receiver mute file is stale, lastModified: {}, retainInterval: {}",
                    lastModified, lookupRetain);
            }
            TenXLog.info("rate receiver mute file is stale, lastModified: {}, retainInterval: {}",
                lastModified, lookupRetain);
        }
    }
}

export class rateReceiverLookupObject extends TenXObject {

    // WITH mute file, NO cap file.
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverLookupFile") && !TenXEnv.get("rateReceiverCapLookupFile");
    }

    // The regulator algorithm runs in the groupFilter getter (post-grouping,
    // on the whole event). `this.route("drop")` MARKS the event routeState="drop"; the marked
    // event keeps flowing (getter returns true). The encoder no longer filters
    // marked events out of output, so each output stream's filter decides:
    // isObject = emit (soft-drop), isObject && !this.isRoute("drop") = suppress.
    get shouldRetainEventWithMute() {

        if ((!this.isObject) || (this.isRoute("drop"))) return true;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true;

        // Inline the env lookup; a local var passed to this.get() is treated as an event field.
        var container = this.get(TenXEnv.get("rateReceiverContainerField"));
        if (!container) container = "__node__";

        var key = fieldSetKey + "@" + container;
        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);

        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = TenXString.length(floorRaw) > 0 ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0);
        var keepMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverKeepCounts"));
        var keepRaw = TenXMap.get(keepMap, level, "");
        var keepCount = TenXString.length(keepRaw) > 0 ? TenXMath.parseDouble(keepRaw) : -1;

        // ---- 1. mute file (FILE WINS) ----
        var hasActiveMute = false;
        var muteThreshold = 0;
        var entry = TenXLookup.get("rateReceiverLookupFile", fieldSetKey);
        if (entry) {
            var c1 = TenXString.indexOf(entry, ":", 0);
            if (c1 >= 0) {
                var c2 = TenXString.indexOf(entry, ":", c1 + 1);
                var untilEnd = (c2 < 0) ? TenXString.length(entry) : c2;
                var sampleRate = TenXMath.parseDouble(TenXString.substring(entry, 0, c1));
                var untilEpochSec = TenXMath.parseDouble(TenXString.substring(entry, c1 + 1, untilEnd));
                if ((TenXDate.now() / 1000) < untilEpochSec) {
                    hasActiveMute = true;
                    muteThreshold = TenXMath.max(sampleRate, floor);
                }
            }
        }
        // Under a mute, the levels with a keep count pass their first K lines
        // per pattern per window; the mute's sample rate decides the rest.
        var muteKept = -1;
        if (hasActiveMute && keepCount >= 0) muteKept = TenXCounter.getAndInc("rg_kc_" + key, 1, windowMs);
        if (hasActiveMute && muteKept >= 0 && muteKept < keepCount) return true;
        if (hasActiveMute && TenXMath.random() > muteThreshold) this.route("drop");
        if (hasActiveMute) return true; // mute decision is terminal (marked if over threshold)

        // ---- regulator path (env-var cap only; no cap file in this variant) ----

        var absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 0);
        if (absoluteCap == 0) return true;

        var units = (TenXEnv.get("rateReceiverUnit", "bytes") == "events") ? 1 : this.utf8Size();

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
