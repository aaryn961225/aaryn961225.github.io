import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import Stats from 'three/addons/libs/stats.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createFluffyGrass, updateFluffyGrass } from './fluffyGrass.js';
// ===== Audio：全域 =====
const bgMusic = document.getElementById('bgMusic');
const sfxThrow = document.getElementById('sfxThrow');
// const sfxBark = document.getElementById('sfxBark');
const barkSounds = [
    document.getElementById('sfxBark1'),
    document.getElementById('sfxBark2'),
    document.getElementById('sfxBark3')
];

let audioEnabled = false;

function fadeOutFogOverlay() {
    const fog = document.getElementById('fog-overlay');
    const logo = document.querySelector('.fog-center-logo');

    fog.style.opacity = '0';

    setTimeout(() => {
        logo.style.opacity = '1';
    }, 800);

    setTimeout(() => {
        logo.style.opacity = '0';
    }, 2500 + 2000);

    setTimeout(() => {
        fog.remove();
        logo.parentElement.remove();
    }, 2500 + 2000 + 1000);
}

function playBgm() {
    if (!audioEnabled || !bgMusic) return;
    bgMusic.currentTime = 0;
    bgMusic.volume = 0.6;
    bgMusic.play().catch(err => console.warn('BGM blocked:', err));
}

function playSfx(audioEl, volume = 1) {
    if (!audioEnabled || !audioEl) return;

    audioEl.currentTime = 0;
    audioEl.volume = volume;
    audioEl.play().catch(err => console.warn('SFX blocked:', err));
}

function playRandomBark(volume = 0.8) {
    if (!audioEnabled) return;
    if (!barkSounds.length) return;

    const idx = Math.floor(Math.random() * barkSounds.length);
    const audioEl = barkSounds[idx];
    playSfx(audioEl, volume);
    if (dogBody) {
        dogBody.showHeartBubble(1.2); // 停留 1.2 秒，可自行調
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const loadingContainer = document.querySelector('.loadingContainer');
    const loadingScreen = document.querySelectorAll('.loadingScreen');
    // const exploreNoAudio = document.querySelector('.exploreNoAudio');
    const backgroundCover = document.querySelector('.background');
    const elements = [
        loadingContainer,
        backgroundCover,
        ...loadingScreen
    ];

    function startExperience(withAudio) {
        audioEnabled = withAudio;
        if (audioEnabled) {
            playBgm();
            fadeOutFogOverlay();
        }

        elements.forEach(el => {
            if (!el) return;
            el.classList.add('fade-out');
            el.addEventListener('transitionend', () => {
                el.classList.add('hidden');
            }, { once: true });
        });
    }

    loadingContainer.addEventListener('click', () => {
        startExperience(true);
    });

    // if (exploreNoAudio) {
    //     exploreNoAudio.addEventListener('click', (e) => {
    //         e.stopPropagation();
    //         startExperience(false);
    //     });
    // }
});

function loadModelPromise(url, key) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(url,
            gltf => {
                ballModels[key] = gltf.scene;
                resolve();
            },
            undefined,
            err => reject(err)
        );
    });
}

// -----------------------------------------------------------------------------
// 0. 全域變數 & 基本設定
// -----------------------------------------------------------------------------
let container, stats;
let camera, controls, scene, renderer;
let textureLoader;
const clock = new THREE.Clock();
let fluffyGrass = null;
const raycaster = new THREE.Raycaster();

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();

// 丟球蓄力相關
const balls = [];
let isCharging = false;
let chargeStart = 0;
let chargePower = 0;           // 0 ~ 1
const CHARGE_MAX_MS = 1500;    // 滿蓄 1.5 秒
const MIN_SPEED = 6;           // 最小拋出初速 (m/s)
const MAX_SPEED = 28;          // 最大拋出初速 (m/s)
let downMouse = new THREE.Vector2();   // pointerdown 當下的螢幕座標
let downRay = new THREE.Ray();         // pointerdown 當下的射線(方向固定，避免蓄力中滑動改變方向)
const chargeHUD = document.getElementById('chargeHUD');
const chargeFill = document.getElementById('chargeFill');

// 狗與玩家
let dog, dogBody, dogBrain;
let mixer;
let heartBubblePrefab = null;
const playerPos = new THREE.Vector3();
const tmpV = new THREE.Vector3();

// 邊緣安全判斷
let GROUND_HALF_X = 20;
let GROUND_HALF_Z = 20;
const EDGE_SAFE = 1.2;
const PREDICT_T = 0.7;

// Physics
const gravityConstant = -9.8;
let physicsWorld;
const rigidBodies = [];
const margin = 0.05;
let transformAux1;
// let softBodyHelpers;


// 目前球種
let currentBallType = 'tennisball';


// 預設基礎球材質（會在 BallFactory clone）
const baseBallMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0x220000,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0.1
});


Promise.all([
    loadModelPromise('/model/tennis_ball.glb', 'tennisball'),
    loadModelPromise('/model/football.glb', 'football'),
    loadModelPromise('/model/beach_ball.glb', 'beachball'),
]).then(() => {
    console.log("✓ all ball models loaded");

    Ammo().then(function (AmmoLib) {
        Ammo = AmmoLib;
        init();
    });
});


// -----------------------------------------------------------------------------
// 1. 環境初始化：場景 / 相機 / 燈光 / 地形 / Physics
// -----------------------------------------------------------------------------
function init() {
    initGraphics();
    initPhysics();
    createObjects();
    initInput();
}

