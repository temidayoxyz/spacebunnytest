import { BufferGeometry, BufferAttribute } from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

/**
 * Compact marching-cubes polygoniser working directly in world space.
 *
 * Differences from three's MarchingCubes helper:
 *   - operates on a cropped sub-grid instead of a full cubic allocation,
 *   - no normal cache (gradients are taken from the grid on demand),
 *   - emits a per-vertex `aThick` attribute derived from a user callback,
 *     which the wax shader uses as a subsurface thickness estimate.
 *
 * Field convention matches three's: a cell corner counts as *inside* when
 * `field < iso`, so the field has to hold `-sdf`.
 */

// corner offsets and the matching bit of Bourke's cubeindex
const CX = [ 0, 1, 0, 1, 0, 1, 0, 1 ];
const CY = [ 0, 0, 1, 1, 0, 0, 1, 1 ];
const CZ = [ 0, 0, 0, 0, 1, 1, 1, 1 ];
const CB = [ 1, 2, 8, 4, 16, 32, 128, 64 ];

/**
 * The twelve cube edges, written as
 *   [ slot, cornerA, cornerB, axisX, axisY, axisZ, offX, offY, offZ ].
 * `off` is the lattice offset of the edge origin relative to the cell origin.
 */
const EDGES = new Int32Array( [
	0, 0, 1, 1, 0, 0, 0, 0, 0,
	1, 1, 3, 0, 1, 0, 1, 0, 0,
	2, 2, 3, 1, 0, 0, 0, 1, 0,
	3, 0, 2, 0, 1, 0, 0, 0, 0,
	4, 4, 5, 1, 0, 0, 0, 0, 1,
	5, 5, 7, 0, 1, 0, 1, 0, 1,
	6, 6, 7, 1, 0, 0, 0, 1, 1,
	7, 4, 6, 0, 1, 0, 0, 0, 1,
	8, 0, 4, 0, 0, 1, 0, 0, 0,
	9, 1, 5, 0, 0, 1, 1, 0, 0,
	10, 3, 7, 0, 0, 1, 1, 1, 0,
	11, 2, 6, 0, 0, 1, 0, 1, 0,
] );

/**
 * @param {object}   o
 * @param {Float32Array} o.field     sampled grid (positive == far outside)
 * @param {number[]} o.dims          node counts [nx, ny, nz]
 * @param {Vector3}  o.origin        world position of grid node (0,0,0)
 * @param {number}   o.voxel         world size of one grid cell
 * @param {number}   [o.iso]         iso level, defaults to 0
 * @param {Function} [o.thicknessFn] (x, y, z) => 0..1 subsurface depth
 */
