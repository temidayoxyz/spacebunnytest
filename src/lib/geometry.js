import { Vector2, Vector3, CatmullRomCurve3, LatheGeometry } from 'three';

/**
 * All of the lamp's turned parts come from 2D (radius, height) profiles that are
 * splined through a handful of control points, then revolved. Nothing here is
 * a stock primitive, so the silhouette is fully art-directable.
 */

/** Spline through [r, y] control points, sampled into a dense polyline. */
export function splineProfile( points, samples = 220 ) {

	const ctrl = points.map( ( p ) => new Vector3( p[ 0 ], p[ 1 ], 0 ) );
	const curve = new CatmullRomCurve3( ctrl, false, 'centripetal', 0.5 );

	const out = [];
	for ( let i = 0; i <= samples; i ++ ) {

		const p = curve.getPoint( i / samples );
		out.push( new Vector2( Math.max( 0, p.x ), p.y ) );

	}

	return out;

}

/**
 * Offset a profile along its own 2D normal. `t > 0` moves inward (toward the
 * axis) which is how the glass wall thickness is produced.
 */
export function offsetProfile( profile, t ) {

	const out = [];
	for ( let i = 0; i < profile.length; i ++ ) {

		const a = profile[ Math.max( 0, i - 1 ) ];
		const b = profile[ Math.min( profile.length - 1, i + 1 ) ];

		const tr = b.x - a.x, ty = b.y - a.y;
		const len = Math.hypot( tr, ty ) || 1;

		// outward normal of a (r, y) curve travelling upward is (ty, -tr)
		const nr = ty / len, ny = - tr / len;
		out.push( new Vector2( Math.max( 0, profile[ i ].x + nr * t ), profile[ i ].y + ny * t ) );

	}

	return out;

}

/** Rebuild a dense profile through explicit corner points (keeps hard creases). */
export function profileFromPath( segments, samplesPerSegment = 34 ) {

	const out = [];
	for ( let s = 0; s < segments.length; s ++ ) {

		const seg = segments[ s ];
		if ( s === 0 ) out.push( new Vector2( seg[ 0 ][ 0 ], seg[ 0 ][ 1 ] ) );
		for ( let i = 1; i <= samplesPerSegment; i ++ ) {

			const t = i / samplesPerSegment;
			out.push( new Vector2(
				seg[ 0 ][ 0 ] + ( seg[ 1 ][ 0 ] - seg[ 0 ][ 0 ] ) * t,
				seg[ 0 ][ 1 ] + ( seg[ 1 ][ 1 ] - seg[ 0 ][ 1 ] ) * t ) );

		}

	}

	return out;

}

/** Revolve a profile. Points at r = 0 collapse into cone tips. */
export function lathe( profile, segments = 192 ) {

	const clean = profile.filter( ( p ) => Number.isFinite( p.x ) && Number.isFinite( p.y ) );
	return new LatheGeometry( clean, segments, 0, Math.PI * 2 );

}

// ---------------------------------------------------------------------------
// Lamp profiles. Dimensions in metres; the finished lamp stands 0.4575 m tall,
// which sits close to a 45 cm Mathmos Astro.
// ---------------------------------------------------------------------------

/** Outer wall of the glass vessel, bottom stub -> rim. */
export const GLASS_OUTER = [
	[ 0.0294, 0.0930 ],
	[ 0.0295, 0.1050 ],
	[ 0.0302, 0.1135 ],
	[ 0.0336, 0.1240 ],
	[ 0.0384, 0.1410 ],
	[ 0.0412, 0.1630 ],
	[ 0.0425, 0.1905 ],
	[ 0.0422, 0.2260 ],
	[ 0.0406, 0.2660 ],
	[ 0.0378, 0.3050 ],
	[ 0.0338, 0.3400 ],
	[ 0.0288, 0.3685 ],
	[ 0.0240, 0.3900 ],
	[ 0.0198, 0.4030 ],
	[ 0.0170, 0.4105 ],
	[ 0.0158, 0.4162 ],
];

export const WALL = 0.0032;

/** Thickness of the solid glass floor. */
export const FLOOR_T = 0.0062;

/** Fill line of the liquid inside the neck. */
export const FILL_Y = 0.3862;

/**
 * Closed cross-section of the glass: bottom face, outer wall, rim, inner wall,
 * inner floor. Revolving this gives a genuinely hollow vessel with wall
 * thickness rather than a solid lump of "glass".
 */