function initGraphics() {
    container = document.getElementById('container');

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, 2000);

    scene = new THREE.Scene();
    // scene.background = new THREE.Color(0xbfd1e5);

    // === Skybox ===
    const loader = new THREE.CubeTextureLoader();
    const skybox = loader.setPath('../../media/texture/skybox/sky/').load([
        'right.jpg',   // +X
        'left.jpg',    // -X
        'top.jpg',     // +Y
        'bottom.jpg',  // -Y
        'front.jpg',   // +Z
        'back.jpg'     // -Z
    ]);

    scene.background = skybox;
    scene.environment = skybox;

    const hemi = new THREE.HemisphereLight(0xcdd9e8, 0x406040, 1.2);
    scene.add(hemi);

    camera.position.set(-7, 5, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;

    // 使用 skybox 的 environment，不用 RoomEnvironment
    // const pmrem = new THREE.PMREMGenerator(renderer);
    // scene.environment = pmrem.fromScene(new RoomEnvironment(renderer)).texture;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2, 0);
    controls.update();

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,    // 左鍵就算設 PAN，也會被我們下面的丟球攔截
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE // 右鍵拖曳旋轉視角
    };

    textureLoader = new THREE.TextureLoader();

    const ambientLight = new THREE.AmbientLight(0xbbbbbb);
    scene.add(ambientLight);

    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(-10, 10, 5);
    light.castShadow = true;
    const d = 20;
    light.shadow.camera.left = -d;
    light.shadow.camera.right = d;
    light.shadow.camera.top = d;
    light.shadow.camera.bottom = -d;
    light.shadow.camera.near = 2;
    light.shadow.camera.far = 50;
    light.shadow.mapSize.x = 1024;
    light.shadow.mapSize.y = 1024;
    scene.add(light);

    stats = new Stats();
    stats.domElement.style.position = 'absolute';
    stats.domElement.style.top = '0px';
    container.appendChild(stats.domElement);

    window.addEventListener('resize', onWindowResize);
    // 建立球種選擇 UI 綁定
    createBallTypeUI();
}

function initPhysics() {
    const collisionConfiguration = new Ammo.btSoftBodyRigidBodyCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    const broadphase = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    const softBodySolver = new Ammo.btDefaultSoftBodySolver();
    physicsWorld = new Ammo.btSoftRigidDynamicsWorld(
        dispatcher,
        broadphase,
        solver,
        collisionConfiguration,
        softBodySolver
    );
    physicsWorld.setGravity(new Ammo.btVector3(0, gravityConstant, 0));
    physicsWorld.getWorldInfo().set_m_gravity(new Ammo.btVector3(0, gravityConstant, 0));

    transformAux1 = new Ammo.btTransform();
    // softBodyHelpers = new Ammo.btSoftBodyHelpers();
}

function createObjects() {
    // 隱形物理地板
    pos.set(0, -0.5, 0);
    quat.set(0, 0, 0, 1);
    const ground = createParalellepiped(
        40,
        1,
        40,
        0,
        pos,
        quat,
        new THREE.MeshPhongMaterial({ color: 0xffffff })
    );
    ground.castShadow = true;
    ground.receiveShadow = true;
    ground.visible = false;

    // 草地平面
    const planeGeo = new THREE.PlaneGeometry(40, 40, 256, 256);
    planeGeo.rotateX(-Math.PI / 2);
    planeGeo.setAttribute('uv2', new THREE.BufferAttribute(planeGeo.attributes.uv.array, 2));
    const visualGround = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial());
    visualGround.position.y = 0.001;
    visualGround.receiveShadow = true;
    scene.add(visualGround);

    // 草地貼圖
    const TEX_DIR = '../../media/texture/grass/';
    const files = {
        color: 'Grass002_1K-PNG_Color.png',
        normal: 'Grass002_1K-PNG_NormalGL.png',
        rough: 'Grass002_1K-PNG_Roughness.png',
        ao: 'Grass002_1K-PNG_AmbientOcclusion.png',
        disp: 'Grass002_1K-PNG_Displacement.png'
    };

    const colorMap = textureLoader.load(TEX_DIR + files.color);
    const normalMap = textureLoader.load(TEX_DIR + files.normal);
    const roughMap = textureLoader.load(TEX_DIR + files.rough);
    const aoMap = textureLoader.load(TEX_DIR + files.ao);
    const dispMap = textureLoader.load(TEX_DIR + files.disp);

    const TILING = 12;
    [colorMap, normalMap, roughMap, aoMap, dispMap].forEach(t => {
        if (!t) return;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(TILING, TILING);
        t.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
    });
    colorMap.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({
        map: colorMap,
        normalMap: normalMap,
        roughnessMap: roughMap,
        aoMap: aoMap,
        metalness: 0.0,
        roughness: 1.0,
        displacementMap: dispMap,
        displacementScale: 0.02,
        displacementBias: -0.01
    });
    visualGround.material = mat;
    fluffyGrass = createFluffyGrass({
        halfSize: 20,         // 地是 40x40，所以 halfSize = 20
        count: 9000           // 想要多一點就開大，太大會吃效能
    });
    scene.add(fluffyGrass);

    loadDog();
}

