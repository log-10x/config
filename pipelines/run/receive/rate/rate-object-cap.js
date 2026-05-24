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

    // Distinct getter name from the other three variants -- method names
    // are in a GLOBAL namespace across all parsed classes.
    get shouldRetainEventWithCap() {

        if ((!this.isObject) || (this.isDropped)) return true;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true;

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__";

        // DIAG (temporary): log dispatch + container every 500th event.
        var diagSeq = TenXCounter.getAndInc("diag_cap_getter", 1);
        if (diagSeq < 5 || (diagSeq % 500) == 0) {
            TenXConsole.log("DIAG cap-getter fired #" + diagSeq + " container=" + container + " fieldSetKey=" + fieldSetKey);
        }

        // ---- absolute cap resolution (per-event) ----
        // Per-container cap from `rateReceiverCapLookupFile` (loaded by
        // rateReceiverCapInput above) wins over the fleet-wide
        // `rateReceiverAbsoluteCap` env var. If neither yields a positive cap
        // for this container, the over-cap branch is opt-out: return true
        // immediately with no counter state accumulated.
        var absoluteCap = 0;
        var capEntry = TenXLookup.get("rateReceiverCapLookupFile", container);
        if (capEntry) {
            // Parse "<bytes>[:<untilEpochSec>][:<reason>]" with indexOf/substring.
            // Array indexing on TenXString.split result does not work in the DSL.
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
        // DIAG (temporary): log resolved cap.
        if (diagSeq < 5 || (diagSeq % 500) == 0) {
            TenXConsole.log("DIAG cap-getter resolved: container=" + container + " capEntry=" + capEntry + " absoluteCap=" + absoluteCap);
        }
        if (absoluteCap == 0) {
            absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 0);
        }
        if (absoluteCap == 0) {
            return true;
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
            return true;
        }
        if ((now - firstSeen) < TenXEnv.get("rateReceiverWarmupMs", 900000)) {
            return true;
        }

        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) {
            return true;
        }

        if ((patternBytes + bytes) <= absoluteCap) {
            return true;
        }

        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0.05);
        var share = (patternBytes + bytes) / (containerBytes + bytes);
        if (share < minSharePercent) {
            return true;
        }

        if (TenXMath.random() < floor) {
            return true;
        }

        this.drop();

        if (TenXLog.isDebug()) {
            TenXLog.debug("drop by regulator. key={}, patternBytes={}, cap={}, share={}, minShare={}, floor={}, level={}, bytes={}",
                key, (patternBytes + bytes), absoluteCap, share, minSharePercent, floor, level, bytes);
        }

        return true;
    }
}
