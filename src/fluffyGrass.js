// https://github.com/thebenezer/FluffyGrass
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// 建一個「草叢」幾何：兩片交叉的平面
function createGrassTuftGeometry(bladeWidth = 0.06, bladeHeight = 0.5) {
    const plane = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, 4);
    // 頂點往上偏移，讓底部在 y=0
    plane.translate(0, bladeHeight * 0.5, 0);

    const plane2 = plane.clone();
    plane2.rotateY(Math.PI / 2);

    const merged = BufferGeometryUtils.mergeGeometries([plane, plane2]);
    merged.computeVertexNormals();
    return merged;
}

/**
 * 建立一整片草地 (InstancedMesh)
 * @param {Object} options
 *  - size: 方形地面的一半
 *  - count: 草叢數量
 */
export function createFluffyGrass(options = {}) {
    const {
        halfSize = 20,
        // count = 8000,
        count = 80000, // 原本 8000 → 4~5 倍，密很多
        // bladeWidth = 0.04,
        bladeWidth = 0.018, // 變細
        // bladeHeight = 0.4,
        bladeHeight = 0.32,        // 稍微矮一點，接近絨毛
        // baseColor = new THREE.Color(0x9acb7c),
        // tipColor = new THREE.Color(0x8ccf6a)
        baseColor = new THREE.Color(0x4a9e4f), // 深綠
        tipColor  = new THREE.Color(0xc8f9b1),// 亮一點的
    } = options;

    const geometry = createGrassTuftGeometry(bladeWidth, bladeHeight);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uBaseColor: { value: baseColor },
            uTipColor: { value: tipColor },
            uWindDir: { value: new THREE.Vector2(1.0, 0.3) },
            uWindStrength: { value: 0.4 }
        },
        vertexShader: /* glsl */`
            uniform float uTime;
            uniform vec2 uWindDir;
            uniform float uWindStrength;

            // 不要自己宣告 instanceMatrix，THREE 會自動給

            varying float vHeight;
            varying vec2 vUv;

            void main() {
                vUv = uv;
                vec3 pos = position;

                // 高度（0~1），越上面彎曲越大
                vHeight = pos.y;

                // 風搖
                float t = uTime * 0.5;
                float noise = sin(dot(pos.xz + t, uWindDir) * 2.5);
                float bend = noise * uWindStrength * vHeight;

                pos.x += uWindDir.x * bend;
                pos.z += uWindDir.y * bend;

                // === 關鍵：乘上 instanceMatrix ===
                vec4 worldPosition = modelMatrix * instanceMatrix * vec4(pos, 1.0);

                gl_Position = projectionMatrix * viewMatrix * worldPosition;
            }
        `,
        // fragmentShader: /* glsl */`
        //     uniform vec3 uBaseColor;
        //     uniform vec3 uTipColor;

        //     varying float vHeight;
        //     varying vec2 vUv;

        //     void main() {
        //         // 高度漸層顏色
        //         vec3 col = mix(uBaseColor, uTipColor, clamp(vHeight, 0.0, 1.0));

        //         // 上下再加一點 UV 漸層（底部深、頂部亮）
        //         col *= mix(0.85, 1.15, vUv.y);

        //         // 上下漸層 alpha，底部實、頂部略淡
        //         float alphaBottom = smoothstep(0.0, 0.1, vUv.y);
        //         float alphaTop    = smoothstep(0.7, 1.0, vUv.y);
        //         float alpha = alphaBottom * alphaTop;

        //         if (alpha < 0.01) discard;

        //         gl_FragColor = vec4(col, alpha);
        //     }
        // `,
        fragmentShader: /* glsl */`
            uniform vec3 uBaseColor;
            uniform vec3 uTipColor;

            varying float vHeight;
            varying vec2 vUv;

            void main() {
                // 顏色：用 vUv.y 做一點漸層
                float t = clamp(vUv.y * 0.9 + 0.1, 0.0, 1.0);
                vec3 col = mix(uBaseColor, uTipColor, t);

                // 上下再加一點亮度差
                col *= mix(0.9, 1.1, vUv.y);

                // alpha：底部實、頂部稍微淡，做成柔柔一團
                float alphaBottom = smoothstep(0.0, 0.03, vUv.y);  // 底部漸入
                float alphaTop    = smoothstep(0.7, 1.0, vUv.y);   // 頂部漸出
                float alpha = alphaBottom * alphaTop;

                if (alpha < 0.01) discard;

                gl_FragColor = vec4(col, alpha);
            }
        `,

        side: THREE.DoubleSide,
        transparent: true,
    });

    const instanced = new THREE.InstancedMesh(geometry, material, count);
    instanced.castShadow = true;
    instanced.receiveShadow = true;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
        const x = (Math.random() * 2 - 1) * halfSize;
        const z = (Math.random() * 2 - 1) * halfSize;

        // 高度與粗細都稍微隨機
        const scaleY = 0.6 + Math.random() * 0.8;   // 高度 0.6 ~ 1.4
        const scaleXZ = 0.35 + Math.random() * 0.35; // 粗細 0.35 ~ 0.7

        dummy.position.set(x, 0, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(scaleXZ, scaleY, scaleXZ);

        dummy.updateMatrix();
        instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.frustumCulled = false;

    return instanced;
}

/** 給外面呼叫更新時間用 */
export function updateFluffyGrass(grass, dt) {
    if (!grass || !grass.material || !grass.material.uniforms) return;
    grass.material.uniforms.uTime.value += dt;
}
