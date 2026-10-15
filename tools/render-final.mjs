/**
 * Final deliverable renderer.
 *
 * Loads the app in headless Chromium at full output resolution, waits for the
 * wax implicit surface to finish polygonising, then captures the canvas.
 *
 *   node tools/render-final.mjs [out.png] [width] [height] [query]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [ , , outArg = 'renders/lava-lamp.png', wArg = '2000', hArg = '2700', query = '' ] = process.argv;

const out = resolve( outArg );
const width = Number( wArg );
const height = Number( hArg );
const base = process.env.BASE_URL || 'http://127.0.0.1:5190';
const url = `${ base }/${ query ? '?' + query : '' }`;

await mkdir( dirname( out ), { recursive: true } );

const browser = await chromium.launch( {
	args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text' ],
} );

const page = await browser.newPage( { viewport: { width, height }, deviceScaleFactor: 1 } );

const logs = [];
page.on( 'console', ( m ) => logs.push( `[${ m.type() }] ${ m.text() }` ) );
page.on( 'pageerror', ( e ) => logs.push( `[pageerror] ${ e.message }` ) );

console.log( `rendering ${ width }x${ height } from ${ url } ...` );
const t0 = Date.now();

await page.goto( url, { waitUntil: 'load', timeout: 180000 } );
await page.waitForFunction( () => window.sceneReady === true, null, { timeout: 300000 } );

const info = await page.evaluate( () => {
	const c = document.querySelector( 'canvas' );
	return { backing: [ c.width, c.height ] };
} );

// the software rasteriser needs a moment to finish the transmission + shadow passes
await page.waitForTimeout( 3000 );

const buffer = await page.locator( 'canvas' ).screenshot( { type: 'png' } );
await writeFile( out, buffer );

const stats = await page.evaluate( () => {
	const c = document.querySelector( 'canvas' );
	const gl = c.getContext( 'webgl2' );
	const px = new Uint8Array( 4 );
	gl.readPixels( Math.floor( c.width / 2 ), Math.floor( c.height * 0.5 ), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px );
	return { centre: Array.from( px ) };
} );

await browser.close();

console.log( JSON.stringify( {
	out,
	...info,
	...stats,
	seconds: Math.round( ( Date.now() - t0 ) / 1000 ),
	bytes: buffer.length,
	errors: logs.filter( ( l ) => l.includes( 'error' ) || l.includes( 'pageerror' ) ),
}, null, 2 ) );
