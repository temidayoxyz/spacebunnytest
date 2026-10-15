import {
	MeshPhysicalMaterial, MeshStandardMaterial, Color, Vector3, Vector4,
	CanvasTexture, RepeatWrapping, SRGBColorSpace, NoColorSpace,
} from 'three';
import { GLSL_NOISE } from './noise.js';

/**
 * Material library. Colour values are authored in sRGB hex and converted by
 * three's colour management; only the emissive interior uses raw linear values
 * because it is a light source rather than a pigment.
 */

const c = ( hex ) => new Color( hex );

// ------------------------------------------------------------------- glass --

/**
 * The vessel. Real transmission so the wax is genuinely refracted through the
 * wall, with a shallow roughness that keeps the softbox highlights from
 * looking like a perfect mirror.
 */export function createGlassMaterial( { thickness = 0.0065 } = {} ) {

	const m = new MeshPhysicalMaterial( {
		color: c( 0xffffff ),
		metalness: 0.0,
		roughness: 0.028,
		transmission: 1.0,
		thickness,
		ior: 1.52,
		// the liquid column between here and the wax warms the transmitted light
		attenuationColor: c( 0xfff0dc ),
		attenuationDistance: 0.30,
		clearcoat: 0.32,
		clearcoatRoughness: 0.03,
		specularIntensity: 1.0,
		envMapIntensity: 1.05,
		side: 0, // FrontSide
		depthWrite: true,
	} );

	m.userData.kind = 'glass';
	return m;

}

// ------------------------------------------------------------------ liquid --

/**
 * Clear, faintly warm fluid.
 *
 * The optical work of the liquid is folded into the glass (its attenuation and
 * refraction), so this mesh is deliberately close to optically invisible: a
 * near-zero thickness means it refracts nothing and tints nothing, leaving only
 * the surface sheen and the meniscus catching the softboxes. Anything stronger
 * turns the fill line into a hard tonal step across the neck.
 */
export function createLiquidMaterial() {

	const m = new MeshPhysicalMaterial( {
		color: c( 0xffffff ),
		metalness: 0.0,
		roughness: 0.010,
		transmission: 1.0,
		thickness: 0.0008,
		ior: 1.36,
		attenuationColor: c( 0xffffff ),
		attenuationDistance: 100,
		clearcoat: 0.45,
		clearcoatRoughness: 0.02,
		envMapIntensity: 0.6,
		side: 0,
		depthWrite: true,
	} );

	m.userData.kind = 'liquid';
	return m;

}

// ------------------------------------------------------------------- metal --

/**
 * Brushed-aluminium grain.
 *
 * A turned part is brushed circumferentially, so the scratches run around the
 * profile: in lathe UV space that means the value varies along v and barely
 * changes along u. Without this the pedestal reads as one flat blown-out
 * sheet of white; with it the highlight breaks up and the form stays legible.
 */
let brushedMaps = null;

function createBrushedMaps() {

	if ( brushedMaps ) return brushedMaps;

	const N = 512;
	const canvas = document.createElement( 'canvas' );
	canvas.width = N;
	canvas.height = N;
	const ctx = canvas.getContext( '2d' );
	const img = ctx.createImageData( N, N );

	// deterministic 1D value noise with a few octaves, smoothed along u
	const rows = new Float32Array( N );
	for ( let i = 0; i < N; i ++ ) {

		let v = 0, amp = 0.5, f = 1.0;
		for ( let o = 0; o < 3; o ++ ) {

			const x = i / N * f * 220;
			const i0 = Math.floor( x ) & 255;
			const i1 = ( i0 + 1 ) & 255;
			const t = x - Math.floor( x );
			const s = t * t * ( 3 - 2 * t );
			const h = ( k ) => ( Math.sin( k * 12.9898 ) * 43758.5453 ) % 1;
			v += amp * ( h( i0 ) * ( 1 - s ) + h( i1 ) * s );
			amp *= 0.5;
			f *= 2.1;

		}

		rows[ i ] = v;

	}

	for ( let y = 0; y < N; y ++ ) {

		for ( let x = 0; x < N; x ++ ) {

			// a little cross-track variation so it is not perfectly banded
			const jitter = Math.sin( ( x / N ) * Math.PI * 2 * 5 + y * 0.017 ) * 0.02;
			const v = Math.max( 0, Math.min( 1, 0.94 + ( rows[ y ] - 0.47 ) * 0.11 + jitter ) );
			const b = Math.round( v * 255 );
			const o = ( y * N + x ) * 4;
			img.data[ o ] = b;
			img.data[ o + 1 ] = b;
			img.data[ o + 2 ] = b;
			img.data[ o + 3 ] = 255;

		}

	}

	ctx.putImageData( img, 0, 0 );

	const rough = new CanvasTexture( canvas );
	rough.wrapS = rough.wrapT = RepeatWrapping;
	rough.colorSpace = NoColorSpace;
	rough.repeat.set( 1, 1 );

	const bump = new CanvasTexture( canvas );
	bump.wrapS = bump.wrapT = RepeatWrapping;
	bump.colorSpace = NoColorSpace;
	bump.repeat.set( 1, 1 );

	brushedMaps = { rough, bump };
	return brushedMaps;

}

