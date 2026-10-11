export function characterBlink(time: number, phase: number) {
  // A staggered, short blink with an occasional double blink.
  const cycle = (((time + phase * 1.73) % 5.8) + 5.8) % 5.8;
  const pulse = (center: number) =>
    Math.max(0, 1 - Math.abs(cycle - center) / 0.085);
  return Math.max(0.06, 1 - Math.max(pulse(0.16), pulse(0.42) * 0.85));
}

export function workstationMotion(time: number, phase: number) {
  const cycle = (((time + phase * 2.37) % 18) + 18) % 18;
  return cycle < 10 ? "type" : cycle < 13 ? "mouse" : "desk-review";
}