export function glassShellProfile( samples = 240 ) {

	const outer = splineProfile( GLASS_OUTER, samples );

	// inner wall: same curve pushed along its own normal, trimmed at both ends
	const innerAsc = offsetProfile( outer, WALL );
	const topY = outer[ outer.length - 1 ].y;
	const botY = outer[ 0 ].y;
	while ( innerAsc.length && innerAsc[ innerAsc.length - 1 ].y > topY - 0.0006 ) innerAsc.pop();
	while ( innerAsc.length && innerAsc[ 0 ].y < botY + FLOOR_T ) innerAsc.shift();

	const inner = innerAsc.slice().reverse();
	const rTop = outer[ outer.length - 1 ];

	const rim = [
		new Vector2( rTop.x - 0.0003, rTop.y + 0.0005 ),
		new Vector2( rTop.x - 0.0015, rTop.y + 0.0005 ),
		new Vector2( rTop.x - 0.0028, rTop.y + 0.0002 ),
		new Vector2( inner[ 0 ].x, inner[ 0 ].y ),
	];

	const y0 = outer[ 0 ].y;
	const y1 = inner[ inner.length - 1 ].y;
	const rFloor = inner[ inner.length - 1 ].x;

	return [
		new Vector2( 0, y0 ),
		new Vector2( outer[ 0 ].x * 0.55, y0 ),
		new Vector2( outer[ 0 ].x * 0.88, y0 ),
		...outer,
		...rim,
		...inner,
		new Vector2( rFloor * 0.9, y1 ),
		new Vector2( rFloor * 0.5, y1 ),
		new Vector2( 0, y1 ),
	];

}

/**
 * Closed cross-section of the liquid column, ordered bottom -> fill line so the
 * revolved surface is a simple, non self-intersecting solid.
 */
export function liquidProfile( samples = 200 ) {

	const outer = splineProfile( GLASS_OUTER, samples );
	const wall = offsetProfile( outer, WALL + 0.0005 );

	const yFloor = outer[ 0 ].y + FLOOR_T + 0.0012;
	while ( wall.length && wall[ 0 ].y < yFloor ) wall.shift();
	while ( wall.length && wall[ wall.length - 1 ].y > FILL_Y ) wall.pop();

	const rFloor = wall[ 0 ].x;
	const rTop = wall[ wall.length - 1 ].x;

	// Concave meniscus across the fill line. Sampled densely: a faceted top
	// surface shows up as hard steps once the neck refracts it.
	const top = [];
	const SEG = 44;
	const dip = 0.0016;
	for ( let i = 0; i <= SEG; i ++ ) {

		const t = i / SEG;                       // 0 at the rim, 1 at the centre
		top.push( new Vector2( rTop * ( 1 - t ), FILL_Y - dip * t * t ) );

	}

	return [
		new Vector2( 0, yFloor ),
		new Vector2( rFloor * 0.5, yFloor ),
		new Vector2( rFloor * 0.92, yFloor ),
		...wall,
		...top,
	];

}

/** Solid metal pedestal: crisp foot, straight flank, machined step, curved shoulder. */
export const BASE_PROFILE = [
	[ 0.0000, 0.0000 ],
	[ 0.0330, 0.0000 ],
	[ 0.0448, 0.0000 ],
	[ 0.0494, 0.0018 ],
	[ 0.0518, 0.0064 ],
	[ 0.0530, 0.0132 ],
	[ 0.0533, 0.0206 ],
	[ 0.0533, 0.0272 ],
	// fine turned step: reads as machined rather than moulded
	[ 0.0521, 0.0288 ],
	[ 0.0519, 0.0306 ],
	[ 0.0530, 0.0322 ],
	[ 0.0533, 0.0400 ],
	[ 0.0526, 0.0490 ],
	[ 0.0506, 0.0592 ],
	[ 0.0472, 0.0688 ],
	[ 0.0424, 0.0778 ],
	[ 0.0374, 0.0852 ],
	[ 0.0340, 0.0912 ],
	[ 0.0327, 0.0956 ],
	[ 0.0325, 0.0998 ],
];

export const BASE_PROFILE_DENSE = splineProfile( BASE_PROFILE, 190 );