/**
 * Brushed aluminium: anisotropic highlights stretched around the turned
 * surface, which is what separates real machined metal from grey plastic.
 */
export function createMetalMaterial( { tint = 0xb9bec2, roughness = 0.48 } = {} ) {

	const { rough, bump } = createBrushedMaps();

	const m = new MeshPhysicalMaterial( {
		color: c( tint ),
		metalness: 1.0,
		roughness,
		roughnessMap: rough,
		bumpMap: bump,
		bumpScale: 0.0004,
		envMapIntensity: 0.70,
		anisotropy: 0.55,
		anisotropyRotation: Math.PI / 2,
		clearcoat: 0.06,
		clearcoatRoughness: 0.4,
	} );

	m.userData.kind = 'metal';
	return m;

}

/** The heating element: dulled steel that has been running hot for years. */
export function createHeaterMaterial() {

	return new MeshStandardMaterial( {
		color: c( 0x6d6157 ),
		metalness: 0.85,
		roughness: 0.52,
		envMapIntensity: 0.7,
	} );

}

// --------------------------------------------------------------------- wax --

/**
 * Molten wax.
 *
 * Opaque PBR underneath (so it reliably lands in the transmission buffer and is
 * visible through the glass) with a subsurface layer injected on top:
 *
 *   - the blob set that defined the implicit surface is re-evaluated per
 *     fragment to get a subsurface thickness (0 at the skin, 1 deep inside),
 *     which drives colour from hot gold rim to deep ember core,
 *   - three octaves of value noise break up the interior and dither the
 *     thickness so the colour never reads as a flat wash,
 *   - a point emitter at the bulb position adds the internal glow that climbs
 *     through the lower masses and thins out with height.
 */