function loadDog() {
    const gltfLoader = new GLTFLoader();
    const ktx2 = new KTX2Loader()
        .setTranscoderPath('three/examples/jsm/libs/basis/')
        .detectSupport(renderer);
    gltfLoader.setKTX2Loader(ktx2);

    const draco = new DRACOLoader().setDecoderPath('three/examples/jsm/libs/draco/');
    gltfLoader.setDRACOLoader(draco);

    const bubbleLoader = new GLTFLoader();
    bubbleLoader.load('../../model/heart_speech_bubble.glb', gltf => {
        heartBubblePrefab = gltf.scene;
    });

    gltfLoader.load('../../model/dog_mr_2.glb', gltf => {
        dog = SkeletonUtils.clone(gltf.scene);
        dog.scale.setScalar(0.05);
        dog.position.set(0, 0, -2);
        dog.rotation.y = Math.PI;
        scene.add(dog);

        console.group('Animations in model');
        gltf.animations.forEach((clip, i) => {
            console.log(`${i}. name="${clip.name}"  duration=${clip.duration.toFixed(2)}s`);
        });
        console.groupEnd();

        mixer = new THREE.AnimationMixer(dog);
        const clips = gltf.animations;
        const clipMap = {};
        clips.forEach(c => {
            clipMap[c.name.toLowerCase()] = c;
        });

        // 修正貼圖色域
        dog.traverse(o => {
            if (o.isMesh && o.material) {
                if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
                if (o.material.isMeshBasicMaterial) {
                    o.material = new THREE.MeshStandardMaterial({ map: o.material.map });
                }
            }
        });

        // 建立 DogBody ＋ DogBrain
        dogBody = new DogBody({
            object: dog,
            mixer,
            clips: clipMap,
            speedWalk: 1.8,
            speedRun: 4.2,
            turnSpeed: 6.0,
            returnTo: 'home',
            homePos: dog.position.clone()
        });

        dogBrain = new DogBrain(dogBody);

        // 家的位置標記
        spawnStaticRing(dogBody.home, { color: 0xffffff, inner: 0.16, outer: 0.26 });
    });
}

// -----------------------------------------------------------------------------
// 1-2. 傳送陣 & 球清理（環境的一部分）
// -----------------------------------------------------------------------------
function spawnStaticRing(pos, { color = 0x00d1ff, inner = 0.14, outer = 0.24 } = {}) {
    const g = new THREE.RingGeometry(inner, outer, 64);
    const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const ring = new THREE.Mesh(g, m);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.005, pos.z);
    ring.renderOrder = 1;
    scene.add(ring);
    return ring;
}

function spawnDropMarker(pos) {
    const y = Math.max(0.005, pos.y);
    const g = new THREE.RingGeometry(0.12, 0.22, 64);
    const m = new THREE.MeshBasicMaterial({
        color: 0x00d1ff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const ring = new THREE.Mesh(g, m);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, y, pos.z);
    ring.renderOrder = 2;
    scene.add(ring);

    const start = performance.now();
    const duration = 1000;
    const startScale = 0.8;
    const endScale = 1.2;

    (function animateRing() {
        const t = (performance.now() - start) / duration;
        if (t >= 1) {
            scene.remove(ring);
            g.dispose();
            m.dispose();
            return;
        }
        const ease = Math.pow(1 - t, 2.2);
        const scale = startScale + (endScale - startScale) * t;
        ring.scale.set(scale, scale, 1);
        ring.material.opacity = 0.9 * ease;
        requestAnimationFrame(animateRing);
    })();
}

function disposeBall(ball) {
    if (!ball) return;

    if (ball.parent) ball.removeFromParent();

    const body = ball.userData.physicsBody;
    if (body) {
        physicsWorld.removeRigidBody(body);
        ball.userData.physicsBody = null;
    }

    const idx = rigidBodies.indexOf(ball);
    if (idx !== -1) rigidBodies.splice(idx, 1);

    const idxBall = balls.indexOf(ball);
    if (idxBall !== -1) balls.splice(idxBall, 1);

    scene.remove(ball);

    if (ball.geometry) ball.geometry.dispose();
    if (ball.material) {
        if (ball.material.map) ball.material.map.dispose();
        ball.material.dispose();
    }
}

// -----------------------------------------------------------------------------
// 2. BallFactory – 球種定義與建立
// -----------------------------------------------------------------------------

const BALL_TYPES = {
    tennisball: {
        label: 'tennisball',
        radius: 0.1,
        mass: 5,
        restitution: 0.3,
        color: 0xffee55,
        emissive: 0x222200
    },
    football: {
        label: 'football',
        radius: 0.3,
        mass: 12,
        restitution: 0.1,
        color: 0x5555ff,
        emissive: 0x000022
    },
    beachball: {
        label: 'beachball',
        radius: 0.3,
        mass: 3,
        restitution: 0.8,
        color: 0x22ff88,
        emissive: 0x003311
    }
};


// 預載模型
const ballModels = {
    tennisball: null,
    football: null,
    beachball: null
};


/**
 * 建立一顆「指定球種」的可視球 + Bullet shape
 * 回傳：{ mesh, shape, radius, mass, restitution }
 */
function createBallOfType(type = 'tennisball') {
    const def = BALL_TYPES[type] || BALL_TYPES.tennisball;

    // 如果模型尚未載入，先用原本的顏色球當備援
    if (!ballModels[type]) {
        console.warn('[BallFactory] model not loaded yet, fallback to simple sphere:', type);

        const geom = new THREE.SphereGeometry(def.radius, 18, 16);
        const mat = baseBallMaterial.clone();
        mat.color.set(def.color);
        mat.emissive.set(def.emissive);

        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        mesh.userData.radius = def.radius;

        const shape = new Ammo.btSphereShape(def.radius);
        shape.setMargin(margin);

        return {
            mesh,
            shape,
            radius: def.radius,
            mass: def.mass,
            restitution: def.restitution
        };
    }

    // 1. 複製一份模型
    const raw = SkeletonUtils.clone(ballModels[type]);

    // 2. 做一個包覆用 group，避免直接動到 root 的 matrix
    const root = new THREE.Group();
    root.add(raw);

    // 3. 算出原始 bounding box / radius
    const box = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // 把模型中心移到 (0,0,0) 讓物理球中心對齊
    raw.position.sub(center);

    // 重新以移動後的物件計算半徑
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const originalRadius = sphere.radius || 1;

    // 4. 根據目標 def.radius 算出縮放倍率
    const scaleFactor = def.radius / originalRadius;
    root.scale.setScalar(scaleFactor);

    // 5. 陰影設定
    root.traverse(o => {
        if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material && o.material.map) {
                o.material.map.colorSpace = THREE.SRGBColorSpace;
            }
        }
    });

    root.userData.radius = def.radius;

    // 6. 物理形狀仍用 def.radius 當球半徑
    const shape = new Ammo.btSphereShape(def.radius);
    shape.setMargin(margin);

    return {
        mesh: root,
        shape,
        radius: def.radius,
        mass: def.mass,
        restitution: def.restitution
    };
}

