// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- WITH-MUTE, WITH-CAP-FILE variant.
//
// One of FOUR regulator-decision classes split across the (mute, cap)
// cartesian. See rate-object-local.js's header for the full overview.
// This file is the WITH-MUTE WITH-CAP-FILE variant: the cap, total and action
// files are read as in rate-object-cap.js (the container's own row, then the
// `*` row); mute-file decisions win over the regulator path entirely, except
// that levels in `rateReceiverKeepCounts` pass their first lines per window.
// Muted lines that pass count toward their capped service's total.
//
// One class only: rateReceiverLookupCapObject (regulator + mute-lookup +
// cap, total and action lookups). Input classes for the tables live in
// rate-object-lookup.js (mute) and rate-object-cap.js (cap, total, action),
// both gated on their respective env vars independently of cap/mute state,
// so when both files are set, every table is loaded and this Object class can
// call TenXLookup.get on each.
//
// Dispatched via `shouldRetainEventWithMuteAndCap()` from settings.yaml's
// groupFilters 4-way ternary.

export class rateReceiverLookupCapObject extends TenXObject {

    // BOTH mute file AND cap file set.
    static shouldLoad(config) {
        return TenXEnv.get("rateReceiverLookupFile") && TenXEnv.get("rateReceiverCapLookupFile");
    }

