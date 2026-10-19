// @loader: tenx

import { TenXObject, TenXEnv, TenXCounter, TenXMap, TenXMath, TenXLog, TenXLookup, TenXConsole, TenXDate, TenXString } from '@tenx/tenx'

// Per-container noise regulator -- NO-MUTE, WITH-CAP-FILE variant.
//
// One of FOUR regulator-decision classes split across the (mute, cap)
// cartesian. See rate-object-local.js's header for the full overview.
// This file is the NO-MUTE WITH-CAP-FILE variant. Per container, three files
// are read, each keyed by the container with a `*` row for every container
// without a row of its own (the container's own row wins, then `*`):
//   - caps.csv    (`rateReceiverCapLookupFile`): the per-pattern cap, falling
//                 back to `rateReceiverAbsoluteCap`;
//   - totals.csv  (`rateReceiverTotalLookupFile`): the service's total per
//                 window, none when absent;
//   - actions.csv (`rateReceiverActionLookupFile`): what the held lines do,
//                 falling back to `rateReceiverDefaultAction`.
//
// Two classes:
//   1. `rateReceiverCapInput` (shouldLoad: capFile is set): registers the
//      cap, action and total tables. Independent of mute state, so the
//      with-mute-and-cap variant in rate-object-lookup-cap.js also reads them.
//   2. `rateReceiverCapObject` (shouldLoad: !muteFile && capFile):
//      regulator algorithm + inline lookups. Dispatched via
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

        // The per-service action table (sibling actions.csv) decides what the
        // over-budget slice of each capped service does. A cap file may ship
        // alone, so a missing actions file loads as an empty table and every
        // capped service passes until a row names it.
        if (TenXString.length(TenXEnv.get("rateReceiverActionLookupFile")) > 0) {
            TenXLookup.loadIfExists(TenXEnv.get("rateReceiverActionLookupFile"), true);
        }

        // The per-service total table (sibling totals.csv) bounds what each
        // capped service passes per window. A missing totals file loads as an
        // empty table: no service has a total until a row names it.
        if (TenXString.length(TenXEnv.get("rateReceiverTotalLookupFile")) > 0) {
            TenXLookup.loadIfExists(TenXEnv.get("rateReceiverTotalLookupFile"), true);
        }

        // A container with no actions row takes rateReceiverDefaultAction. route()
        // rejects an unknown name on every event, so the regulator uses pass for one.
        var defaultAction = TenXEnv.get("rateReceiverDefaultAction", "pass");
        if (defaultAction != "pass" && defaultAction != "offload" && defaultAction != "tier_down" &&
            defaultAction != "compact" && defaultAction != "sample" && defaultAction != "drop") {
            if (!TenXEnv.get("quiet")) {
                TenXConsole.log("⚠️ rateReceiverDefaultAction '{}' is not one of pass, offload, tier_down, compact, sample, drop; using pass",
                    defaultAction);
            }
            TenXLog.info("rateReceiverDefaultAction '{}' is not one of pass, offload, tier_down, compact, sample, drop; using pass",
                defaultAction);
        }
    }
}

export class rateReceiverCapObject extends TenXObject {

    // No mute file, WITH cap file: regulator + per-container lookups.
    static shouldLoad(config) {
        return !TenXEnv.get("rateReceiverLookupFile") && TenXEnv.get("rateReceiverCapLookupFile");
    }

