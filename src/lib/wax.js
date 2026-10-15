import { Vector3 } from 'three';
import { noise3 } from './noise.js';
import { polygonise } from './marching.js';

/**
 * The wax is built as an implicit surface: a smooth union of rotated ellipsoids
 * displaced by three octaves of gradient noise, polygonised with marching cubes.
 * That gives genuinely fused, irregular masses instead of a row of spheres.
 */

// [ x, y, z, rx, ry, rz, groupIndex ]
// group 0 = main bottom mass, 1 = rising tendril, 2 = mid mass,
// group 3 = upper mass,    4 = loose satellites
export const WAX_BLOBS = [
	// --- 0: heavy mass settled in the heated zone -----------------------------
	[ 0.0000, 0.1690, 0.0000, 0.0205, 0.0195, 0.0198, 0 ],
	[ 0.0140, 0.1792, -0.0055, 0.0100, 0.0106, 0.0098, 0 ],
	[ -0.0138, 0.1740, 0.0062, 0.0098, 0.0100, 0.0096, 0 ],
	[ 0.0030, 0.1495, 0.0040, 0.0125, 0.0115, 0.0120, 0 ],
	[ -0.0060, 0.1832, -0.0092, 0.0080, 0.0082, 0.0078, 0 ],

	// --- 1: a wisp peeling off the main mass -----------------------------------
	[ 0.0068, 0.2022, 0.0024, 0.0058, 0.0094, 0.0056, 1 ],
	[ 0.0008, 0.2184, -0.0028, 0.0036, 0.0064, 0.0034, 1 ],

	// --- 2: middle mass -------------------------------------------------------
	[ -0.0085, 0.2572, 0.0062, 0.0140, 0.0144, 0.0132, 2 ],
	[ 0.0072, 0.2672, -0.0048, 0.0062, 0.0066, 0.0060, 2 ],
	[ -0.0162, 0.2498, -0.0024, 0.0048, 0.0046, 0.0046, 2 ],

	// --- 3: upper mass -------------------------------------------------------
	[ 0.0010, 0.3068, 0.0005, 0.0132, 0.0138, 0.0126, 3 ],
	[ -0.0122, 0.3162, 0.0068, 0.0056, 0.0052, 0.0054, 3 ],
	[ 0.0128, 0.3146, -0.0058, 0.0052, 0.0050, 0.0050, 3 ],

	// --- 4: loose satellites and a bead still in the heat -----------------------
	[ 0.0160, 0.2310, 0.0108, 0.0044, 0.0042, 0.0042, 4 ],
	[ -0.0160, 0.2240, -0.0074, 0.0040, 0.0038, 0.0039, 4 ],
	[ 0.0138, 0.2830, -0.0110, 0.0036, 0.0035, 0.0035, 4 ],
	[ -0.0092, 0.2928, -0.0116, 0.0030, 0.0029, 0.0031, 4 ],
	[ 0.0068, 0.3336, 0.0048, 0.0046, 0.0044, 0.0045, 4 ],
	[ -0.0060, 0.3482, -0.0038, 0.0034, 0.0033, 0.0034, 4 ],
	[ 0.0000, 0.1352, 0.0000, 0.0114, 0.0088, 0.0108, 4 ],
];

// Smooth-union radius per group. Kept small so the lobes read as distinct
// molten bumps on a mass instead of fusing into one wide flat lens.
const GROUP_K = [ 0.0092, 0.0052, 0.0078, 0.0074, 0.0034 ];

// Two octaves of surface displacement. Wavelengths are deliberately kept well
// above the voxel size (resolution 288 over a ~0.24 m box gives a ~0.8 mm
// voxel) so the polygonised surface stays smooth instead of spiky.
const OCTAVES = [
	{ amp: 0.0031, freq: 25.0 },
	{ amp: 0.0010, freq: 61.0 },
];

const smin = ( a, b, k ) => {

	const h = Math.max( 0, Math.min( 1, 0.5 + 0.5 * ( b - a ) / k ) );
	return b * ( 1 - h ) + a * h - k * h * ( 1 - h );

};

/** Build the flattened blob table used by the field evaluator. */
function prepare( blobs ) {

	return blobs.map( ( b ) => {

		const [ x, y, z, rx, ry, rz, group ] = b;

		return {
			cx: x, cy: y, cz: z,
			rx, ry, rz,
			k: GROUP_K[ group ],
			// cheap bounding sphere for the early-out
			br: Math.max( rx, ry, rz ),
			br2: Math.pow( Math.max( rx, ry, rz ) * 2.1, 2 ),
		};

	} );

}

/**
 * Blob data for the shader. The same analytic definition is evaluated per
 * fragment there, which is both cheaper than an interpolated attribute and
 * free of the per-triangle contouring an attribute produces.
 */
