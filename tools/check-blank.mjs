/**
 * Reproduces a suspected "page goes blank after load" bug: load the app, grab
 * a shot, resize the viewport, grab another, and report mean luminance of each
 * so a blank canvas is unambiguous.
 */
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:5190';
const browser = await chromium.launch( {
	args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );

const page = await browser.newPage( { viewport: { width: 800, height: 1000 }, deviceScaleFactor: 1 } );
const errors = [];
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text() ); } );
page.on( 'pageerror', ( e ) => errors.push( e.message ) );

await page.goto( base + '/', { waitUntil: 'load', timeout: 120000 } );
await page.waitForFunction( () => window.sceneReady === true, null, { timeout: 300000 } );
await page.waitForTimeout( 2500 );

// mean luminance of the canvas, read straight out of the WebGL context
const sample = async ( label ) => {

	const r = await page.evaluate( () => {

		const c = document.querySelector( 'canvas' );
		const gl = c.getContext( 'webgl2' );
		const w = 120, h = 160;
		const px = new Uint8Array( w * h * 4 );
		gl.readPixels(
			Math.floor( c.width / 2 - w / 2 ), Math.floor( c.height / 2 - h / 2 ),
			w, h, gl.RGBA, gl.UNSIGNED_BYTE, px );
		let sum = 0;
		for ( let i = 0; i < px.length; i += 4 ) sum += 0.2126 * px[ i ] + 0.7152 * px[ i + 1 ] + 0.0722 * px[ i + 2 ];
		return { backing: [ c.width, c.height ], css: [ c.clientWidth, c.clientHeight ], mean: sum / ( w * h ) };

	} );

	console.log( label, JSON.stringify( r ) );
	return r;

};

console.log( '--- before resize ---' );
const before = await sample( 'after load:   ' );

console.log( '--- resizing viewport ---' );
await page.setViewportSize( { width: 1100, height: 1400 } );
await page.waitForTimeout( 2500 );
const after = await sample( 'after resize: ' );

console.log( '--- after a reload ---' );
await page.reload( { waitUntil: 'load' } );
await page.waitForFunction( () => window.sceneReady === true, null, { timeout: 300000 } );
await page.waitForTimeout( 2500 );
const reloaded = await sample( 'after reload: ' );

console.log( JSON.stringify( {
	blankAfterResize: after.mean < 2,
	blankAfterReload: reloaded.mean < 2,
	errors,
}, null, 2 ) );

await browser.close();
