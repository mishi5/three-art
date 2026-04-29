#define MAX_JOINTS 13

uniform vec3 uJoints[MAX_JOINTS];
uniform float uTime;
uniform float uVolume;
uniform float uBass;
uniform float uTreble;
uniform float uPixelRatio;

attribute float aJointIndex;
attribute vec3 aOffset;   // ガウス分布サンプル（関節中心からのオフセット、メートル）
attribute float aSeed;

varying float vAlpha;

void main() {
  int jointIdx = int(aJointIndex + 0.5);
  vec3 jointPos = uJoints[jointIdx];

  // bass で半径膨張（後の Task で使う、今は uBass=0 固定）
  float radius = 1.0 + uBass * 1.5;
  vec3 offset = aOffset * radius;

  // treble で個別シマー
  float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * uTreble * 0.02;
  offset += normalize(aOffset + 0.0001) * shimmer;

  vec3 pos = jointPos + offset;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (3.0 + uVolume * 5.0) * uPixelRatio * (1.0 / -mv.z);

  float d = length(aOffset);
  vAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * (0.5 + uTreble * 0.5);
}