// 呼叫：改球種
function setCurrentBallType(type) {
    if (BALL_TYPES[type]) {
        currentBallType = type;
        console.log('[BallFactory] Switched ball type to:', type);

        // 更新 UI 高亮狀態
        const buttons = document.querySelectorAll('.ball-type-btn');
        buttons.forEach(btn => {
            const btnType = btn.dataset.ballType;
            btn.classList.toggle('active', btnType === type);
        });
    }
}

function createBallTypeUI() {
    const panel = document.getElementById('ballTypePanel');
    if (!panel) {
        console.warn('[BallTypeUI] #ballTypePanel not found in DOM');
        return;
    }

    // 監聽按鈕點擊
    panel.addEventListener('click', (e) => {
        const btn = e.target.closest(".ball-type-btn");
        if (!btn) return;

        document.querySelectorAll(".ball-type-btn").forEach(el =>
            el.classList.remove("active")
        );
        btn.classList.add("active");

        const type = btn.dataset.ballType;
        setCurrentBallType(type);
    });

    setCurrentBallType(currentBallType);

}

// -----------------------------------------------------------------------------
// 3. ThrowSystem – 使用者丟球（蓄力 / Raycast）
// -----------------------------------------------------------------------------
function initInput() {
    window.addEventListener('pointerdown', event => {
        downMouse.set(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );

        raycaster.setFromCamera(downMouse, camera);
        downRay.origin.copy(raycaster.ray.origin);
        downRay.direction.copy(raycaster.ray.direction);

        isCharging = true;
        chargeStart = performance.now();
        chargePower = 0;
        if (controls) controls.enabled = false;
        chargeHUD.style.display = 'block';
        chargeFill.style.width = '0%';
    });

    const endCharge = () => {
        if (!isCharging) return;

        const dt = performance.now() - chargeStart;
        const linear = Math.min(1, dt / CHARGE_MAX_MS);
        const EASE = Math.pow(linear, 1.5);
        chargePower = EASE;

        const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * chargePower;
        spawnBall(downRay, speed, currentBallType);

        isCharging = false;
        if (controls) controls.enabled = true;
        chargeHUD.style.display = 'none';
    };

    window.addEventListener('pointerup', endCharge);
    window.addEventListener('pointercancel', endCharge);
    window.addEventListener('pointerleave', endCharge);
}

/**
 * 丟出一顆球（使用 BallFactory）
 */
function spawnBall(ray, speed, ballType = 'tennisball') {
    const ballDef = createBallOfType(ballType);

    const ball = ballDef.mesh;
    const ballShape = ballDef.shape;
    const ballMass = ballDef.mass;

    // ★ 標記這是「球」，並加入全域清單
    ball.userData.isBall = true;
    balls.push(ball);

    // 生成位置：從相機前方/射線原點稍微往前，避免跟相機自己碰撞
    const spawnPos = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, 1.2);
    pos.copy(spawnPos);
    quat.set(0, 0, 0, 1);

    const ballBody = createRigidBody(ball, ballShape, ballMass, pos, quat);
    ballBody.setFriction(0.5);
    ballBody.setRestitution(ballDef.restitution);

    // 設定初速向量
    const v = new THREE.Vector3().copy(ray.direction).multiplyScalar(speed);
    ballBody.setLinearVelocity(new Ammo.btVector3(v.x, v.y, v.z));

    // 讓狗這次去追這顆球

    // 音效
    playSfx(sfxThrow, 0.9);

    if (dogBody && dogBody.holdingBall) {
        // 叼著球時不播放狗叫，不影響蓄力
    } else {
        playRandomBark(0.8);
    }
}

// 球體切換尺寸（歸正）
const _wsChildScale = new THREE.Vector3();
const _wsParentScale = new THREE.Vector3();

function reparentPreserveWorldScale(child, newParent) {
    if (!child || !newParent) return;

    // 先記錄 child 原本的世界 scale
    child.getWorldScale(_wsChildScale);

    // 換父物件
    newParent.add(child);

    // newParent 的世界 scale
    newParent.getWorldScale(_wsParentScale);

    // 設成：childLocalScale × parentWorldScale = 原本 worldScale
    child.scale.set(
        _wsChildScale.x / _wsParentScale.x,
        _wsChildScale.y / _wsParentScale.y,
        _wsChildScale.z / _wsParentScale.z
    );
}

// -----------------------------------------------------------------------------
// 4. DogBody – 只負責「身體＆動畫＆嘴巴叼球」的部分
// -----------------------------------------------------------------------------
class DogBody {
    constructor({
        object,
        mixer,
        clips,
        speedWalk = 2,
        speedRun = 4,
        turnSpeed = 6,
        returnTo = 'player',
        homePos = null
    }) {
        this.obj = object;
        this.mixer = mixer;
        this.clips = clips;
        this.speedWalk = speedWalk;
        this.speedRun = speedRun;
        this.turnSpeed = turnSpeed;

        this.returnTo = returnTo;
        this.home = homePos ? homePos.clone() : object.position.clone();

        // 這裡的 state 只當「目前狀態標記事」，實際流程由 DogBrain 控制
        this.state = 'idle'; // idle / seek / return / drop
        this.targetBall = null;
        this.holdingBall = null;
        // this.pendingBall = null;

        this.mouth = this._makeMouthAnchor();
        this._currentAction = null;
        this._play('idle1') || this._play('idleeartwitch') || this._playAny();
        this.ignoreBallUntil = 0;

        // 心型泡泡
        this.heartBubble = null;
        this.heartBubbleTimer = 0;
        this.heartBubbleDuration = 0;
        this._initHeartBubble();
    }

