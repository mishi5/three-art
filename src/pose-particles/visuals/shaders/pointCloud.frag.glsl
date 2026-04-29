precision mediump float;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float circle = 1.0 - smoothstep(0.4, 0.5, d);
  if (circle < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), circle * vAlpha);
}
