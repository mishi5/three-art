#define MAX_JOINTS 13

uniform vec3 uJoints[MAX_JOINTS];
uniform float uTime;
uniform float uVolume;
uniform float uMid;
uniform float uPixelRatio;

attribute vec3 aBasePosition;
attribute float aSeed;

varying float vAlpha;

vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

vec3 curlNoise(vec3 p) {
  float e = 0.05;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 px0 = hash3(p - dx); vec3 px1 = hash3(p + dx);
  vec3 py0 = hash3(p - dy); vec3 py1 = hash3(p + dy);
  vec3 pz0 = hash3(p - dz); vec3 pz1 = hash3(p + dz);
  vec3 dFdx = (px1 - px0) / (2.0 * e);
  vec3 dFdy = (py1 - py0) / (2.0 * e);
  vec3 dFdz = (pz1 - pz0) / (2.0 * e);
  return vec3(dFdy.z - dFdz.y, dFdz.x - dFdx.z, dFdx.y - dFdy.x);
}

void main() {
  vec3 base = aBasePosition;
  vec3 drift = curlNoise(base * 0.5 + uTime * 0.1) * (0.3 + uMid * 0.5);
  vec3 pos = base + drift;

  // 13 関節からの逆二乗合力で吸い寄せ
  vec3 force = vec3(0.0);
  for (int i = 0; i < MAX_JOINTS; i++) {
    vec3 toJoint = uJoints[i] - pos;
    float d2 = dot(toJoint, toJoint) + 0.05;
    force += toJoint / d2;
  }
  pos += force * 0.02;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.5 + uVolume * 1.5) * uPixelRatio * (1.0 / -mv.z);
  vAlpha = 0.4 + uVolume * 0.4;
}