    // ==========================
    // 動畫 Helper
    // ==========================
    _play(nameLower) {
        const clip = this.clips[nameLower];
        if (!clip) return false;
        const act = this.mixer.clipAction(clip);
        if (this._currentAction !== act) {
            if (this._currentAction) this._currentAction.fadeOut(0.15);
            act.reset().fadeIn(0.15).play();
            this._currentAction = act;
        }
        return true;
    }

    _playAny() {
        const keys = Object.keys(this.clips);
        if (!keys.length) return false;
        return this._play(keys[0]);
    }

    
    // ==========================
    // 嘴巴 Anchor & 心泡泡
    // ==========================
    _makeMouthAnchor() {
        const preferExact = [
            'SnoutLower_metarig',
            'SnoutUpper_metarig',
            'spine011_metarig',
            'spine010_metarig'
        ];
        let headBone = null;

        this.obj.traverse(o => {
            if (!headBone && o.isBone && preferExact.includes(o.name)) {
                headBone = o;
            }
        });
        if (!headBone) {
            this.obj.traverse(o => {
                if (!headBone && o.isBone) {
                    if (o.name.includes('Snout') || o.name.includes('spine011')) {
                        headBone = o;
                    }
                }
            });
        }
        console.log('Picked headBone =', headBone ? headBone.name : 'NULL');

        const anchor = new THREE.Object3D();
        if (headBone) {
            headBone.add(anchor);
            anchor.position.set(0, 0.5, 0.1);
        } else {
            this.obj.add(anchor);
            anchor.position.set(0, 0.35, 0.4);
        }
        return anchor;
    }

    _initHeartBubble() {
        if (!heartBubblePrefab) return;

        const bubble = SkeletonUtils.clone(heartBubblePrefab);

        const head = this.mouth?.parent || this.obj;
        head.add(bubble);

        bubble.position.set(0, 1, -2);
        bubble.scale.setScalar(0.02);
        bubble.rotation.x = -Math.PI / 2;
        bubble.visible = false;

        bubble.traverse(o => {
            if (o.isMesh) {
                o.castShadow = false;
                o.receiveShadow = false;
                if (o.material && o.material.map) {
                    o.material.map.colorSpace = THREE.SRGBColorSpace;
                }
            }
        });

        this.heartBubble = bubble;
        this.heartBubbleTimer = 0;
        this.heartBubbleDuration = 0;
    }

    showHeartBubble(duration = 1.2) {
        if (!this.heartBubble) {
            this._initHeartBubble();
            if (!this.heartBubble) return;
        }
        this.heartBubbleDuration = duration;
        this.heartBubbleTimer = duration;
        this.heartBubble.visible = true;

        this.heartBubble.traverse(o => {
            if (o.isMesh && o.material && 'opacity' in o.material) {
                o.material.transparent = true;
                o.material.opacity = 1;
            }
        });
    }

    _updateHeartBubble(dt) {
        if (!this.heartBubble || this.heartBubbleDuration <= 0) return;
        if (this.heartBubbleTimer <= 0) {
            this.heartBubble.visible = false;
            return;
        }

        this.heartBubbleTimer -= dt;

        const t = this.heartBubbleTimer / this.heartBubbleDuration; // 1 → 0
        const fadeStart = 0.5;
        if (t < fadeStart) {
            const k = t / fadeStart; // 1 → 0
            this.heartBubble.traverse(o => {
                if (o.isMesh && o.material && 'opacity' in o.material) {
                    o.material.opacity = k;
                }
            });
        }
    }

    /**
     * 每 frame 共通更新（給 DogBrain 先呼叫一次）
     */
    updateCommon(dt) {
        if (this.mixer) this.mixer.update(dt);
        this._updateHeartBubble(dt);
    }

    // ==========================
    // 球狀態查詢 & 選擇
    // ==========================
    _isBallHeldByDog() {
        return !!this.holdingBall;
    }

    _getBallWorldPos(ballMesh) {
        if (!ballMesh) return new THREE.Vector3();
        return ballMesh.getWorldPosition(new THREE.Vector3());
    }

    _willBallFall(ballMesh) {
        if (!ballMesh) return false;

        const p = this._getBallWorldPos(ballMesh);

        if (p.y < -0.2) return true;
        if (Math.abs(p.x) > GROUND_HALF_X || Math.abs(p.z) > GROUND_HALF_Z) return true;

        const body = ballMesh.userData.physicsBody;
        if (!body) return false;
        const v = body.getLinearVelocity();
        const vx = v.x(), vz = v.z();

        const px = p.x + vx * PREDICT_T;
        const pz = p.z + vz * PREDICT_T;

        const nearEdgeX = Math.abs(p.x) > GROUND_HALF_X - EDGE_SAFE;
        const nearEdgeZ = Math.abs(p.z) > GROUND_HALF_Z - EDGE_SAFE;
        const movingOutX = (p.x > 0 && vx > 0) || (p.x < 0 && vx < 0);
        const movingOutZ = (p.z > 0 && vz > 0) || (p.z < 0 && vz < 0);

        if (nearEdgeX && movingOutX) return true;
        if (nearEdgeZ && movingOutZ) return true;
        if (Math.abs(px) > GROUND_HALF_X - 0.05) return true;
        if (Math.abs(pz) > GROUND_HALF_Z - 0.05) return true;

        return false;
    }
    

