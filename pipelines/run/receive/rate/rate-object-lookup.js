// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- WITH-MUTE-FILE variant. HYBRID algorithm.
//
// Loaded only when `rateReceiverLookupFile` is set. Handles BOTH the mute check
// AND the regulator inline in a single filter, so the "file wins" semantic is
// genuine (the file's decision short-circuits the regulator path).
//
// The no-mute-file variant (RegulatorObject in rate-object-local.js) loads
// instead when the file is empty. The two variants are mutually exclusive via
// `shouldLoad`, so `settings.yaml groupFilters` dispatches to the right one and
// there is no inter-filter coordination problem.
//
// The split exists because `TenXLookup.get` is parse-validated against
// registered tables at engine init -- it cannot live in the no-file class even
// behind a runtime if-guard. Keep the regulator path here in sync with
// `RegulatorObject.shouldRetainEvent`; the only difference is the mute check
// at step 1.
//
// HEADLINE GUARANTEE: no single log pattern can exceed `rateReceiverAbsoluteCap`
// bytes per container per `rateReceiverResetIntervalMs` window, UNLESS a mute
// file entry overrides for that pattern (file wins).
//
// Decision order per event:
//   1. Mute file (FILE WINS): if the pattern is listed and active in the file,
//      the file's `<sampleRate>` decides -- max(sampleRate, severity floor) so a
//      0.0 mute never silences ERROR/CRITICAL. Expired/malformed entries fall
//      through to the regulator.
//   2. Warmup: brand-new container left unregulated for the grace period.
//   3. Baseline: first N events of each (pattern, container) per window kept.
//   4. Absolute cap (primary): kept if patternBytes (after this event) <= cap.
//   5. Share guard (sanity): kept if pattern is < minSharePercent of container.
//   6. Severity floor: kept with probability = severity floor; otherwise drop.

export class LookupInput extends TenXInput {

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
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

        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 900000);

        if (!(warmupMs >= 0)) {
            throw new Error("the 'rateReceiverWarmupMs' argument must be >= 0, received: " + warmupMs);
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

export class RegulatorWithMuteObject extends TenXObject {

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverLookupFile");
    }

    // Distinct getter name from RegulatorObject.shouldRetainEvent: method names
    // are in a GLOBAL namespace across all parsed classes (the engine validates
    // every class in every file regardless of shouldLoad), so two classes can't
    // share a getter name even when they are mutually exclusive at load time.
    // settings.yaml dispatches via env ternary into a single groupFilters slot.
    get shouldRetainEventWithMute() {

        if ((!this.isObject) || (this.isDropped)) return true;

        // ---- identity ----
        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true; // cannot identify the pattern -> leave it alone

        // ---- severity floor (used by both mute and regulator paths) ----
        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = floorRaw ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0.1);

        // ---- 1. mute file (FILE WINS) ----
        // An active entry short-circuits the regulator: the file decides.
        // RETURNS ARE FLATTENED -- the TenX DSL compiler does not handle `return`
        // from inside multi-level nested ifs the way standard JS does. The
        // previously-verified shouldRetainByLookup pattern uses guard clauses
        // with returns at the function-body level only. Mirror that here: compute
        // the active-mute threshold in nested ifs, then make the decision (with
        // its return) at level 1.
        //
        // Parse "<sampleRate>:<untilEpochSec>[:<reason>]" with indexOf/substring.
        // (Array indexing on a TenXString.split result does not work in the DSL --
        // parts[N] resolves to a field lookup, not a list element.)
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
                    // severity floor wins over a 0.0 mute (so ERROR/CRITICAL are
                    // never fully silenced)
                    muteThreshold = TenXMath.max(sampleRate, floor);
                }
                // expired entry -> hasActiveMute stays false -> fall through
            }
            // malformed entry -> hasActiveMute stays false -> fall through
        }
        // Two guards at function-body level (NOT a single block containing both
        // return true and return false -- the DSL appears to mishandle that shape).
        if (hasActiveMute && (TenXMath.random() <= muteThreshold)) return true;
        if (hasActiveMute) {
            // drop by mute. this.drop() sets isDropped; returning true lets the
            // event flow into the receive aggregator stage so the all_events vs
            // emitted_events delta attributes the saving.
            this.drop();
            return true;
        }

        // ---- regulator path (mirrors RegulatorObject.shouldRetainEvent) ----

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__"; // no-container fallback: regulate node-wide

        var key = fieldSetKey + "@" + container;
        var bytes = this.utf8Size();

        // ---- counters (windowed: reflect recent volume) ----
        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);
        var patternBytes = TenXCounter.getAndInc("rg_num_" + key, bytes, windowMs);
        var containerBytes = TenXCounter.getAndInc("rg_den_" + container, bytes, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);

        // ---- 2. warmup gate (delay only; no learned baseline) ----
        var now = TenXDate.now();
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            TenXCounter.getAndSet("rg_seen_" + container, now);
            return true;
        }
        if ((now - firstSeen) < TenXEnv.get("rateReceiverWarmupMs", 900000)) {
            return true;
        }

        // ---- 3. baseline: keep the first N of each pattern per window ----
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) {
            return true;
        }

        // ---- 4. absolute cap (PRIMARY TRIGGER, HEADLINE GUARANTEE) ----
        var absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 10485760);
        if ((patternBytes + bytes) <= absoluteCap) {
            return true;
        }

        // ---- 5. share guard (sanity: protect legitimately busy containers) ----
        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0.05);
        var share = (patternBytes + bytes) / (containerBytes + bytes);
        if (share < minSharePercent) {
            return true;
        }

        // ---- 6. severity floor wins over cap ----
        // Drop attribution is already in the receive aggregator's
        // `all_events - emitted_events`; no separate overshoot counter needed.
        if (TenXMath.random() < floor) {
            return true;
        }

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
