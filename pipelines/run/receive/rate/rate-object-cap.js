// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- NO-MUTE, WITH-CAP-FILE variant.
//
// One of FOUR regulator-decision classes split across the (mute, cap)
// cartesian. See rate-object-local.js's header for the full overview.
// This file is the NO-MUTE WITH-CAP-FILE variant: per-event cap is
// resolved from `rateReceiverCapLookupFile` first, then the
// `rateReceiverAbsoluteCap` env var as fallback.
//
// Two classes:
//   1. `rateReceiverCapInput` (shouldLoad: capFile is set): registers the
//      cap lookup table via TenXLookup.load. Independent of mute state,
//      so the with-mute-and-cap variant in rate-object-lookup-cap.js can
//      also use the table without duplicating the load.
//   2. `rateReceiverCapObject` (shouldLoad: !muteFile && capFile):
//      regulator algorithm + inline cap-lookup. Dispatched via
//      `shouldRetainEventWithCap()` from settings.yaml's groupFilters
//      4-way ternary.

export class rateReceiverCapInput extends TenXInput {

    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverCapLookupFile");
    }

    constructor() {

        if (!TenXEnv.get("quiet")) {
            TenXConsole.log("💰 Loading rate cap file: " + TenXEnv.get("rateReceiverCapLookupFile"));
        }

        var lastModified = TenXLookup.load(TenXEnv.get("rateReceiverCapLookupFile"), true);
        var capRetain = TenXEnv.get("rateReceiverCapLookupRetain", 300000);

        if (TenXDate.now() - lastModified > capRetain) {
            if (!TenXEnv.get("quiet")) {
                TenXConsole.log("⚠️ rate receiver cap file is stale, lastModified: {}, retainInterval: {}",
                    lastModified, capRetain);
            }
            TenXLog.info("rate receiver cap file is stale, lastModified: {}, retainInterval: {}",
                lastModified, capRetain);
        }
    }
}

export class rateReceiverCapObject extends TenXObject {

    // No mute file, WITH cap file: regulator + per-container cap-lookup.
    static shouldLoad(config) {
        return !TenXEnv.get("rateReceiverLookupFile") && TenXEnv.get("rateReceiverCapLookupFile");
    }

    // CONSTRUCTOR-DROP PATTERN: every documented `this.drop()` example in the
    // TenX engine docs is inside a constructor, never inside a `get` getter.
    // TenXObject is immutable post-construction, so calling `this.drop()`
    // from a getter is a no-op (confirmed empirically on the demo cluster:
    // DIAG showed cap-getter -> over-cap -> drop fired, but immediately after,
    // `this.isDropped` was false; the receive aggregator's `!isDropped`
    // filter therefore never excluded the event from `emitted_events`).
    //
    // The fix is to run the regulator algorithm in the constructor and call
    // `this.drop()` there. The getter just returns true so the event keeps
    // flowing to the aggregator, which sees `isDropped=true` and excludes it
    // from `emitted_events` while keeping it in `all_events` -- producing the
    // delta that is the savings attribution.
    constructor() {

        if ((!this.isObject) || (this.isDropped)) return;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return;

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__";

        // DIAG (temporary): log dispatch + container every 500th event.
        var diagSeq = TenXCounter.getAndInc("diag_cap_ctor", 1);
        if (diagSeq < 5 || (diagSeq % 500) == 0) {
            TenXConsole.log("DIAG cap-ctor fired #" + diagSeq + " container=" + container + " fieldSetKey=" + fieldSetKey);
        }

        var absoluteCap = 0;
        var capEntry = TenXLookup.get("rateReceiverCapLookupFile", container);
        if (capEntry) {
            var capC1 = TenXString.indexOf(capEntry, ":", 0);
            var capBytesEnd = (capC1 < 0) ? TenXString.length(capEntry) : capC1;
            var capCandidate = TenXMath.parseDouble(TenXString.substring(capEntry, 0, capBytesEnd));
            var capActive = true;
            if (capC1 >= 0) {
                var capC2 = TenXString.indexOf(capEntry, ":", capC1 + 1);
                var capUntilEnd = (capC2 < 0) ? TenXString.length(capEntry) : capC2;
                var capUntilEpochSec = TenXMath.parseDouble(TenXString.substring(capEntry, capC1 + 1, capUntilEnd));
                if (capUntilEpochSec > 0 && (TenXDate.now() / 1000) > capUntilEpochSec) {
                    capActive = false;
                }
            }
            if (capActive) absoluteCap = capCandidate;
        }
        if (absoluteCap == 0) {
            absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 0);
        }
        // DIAG: log what cap-resolution produced
        if (diagSeq < 5 || (diagSeq % 20) == 0) {
            TenXConsole.log("DIAG ctor resolved #" + diagSeq + " container=" + container + " capEntry=" + capEntry + " absoluteCap=" + absoluteCap);
        }
        if (absoluteCap == 0) {
            return; // no cap configured -> opt-out
        }

        var key = fieldSetKey + "@" + container;
        var bytes = this.utf8Size();

        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = floorRaw ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0.1);

        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);
        var patternBytes = TenXCounter.getAndInc("rg_num_" + key, bytes, windowMs);
        var containerBytes = TenXCounter.getAndInc("rg_den_" + container, bytes, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);

        var now = TenXDate.now();
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            TenXCounter.getAndSet("rg_seen_" + container, now);
            return;
        }
        if ((now - firstSeen) < TenXEnv.get("rateReceiverWarmupMs", 900000)) {
            return;
        }
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) {
            return;
        }
        // DIAG (temporary): log cap-comparison every 20th event so we see counter growth
        if (diagSeq < 5 || (diagSeq % 20) == 0) {
            TenXConsole.log("DIAG ctor cap-check #" + diagSeq + " container=" + container + " patternBytes=" + patternBytes + " bytes=" + bytes + " cap=" + absoluteCap + " (overcap=" + ((patternBytes + bytes) > absoluteCap) + ")");
        }
        if ((patternBytes + bytes) <= absoluteCap) {
            return;
        }
        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0.05);
        var share = (patternBytes + bytes) / (containerBytes + bytes);
        if (share < minSharePercent) {
            return;
        }
        if (TenXMath.random() < floor) {
            return;
        }

        // Over cap AND over share guard AND severity-floor coin-flip says drop.
        if (container == "cart" && (diagSeq % 500) == 0) {
            TenXConsole.log("DIAG cap-ctor DROP for cart: patternBytes=" + patternBytes + " bytes=" + bytes + " cap=" + absoluteCap);
        }
        this.drop();
        if (container == "cart" && (diagSeq % 500) == 0) {
            TenXConsole.log("DIAG cap-ctor POST-drop: this.isDropped=" + this.isDropped);
        }
    }

    // settings.yaml groupFilters dispatches to this; constructor already
    // marked isDropped, so the aggregator's filter handles the rest.
    get shouldRetainEventWithCap() {
        return true;
    }
}