    /**
     * 提供給 BT：在需要時選下一顆球
     */
    chooseNextTargetBall() {
        // 場上所有安全球裡面最近的一顆
        let closest = null;
        let minDist = Infinity;

        for (const b of balls) {
            if (!b || !b.parent) continue;
            if (this._willBallFall(b)) continue;

            const p = this._getBallWorldPos(b);
            const d = this.obj.position.distanceTo(p);
            if (d < minDist) {
                minDist = d;
                closest = b;
            }
        }

        if (!closest) {
            this.targetBall = null;
            return null;
        }

        // 如果原本就有 target，而且它也還存在、沒要掉下去，
        // 且距離沒有比「最近那顆」遠太多，就先把這顆完成
        if (this.targetBall && this.targetBall.parent && !this._willBallFall(this.targetBall)) {
            const curDist = this.obj.position
                .distanceTo(this._getBallWorldPos(this.targetBall));

            const SWITCH_THRESHOLD = 0.8;
            // 例如：只有在「新球比舊目標近 0.8 公尺以上」才換目標，
            // 避免狗一直左顧右盼改來改去。

            if (curDist <= minDist + SWITCH_THRESHOLD) {
                // 現在的目標其實也不遠，那就繼續這顆
                return this.targetBall;
            }
        }

        this.targetBall = closest;
        return closest;
    }

  

    // ==========================
    // 位移相關
    // ==========================
    _moveTowards(target, dt, speed) {
        const dir = tmpV.copy(target).sub(this.obj.position);
        dir.y = 0;
        const dist = dir.length();
        if (dist < 1e-3) return;

        dir.normalize();
        const quatTarget = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            dir
        );
        this.obj.quaternion.rotateTowards(quatTarget, this.turnSpeed * dt);

        const step = Math.min(dist, speed * dt);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.obj.quaternion);
        this.obj.position.addScaledVector(forward, step);
    }
  
    // ==========================
    // 拾球 / 放球
    // ==========================
    _pickupBall(ballMesh) {
        if (!ballMesh) return;

        const body = ballMesh.userData.physicsBody;
        if (body) {
            physicsWorld.removeRigidBody(body);
            ballMesh.userData.physicsBody = null;
        }
        const idx = rigidBodies.indexOf(ballMesh);
        if (idx !== -1) rigidBodies.splice(idx, 1);

        reparentPreserveWorldScale(ballMesh, this.mouth);

        const r = getBallRadius(ballMesh);

        const zOff = r * 0.95 + 0.03;
        const yOff = Math.max(0.02, r * 0.15);

        ballMesh.position.set(0, yOff, zOff);
        ballMesh.quaternion.identity();

        this.holdingBall = ballMesh;
    }

     dropBallInFront() {
        if (!this.holdingBall) return;

        const ball = this.holdingBall;
        const r = getBallRadius(ball);

        const world = new THREE.Vector3();
        this.mouth.getWorldPosition(world);

        const forwardW = new THREE.Vector3(0, 0, 1).applyQuaternion(this.obj.quaternion);
        world.addScaledVector(forwardW, r + 0.08);
        world.y = Math.max(r + 0.02, 0.02);

        this.mouth.remove(ball);
        scene.add(ball);

        reparentPreserveWorldScale(ball, scene);
        ball.position.copy(world);
        ball.quaternion.copy(this.obj.quaternion);

        const ballShape = new Ammo.btSphereShape(r);
        ballShape.setMargin(margin);
        const body = createRigidBody(ball, ballShape, 10, world, ball.quaternion);
        body.setFriction(0.5);

        // 傳送陣顯示在家位置
        spawnDropMarker(this.home);

        // 可依需求決定是否立刻清除；目前沿用你原本「立即 dispose」的行為
        disposeBall(ball);

        this.holdingBall = null;

        // 丟完冷卻一下，避免立刻又撿同一顆
        this.ignoreBallUntil = performance.now() + 600;
    }

   
}

// -----------------------------------------------------------------------------
// 5. DogBrain – 行為邏輯 + 行為樹骨架
// -----------------------------------------------------------------------------
const BTStatus = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    RUNNING: 'running'
};

class BTNode {
    tick(blackboard, dt) {
        return BTStatus.SUCCESS;
    }
}

class BTCondition extends BTNode {
    constructor(fn) {
        super();
        this.fn = fn;
    }
    tick(bb) {
        return this.fn(bb) ? BTStatus.SUCCESS : BTStatus.FAILURE;
    }
}

class BTAction extends BTNode {
    constructor(fn) {
        super();
        this.fn = fn;
    }
    tick(bb, dt) {
        return this.fn(bb, dt);
    }
}

class BTSequence extends BTNode {
    constructor(children = []) {
        super();
        this.children = children;
        this._runningIndex = 0;
    }
    tick(bb, dt) {
        for (let i = this._runningIndex; i < this.children.length; i++) {
            const child = this.children[i];
            const s = child.tick(bb, dt);
            if (s === BTStatus.RUNNING) {
                this._runningIndex = i;
                return BTStatus.RUNNING;
            }
            if (s === BTStatus.FAILURE) {
                this._runningIndex = 0;
                return BTStatus.FAILURE;
            }
        }
        this._runningIndex = 0;
        return BTStatus.SUCCESS;
    }
}

class BTSelector extends BTNode {
    constructor(children = []) {
        super();
        this.children = children;
        this._runningIndex = 0;
    }
    tick(bb, dt) {
        for (let i = this._runningIndex; i < this.children.length; i++) {
            const child = this.children[i];
            const s = child.tick(bb, dt);
            if (s === BTStatus.RUNNING) {
                this._runningIndex = i;
                return BTStatus.RUNNING;
            }
            if (s === BTStatus.SUCCESS) {
                this._runningIndex = 0;
                return BTStatus.SUCCESS;
            }
        }
        this._runningIndex = 0;
        return BTStatus.FAILURE;
    }
}


