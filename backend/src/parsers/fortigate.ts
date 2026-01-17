/**
 * FortiGate Syslog Parser
 * 
 * Parses FortiGate syslog messages in key=value format.
 * Handles quoted values, nested quotes, and special characters.
 */

export interface ParsedFortiGateLog {
    // Timestamps
    date?: string;
    time?: string;
    eventtime?: string;
    tz?: string;

    // Device info
    devname?: string;
    devid?: string;
    vd?: string; // virtual domain

    // Log metadata
    logid?: string;
    type?: string;
    subtype?: string;
    level?: string;
    logdesc?: string;

    // User/session info
    user?: string;
    srcuser?: string;
    dstuser?: string;
    ui?: string;
    policyid?: string;
    sessionid?: string;

    // Network info
    srcip?: string;
    srcport?: string;
    dstip?: string;
    dstport?: string;
    srcintf?: string;
    dstintf?: string;
    proto?: string;
    service?: string;

    // Action/result
    action?: string;
    status?: string;
    reason?: string;
    msg?: string;

    // VPN specific
    tunneltype?: string;
    tunnelid?: string;
    remip?: string;
    xauthuser?: string;
    xauthgroup?: string;
    vpntunnel?: string;

    // Config change specific
    cfgtid?: string;
    cfgpath?: string;
    cfgattr?: string;

    // UTM/Security
    attack?: string;
    severity?: string;
    ref?: string;
    incidentserialno?: string;

    // All raw key-value pairs
    rawKv: Record<string, string>;
}

/**
 * Parse a FortiGate syslog message into structured fields.
 * 
 * FortiGate format: key1=value1 key2="quoted value" key3=unquoted
 * 
 * @param rawMessage - The raw syslog message string
 * @returns Parsed log object with extracted fields
 */
export function parseFortiGateLog(rawMessage: string): ParsedFortiGateLog {
    const rawKv: Record<string, string> = {};

    // Remove syslog priority prefix if present (e.g., "<134>")
    let message = rawMessage.replace(/^<\d+>/, '').trim();

    // Regex to match key=value pairs
    // Handles: key=value, key="quoted value", key="value with \"escaped\" quotes"
    const kvRegex = /(\w+)=((?:"(?:[^"\\]|\\.)*")|(?:[^\s]+))/g;

    let match: RegExpExecArray | null;
    while ((match = kvRegex.exec(message)) !== null) {
        const key = match[1]?.toLowerCase();
        const value = match[2];

        if (!key || value === undefined) continue;

        // Remove surrounding quotes if present
        let cleanValue = value;
        if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
            cleanValue = cleanValue.slice(1, -1);
            // Unescape escaped quotes
            cleanValue = cleanValue.replace(/\\"/g, '"');
        }

        rawKv[key] = cleanValue;
    }

    // Build the parsed object dynamically to avoid undefined assignments
    const parsed: ParsedFortiGateLog = { rawKv };

    // Helper to set property only if value exists
    const set = <K extends keyof ParsedFortiGateLog>(key: K, value: string | undefined) => {
        if (value !== undefined) {
            (parsed as unknown as Record<string, string>)[key] = value;
        }
    };

    // Timestamps
    set('date', rawKv['date']);
    set('time', rawKv['time']);
    set('eventtime', rawKv['eventtime']);
    set('tz', rawKv['tz']);

    // Device info
    set('devname', rawKv['devname']);
    set('devid', rawKv['devid']);
    set('vd', rawKv['vd']);

    // Log metadata
    set('logid', rawKv['logid']);
    set('type', rawKv['type']);
    set('subtype', rawKv['subtype']);
    set('level', rawKv['level']);
    set('logdesc', rawKv['logdesc']);

    // User/session
    set('user', rawKv['user']);
    set('srcuser', rawKv['srcuser']);
    set('dstuser', rawKv['dstuser']);
    set('ui', rawKv['ui']);
    set('policyid', rawKv['policyid']);
    set('sessionid', rawKv['sessionid']);

    // Network
    set('srcip', rawKv['srcip']);
    set('srcport', rawKv['srcport']);
    set('dstip', rawKv['dstip']);
    set('dstport', rawKv['dstport']);
    set('srcintf', rawKv['srcintf']);
    set('dstintf', rawKv['dstintf']);
    set('proto', rawKv['proto']);
    set('service', rawKv['service']);

    // Action
    set('action', rawKv['action']);
    set('status', rawKv['status']);
    set('reason', rawKv['reason']);
    set('msg', rawKv['msg']);

    // VPN
    set('tunneltype', rawKv['tunneltype']);
    set('tunnelid', rawKv['tunnelid']);
    set('remip', rawKv['remip']);
    set('xauthuser', rawKv['xauthuser']);
    set('xauthgroup', rawKv['xauthgroup']);
    set('vpntunnel', rawKv['vpntunnel']);

    // Config
    set('cfgtid', rawKv['cfgtid']);
    set('cfgpath', rawKv['cfgpath']);
    set('cfgattr', rawKv['cfgattr']);

    // UTM
    set('attack', rawKv['attack']);
    set('severity', rawKv['severity']);
    set('ref', rawKv['ref']);
    set('incidentserialno', rawKv['incidentserialno']);

    return parsed;
}

