const PREFIX = '[bluetooth-smartlock]';

export function logInfo(message) {
    log(`${PREFIX} ${message}`);
}

export function logWarn(message) {
    console.warn(`${PREFIX} ${message}`);
}

export function logError(message) {
    console.error(`${PREFIX} ${message}`);
}