// --- 具體行為節點 ---

// 取得 Vector3 暫存用（避免每次 new）
const _btTmpV3 = new THREE.Vector3();

// 檢查當前場景是否「有事可做」（嘴裡有球 or 有目標球 or 有 pendingBall）
class HasWorkNode extends BTCondition {
    constructor() {
        super(bb => {
            const body = bb.body;
            // 場上還有球就視為有工作
            const hasBallInScene = balls.some(b => b && b.parent);
            // return body._isBallHeldByDog() || !!bb.targetBall || !!body.pendingBall || hasBallInScene;
            return body._isBallHeldByDog() || !!bb.targetBall || hasBallInScene;

        });
    }
}


// 尋找 / 更新當前目標球：
// 1. 若已叼球 -> 不動 targetBall
// 2. 若 targetBall 不存在或不安全 -> 用 body.chooseNextTargetBall()
class FindOrRefreshTargetBallNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;

        // 嘴裡已經有球就不用找目標
        if (body._isBallHeldByDog()) {
            return BTStatus.SUCCESS;
        }

        const next = body.chooseNextTargetBall();
        bb.targetBall = next || null;
        body.targetBall = next || null;

        return next ? BTStatus.SUCCESS : BTStatus.FAILURE;
    }
}


// 追球：往球的位置跑，距離 < 0.6 時回 SUCCESS，其餘 RUNNING
class SeekBallNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        const ball = bb.targetBall;
        if (!ball || !ball.parent) {
            return BTStatus.FAILURE;
        }

        // 若這顆球已預測會掉出邊界，當成失敗，交由上層改找下一顆
        if (body._willBallFall(ball)) {
            return BTStatus.FAILURE;
        }

        const ballPos = body._getBallWorldPos(ball);
        body._play('runcycle');
        body._moveTowards(ballPos, dt, body.speedRun);

        const dist = body.obj.position.distanceTo(ballPos);
        if (dist < 0.6) {
            return BTStatus.SUCCESS;
        }
        return BTStatus.RUNNING;
    }
}

// 撿球：到達球附近後呼叫 _pickupBall
class PickupBallNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        const ball = bb.targetBall;
        if (!ball || !ball.parent) {
            return BTStatus.FAILURE;
        }

        const ballPos = body._getBallWorldPos(ball);
        const dist = body.obj.position.distanceTo(ballPos);
        if (dist > 0.8) {
            // 理論上不該發生（SeekBall 成功時已經很近了）
            return BTStatus.FAILURE;
        }

        body._pickupBall(ball);
        // 嘴裡有球後，目標保留在 bb.targetBall（之後 Return / Drop 用）
        return BTStatus.SUCCESS;
    }
}

// 回家（或回玩家前方）：持續移動直到距離 < 0.6 為 SUCCESS，其餘 RUNNING
class ReturnHomeNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        const playerPos = bb.playerPos;
        const cam = bb.camera;

        if (!playerPos) return BTStatus.FAILURE;

        let dropPos;
        if (body.returnTo === 'home') {
            dropPos = body.home;
        } else {
            dropPos = _btTmpV3.copy(playerPos);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
            dropPos.addScaledVector(forward, 0.8);
        }

        bb.dropPos = dropPos.clone();

        body._play('runcycle');
        body._moveTowards(dropPos, dt, body.speedWalk * 1.25);

        const dist = body.obj.position.distanceTo(dropPos);
        if (dist < 0.6) {
            return BTStatus.SUCCESS;
        }
        return BTStatus.RUNNING;
    }
}

// 放球：呼叫 _dropBallInFront，一次成功
class DropBallNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        if (!body._isBallHeldByDog()) {
            // 已無球可放，算成功（避免重複呼叫）
            return BTStatus.SUCCESS;
        }

        // ✅ 用 DogBody 的公開 API
        body.dropBallInFront();

        // 放球之後，targetBall 清掉交給 AutoFetchNextNode 決定下一顆
        bb.targetBall = null;
        return BTStatus.SUCCESS;
    }
}


// 放球後，決定下一顆要撿的球（先 pending，再場上最近安全的一顆）
class AutoFetchNextNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        const next = body.chooseNextTargetBall();
        bb.targetBall = next || null;
        body.targetBall = next || null;
        return BTStatus.SUCCESS;
    }
}

// Idle：沒事做時坐下看玩家
class IdleNode extends BTNode {
    tick(bb, dt) {
        const body = bb.body;
        const playerPos = bb.playerPos;

        body._play('idlesit');

        if (playerPos) {
            const lookDir = new THREE.Vector3()
                .subVectors(playerPos, body.obj.position)
                .setY(0)
                .normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 0, 1),
                lookDir
            );
            body.obj.quaternion.slerp(q, 0.3);
        }

        return BTStatus.SUCCESS;
    }
}

/**
 * DogBrain：現在真正由行為樹控制「找球 → 追球 → 回家 → 放球」，
 * DogBody 僅負責動作與動畫。
 */
