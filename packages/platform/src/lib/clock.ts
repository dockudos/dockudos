/** Where "now" comes from. Services take a clock so retries, expiry and windows can be tested without waiting. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
