/**
 * Capture helper: loads the dev/preview server in headless Chromium, waits for
 * the scene to finish baking, then writes a PNG of the live canvas.
 *
 *   node tools/shoot.mjs <out.png> [width] [height] [query]
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [ , , outArg = 'shots/preview.png', wArg = '900', hArg = '1200', query = '' ] = process.argv;

const out = resolve( outArg );
const width = Number( wArg );
const height = Number( hArg );
const url = `${ process.env.BASE_URL || 'http://127.0.0.1:5190' }/${ query ? '?' + query : '' }`;

await mkdir( dirname( out ), { recursive: true } );

const browser = await chromium.launch( {
	args: [
		'--use-gl=angle',
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--disable-lcd-text',
	],
} );

const page = await browser.newPage( { viewport: { width, height }, deviceScaleFactor: 1 } );

const logs = [];
page.on( 'console', ( m ) => logs.push( `[${ m.type() }] ${ m.text() }` ) );
page.on( 'pageerror', ( e ) => logs.push( `[pageerror] ${ e.message }` ) );

await page.goto( url, { waitUntil: 'load', timeout: 120000 } );

await page.waitForFunction( () => window.sceneReady === true, null, { timeout: 180000 } );
// let the software rasteriser finish the transmission pass
await page.waitForTimeout( 1500 );

const info = await page.evaluate( () => {
	const c = document.querySelector( 'canvas' );
	const gl = c.getContext( 'webgl2' ) || c.getContext( 'webgl' );
	const dbg = gl && gl.getExtension( 'WEBGL_debug_renderer_info' );
	return {
		renderer: dbg ? gl.getParameter( dbg.UNMASKED_RENDERER_WEBGL ) : 'n/a',
		size: [ c.width, c.height ],
	};
} );

await page.screenshot( { path: out } );

await browser.close();

console.log( JSON.stringify( { out, width, height, ...info, logs }, null, 2 ) );