class DogBrain {
    constructor(body) {
        this.body = body;
        this.blackboard = {
            body: body,
            targetBall: null,
            playerPos: null,
            camera: null,
            dropPos: null
        };

        // Root 行為樹結構：
        // 1) 若有事情可做（HasWorkNode） ->
        //    a) 若嘴裡已有球：ReturnHome -> DropBall -> AutoFetchNext
        //    b) 否則：FindTarget -> SeekBall -> Pickup -> ReturnHome -> DropBall -> AutoFetchNext
        // 2) 若完全沒有球可處理 -> Idle

        const haveWorkBranch = new BTSequence([
            new HasWorkNode(),
            new BTSelector([
                // a) 已含球：只需要回家 + 放球 + 看下一顆
                new BTSequence([
                    new BTCondition(bb => bb.body._isBallHeldByDog()),
                    new ReturnHomeNode(),
                    new DropBallNode(),
                    new AutoFetchNextNode()
                ]),
                // b) 沒含球：找球 → 追球 → 撿球 → 回家 → 放球 → 決定下一顆
                new BTSequence([
                    new FindOrRefreshTargetBallNode(),
                    new SeekBallNode(),
                    new PickupBallNode(),
                    new ReturnHomeNode(),
                    new DropBallNode(),
                    new AutoFetchNextNode()
                ])
            ])
        ]);

        const idleBranch = new IdleNode();

        this.root = new BTSelector([
            haveWorkBranch,
            idleBranch
        ]);
    }

    /**
     * 玩家丟出新球時呼叫。
     * 規則：
     *  - 若嘴裡有球 -> 新球排入 pendingBall，**不打斷這趟回家**
     *  - 若嘴裡沒有球 -> 新球成為 targetBall，立刻啟動追球流程
     */

    /**
     * 每幀更新：由 render() 呼叫 dogBrain.update(deltaTime, { playerPos })
     */
    update(dt, context) {
        const { playerPos } = context;
        this.blackboard.playerPos = playerPos;
        this.blackboard.camera = camera;

        // 先跑共通動畫更新（Mixer / 愛心泡泡）
        this.body.updateCommon(dt);

        // 再由行為樹決定當前要做什麼
        this.root.tick(this.blackboard, dt);
    }
}


// -----------------------------------------------------------------------------
// 6. 其他：SoftBody / RigidBody Helper + 公用
// -----------------------------------------------------------------------------

function createParalellepiped(sx, sy, sz, mass, pos, quat, material) {
    const threeObject = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1),
        material
    );
    const shape = new Ammo.btBoxShape(
        new Ammo.btVector3(sx * 0.5, sy * 0.5, sz * 0.5)
    );
    shape.setMargin(margin);
    createRigidBody(threeObject, shape, mass, pos, quat);
    return threeObject;
}

function createRigidBody(threeObject, physicsShape, mass, pos, quat) {
    threeObject.position.copy(pos);
    threeObject.quaternion.copy(quat);

    const transform = new Ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
    transform.setRotation(
        new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w)
    );
    const motionState = new Ammo.btDefaultMotionState(transform);

    const localInertia = new Ammo.btVector3(0, 0, 0);
    physicsShape.calculateLocalInertia(mass, localInertia);

    const rbInfo = new Ammo.btRigidBodyConstructionInfo(
        mass,
        motionState,
        physicsShape,
        localInertia
    );
    const body = new Ammo.btRigidBody(rbInfo);

    threeObject.userData.physicsBody = body;

    scene.add(threeObject);

    if (mass > 0) {
        rigidBodies.push(threeObject);
        body.setActivationState(4);
    }

    physicsWorld.addRigidBody(body);
    return body;
}


function getBallRadius(mesh) {
    if (!mesh) return 0.4;

    // 1. 若 BallFactory 已寫入 userData.radius → 直接用
    if (mesh.userData && typeof mesh.userData.radius === 'number') {
        return mesh.userData.radius;
    }

    // 2. 從 GLTF Group 中找第一個帶 geometry 的 Mesh
    let target = null;
    mesh.traverse(o => {
        if (!target && o.isMesh && o.geometry) {
            target = o;
        }
    });

    if (!target) {
        console.warn("[BallFactory] No geometry found in model, using fallback radius 0.4");
        return 0.4;
    }

    const geom = target.geometry;

    // 3. 若本身就是 SphereGeometry → 取它的 radius
    if (geom.parameters && typeof geom.parameters.radius === 'number') {
        mesh.userData.radius = geom.parameters.radius;
        return geom.parameters.radius;
    }

    // 4. GLTF 模型一般沒內建 boundingSphere → 計算一個
    geom.computeBoundingSphere();

    const r = geom.boundingSphere ? geom.boundingSphere.radius : 0.4;

    // 記錄起來，下次不用再算
    mesh.userData.radius = r;

    return r;
}


// -----------------------------------------------------------------------------
// 7. Main Loop
// -----------------------------------------------------------------------------
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    render();
    stats.update();
}

function render() {
    const deltaTime = clock.getDelta();

    updatePhysics(deltaTime);

    // 蓄力條
    if (isCharging) {
        const dt = performance.now() - chargeStart;
        const linear = Math.min(1, dt / CHARGE_MAX_MS);
        const EASE = Math.pow(linear, 1.5);
        chargeFill.style.width = `${Math.round(EASE * 100)}%`;
    }

    // 更新小狗
    playerPos.copy(camera.position);
    if (dogBrain) {
        dogBrain.update(deltaTime, { playerPos });
    }
    if (fluffyGrass) {
        updateFluffyGrass(fluffyGrass, deltaTime);
    }
    renderer.render(scene, camera);
}

function updatePhysics(deltaTime) {
    physicsWorld.stepSimulation(deltaTime, 10);

    // 更新 rigid bodies
    for (let i = 0, il = rigidBodies.length; i < il; i++) {
        const objThree = rigidBodies[i];
        const objPhys = objThree.userData.physicsBody;
        if (!objPhys) continue;
        const ms = objPhys.getMotionState();
        if (!ms) continue;

        ms.getWorldTransform(transformAux1);
        const p = transformAux1.getOrigin();
        const q = transformAux1.getRotation();
        objThree.position.set(p.x(), p.y(), p.z());
        objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
}