/** Collar ring that grips the glass stub above the pedestal. */
export function collarProfile() {

	return profileFromPath( [
		[ [ 0.0296, 0.0988 ], [ 0.0322, 0.0992 ] ],
		[ [ 0.0322, 0.0992 ], [ 0.0325, 0.1010 ] ],
		[ [ 0.0325, 0.1010 ], [ 0.0325, 0.1046 ] ],
		[ [ 0.0325, 0.1046 ], [ 0.0319, 0.1074 ] ],
		[ [ 0.0319, 0.1074 ], [ 0.0304, 0.1092 ] ],
		[ [ 0.0304, 0.1092 ], [ 0.0296, 0.1090 ] ],
		[ [ 0.0296, 0.1090 ], [ 0.0296, 0.0988 ] ],
	], 10 );

}

/**
 * Domed metal cap that closes the neck: a short skirt flaring over the rim,
 * then a full half-round shoulder. Deliberately squat so it reads as a machined
 * cap rather than a finial.
 */
export const CAP_PROFILE = [
	[ 0.0000, 0.4012 ],
	[ 0.0100, 0.4012 ],
	[ 0.0166, 0.4020 ],
	[ 0.0197, 0.4044 ],
	[ 0.0209, 0.4082 ],
	[ 0.0213, 0.4136 ],
	[ 0.0211, 0.4186 ],
	[ 0.0203, 0.4242 ],
	[ 0.0187, 0.4302 ],
	[ 0.0163, 0.4355 ],
	[ 0.0131, 0.4398 ],
	[ 0.0089, 0.4432 ],
	[ 0.0042, 0.4454 ],
	[ 0.0000, 0.4460 ],
];

export const CAP_PROFILE_DENSE = splineProfile( CAP_PROFILE, 160 );

/**
 * Curved metal disc sitting just above the fill line: the cap of the liquid.
 * Only the outer band and the underside are visible.
 */
export function discProfile( rOuter, rInner, y, bulge = 0.0012 ) {

	return profileFromPath( [
		[ [ 0, y - bulge ], [ rInner * 0.5, y - bulge ] ],
		[ [ rInner * 0.5, y - bulge ], [ rInner, y - bulge * 0.2 ] ],
		[ [ rInner, y - bulge * 0.2 ], [ rOuter, y ] ],
		[ [ rOuter, y ], [ rOuter, y - 0.004 ] ],
		[ [ rOuter, y - 0.004 ], [ rInner, y - 0.004 ] ],
		[ [ rInner, y - 0.004 ], [ rInner * 0.5, y - 0.004 ] ],
		[ [ rInner * 0.5, y - 0.004 ], [ 0, y - 0.004 ] ],
	], 8 );

}

/**
 * Heating element: a smooth dished disc sitting in the bottom of the liquid
 * where the bulb would be in the real appliance.
 */
export function heaterProfile( r = 0.0215, y = 0.1180 ) {

	return profileFromPath( [
		[ [ 0, y ], [ r * 0.30, y - 0.0004 ] ],
		[ [ r * 0.30, y - 0.0004 ], [ r * 0.58, y - 0.0019 ] ],
		[ [ r * 0.58, y - 0.0019 ], [ r * 0.80, y - 0.0044 ] ],
		[ [ r * 0.80, y - 0.0044 ], [ r * 0.94, y - 0.0076 ] ],
		[ [ r * 0.94, y - 0.0076 ], [ r, y - 0.0112 ] ],
		[ [ r, y - 0.0112 ], [ r * 0.99, y - 0.0130 ] ],
		[ [ r * 0.99, y - 0.0130 ], [ r * 0.86, y - 0.0134 ] ],
		[ [ r * 0.86, y - 0.0134 ], [ r * 0.40, y - 0.0136 ] ],
		[ [ r * 0.40, y - 0.0136 ], [ 0, y - 0.0136 ] ],
	], 14 );

}

/**
 * The glowing element itself: a shallow dome sitting on the heater dish. Kept
 * small so it reads as a light source rather than a bright disc.
 */
export function bulbProfile( r = 0.0125, y = 0.1215 ) {

	return profileFromPath( [
		[ [ 0, y + r * 0.62 ], [ r * 0.45, y + r * 0.46 ] ],
		[ [ r * 0.45, y + r * 0.46 ], [ r * 0.78, y + r * 0.22 ] ],
		[ [ r * 0.78, y + r * 0.22 ], [ r, y - r * 0.08 ] ],
		[ [ r, y - r * 0.08 ], [ r, y - r * 0.30 ] ],
		[ [ r, y - r * 0.30 ], [ r * 0.7, y - r * 0.38 ] ],
		[ [ r * 0.7, y - r * 0.38 ], [ 0, y - r * 0.40 ] ],
	], 12 );

}