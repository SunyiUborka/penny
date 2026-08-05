export const SESSION_COOKIE_NAME = 'session';
export const SESSION_COOKIE_VALUE = 'authenticated';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const LOGIN_RATE_LIMIT_MAX = 5;
export const LOGIN_RATE_LIMIT_WINDOW = '1 minute';
export const LOGIN_DELAY_WINDOW_MS = 60 * 1000;
export const LOGIN_DELAY_STEP_MS = 300;
export const LOGIN_DELAY_MAX_MS = 3000;
