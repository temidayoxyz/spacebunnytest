/**
 * Deterministic 3D gradient noise (classic Perlin) used to displace the wax
 * implicit surface, plus the GLSL counterpart used for internal colour
 * variation inside the wax shader.
 */

// ---------------------------------------------------------------- JS noise --

const PERM = new Uint8Array( 512 );
const GRAD = new Float32Array( 512 * 3 );

( function seedPerm( seed ) {

	const p = new Uint8Array( 256 );
	for ( let i = 0; i < 256; i ++ ) p[ i ] = i;

	// xorshift32 PRNG so the result is identical on every load.
	let s = seed >>> 0 || 1;
	const rnd = () => {

		s ^= s << 13; s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5; s >>>= 0;
		return s / 4294967296;

	};

	for ( let i = 255; i > 0; i -- ) {

		const j = Math.floor( rnd() * ( i + 1 ) );
		const t = p[ i ]; p[ i ] = p[ j ]; p[ j ] = t;

	}

	for ( let i = 0; i < 512; i ++ ) {

		PERM[ i ] = p[ i & 255 ];

		// uniform points on the sphere
		const z = rnd() * 2 - 1;
		const a = rnd() * Math.PI * 2;
		const r = Math.sqrt( Math.max( 0, 1 - z * z ) );
		GRAD[ i * 3 + 0 ] = r * Math.cos( a );
		GRAD[ i * 3 + 1 ] = r * Math.sin( a );
		GRAD[ i * 3 + 2 ] = z;

	}

} )( 0x9e3779b9 );

const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );

/** Perlin noise in [-1, 1]. */
export function noise3( x, y, z ) {

	const X = Math.floor( x ) & 255;
	const Y = Math.floor( y ) & 255;
	const Z = Math.floor( z ) & 255;

	x -= Math.floor( x );
	y -= Math.floor( y );
	z -= Math.floor( z );

	const u = fade( x ), v = fade( y ), w = fade( z );

	const A = PERM[ X ] + Y, AA = PERM[ A ] + Z, AB = PERM[ A + 1 ] + Z;
	const B = PERM[ X + 1 ] + Y, BA = PERM[ B ] + Z, BB = PERM[ B + 1 ] + Z;

	const g = ( h, dx, dy, dz ) => {

		const i = h * 3;
		return GRAD[ i ] * dx + GRAD[ i + 1 ] * dy + GRAD[ i + 2 ] * dz;

	};

	const lerp = ( a, b, t ) => a + t * ( b - a );

	return lerp(
		lerp(
			lerp( g( PERM[ AA ], x, y, z ), g( PERM[ BA ], x - 1, y, z ), u ),
			lerp( g( PERM[ AB ], x, y - 1, z ), g( PERM[ BB ], x - 1, y - 1, z ), u ), v ),
		lerp(
			lerp( g( PERM[ AA + 1 ], x, y, z - 1 ), g( PERM[ BA + 1 ], x - 1, y, z - 1 ), u ),
			lerp( g( PERM[ AB + 1 ], x, y - 1, z - 1 ), g( PERM[ BB + 1 ], x - 1, y - 1, z - 1 ), u ), v ),
		w );

}

// -------------------------------------------------------------- GLSL noise --

export const GLSL_NOISE = /* glsl */`
// Hoskins-style hash. The obvious fract( sin( ... ) ) trick collapses into
// visible stripes once the input gets large, which showed up as banding across
// the wax, so this uses a multiply/frac chain instead.
vec3 sb_hash33( vec3 p3 ) {

    p3 = fract( p3 * vec3( 0.1031, 0.1030, 0.0973 ) );
    p3 += dot( p3, p3.yxz + 33.33 );
    return -1.0 + 2.0 * fract( ( p3.xxy + p3.yxx ) * p3.zyx );

}

float sb_noise( vec3 p ) {

    vec3 i = floor( p );
    vec3 f = fract( p );
    vec3 u = f * f * ( 3.0 - 2.0 * f );

    return mix(
        mix( mix( dot( sb_hash33( i + vec3(0.0,0.0,0.0) ), f - vec3(0.0,0.0,0.0) ),
                  dot( sb_hash33( i + vec3(1.0,0.0,0.0) ), f - vec3(1.0,0.0,0.0) ), u.x ),
             mix( dot( sb_hash33( i + vec3(0.0,1.0,0.0) ), f - vec3(0.0,1.0,0.0) ),
                  dot( sb_hash33( i + vec3(1.0,1.0,0.0) ), f - vec3(1.0,1.0,0.0) ), u.x ), u.y ),
        mix( mix( dot( sb_hash33( i + vec3(0.0,0.0,1.0) ), f - vec3(0.0,0.0,1.0) ),
                  dot( sb_hash33( i + vec3(1.0,0.0,1.0) ), f - vec3(1.0,0.0,1.0) ), u.x ),
             mix( dot( sb_hash33( i + vec3(0.0,1.0,1.0) ), f - vec3(0.0,1.0,1.0) ),
                  dot( sb_hash33( i + vec3(1.0,1.0,1.0) ), f - vec3(1.0,1.0,1.0) ), u.x ), u.y ),
        u.z );

}

float sb_fbm( vec3 p, int octaves ) {

    float sum = 0.0;
    float amp = 0.5;
    for ( int i = 0; i < 4; i ++ ) {

        if ( i >= octaves ) break;
        sum += amp * sb_noise( p );
        p *= 2.03;
        amp *= 0.5;

    }

    return sum;

}
`;