    // The regulator algorithm runs in the groupFilter getter (post-grouping,
    // on the whole event). `this.route(action)` MARKS the event's routeState; the
    // marked event keeps flowing (getter returns true), and each output stream's
    // filter decides what a mark means.
    get shouldRetainEventWithMuteAndCap() {

        if ((!this.isObject) || (this.isRoute("drop"))) return true;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true;

        // Inline the env lookup; a local var passed to this.get() is treated as an event field.
        var container = this.get(TenXEnv.get("rateReceiverContainerField"));
        if (!container) container = "__node__";

        var key = fieldSetKey + "@" + container;
        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);
        var nowSec = TenXDate.now() / 1000;

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
                if (nowSec < untilEpochSec) {
                    hasActiveMute = true;
                    muteThreshold = TenXMath.max(sampleRate, floor);
                }
            }
        }
        // ---- 2. cap, total and action files, as in rate-object-cap.js ----

        // Cap: the container's active row, else the `*` row, else rateReceiverAbsoluteCap.
        // Entry shape: <units>[:<untilEpochSec>[:<reason>]]. A row of 0 exempts the container.
        var absoluteCap = 0;
        var capFound = false;
        var capEntry = TenXLookup.get("rateReceiverCapLookupFile", container);
        if (capEntry) {
            var capC1 = TenXString.indexOf(capEntry, ":", 0);
            var capEnd = (capC1 < 0) ? TenXString.length(capEntry) : capC1;
            var capActive = true;
            if (capC1 >= 0) {
                var capC2 = TenXString.indexOf(capEntry, ":", capC1 + 1);
                var capUntilEnd = (capC2 < 0) ? TenXString.length(capEntry) : capC2;
                var capUntil = TenXMath.parseDouble(TenXString.substring(capEntry, capC1 + 1, capUntilEnd));
                if (capUntil > 0 && nowSec > capUntil) capActive = false;
            }
            if (capActive) absoluteCap = TenXMath.parseDouble(TenXString.substring(capEntry, 0, capEnd));
            if (capActive) capFound = true;
        }
        if (!capFound) {
            var starCapEntry = TenXLookup.get("rateReceiverCapLookupFile", "*");
            if (starCapEntry) {
                var starCapC1 = TenXString.indexOf(starCapEntry, ":", 0);
                var starCapEnd = (starCapC1 < 0) ? TenXString.length(starCapEntry) : starCapC1;
                var starCapActive = true;
                if (starCapC1 >= 0) {
                    var starCapC2 = TenXString.indexOf(starCapEntry, ":", starCapC1 + 1);
                    var starCapUntilEnd = (starCapC2 < 0) ? TenXString.length(starCapEntry) : starCapC2;
                    var starCapUntil = TenXMath.parseDouble(TenXString.substring(starCapEntry, starCapC1 + 1, starCapUntilEnd));
                    if (starCapUntil > 0 && nowSec > starCapUntil) starCapActive = false;
                }
                if (starCapActive) absoluteCap = TenXMath.parseDouble(TenXString.substring(starCapEntry, 0, starCapEnd));
                if (starCapActive) capFound = true;
            }
        }
        if (!capFound) absoluteCap = TenXEnv.get("rateReceiverAbsoluteCap", 0);

        // Total per window: the container's active row, else the `*` row, else none.
        var serviceTotal = 0;
        if (TenXString.length(TenXEnv.get("rateReceiverTotalLookupFile")) > 0) {
            var totalFound = false;
            var totalEntry = TenXLookup.get("rateReceiverTotalLookupFile", container);
            if (totalEntry) {
                var tC1 = TenXString.indexOf(totalEntry, ":", 0);
                var tEnd = (tC1 < 0) ? TenXString.length(totalEntry) : tC1;
                var tActive = true;
                if (tC1 >= 0) {
                    var tC2 = TenXString.indexOf(totalEntry, ":", tC1 + 1);
                    var tUntilEnd = (tC2 < 0) ? TenXString.length(totalEntry) : tC2;
                    var tUntil = TenXMath.parseDouble(TenXString.substring(totalEntry, tC1 + 1, tUntilEnd));
                    if (tUntil > 0 && nowSec > tUntil) tActive = false;
                }
                if (tActive) serviceTotal = TenXMath.parseDouble(TenXString.substring(totalEntry, 0, tEnd));
                if (tActive) totalFound = true;
            }
            if (!totalFound) {
                var starTotalEntry = TenXLookup.get("rateReceiverTotalLookupFile", "*");
                if (starTotalEntry) {
                    var stC1 = TenXString.indexOf(starTotalEntry, ":", 0);
                    var stEnd = (stC1 < 0) ? TenXString.length(starTotalEntry) : stC1;
                    var stActive = true;
                    if (stC1 >= 0) {
                        var stC2 = TenXString.indexOf(starTotalEntry, ":", stC1 + 1);
                        var stUntilEnd = (stC2 < 0) ? TenXString.length(starTotalEntry) : stC2;
                        var stUntil = TenXMath.parseDouble(TenXString.substring(starTotalEntry, stC1 + 1, stUntilEnd));
                        if (stUntil > 0 && nowSec > stUntil) stActive = false;
                    }
                    if (stActive) serviceTotal = TenXMath.parseDouble(TenXString.substring(starTotalEntry, 0, stEnd));
                }
            }
        }

        var units = (TenXEnv.get("rateReceiverUnit", "bytes") == "events") ? 1 : this.utf8Size();

        // What the service's caps alone let through in the previous window, as
        // in rate-object-cap.js. Muted lines that pass count in it.
        var prevUnits = 0;
        if (serviceTotal > 0 && absoluteCap != 0) {
            if (TenXCounter.getAndInc("rg_win_" + container, 1, windowMs) == 0) {
                var lastStart = TenXCounter.getAndSet("rg_ws_" + container, nowSec);
                if (nowSec - lastStart >= 1) {
                    var lastUnits = TenXCounter.getAndSet("rg_run_" + container, 0);
                    var lastWindow = (lastStart > 0 && (nowSec - lastStart) * 1000 < 2 * windowMs) ? lastUnits : 0;
                    TenXCounter.getAndSet("rg_prev_" + container, lastWindow);
                }
            }
            prevUnits = TenXCounter.getAndInc("rg_prev_" + container, 0);
        }

        // A muted pattern follows its entry: the levels with a keep count pass
        // their first K lines per pattern per window, and the sample rate decides
        // the rest. In a capped container the lines that pass still count toward
        // the pattern, the service volume and the service total, so the rest of
        // the service gives way first.
        var mutePass = false;
        var muteKept = -1;
        if (hasActiveMute && keepCount >= 0) muteKept = TenXCounter.getAndInc("rg_kc_" + key, 1, windowMs);
        if (hasActiveMute && muteKept >= 0 && muteKept < keepCount) mutePass = true;
        if (hasActiveMute && !mutePass && TenXMath.random() <= muteThreshold) mutePass = true;
        if (hasActiveMute && mutePass && absoluteCap != 0) TenXCounter.getAndInc("rg_num_" + key, units, windowMs);
        if (hasActiveMute && mutePass && absoluteCap != 0) TenXCounter.getAndInc("rg_den_" + container, units, windowMs);
        if (hasActiveMute && mutePass && absoluteCap != 0 && serviceTotal > 0) TenXCounter.getAndInc("rg_pas_" + container, units, windowMs);
        if (hasActiveMute && mutePass && absoluteCap != 0 && serviceTotal > 0) TenXCounter.getAndInc("rg_run_" + container, units);
        if (hasActiveMute && !mutePass) this.route("drop");
        if (hasActiveMute) return true; // mute decision is terminal (marked if over threshold)

        // ---- 3. regulator path ----
        if (absoluteCap == 0) return true;

        var patternUnits = TenXCounter.getAndInc("rg_num_" + key, units, windowMs);
        var containerUnits = TenXCounter.getAndInc("rg_den_" + container, units, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);
        var underCap = (serviceTotal > 0 && (patternUnits + units) <= absoluteCap) ? units : 0;
        var runUnits = 0;
        if (serviceTotal > 0) runUnits = TenXCounter.getAndInc("rg_run_" + container, underCap) + underCap;

        var now = TenXDate.now();
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            // getAndSet is atomic: one event gets 0 back, a racing one gets the stored time.
            firstSeen = TenXCounter.getAndSet("rg_seen_" + container, now);
            if (firstSeen == 0) firstSeen = now;
        }
        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 0);

        // Always kept: the warm-up. The per-pattern baseline sample passes
        // within the service total like any line, and past it up to
        // rateReceiverBaselineMaxOverTotal sample lines per service per window.
        var keep = false;
        if (warmupMs > 0 && (now - firstSeen) < warmupMs) keep = true;
        var inSample = false;
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) inSample = true;

        // Noisiest first: when the service's caps alone let more than its total
        // through in the previous window, every pattern's cap scales by total /
        // that amount for the whole window, or by what they let through so far
        // this window once that is larger. With no previous window, the scale is
        // total / the service's units so far this window.
        var effectiveCap = absoluteCap;
        var scaleUnits = TenXMath.max(prevUnits, runUnits);
        if (serviceTotal > 0 && prevUnits > 0 && scaleUnits > serviceTotal) effectiveCap = absoluteCap * serviceTotal / scaleUnits;
        if (serviceTotal > 0 && prevUnits == 0 && (containerUnits + units) > serviceTotal) effectiveCap = absoluteCap * serviceTotal / (containerUnits + units);

        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0);
        var share = (patternUnits + units) / (containerUnits + units);
        var regular = false;
        if (!keep && inSample) regular = true;
        if (!keep && (patternUnits + units) <= effectiveCap) regular = true;
        if (!keep && share < minSharePercent) regular = true;
        if (!keep && keepCount < 0 && TenXMath.random() < floor) regular = true;

        // Hard bound: the units the service passed this window. A line reserves
        // its units, and a line that does not fit hands them back.
        var counted = false;
        var passedBefore = 0;
        if (regular && serviceTotal > 0) passedBefore = TenXCounter.getAndInc("rg_pas_" + container, units, windowMs);
        if (regular && serviceTotal > 0 && (passedBefore + units) <= serviceTotal) counted = true;
        if (regular && serviceTotal > 0 && !counted) TenXCounter.getAndInc("rg_pas_" + container, 0 - units, windowMs);
        if (regular && serviceTotal > 0 && !counted) regular = false;
        if (regular) keep = true;

        // A sample line past the service total: the service's allowance of
        // sample lines over its total this window, unbounded at 0.
        var sampleOver = TenXEnv.get("rateReceiverBaselineMaxOverTotal", 50);
        if (!keep && inSample && sampleOver <= 0) keep = true;
        if (!keep && inSample && sampleOver > 0 && TenXCounter.getAndInc("rg_sx_" + container, 1, windowMs) < sampleOver) keep = true;

        // Error-class levels with a keep count: the first K lines of a pattern
        // held by its cap or by the service total pass each window, within the
        // service total like any line, and past it up to
        // rateReceiverKeepMaxOverTotal keep lines per service per window.
        var keptBefore = -1;
        if (!keep && keepCount >= 0) keptBefore = TenXCounter.getAndInc("rg_kc_" + key, 1, windowMs);
        var inKeep = false;
        if (keptBefore >= 0 && keptBefore < keepCount) inKeep = true;
        var keepOver = TenXEnv.get("rateReceiverKeepMaxOverTotal", 500);
        if (inKeep && serviceTotal <= 0) keep = true;
        if (inKeep && keepOver <= 0) keep = true;
        if (inKeep && !keep) passedBefore = TenXCounter.getAndInc("rg_pas_" + container, units, windowMs);
        if (inKeep && !keep && (passedBefore + units) <= serviceTotal) counted = true;
        if (inKeep && !keep && !counted) TenXCounter.getAndInc("rg_pas_" + container, 0 - units, windowMs);
        if (inKeep && counted) keep = true;
        if (inKeep && !keep && TenXCounter.getAndInc("rg_kx_" + container, 1, windowMs) < keepOver) keep = true;

        if (keep && serviceTotal > 0 && !counted) TenXCounter.getAndInc("rg_pas_" + container, units, windowMs);
        if (keep) return true;

        // Held: the action is the container's active row, else the `*` row,
        // else rateReceiverDefaultAction (pass unless set).
        // Entry shape (mirrors the cap entry): <action>[:<untilEpochSec>[:<reason>]].
        var action = TenXEnv.get("rateReceiverDefaultAction", "pass");
        if (action != "offload" && action != "tier_down" && action != "compact" && action != "sample" && action != "drop") action = "pass";
        if (TenXString.length(TenXEnv.get("rateReceiverActionLookupFile")) > 0) {
            var actionFound = false;
            var actionEntry = TenXLookup.get("rateReceiverActionLookupFile", container);
            if (actionEntry) {
                var aC1 = TenXString.indexOf(actionEntry, ":", 0);
                var actionEnd = (aC1 < 0) ? TenXString.length(actionEntry) : aC1;
                var actionActive = true;
                if (aC1 >= 0) {
                    var aC2 = TenXString.indexOf(actionEntry, ":", aC1 + 1);
                    var aUntilEnd = (aC2 < 0) ? TenXString.length(actionEntry) : aC2;
                    var aUntil = TenXMath.parseDouble(TenXString.substring(actionEntry, aC1 + 1, aUntilEnd));
                    if (aUntil > 0 && nowSec > aUntil) actionActive = false;
                }
                if (actionActive) action = TenXString.substring(actionEntry, 0, actionEnd);
                if (actionActive) actionFound = true;
            }
            if (!actionFound) {
                var starActionEntry = TenXLookup.get("rateReceiverActionLookupFile", "*");
                if (starActionEntry) {
                    var saC1 = TenXString.indexOf(starActionEntry, ":", 0);
                    var saEnd = (saC1 < 0) ? TenXString.length(starActionEntry) : saC1;
                    var saActive = true;
                    if (saC1 >= 0) {
                        var saC2 = TenXString.indexOf(starActionEntry, ":", saC1 + 1);
                        var saUntilEnd = (saC2 < 0) ? TenXString.length(starActionEntry) : saC2;
                        var saUntil = TenXMath.parseDouble(TenXString.substring(starActionEntry, saC1 + 1, saUntilEnd));
                        if (saUntil > 0 && nowSec > saUntil) saActive = false;
                    }
                    if (saActive) action = TenXString.substring(starActionEntry, 0, saEnd);
                }
            }
        }

        this.route(action);
        return true;
    }
}
