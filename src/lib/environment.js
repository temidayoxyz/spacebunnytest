import {
	Scene, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Color,
	BoxGeometry, PlaneGeometry, SphereGeometry, BackSide, DoubleSide,
	BufferGeometry, BufferAttribute, Vector3, PMREMGenerator,
} from 'three';

/**
 * A procedural photographic studio: an emissive softbox rig baked into a PMREM
 * environment map for reflections, plus the physical cyclorama sweep the lamp
 * actually stands on.
 */

function softbox( width, height, rgb, position, lookAt ) {

	// values above 1 are fine: the rig is an emitter, not a surface colour
	const mat = new MeshBasicMaterial( { side: DoubleSide, toneMapped: false } );
	mat.color.setRGB( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ] );

	const mesh = new Mesh( new PlaneGeometry( width, height ), mat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	mesh.lookAt( new Vector3( lookAt[ 0 ], lookAt[ 1 ], lookAt[ 2 ] ) );
	return mesh;

}

export function buildStudioEnvironment() {

	const envScene = new Scene();

	// graded room shell: cool grey above, warm charcoal below
	const shell = new Mesh(
		new SphereGeometry( 9, 32, 24 ),
		new MeshBasicMaterial( { side: BackSide, toneMapped: false } ) );

	shell.material.color.setRGB( 0.030, 0.032, 0.038 );
	shell.material.onBeforeCompile = ( s ) => {

		s.vertexShader = s.vertexShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vDir;' )
			.replace( '#include <begin_vertex>', '#include <begin_vertex>\nvDir = normalize( position );' );

		s.fragmentShader = s.fragmentShader
			.replace( '#include <common>', '#include <common>\nvarying vec3 vDir;' )
			.replace( '#include <dithering_fragment>', `
				float h = clamp( vDir.y * 0.5 + 0.5, 0.0, 1.0 );
				vec3 low  = vec3( 0.070, 0.062, 0.052 );
				vec3 mid  = vec3( 0.168, 0.155, 0.136 );
				vec3 high = vec3( 0.520, 0.528, 0.545 );
				vec3 c = mix( low, mid, smoothstep( 0.0, 0.52, h ) );
				c = mix( c, high, smoothstep( 0.52, 1.0, h ) );
				gl_FragColor.rgb = c;
				#include <dithering_fragment>` );

	};

	envScene.add( shell );

	// key softbox, camera left and high. Kept deliberately small: a broad
	// emitter gives rough metal a flat, shapeless white field, a tight one
	// gives a highlight that actually describes the curve of the pedestal.
	envScene.add( softbox( 0.95, 1.70, [ 6.8, 6.4, 5.75 ], [ - 2.5, 1.7, 2.1 ], [ 0, 0.2, 0 ] ) );
	// broad fill, camera right
	envScene.add( softbox( 2.4, 2.4, [ 0.80, 0.88, 1.02 ], [ 3.1, 0.9, 1.5 ], [ 0, 0.2, 0 ] ) );
	// rim strip behind
	envScene.add( softbox( 0.55, 1.10, [ 4.6, 4.55, 4.7 ], [ 1.5, 2.2, - 2.6 ], [ 0, 0.3, 0 ] ) );
	// second rim, camera left rear
	envScene.add( softbox( 0.45, 1.00, [ 1.9, 1.82, 1.70 ], [ - 2.2, 1.9, - 2.2 ], [ 0, 0.3, 0 ] ) );
	// ceiling bounce
	const ceiling = new Mesh( new PlaneGeometry( 9, 9 ), softbox( 1, 1, [ 1.0, 0.95, 0.88 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ).material );
	ceiling.position.set( 0, 3.4, 0 );
	ceiling.rotation.x = Math.PI / 2;
	envScene.add( ceiling );
	// warm floor bounce
	const bounce = new Mesh( new PlaneGeometry( 9, 9 ), softbox( 1, 1, [ 0.20, 0.155, 0.115 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ).material );
	bounce.position.set( 0, - 1.4, 0 );
	bounce.rotation.x = - Math.PI / 2;
	envScene.add( bounce );

	return envScene;

}

/** Bake the studio rig into a prefiltered environment map. */
export function createEnvironmentMap( renderer ) {

	const pmrem = new PMREMGenerator( renderer );
	pmrem.compileEquirectangularShader();

	const envScene = buildStudioEnvironment();
	const rt = pmrem.fromScene( envScene, 0.0, 0.1, 40 );

	envScene.traverse( ( o ) => {

		if ( o.isMesh ) { o.geometry.dispose(); o.material.dispose(); }

	} );

	pmrem.dispose();

	return rt.texture;

}

/**
 * Seamless cyclorama: flat floor running into a large radius cove and a
 * vertical wall, so there is no visible horizon line behind the product.
 */
export function createSweep() {

	const R = 1.15;          // cove radius
	const zFloorEnd = - 0.28;
	const zWall = zFloorEnd - R;
	const wallTop = 3.4;
	const halfWidth = 3.6;

	const profile = [];
	const FLOOR_SEGS = 26;

	for ( let i = 0; i <= FLOOR_SEGS; i ++ ) {

		const t = i / FLOOR_SEGS;
		profile.push( [ 3.0 + ( zFloorEnd - 3.0 ) * t, 0 ] );

	}

	const COVE_SEGS = 54;
	for ( let i = 1; i <= COVE_SEGS; i ++ ) {

		const a = ( i / COVE_SEGS ) * Math.PI / 2;
		profile.push( [ zFloorEnd - R * Math.sin( a ), R * ( 1 - Math.cos( a ) ) ] );

	}

	const WALL_SEGS = 26;
	for ( let i = 1; i <= WALL_SEGS; i ++ ) {

		const t = i / WALL_SEGS;
		profile.push( [ zWall, R + ( wallTop - R ) * t ] );

	}

	const X_SEGS = 6;
	const rows = profile.length;

	const positions = new Float32Array( rows * ( X_SEGS + 1 ) * 3 );
	const normals = new Float32Array( rows * ( X_SEGS + 1 ) * 3 );
	const uvs = new Float32Array( rows * ( X_SEGS + 1 ) * 2 );
	const colors = new Float32Array( rows * ( X_SEGS + 1 ) * 3 );
	const indices = [];

	const smoothstep = ( a, b, x ) => {

		const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
		return t * t * ( 3 - 2 * t );

	};

	let p = 0, n = 0, u = 0, cl = 0;
	for ( let r = 0; r < rows; r ++ ) {

		const prev = profile[ Math.max( 0, r - 1 ) ];
		const next = profile[ Math.min( rows - 1, r + 1 ) ];
		const dzy = next[ 1 ] - prev[ 1 ];
		const dzz = next[ 0 ] - prev[ 0 ];
		const len = Math.hypot( dzy, dzz ) || 1;
		// profile travels from the front of the floor, up the cove, up the wall
		const ny = - dzz / len;
		const nz = dzy / len;

		for ( let c = 0; c <= X_SEGS; c ++ ) {

			const x = - halfWidth + ( 2 * halfWidth ) * ( c / X_SEGS );
			const y = profile[ r ][ 1 ];
			const z = profile[ r ][ 0 ];

			positions[ p ++ ] = x;
			positions[ p ++ ] = y;
			positions[ p ++ ] = z;

			normals[ n ++ ] = 0;
			normals[ n ++ ] = ny;
			normals[ n ++ ] = nz;

			uvs[ u ++ ] = c / X_SEGS;
			uvs[ u ++ ] = r / ( rows - 1 );

			// baked falloff: a sweep lit by softboxes is brightest right behind
			// the product and falls away to the sides and up the wall, plus a
			// contact-occlusion pool hugging the base of the lamp
			const lateral = Math.hypot( x, Math.max( z, 0 ) );
			const t = 0.78 * smoothstep( 0.24, 1.75, lateral ) + 0.22 * smoothstep( 0.55, 2.6, y );
			const contact = Math.exp( - Math.max( 0, 0.125 - lateral ) / 0.05 );
			const shade = ( 1.0 - 0.72 * t ) * ( 1.0 - 0.62 * contact );
			colors[ cl ++ ] = shade;
			colors[ cl ++ ] = shade * 0.995;
			colors[ cl ++ ] = shade * 0.985;

		}

	}

	const stride = X_SEGS + 1;
	for ( let r = 0; r < rows - 1; r ++ ) {

		for ( let c = 0; c < X_SEGS; c ++ ) {

			const a = r * stride + c;
			const b = a + 1;
			const d = ( r + 1 ) * stride + c;
			const e = d + 1;

			// wound so the front face points away from the cyclorama shell
			indices.push( a, b, d );
			indices.push( b, e, d );

		}

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'color', new BufferAttribute( colors, 3 ) );
	geometry.setIndex( indices );
	geometry.computeBoundingSphere();

	const material = new MeshPhysicalMaterial( {
		color: new Color( 0x5b534a ),
		roughness: 0.56,
		metalness: 0.0,
		vertexColors: true,
		sheen: 0.28,
		sheenRoughness: 0.8,
		sheenColor: new Color( 0xb9ab99 ),
	} );

	const mesh = new Mesh( geometry, material );
	mesh.receiveShadow = true;
	mesh.name = 'sweep';

	return mesh;

}