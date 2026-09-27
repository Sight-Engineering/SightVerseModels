// Post-processing chain: MSAA HDR scene -> ambient occlusion -> bloom -> tone-mapping -> colour grade.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'SightVerseGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.018 },
    uSaturation: { value: 1.07 },
    uAspect: { value: 1.7 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uSaturation, uAspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(1.05, 0.25, length(q));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      float g = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

export function createPostFX({ renderer, scene, camera }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 2.5, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.6, 1.8);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);

  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  return {
    composer, gtao, bloom, grade,
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      grade.uniforms.uAspect.value = w / h;
    },
    /** cfg: { ao, bloom, msaa } */
    apply(cfg) {
      gtao.enabled = !!cfg.ao;
      bloom.enabled = !!cfg.bloom;
      const s = cfg.msaa ?? 4;
      if (composer.renderTarget1.samples !== s) {
        for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = s; rt.dispose(); }
      }
    },
    render(dt, time) {
      grade.uniforms.uTime.value = time % 100;
      composer.render(dt);
    },
  };
}