export function blobUniformArrays() {

	return WAX_BLOBS.map( ( b ) => ( {
		centre: [ b[ 0 ], b[ 1 ], b[ 2 ] ],
		radii: [ b[ 3 ], b[ 4 ], b[ 5 ] ],
	} ) );

}

/** Signed distance of the union of the blobs at a world point. */
function blobField( prepared, x, y, z, noiseAmp ) {

	let d = Infinity;

	for ( let i = 0; i < prepared.length; i ++ ) {

		const b = prepared[ i ];
		const ax = x - b.cx, ay = y - b.cy, az = z - b.cz;

		if ( ax * ax + ay * ay + az * az > b.br2 ) continue;

		const lx = ax, ly = ay, lz = az;

		const k0 = Math.sqrt(
			( lx / b.rx ) ** 2 + ( ly / b.ry ) ** 2 + ( lz / b.rz ) ** 2 );
		const k1 = Math.sqrt(
			( lx / ( b.rx * b.rx ) ) ** 2 +
			( ly / ( b.ry * b.ry ) ) ** 2 +
			( lz / ( b.rz * b.rz ) ) ** 2 );

		const sd = k1 < 1e-9 ? - Math.min( b.rx, b.ry, b.rz )
			: k0 * ( k0 - 1 ) / k1;

		d = d === Infinity ? sd : smin( d, sd, b.k );

	}

	if ( d === Infinity ) return 1;

	if ( noiseAmp > 0 ) {

		let n = 0;
		for ( let o = 0; o < OCTAVES.length; o ++ ) {

			const oct = OCTAVES[ o ];
			n += oct.amp * noise3( x * oct.freq, y * oct.freq, z * oct.freq );

		}

		d += n * noiseAmp;

	}

	return d;

}

/**
 * @param {object} opts
 * @param {number} opts.resolution  grid nodes across the cropped bounding box
 * @param {number} opts.noise       0..1 multiplier on the displacement octaves
 */
export function buildWaxGeometry( { resolution = 256, noise = 1, full = false } = {} ) {

	const prepared = prepare( WAX_BLOBS );
	// crop the grid to the wax bounds. The margin has to comfortably exceed the
	// smooth-union bulge (k/4) plus the displacement octaves, otherwise the
	// edge of the sampled neighbourhood slices into the surface.
	const margin = 0.024;
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = - Infinity, maxY = - Infinity, maxZ = - Infinity;

	for ( const b of prepared ) {

		const r = b.br + margin;
		minX = Math.min( minX, b.cx - r ); maxX = Math.max( maxX, b.cx + r );
		minY = Math.min( minY, b.cy - r ); maxY = Math.max( maxY, b.cy + r );
		minZ = Math.min( minZ, b.cz - r ); maxZ = Math.max( maxZ, b.cz + r );

	}

	// keep the voxel isotropic: longest world extent maps to `resolution`
	const extentX = maxX - minX, extentY = maxY - minY, extentZ = maxZ - minZ;
	const longest = Math.max( extentX, extentY, extentZ );
	const voxel = longest / resolution;

	const dims = [
		Math.ceil( extentX / voxel ) + 4,
		Math.ceil( extentY / voxel ) + 4,
		Math.ceil( extentZ / voxel ) + 4,
	];

	const origin = new Vector3(
		minX - voxel * 2,
		minY - voxel * 2,
		minZ - voxel * 2 );

	const [ NX, NY, NZ ] = dims;

	// Field convention: we store -sdf, so `field < iso` means *outside* (the
	// Bourke/three convention). Everything away from the blobs must therefore be
	// a large NEGATIVE value — seeding it positive makes the polygoniser treat
	// the whole background as interior and generates a phantom shell around
	// every blob at the edge of the sampled neighbourhood.
	const FAR = - 1;
	const field = new Float32Array( NX * NY * NZ ).fill( FAR );

	const SY = NX, SZ = NX * NY;
	const noiseAmp = noise;

	let index = 0;
	for ( let z = 0; z < NZ; z ++ ) {

		const wz = origin.z + z * voxel;

		for ( let y = 0; y < NY; y ++ ) {

			const wy = origin.y + y * voxel;

			for ( let x = 0; x < NX; x ++ ) {

				// only evaluate nodes that are anywhere near a blob; everything else
				// keeps the FAR sentinel
				const wx = origin.x + x * voxel;
				let near = full;
				if ( ! near ) for ( let i = 0; i < prepared.length; i ++ ) {

					const b = prepared[ i ];
					const ax = wx - b.cx, ay = wy - b.cy, az = wz - b.cz;
					const r = b.br + margin;
					if ( ax * ax + ay * ay + az * az < r * r ) { near = true; break; }

				}

				if ( near ) field[ index ] = - blobField( prepared, wx, wy, wz, noiseAmp );

				index ++;

			}

		}

	}

	return polygonise( {
		field,
		dims,
		origin,
		voxel,
		iso: 0,
	} );

}