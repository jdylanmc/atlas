function freezeLocation(location) {
    return Object.freeze({
        end: Object.freeze({ ...location.end }),
        start: Object.freeze({ ...location.start }),
    });
}
/**
 * Builds the deeply immutable, trusted Findings one Atlas SDK check reports, so
 * every trusted check shares one attribution and one immutability guarantee.
 */
export function sdkFindings(checkId) {
    const attribution = Object.freeze({
        checkId,
        kind: "sdk-core",
        trusted: true,
    });
    return (code, message, path, location) => Object.freeze({
        attribution,
        code,
        "finding-schema": "1.0.0",
        ...(location === undefined ? {} : { location: freezeLocation(location) }),
        message,
        path,
        severity: "error",
    });
}
