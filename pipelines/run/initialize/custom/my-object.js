// @loader: tenx

import {TenXInput, TenXLookup, TenXObject, TenXSummary, TenXCounter, TenXEnv, TenXLog, TenXConsole} from '@tenx/tenx'

/** 
 * The 10x JavaScript library provides a programmatic interface to the 10x Engine.
 * The MyInput, MyObject and MySummary classes below provide a sandbox for writing custom 10x scripts
 * that are loaded by the 10x 'run' pipeline by default. 
 * 
 */

/**
 * Input constructors are designed to initialize specific resources at the start of 
 * pipeline execution. These include functions for loading.csv/.tsv lookup tables via {@link TenXLookup.load},
 * connecting to GeoIP DB files {@link TenXLookup.loadGeoIPDB()} to allow for geo-referencing,
 * validating startups args via {@link TenXLog.throwError} and more. 
 * 
 * To learn more see {@link TenXInput}.
 *  
 */

export class MyInput extends TenXInput {

    // @https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {

        // customize result to control whether to load this class 
        return true;
    }

    constructor() {
        // Load the MCP-written config-generation lookup by its bare filename.
        // TenXLookup.load wants a string LITERAL (no computed path), but it
        // resolves a relative filename against the pipeline's include paths --
        // and the @kubernetes ConfigMap pull adds the pulled dir
        // (java.io.tmpdir/tenx/kubernetes/<ns>/<configMap>/) to those paths. So a
        // bare "config-generation.csv" resolves there on any install, no
        // namespace/ConfigMap hardcoding. configure_engine writes the file next
        // to caps.csv; load raises if it is absent, so configure_engine always
        // writes a generation (and terraform seeds a bootstrap row).
        TenXLookup.load("config-generation.csv", true, "key", "value");
    }
}

/**
 *  Object constructors initialize tenxObjects structured from input events.
 *  This can be used to enrich instances with calculated fields that combine intrinsic, extracted and reflected fields
 *  with configuration values using {@link TenXEnv.get()}, increase atomic counters {@link TenXCounter.inc()},
 *  or filter instances from the pipeline using {@link TenXObject.drop()}.
 * 
 *  To learn more see {@link TenXObject}
 */

export class MyObject extends TenXObject {

    // @https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        
        // customize result to control whether to load this class 
        return true;
    }

    constructor() {
        // Stamp the running config generation onto every event. Listed in
        // enrichmentFields (run/modules/receive/rate/settings.yaml), it rides the
        // summary metrics as the `tenx_config_version` label, so the engine
        // advertises which generation it loaded and the MCP can verify the policy
        // it wrote is live. Value = the `generation` row of the MCP-written
        // config-generation lookup (table name = file basename); "unset" only
        // when that row is absent.
        var g = TenXLookup.get("config-generation", "generation", "key", "value");
        this.tenx_config_version = g ? g : "unset";
     }
}

/** 
 *  Summary constructors initialize instances produced by an aggregator (https://doc.log10x.com/run/aggregate)
 *  This can be used to enrich instances with calculated fields using lookup tables {@link TenXLookup.get()},
 *  or tally values via counters using {@link TenXCounter.getAndSet()}.
 * 
 *   To learn more see {@link TenXSummary}
 */
export class MySummary extends TenXSummary {

    // @https://doc.log10x.com/api/js/#TenXEngine.shouldLoad
    static shouldLoad(config) {
        // customize result to control whether to load this class 
        return true;
    }

    constructor() {
        // your code here to enrich summary instances
    }
}