export function polygonise( { field, dims, origin, voxel, iso = 0, thicknessFn = null } ) {

	const [ NX, NY, NZ ] = dims;
	const SY = NX, SZ = NX * NY;
	const inv2h = 1 / ( 2 * voxel );

	const n = Math.max( 0, Math.floor( field.length / 3 ) );
	let capacity = Math.min( n * 9, 3 * 1024 * 1024 ); // growable vertex store
	let positions = new Float32Array( capacity );
	let normals = new Float32Array( capacity );
	let thicks = new Float32Array( capacity / 3 );
	let out = 0;

	const grow = () => {

		const next = new Float32Array( positions.length * 2 );
		next.set( positions );
		positions = next;

		const nn = new Float32Array( normals.length * 2 );
		nn.set( normals );
		normals = nn;

		const nt = new Float32Array( thicks.length * 2 );
		nt.set( thicks );
		thicks = nt;

	};

	const V = new Float64Array( 36 );
	const N = new Float64Array( 36 );
	const G = new Float64Array( 24 );
	const CORNER = new Int32Array( 8 );

	const ox0 = origin.x, oy0 = origin.y, oz0 = origin.z;

	for ( let z = 0; z < NZ - 1; z ++ ) {

		for ( let y = 0; y < NY - 1; y ++ ) {

			const rowBase = z * SZ + y * SY;

			for ( let x = 0; x < NX - 1; x ++ ) {

				const base = rowBase + x;

				let cube = 0;
				for ( let c = 0; c < 8; c ++ ) {

					const i = base + CX[ c ] + CY[ c ] * SY + CZ[ c ] * SZ;
					CORNER[ c ] = i;
					if ( field[ i ] < iso ) cube |= CB[ c ];

				}

				if ( edgeTable[ cube ] === 0 ) continue;

				// central-difference gradients of the eight corners
				for ( let c = 0; c < 8; c ++ ) {

					const i = CORNER[ c ];
					G[ c * 3 + 0 ] = ( field[ i - 1 ] - field[ i + 1 ] ) * inv2h;
					G[ c * 3 + 1 ] = ( field[ i - SY ] - field[ i + SY ] ) * inv2h;
					G[ c * 3 + 2 ] = ( field[ i - SZ ] - field[ i + SZ ] ) * inv2h;

				}

				for ( let e = 0; e < 12; e ++ ) {

					const o9 = e * 9;
					const slot = EDGES[ o9 ];
					const c0 = EDGES[ o9 + 1 ], c1 = EDGES[ o9 + 2 ];
					const ax = EDGES[ o9 + 3 ], ay = EDGES[ o9 + 4 ], az = EDGES[ o9 + 5 ];
					const qx = EDGES[ o9 + 6 ], qy = EDGES[ o9 + 7 ], qz = EDGES[ o9 + 8 ];

					const i0 = CORNER[ c0 ], i1 = CORNER[ c1 ];
					const v0 = field[ i0 ], v1 = field[ i1 ];

					let mu = ( iso - v0 ) / ( v1 - v0 );
					if ( ! ( mu >= 0 ) ) mu = 0.5;            // NaN or negative
					else if ( mu > 1 ) mu = 1;

					const o3 = slot * 3;
					V[ o3 ] = ox0 + ( x + qx + mu * ax ) * voxel;
					V[ o3 + 1 ] = oy0 + ( y + qy + mu * ay ) * voxel;
					V[ o3 + 2 ] = oz0 + ( z + qz + mu * az ) * voxel;

					N[ o3 ] = G[ c0 * 3 ] + mu * ( G[ c1 * 3 ] - G[ c0 * 3 ] );
					N[ o3 + 1 ] = G[ c0 * 3 + 1 ] + mu * ( G[ c1 * 3 + 1 ] - G[ c0 * 3 + 1 ] );
					N[ o3 + 2 ] = G[ c0 * 3 + 2 ] + mu * ( G[ c1 * 3 + 2 ] - G[ c0 * 3 + 2 ] );

				}

				let i = cube << 4;

				while ( triTable[ i ] !== - 1 ) {

					const a = triTable[ i ] * 3;
					const b = triTable[ i + 1 ] * 3;
					const c = triTable[ i + 2 ] * 3;
					i += 3;

					for ( let k = 0; k < 3; k ++ ) {

						if ( out + 3 > positions.length ) grow();

						const o3 = k === 0 ? a : ( k === 1 ? b : c );

						const px = V[ o3 ], py = V[ o3 + 1 ], pz = V[ o3 + 2 ];
						positions[ out ] = px;
						positions[ out + 1 ] = py;
						positions[ out + 2 ] = pz;

						const nx = N[ o3 ], ny = N[ o3 + 1 ], nz = N[ o3 + 2 ];
						const len = Math.sqrt( nx * nx + ny * ny + nz * nz ) || 1;
						normals[ out ] = nx / len;
						normals[ out + 1 ] = ny / len;
						normals[ out + 2 ] = nz / len;

						if ( thicknessFn ) thicks[ out / 3 ] = thicknessFn( px, py, pz );

						out += 3;

					}

				}

			}

		}

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( positions.subarray( 0, out ), 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( normals.subarray( 0, out ), 3 ) );
	if ( thicknessFn ) geometry.setAttribute( 'aThick', new BufferAttribute( thicks.subarray( 0, out / 3 ), 1 ) );
	geometry.computeBoundingSphere();

	return geometry;

}