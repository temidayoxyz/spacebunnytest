import { splineProfile, offsetProfile, GLASS_OUTER } from '../src/lib/geometry.js';

const outer = splineProfile( GLASS_OUTER, 260 );

// second derivative of radius against arc length, sampled along the curve
let maxCurv = 0;
let at = 0;
const rows = [];
for ( let i = 2; i < outer.length - 2; i ++ ) {

	const r0 = outer[ i - 2 ].x, r1 = outer[ i - 1 ].x, r2 = outer[ i ].x, r3 = outer[ i + 1 ].x, r4 = outer[ i + 2 ].x;
	const c = ( r0 - 8 * r1 + 16 * r2 - 8 * r3 + r4 ) / 12;
	if ( Math.abs( c ) > maxCurv ) { maxCurv = Math.abs( c ); at = i; }
	if ( i % 12 === 0 ) rows.push( [ i, outer[ i ].y.toFixed( 4 ), outer[ i ].x.toFixed( 5 ), c.toExponential( 2 ) ] );

}

console.log( 'profile samples:', outer.length, 'max |d2r/di2|:', maxCurv.toExponential( 3 ), 'at i', at );
console.log( 'y        r         laplacian' );
for ( const r of rows ) console.log( r[ 0 ] + '\t' + r[ 1 ] + '\t' + r[ 2 ] + '\t' + r[ 3 ] );

// inner wall
const inner = offsetProfile( outer, 0.0032 );
let wall = [];
for ( let i = 0; i < outer.length; i += 10 ) wall.push( ( outer[ i ].x - inner[ i ].x ) * 1000 );
console.log( '\nradial wall thickness (mm), every 10th sample:', wall.map( ( v ) => v.toFixed( 2 ) ).join( ' ' ) );
