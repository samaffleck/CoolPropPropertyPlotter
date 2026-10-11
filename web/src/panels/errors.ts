export function friendlyError(e: string): string {
  if (/unsupported input pair/.test(e)) return "That pair of properties cannot define a state. Choose two independent properties.";
  if (/out of range|outside|bounds|not valid/i.test(e)) return `No valid state: ${e}`;
  return e.length > 180 ? `${e.slice(0, 180)}…` : e;
}