    // The regulator algorithm runs in the groupFilter getter (post-grouping,
    // on the whole event). `this.route(action)` MARKS the event's routeState; the
    // marked event keeps flowing (getter returns true), and each output stream's
    // filter decides what a mark means.
    get shouldRetainEventWithCap() {

        if ((!this.isObject) || (this.isRoute("drop"))) return true;

        var fieldSetKey = this.joinFields("_", TenXEnv.get("rateReceiverFieldNames"));
        if (!fieldSetKey) return true;

        // Inline the env lookup; a local var passed to this.get() is treated as an event field.
        var container = this.get(TenXEnv.get("rateReceiverContainerField"));
        if (!container) container = "__node__";

        var nowSec = TenXDate.now() / 1000;

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
        if (absoluteCap == 0) return true; // no cap configured -> opt-out

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

        var key = fieldSetKey + "@" + container;
        var units = (TenXEnv.get("rateReceiverUnit", "bytes") == "events") ? 1 : this.utf8Size();
        var windowMs = TenXEnv.get("rateReceiverResetIntervalMs", 240000);

        // What the service's caps alone let through in the previous window:
        // rg_run_ counts it, and the first line of each window moves the count
        // to rg_prev_. A service with no line in the window before gets 0.
        var prevUnits = 0;
        if (serviceTotal > 0) {
            if (TenXCounter.getAndInc("rg_win_" + container, 1, windowMs) == 0) {
                var lastStart = TenXCounter.getAndSet("rg_ws_" + container, nowSec);
                var lastUnits = TenXCounter.getAndSet("rg_run_" + container, 0);
                var lastWindow = (lastStart > 0 && (nowSec - lastStart) * 1000 < 2 * windowMs) ? lastUnits : 0;
                TenXCounter.getAndSet("rg_prev_" + container, lastWindow);
            }
            prevUnits = TenXCounter.getAndInc("rg_prev_" + container, 0);
        }

        var level = this.get(TenXEnv.get("levelField"));
        var floorMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverSeverityFloors"));
        var floorRaw = TenXMap.get(floorMap, level, "");
        var floor = TenXString.length(floorRaw) > 0 ? TenXMath.parseDouble(floorRaw) : TenXEnv.get("rateReceiverMinRetentionThreshold", 0);
        var keepMap = TenXMap.fromEntries(TenXEnv.get("rateReceiverKeepCounts"));
        var keepRaw = TenXMap.get(keepMap, level, "");
        var keepCount = TenXString.length(keepRaw) > 0 ? TenXMath.parseDouble(keepRaw) : -1;

        var patternUnits = TenXCounter.getAndInc("rg_num_" + key, units, windowMs);
        var containerUnits = TenXCounter.getAndInc("rg_den_" + container, units, windowMs);
        var n = TenXCounter.getAndInc("rg_cnt_" + key, 1, windowMs);
        if (serviceTotal > 0 && (patternUnits + units) <= absoluteCap) TenXCounter.getAndInc("rg_run_" + container, units);

        var now = TenXDate.now();
        var firstSeen = TenXCounter.getAndInc("rg_seen_" + container, 0);
        if (firstSeen == 0) {
            // getAndSet is atomic: one event gets 0 back, a racing one gets the stored time.
            firstSeen = TenXCounter.getAndSet("rg_seen_" + container, now);
            if (firstSeen == 0) firstSeen = now;
        }
        var warmupMs = TenXEnv.get("rateReceiverWarmupMs", 0);

        // Always kept: the warm-up and the per-pattern baseline sample.
        var keep = false;
        if (warmupMs > 0 && (now - firstSeen) < warmupMs) keep = true;
        if (n < TenXEnv.get("rateReceiverBaselineCount", 5)) keep = true;

        // Noisiest first: when the service's caps alone let more than its total
        // through in the previous window, every pattern's cap scales by total /
        // that amount for the whole window. With no previous window, the scale
        // is total / the service's units so far this window.
        var effectiveCap = absoluteCap;
        if (serviceTotal > 0 && prevUnits > serviceTotal) effectiveCap = absoluteCap * serviceTotal / prevUnits;
        if (serviceTotal > 0 && prevUnits == 0 && (containerUnits + units) > serviceTotal) effectiveCap = absoluteCap * serviceTotal / (containerUnits + units);

        var minSharePercent = TenXEnv.get("rateReceiverMinSharePercent", 0);
        var share = (patternUnits + units) / (containerUnits + units);
        var regular = false;
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

        // Error-class levels with a keep count: the first K lines of a pattern
        // held by its cap or by the service total pass each window.
        var keptBefore = -1;
        if (!keep && keepCount >= 0) keptBefore = TenXCounter.getAndInc("rg_kc_" + key, 1, windowMs);
        if (keptBefore >= 0 && keptBefore < keepCount) keep = true;

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
