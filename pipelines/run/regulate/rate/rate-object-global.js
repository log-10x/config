// @loader: tenx

import { TenXObject, TenXEnv, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Declarative, field-set keyed mute reducer.
//
// Loads a lookup file where each line declares a mute for a specific field-set
// value. The field-set is the same joined list of fields used by the local
// reducer (via `rateReducerFieldNames`), so mute keys read like
// `Error_syncing_pod`, `heartbeat_debug_frontend`, `timeout_payment-service`,
// etc. — the same identity the Reporter attributes cost to.
//
// Entry format:
//
//     <fieldSet>=<sampleRate>:<untilEpochSec>[:<reason>]
//
// Example (with rateReducerFieldNames: [symbolMessage]):
//     Error_syncing_pod=0.10:1744848000:pod error spam OPS-4821
//     heartbeat_debug=0.00:1744416000:k8s liveness 200s
//
// Semantics per event:
//   - If no entry for this event's field-set                → retain.
//   - If an entry exists but untilEpochSec has passed       → retain (expired mute self-heals).
//   - Otherwise                                             → retain with probability = sampleRate.
//
// The minRetentionThreshold + severity boost map still applies as a floor so
// that high-severity events (ERROR, FATAL) are never fully suppressed even by a
// 0.0 mute.

export class GlobalReducerInput extends TenXInput {

    // only load class if a mute file is configured
    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
       return TenXEnv.get("rateReducerLookupFile");
    }

    constructor() {

        if (!TenXEnv.get("quiet")) {
            TenXConsole.log("🚦 Applying mute-file rate reducer to: " + this.inputName + " using: " + TenXEnv.get("rateReducerLookupFile"));
        }

        if (!TenXEnv.get("levelField")) {
            throw new Error("the rate reducer module requires 'level' enrichment: https://doc.log10x.com/run/initialize/level/");
        }

        if (!TenXEnv.get("rateReducerFieldNames")) {
            throw new Error("the 'rateReducerFieldNames' argument must be set to identify mute-file entries");
        }

        var minSampleRate = TenXEnv.get("rateReducerMinRetentionThreshold", 0.1);

        if (!(minSampleRate >= 0.01)) {
            throw new Error("the 'rateReducerMinRetentionThreshold' argument must be greater than 0.01, received: " + minSampleRate);
        }

        var lastModified = TenXLookup.load(TenXEnv.get("rateReducerLookupFile"), true);

        var rateReducerLookupRetain = TenXEnv.get("rateReducerLookupRetain", 300000);

        if (TenXDate.now() - lastModified > rateReducerLookupRetain) {

            if (!TenXEnv.get("quiet")) {
                TenXConsole.log("⚠️ rate reducer mute file is stale, lastModified: {}, retainInterval: {}",
                    lastModified, rateReducerLookupRetain);
            }

            TenXLog.info("rate reducer mute file is stale, lastModified: {}, retainInterval: {}",
                lastModified, rateReducerLookupRetain);
        }
    }
}

export class GlobalReducerObject extends TenXObject {

    get shouldRetainEventWithLookup() {

        if ((!this.isObject) || (this.isDropped)) return true;

        // Build the field-set key the same way the local reducer does, so mute
        // entries are keyed by human-readable field values (e.g. symbolMessage,
        // container) rather than an internal hash.
        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReducerFieldNames"));
        if (!fieldSetKey) return true;

        // Look up the mute entry for this field-set.
        // Entry format: "<sampleRate>:<untilEpochSec>[:<reason>]"
        var entry = TenXLookup.get("rateReducerLookupFile", fieldSetKey);
        if (!entry) return true;

        var parts = TenXString.split(entry, ":");
        var sampleRate = TenXMath.parseDouble(parts[0]);
        var untilEpochSec = TenXMath.parseDouble(parts[1]);

        // Expired mute → self-heal, always retain.
        var nowSec = TenXDate.now() / 1000;
        if (nowSec >= untilEpochSec) {
            if (TenXLog.isDebug()) {
                TenXLog.debug("mute expired. fieldSet={}, untilEpochSec={}, nowSec={}",
                    fieldSetKey, untilEpochSec, nowSec);
            }
            return true;
        }

        // Apply severity floor: a 0.0 mute on INFO drops everything, but an
        // ERROR/FATAL event under the same mute still gets minRetentionThreshold * boost.
        var minRetentionThreshold = TenXEnv.get("rateReducerMinRetentionThreshold", 0.1);
        var boostMap = TenXMap.fromEntries(TenXEnv.get("rateReducerLevelBoost"));
        var level = this.get(TenXEnv.get("levelField"));
        var boost = TenXMap.get(boostMap, level, 1);

        var retentionThreshold = TenXMath.max(sampleRate, minRetentionThreshold * boost);

        if (TenXMath.random() > retentionThreshold) {
            this.drop();

            if (TenXLog.isDebug()) {
                TenXLog.debug("drop by mute. fieldSet={}, sampleRate={}, untilEpochSec={}, boost={}, retentionThreshold={}",
                    fieldSetKey, sampleRate, untilEpochSec, boost, retentionThreshold);
            }
        } else {
            if (TenXLog.isDebug()) {
                TenXLog.debug("retained under mute. fieldSet={}, sampleRate={}, untilEpochSec={}, boost={}, retentionThreshold={}",
                    fieldSetKey, sampleRate, untilEpochSec, boost, retentionThreshold);
            }
        }

        return true;
    }
}