/**
 * Determine the normalized event type from FortiGate log fields.
 * 
 * @param parsed - Parsed FortiGate log
 * @returns Normalized event type string
 */
export function getEventType(parsed: ParsedFortiGateLog): string {
    const type = parsed.type?.toLowerCase() ?? '';
    const subtype = parsed.subtype?.toLowerCase() ?? '';
    const logid = parsed.logid ?? '';

    // VPN events
    if (subtype === 'vpn') {
        if (parsed.action === 'tunnel-up') return 'vpn_tunnel_up';
        if (parsed.action === 'tunnel-down') return 'vpn_tunnel_down';
        if (parsed.action === 'ssl-login-fail') return 'vpn_login_fail';
        if (parsed.action === 'ssl-login-success') return 'vpn_login_success';
        return 'vpn_event';
    }

    // Admin login events
    if (subtype === 'admin') {
        if (parsed.status === 'success') return 'admin_login_success';
        if (parsed.status === 'failed') return 'admin_login_fail';
        return 'admin_event';
    }

    // System config changes
    if (subtype === 'system' && parsed.cfgpath) {
        return 'config_change';
    }

    // Firewall traffic
    if (type === 'traffic') {
        if (parsed.action === 'deny') return 'traffic_deny';
        if (parsed.action === 'accept') return 'traffic_accept';
        return 'traffic';
    }

    // UTM/Security events
    if (type === 'utm') {
        if (subtype === 'virus') return 'utm_virus';
        if (subtype === 'ips') return 'utm_ips';
        if (subtype === 'webfilter') return 'utm_webfilter';
        if (subtype === 'app-ctrl') return 'utm_app_control';
        return 'utm_event';
    }

    // Anomaly/IPS
    if (type === 'anomaly' || subtype === 'anomaly') {
        return 'anomaly';
    }

    // Default: use type_subtype
    if (type && subtype) {
        return `${type}_${subtype}`;
    }

    return 'unknown';
}

/**
 * Map FortiGate level to normalized severity.
 * 
 * @param level - FortiGate level string
 * @returns Normalized severity: info, low, medium, high, critical
 */
export function mapSeverity(level: string | undefined): string {
    switch (level?.toLowerCase()) {
        case 'emergency':
        case 'alert':
        case 'critical':
            return 'critical';
        case 'error':
            return 'high';
        case 'warning':
            return 'medium';
        case 'notice':
            return 'low';
        case 'information':
        case 'debug':
        default:
            return 'info';
    }
}

/**
 * Parse FortiGate timestamp to Date object.
 * 
 * @param date - Date string (YYYY-MM-DD)
 * @param time - Time string (HH:MM:SS)
 * @param tz - Timezone offset (e.g., "-0300")
 * @returns Date object or undefined
 */
export function parseTimestamp(
    date: string | undefined,
    time: string | undefined,
    tz: string | undefined
): Date | undefined {
    if (!date || !time) return undefined;

    // Format: "2026-01-16 12:26:43 -0300"
    let isoString = `${date}T${time}`;

    if (tz) {
        // Convert "-0300" to "-03:00"
        const tzFormatted = tz.replace(/([+-])(\d{2})(\d{2})/, '$1$2:$3');
        isoString += tzFormatted;
    }

    try {
        return new Date(isoString);
    } catch {
        return undefined;
    }
}

/**
 * Extract source IP from UI field if present.
 * Example: "GUI(107.216.131.59)" -> "107.216.131.59"
 * 
 * @param ui - UI field value
 * @returns Extracted IP or undefined
 */
export function extractIpFromUi(ui: string | undefined): string | undefined {
    if (!ui) return undefined;
    const match = ui.match(/\(([^)]+)\)/);
    return match?.[1];
}
