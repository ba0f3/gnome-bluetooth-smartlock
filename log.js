const P = '[bluetooth-smartlock]';

export const extLog  = (...args) => console.log(P, ...args);
export const extWarn = (...args) => console.warn(P, ...args);
export const extErr   = (...args) => console.error(P, ...args);
export const extDebug = (...args) => console.debug(P, ...args);