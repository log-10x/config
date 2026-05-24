// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- WITH-MUTE, WITH-CAP-FILE variant.
//
// One of FOUR regulator-decision classes split across the (mute, cap)
// cartesian. See rate-object-local.js's header for the full overview.
// This file is the WITH-MUTE WITH-CAP-FILE variant: per-event cap is
// resolved from `rateReceiverCapLookupFile` first, then the
// `rateReceiverAbsoluteCap` env var as fallback; mute-file decisions win
// over the regulator path entirely.
//
// One class only: rateReceiverLookupCapObject (regulator + mute-lookup +
// cap-lookup). Input classes for the two lookup tables live in
// rate-object-lookup.js (mute) and rate-object-cap.js (cap), both gated
// on their respective env vars independently of cap/mute state -- so when
// both files are set, both tables are loaded by their respective Input
// classes, and this Object class can call TenXLookup.get on both.
//
// Dispatched via `shouldRetainEventWithMuteAndCap()` from settings.yaml's
// groupFilters 4-way ternary.

export class rateReceiverLookupCapObject extends TenXObject {

    // BOTH mute file AND cap file set.
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverLookupFile") && TenXEnv.get("rateReceiverCapLookupFile");
    }

    // CONSTRUCTOR-DROP PATTERN: this.drop() in a getter is a no-op
    // (TenXObject is immutable post-construction). The getter just returns
    // true and the constructor does the actual decision.
    constructor() {

        if ((!this.isObject) || (this.isDropped)) return;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return;

        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = floorRaw ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0.1);

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
        if (hasActiveMute) {
            if (TenXMath.random() > muteThreshold) this.drop();
            return; // mute decision is terminal
        }

        // ---- regulator path (cap-file + env-var fallback) ----

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__";

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
        if (absoluteCap == 0) return;

        var key = fieldSetKey + "@" + container;
        var bytes = this.utf8Size();

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
        if ((now - firstSeen) < TenXEnv.get("rateReceiverWarmupMs", 900000)) return;
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) return;
        if ((patternBytes + bytes) <= absoluteCap) return;
        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0.05);
        var share = (patternBytes + bytes) / (containerBytes + bytes);
        if (share < minSharePercent) return;
        if (TenXMath.random() < floor) return;

        this.drop();
        if (TenXLog.isDebug()) {
            TenXLog.debug("drop by regulator. key={}, patternBytes={}, cap={}, share={}, minShare={}, floor={}, level={}, bytes={}",
                key, (patternBytes + bytes), absoluteCap, share, minSharePercent, floor, level, bytes);
        }
    }

    // settings.yaml groupFilters dispatches to this; constructor already
    // marked isDropped, so the aggregator's filter handles the rest.
    get shouldRetainEventWithMuteAndCap() {
        return true;
    }
}
