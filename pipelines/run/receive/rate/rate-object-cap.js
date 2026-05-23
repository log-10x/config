// @loader: tenx

import { TenXObject, TenXEnv, TenXLookup, TenXLog, TenXConsole, TenXDate, TenXMath, TenXString } from '@tenx/tenx'

// Per-container byte cap loader and per-event resolver.
//
// Loaded only when `rateReceiverCapLookupFile` is set. Two classes:
//
//   1. `rateReceiverCapInput extends TenXInput`: registers the cap lookup
//      table at engine init via `TenXLookup.load`, and emits a staleness
//      warning if the file's last modified time is older than
//      `rateReceiverCapLookupRetain`.
//
//   2. `rateReceiverCapObject extends TenXObject`: provides a per-event
//      getter `rateReceiverResolvedCap` that returns the cap bytes for the
//      current event's container, or 0 if there is no active entry. The
//      regulator classes (rate-object-local.js, rate-object-lookup.js) read
//      `this.rateReceiverResolvedCap` to determine the per-event cap. When
//      this file is shouldLoad=false (cap file unset), the getter is absent
//      from the TenXObject and the regulator falls back to
//      `rateReceiverAbsoluteCap`.
//
// The two classes are split out (rather than inlining `TenXLookup.get`
// directly into the regulator classes) because `TenXLookup.get` is
// parse-validated against registered tables at engine init -- it cannot live
// in a class that may load independently of the load-side class. Co-locating
// the get and the load in this file under the same `shouldLoad` gate
// satisfies the validation cleanly; the regulator classes only read the
// result via property access on `this`, which has no such validation.
//
// File format (CSV; header row + one comma-separated entry per row):
//   container,cap
//   <container>,<bytes>[:<untilEpochSec>][:<reason>]
//
// Where the <container> column is the value of `rateReceiverContainerField`
// (the regulator's container axis; the k8s container name in k8s). The <cap>
// column packs three colon-separated fields:
//   - <bytes>: integer cap per pattern per container per window.
//   - <untilEpochSec> (optional): self-expiry; past it the entry returns 0
//     (no cap), and the fallback `rateReceiverAbsoluteCap` applies.
//   - <reason> (optional): free-text for audit, unused at runtime.
// The reason field must not contain commas (would break CSV parsing).

export class rateReceiverCapInput extends TenXInput {

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
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

    // https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverCapLookupFile");
    }

    // Per-event cap resolution for the current TenXObject. The regulator
    // classes read this getter via `this.rateReceiverResolvedCap` to decide
    // whether and at what threshold to engage the over-cap branch.
    //
    // Returns:
    //   - the cap bytes from the file if there is an active entry for this
    //     container.
    //   - 0 if there is no entry, the entry is expired, or the entry is
    //     malformed. The regulator then falls back to
    //     `rateReceiverAbsoluteCap` (or to "no cap" if that is also 0).
    //
    // Getter name is prefixed `rateReceiver` to stay in the module's
    // namespace -- method names are global across all parsed classes (see
    // rate-object-lookup.js's `shouldRetainEventWithMute` for the same
    // reasoning).
    get rateReceiverResolvedCap() {

        var containerField = TenXEnv.get("rateReceiverContainerField");
        var container = containerField ? this.get(containerField) : "";
        if (!container) container = "__node__";

        var entry = TenXLookup.get("rateReceiverCapLookupFile", container);
        if (!entry) return 0;

        // Parse "<bytes>[:<untilEpochSec>][:<reason>]" with indexOf/substring.
        // Array indexing on a TenXString.split result does not work in the
        // DSL -- parts[N] resolves to a field lookup, not a list element.
        // The previously-verified parser shape in rate-object-lookup.js's
        // shouldRetainEventWithMute is mirrored here.
        var c1 = TenXString.indexOf(entry, ":", 0);
        var bytesEnd = (c1 < 0) ? TenXString.length(entry) : c1;
        var capBytes = TenXMath.parseDouble(TenXString.substring(entry, 0, bytesEnd));

        // No expiry segment -> entry is active.
        if (c1 < 0) return capBytes;

        var c2 = TenXString.indexOf(entry, ":", c1 + 1);
        var untilEnd = (c2 < 0) ? TenXString.length(entry) : c2;
        var untilEpochSec = TenXMath.parseDouble(TenXString.substring(entry, c1 + 1, untilEnd));

        // 0 means "no expiry"; positive past now means expired.
        if (untilEpochSec == 0) return capBytes;
        if ((TenXDate.now() / 1000) < untilEpochSec) return capBytes;

        return 0;
    }
}
