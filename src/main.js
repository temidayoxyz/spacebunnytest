import {
	Scene, Group, Mesh, PerspectiveCamera, WebGLRenderer, Vector2, Vector3, Color,
	PCFSoftShadowMap, SRGBColorSpace, AgXToneMapping, NeutralToneMapping,
	ACESFilmicToneMapping, RectAreaLight, DirectionalLight, PointLight,
	MathUtils,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import {
	lathe, glassShellProfile, liquidProfile, collarProfile, heaterProfile, bulbProfile,
	BASE_PROFILE_DENSE, CAP_PROFILE_DENSE,
} from './lib/geometry.js';
import {
	createGlassMaterial, createLiquidMaterial, createMetalMaterial,
	createWaxMaterial, createWaxUniforms, createHeaterMaterial, createBulbMaterial,
} from './lib/materials.js';
import { createEnvironmentMap, createSweep } from './lib/environment.js';
import { buildWaxGeometry, blobUniformArrays } from './lib/wax.js';

// ---------------------------------------------------------------- options --

const params = new URLSearchParams( location.search );
const num = ( k, d ) => ( params.has( k ) ? Number( params.get( k ) ) : d );

/**
 * The defaults below are the art-directed look. Everything can be overridden
 * from the query string, which is how the lighting and materials were dialled
 * in; nothing on screen changes.
 */
const OPTIONS = {
	waxResolution: num( 'waxres', 300 ),
	waxNoise: num( 'waxnoise', 1.0 ),
	fov: num( 'fov', 26 ),
	// Khronos PBR Neutral keeps the wax saturated; AgX desaturates the
	// highlights towards cream and ACES shifts the oranges towards yellow.
	toneMapping: params.get( 'tm' ) || 'neutral',
	exposure: num( 'exposure', 0.95 ),
	bulbPower: num( 'bulb', 1.7 ),
	pixelRatio: num( 'dpr', Math.min( window.devicePixelRatio || 1, 2 ) ),
};

const TONE = {
	agx: AgXToneMapping,
	neutral: NeutralToneMapping,
	aces: ACESFilmicToneMapping,
};

// --------------------------------------------------------------- renderer --

const renderer = new WebGLRenderer( {
	antialias: true,
	alpha: false,
	powerPreference: 'high-performance',
	preserveDrawingBuffer: true,
} );

renderer.setPixelRatio( OPTIONS.pixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = TONE[ OPTIONS.toneMapping ] || AgXToneMapping;
renderer.toneMappingExposure = OPTIONS.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.transmissionResolutionScale = 1.0;
document.body.appendChild( renderer.domElement );

// ------------------------------------------------------------------ scene --

const scene = new Scene();
scene.background = new Color( 0x0b0a09 );
scene.environment = createEnvironmentMap( renderer );
scene.environmentIntensity = 1.0;

const camera = new PerspectiveCamera( OPTIONS.fov, 1, 0.02, 60 );

// ------------------------------------------------------------------- lamp --

const lamp = new Group();
scene.add( lamp );

const metal = createMetalMaterial( { tint: 0xb0b5b9, roughness: 0.50 } );
const metalCap = createMetalMaterial( { tint: 0xc2c6c9, roughness: 0.34 } );

// pedestal
const base = new Mesh( lathe( BASE_PROFILE_DENSE, 224 ), metal );
base.castShadow = true;
base.receiveShadow = true;
lamp.add( base );

// collar ring
const collar = new Mesh( lathe( collarProfile(), 224 ), metal );
collar.castShadow = true;
lamp.add( collar );

// domed cap
const cap = new Mesh( lathe( CAP_PROFILE_DENSE, 224 ), metalCap );
cap.castShadow = true;
lamp.add( cap );

// glass vessel
const glassMat = createGlassMaterial();
const glass = new Mesh( lathe( glassShellProfile( 260 ), 256 ), glassMat );
glass.renderOrder = 10;
glass.visible = params.get( 'noglass' ) !== '1';
lamp.add( glass );

// liquid column
const liquidMat = createLiquidMaterial();
const liquid = new Mesh( lathe( liquidProfile( 220 ), 224 ), liquidMat );
liquid.renderOrder = 6;
lamp.add( liquid );

// heating element + hot bulb
const heater = new Mesh( lathe( heaterProfile(), 192 ), createHeaterMaterial() );
lamp.add( heater );

const bulbMat = createBulbMaterial();
const bulb = new Mesh( lathe( bulbProfile(), 128 ), bulbMat );
lamp.add( bulb );

// wax
const waxUniforms = createWaxUniforms( blobUniformArrays() );
waxUniforms.uBulbPower.value = OPTIONS.bulbPower;
waxUniforms.uFlatWax.value = num( 'flatwax', 0 );

const waxGeometry = buildWaxGeometry( {
	resolution: OPTIONS.waxResolution,
	noise: OPTIONS.waxNoise,
	full: params.get( 'full' ) === '1',
} );
const wax = new Mesh( waxGeometry, createWaxMaterial( waxUniforms ) );
wax.name = 'wax';
lamp.add( wax );

// ----------------------------------------------------------------- lights --

RectAreaLightUniformsLib.init();

const keyLight = new RectAreaLight( 0xffeedb, 7.0, 0.30, 0.48 );
keyLight.position.set( - 0.58, 0.55, 0.52 );
keyLight.lookAt( 0, 0.22, 0 );
scene.add( keyLight );

const fillLight = new RectAreaLight( 0xdce8ff, 5.5, 0.75, 0.9 );
fillLight.position.set( 0.72, 0.30, 0.48 );
fillLight.lookAt( 0, 0.22, 0 );
scene.add( fillLight );

// cool rim strip behind separates the warm subject from the warm backdrop
const rimLight = new RectAreaLight( 0xcfe0ff, 22, 0.2, 0.46 );
rimLight.position.set( 0.44, 0.40, - 0.44 );
rimLight.lookAt( 0, 0.24, 0 );
scene.add( rimLight );

// shadow caster aligned with the key
const sun = new DirectionalLight( 0xfff0dc, 1.35 );
sun.position.set( - 0.72, 0.95, 0.58 );
sun.target.position.set( 0, 0.18, 0 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
sun.shadow.camera.near = 0.4;
sun.shadow.camera.far = 2.4;
sun.shadow.camera.left = - 0.30;
sun.shadow.camera.right = 0.30;
sun.shadow.camera.top = 0.45;
sun.shadow.camera.bottom = - 0.30;
sun.shadow.bias = - 0.00015;
sun.shadow.normalBias = 0.0016;
scene.add( sun );
scene.add( sun.target );

// internal warmth
const innerLight = new PointLight( 0xff8a24, 0.42, 0.62, 2 );
innerLight.position.set( 0, 0.1245, 0 );
scene.add( innerLight );

const glowLight = new PointLight( 0xffa040, 0.10, 0.40, 2 );
glowLight.position.set( 0, 0.175, 0 );
scene.add( glowLight );

// warm spill onto the sweep
const floorGlow = new PointLight( 0xff9440, 0.030, 1.30, 2 );
floorGlow.position.set( 0, 0.070, 0 );
scene.add( floorGlow );

// -------------------------------------------------------------- cyclorama --

const sweep = createSweep();
scene.add( sweep );

// ----------------------------------------------------------------- camera --

const LAMP_TOP = 0.4460;
const LAMP_BOTTOM = 0.0;
const LAMP_RADIUS = 0.0535;

function frameCamera() {

	const aspect = camera.aspect;

	// explicit override, used while dialling in the look
	if ( params.has( 'camx' ) || params.has( 'camy' ) || params.has( 'camz' ) ) {

		camera.position.set(
			num( 'camx', 0 ), num( 'camy', 0.25 ), num( 'camz', 1.2 ) );
		camera.lookAt( num( 'tgtx', 0 ), num( 'tgty', 0.25 ), num( 'tgtz', 0 ) );
		camera.updateProjectionMatrix();
		return;

	}

	const halfV = ( LAMP_TOP - LAMP_BOTTOM ) * 0.5 + 0.038;
	const halfH = LAMP_RADIUS + 0.078;

	const tv = Math.tan( MathUtils.degToRad( camera.fov ) * 0.5 );
	const th = tv * aspect;

	const dist = Math.max( halfV / tv, halfH / th );
	const targetY = ( LAMP_TOP + LAMP_BOTTOM ) * 0.5 - 0.004;

	const yaw = MathUtils.degToRad( 9.5 );
	const dir = new Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );

	camera.position.set(
		dir.x * dist,
		targetY + dist * 0.055,
		dir.z * dist );

	camera.lookAt( 0, targetY, 0 );
	camera.updateProjectionMatrix();

}

// ------------------------------------------------------------------ render --

/**
 * Render on demand rather than in a loop: the scene is static, so a frame is
 * only needed after a resize or an explicit request. Scheduling through rAF
 * also coalesces the burst of resize events browsers fire when a window moves.
 */
let frameQueued = false;

function requestRender() {

	if ( frameQueued ) return;
	frameQueued = true;

	requestAnimationFrame( () => {

		frameQueued = false;
		draw();

	} );

}

function draw() {

	renderer.render( scene, camera );

}

function resize() {

	const w = window.innerWidth;
	const h = window.innerHeight;

	// let three own the canvas style so the backing store and the element's
	// layout size can never drift apart
	renderer.setSize( w, h );
	renderer.setPixelRatio( OPTIONS.pixelRatio );

	camera.aspect = w / h;
	frameCamera();

	requestRender();

}

window.addEventListener( 'resize', resize );

resize();
draw();

// Exposed for the offscreen capture pass: renders the scene at an arbitrary
// resolution, then puts the on-screen state back exactly as it was.
window.renderStill = function ( width, height ) {

	const prevRatio = renderer.getPixelRatio();
	const prevSize = renderer.getSize( new Vector2() );
	const prevAspect = camera.aspect;

	renderer.setPixelRatio( 1 );
	renderer.setSize( width, height, false );
	camera.aspect = width / height;
	frameCamera();

	renderer.render( scene, camera );
	const url = renderer.domElement.toDataURL( 'image/png' );

	renderer.setPixelRatio( prevRatio );
	renderer.setSize( prevSize.x, prevSize.y, false );
	camera.aspect = prevAspect;
	frameCamera();
	draw();

	return url;

};

window.sceneReady = true;

console.info( 'lava lamp ready', {
	waxVertices: waxGeometry.getAttribute( 'position' ).count,
	tris: waxGeometry.getAttribute( 'position' ).count / 3,
	options: OPTIONS,
} );