export function createWaxMaterial( uniforms ) {

	const m = new MeshPhysicalMaterial( {
		color: c( 0xffffff ),
		metalness: 0.0,
		roughness: 0.30,
		clearcoat: 0.14,
		clearcoatRoughness: 0.28,
		sheen: 0.10,
		sheenRoughness: 0.6,
		sheenColor: c( 0xff5c08 ),
		specularIntensity: 0.42,
		envMapIntensity: 0.18,
		side: 0,
	} );

	m.userData.kind = 'wax';
	m.userData.uniforms = uniforms;

	m.onBeforeCompile = ( shader ) => {

		Object.assign( shader.uniforms, uniforms );

		const count = uniforms.__count || 1;
		const defines = `#define WAX_BLOB_COUNT ${ count }\n`;

		shader.vertexShader = defines + shader.vertexShader
			.replace( '#include <common>', /* glsl */`
				#include <common>
				varying vec3 vWaxPos;
				varying vec3 vWaxWorld;
				varying vec3 vWaxNormal;
			` )
			.replace( '#include <begin_vertex>', /* glsl */`
				#include <begin_vertex>
				vWaxPos = position;
				vWaxWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
				vWaxNormal = normalize( mat3( modelMatrix ) * objectNormal );
			` );

		shader.fragmentShader = defines + shader.fragmentShader
			.replace( '#include <common>', /* glsl */`
				#include <common>
				varying vec3 vWaxPos;
				varying vec3 vWaxWorld;
				varying vec3 vWaxNormal;
				uniform vec3 uCoreColor;
				uniform vec3 uMidColor;
				uniform vec3 uRimColor;
				uniform vec3 uHotColor;
				uniform vec3 uBulbPos;
				uniform vec3 uBulbColor;
				uniform float uBulbPower;
				uniform float uSkin;
				uniform float uFlatWax;
				uniform float uRefChord;
				uniform vec4 uBlobC[ WAX_BLOB_COUNT ];
				uniform vec4 uBlobR[ WAX_BLOB_COUNT ];
				${ GLSL_NOISE }

				/**
				 * How much wax a light ray has to cross to leave the mass again.
				 *
				 * For each blob that contains the point, that is the chord along
				 * -N, which for a quadric is 2 / |N / r|. Normalised against a
				 * reference chord this gives 0 on a thin wisp and 1 in the belly
				 * of a large mass, and it is what drives both the colour ramp
				 * and how much of the bulb glow leaks through.
				 */
				float wax_thickness( vec3 p, vec3 n ) {

					float t = 0.0;

					for ( int i = 0; i < WAX_BLOB_COUNT; i ++ ) {

						vec3 r = uBlobR[ i ].xyz;

						float chord = 2.0 / max( length( n / r ), 1e-4 );
						float ti = clamp( chord / uRefChord, 0.0, 1.0 );

						// fade out for blobs this point does not belong to
						float d = length( ( p - uBlobC[ i ].xyz ) / r );
						ti *= 1.0 - smoothstep( 0.90, 1.14, d );

						// probabilistic-or accumulation: smooth, and saturates
						t = t + ti - t * ti;

					}

					return clamp( t, 0.0, 1.0 );

				}
			` )
			.replace( '#include <color_fragment>', /* glsl */`
				#include <color_fragment>

				vec3 waxN = normalize( vWaxNormal );
				float waxThick = wax_thickness( vWaxPos, waxN );

				// organic marbling: broad swirl plus a fine grain
				float swirl = sb_fbm( vWaxPos * 34.0, 3 );
				float grain = sb_noise( vWaxPos * 150.0 );
				waxThick = clamp( waxThick + 0.09 * swirl + 0.05 * grain, 0.0, 1.0 );

				// long optical path at grazing angles: the silhouette of every
				// mass glows, exactly like real translucent wax
				float fres = pow( 1.0 - clamp( dot( waxN, normalize( vViewPosition ) ), 0.0, 1.0 ), 2.2 );
				float hotness = clamp( pow( 1.0 - waxThick, 2.6 ) * 0.5 + fres * 0.6, 0.0, 1.0 );

				if ( uFlatWax > 0.5 ) { waxThick = 0.45; hotness = 0.2; }

				vec3 waxCol = mix( uRimColor, uMidColor, smoothstep( 0.0, 0.50, waxThick ) );
				waxCol = mix( waxCol, uCoreColor, smoothstep( 0.30, 0.92, waxThick ) );
				waxCol = mix( waxCol, uHotColor, hotness );

				waxCol *= 0.90 + 0.16 * swirl + 0.07 * grain;
				waxCol = clamp( waxCol, 0.0, 4.0 );

				diffuseColor.rgb *= waxCol;
			` )
			.replace( '#include <emissivemap_fragment>', /* glsl */`
				#include <emissivemap_fragment>

				{
					vec3 waxWorld = vWaxWorld;
					vec3 toBulb = uBulbPos - waxWorld;
					float bulbDist = length( toBulb );
					vec3 bulbDir = toBulb / max( bulbDist, 1e-4 );

					// inverse-square-ish falloff plus a ceiling so the top stays cool
					float reach = 1.0 / ( 1.0 + bulbDist * bulbDist * 46.0 );
					float climb = exp( - max( waxWorld.y - 0.118, 0.0 ) * 6.4 );

					// thin regions let more light through
					float pass = pow( 1.0 - waxThick, 1.7 );

					// forward scattering: brightest where the bulb is behind the surface
					vec3 waxView = normalize( vViewPosition );
					float forward = pow( clamp( dot( - bulbDir, - waxView ) * 0.5 + 0.5, 0.0, 1.0 ), 3.5 );

					float glow = reach * climb * ( 0.26 + 0.95 * pass ) * ( 0.45 + 0.75 * forward );

					// a warm vein that sits just under the skin of every mass
					float skin = exp( - waxThick * uSkin ) * 0.35;

					totalEmissiveRadiance += uBulbColor * uBulbPower * ( glow + skin * climb * reach * 0.5 );
				}
			` );

	};

	return m;

}

export function createWaxUniforms( blobs ) {

	const count = blobs.length;
	const centre = [];
	const radii = [];

	for ( const b of blobs ) {

		centre.push( new Vector4( b.centre[ 0 ], b.centre[ 1 ], b.centre[ 2 ], 0 ) );
		radii.push( new Vector4( b.radii[ 0 ], b.radii[ 1 ], b.radii[ 2 ], 0 ) );

	}

	// NB: Color( hex ) already lands in the linear working space under three's
	// colour management, so no extra conversion here.
	return {
		uCoreColor: { value: new Color( 0x4a0900 ) },
		uMidColor: { value: new Color( 0xba3200 ) },
		uRimColor: { value: new Color( 0xf26a00 ) },
		uHotColor: { value: new Color( 0xff9c10 ) },
		uBulbPos: { value: new Vector3( 0, 0.1225, 0 ) },
		uBulbColor: { value: new Color( 0xff6a12 ) },
		uBulbPower: { value: 1.0 },
		uSkin: { value: 7.0 },
		uFlatWax: { value: 0.0 },
		uRefChord: { value: 0.034 },
		uBlobC: { value: centre },
		uBlobR: { value: radii },
		__count: count,
	};

}

// --------------------------------------------------------- emissive burner --

/** The hot element itself: self-lit so the glow has a real source on screen. */
export function createBulbMaterial() {

	const m = new MeshStandardMaterial( {
		color: c( 0x2a1108 ),
		metalness: 0.4,
		roughness: 0.6,
		toneMapped: true,
	} );

	m.emissive = c( 0xff4d04 );
	m.emissiveIntensity = 0.9;

	return m;

}