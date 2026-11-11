export const GLSL_SKY_NIGHT = `
float skyNight(float vertical, float progress) {
  float front = 1.25 - 1.5 * clamp(progress, 0.0, 1.0);
  return smoothstep(front - 0.15, front + 0.15, vertical);
}
`;
