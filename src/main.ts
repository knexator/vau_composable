import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Grid2D } from './kommon/grid2D';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, fromCount, fromRange, objectMap, repeat, zip2 } from './kommon/kommon';
import { mod, towards as approach, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { canvasFromAscii } from './kommon/spritePS';
import { initGL2, IVec, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';

const input = new Input();
const canvas_ctx = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const ctx = canvas_ctx.getContext('2d')!;
const canvas_gl = document.querySelector<HTMLCanvasElement>('#gl_canvas')!;
const gl = initGL2(canvas_gl)!;
gl.clearColor(0.5, 0.5, 0.5, 1);

const CONFIG = {
};

const gui = new GUI();

let last_timestamp = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp: number) {
    // in seconds
    const delta_time = (cur_timestamp - last_timestamp) / 1000;
    last_timestamp = cur_timestamp;
    input.startFrame();
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas_ctx.width, canvas_ctx.height);
    ctx.fillStyle = 'gray';
    ctx.fillRect(0, 0, canvas_ctx.width, canvas_ctx.height);
    if (or(twgl.resizeCanvasToDisplaySize(canvas_ctx), twgl.resizeCanvasToDisplaySize(canvas_gl))) {
        // resizing stuff
        gl.viewport(0, 0, canvas_gl.width, canvas_gl.height);
    }

    const rect = canvas_ctx.getBoundingClientRect();
    const raw_mouse_pos = new Vec2(input.mouse.clientX - rect.left, input.mouse.clientY - rect.top);

    animation_id = requestAnimationFrame(every_frame);
}

/// /// library stuff

function single<T>(arr: T[]) {
    if (arr.length === 0) {
        throw new Error('the array was empty');
    }
    else if (arr.length > 1) {
        throw new Error(`the array had more than 1 element: ${arr.toString()}`);
    }
    else {
        return arr[0];
    }
}

function at<T>(arr: T[], index: number): T {
    if (arr.length === 0) throw new Error('can\'t call \'at\' with empty array');
    return arr[mod(index, arr.length)];
}

function drawCircle(center: Vec2, radius: number) {
    ctx.moveTo(center.x + radius, center.y);
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
}

function moveTo(pos: Vec2) {
    ctx.moveTo(pos.x, pos.y);
}

function lineTo(pos: Vec2) {
    ctx.lineTo(pos.x, pos.y);
}

function fillText(text: string, pos: Vec2) {
    ctx.fillText(text, pos.x, pos.y);
}

function or(a: boolean, b: boolean) {
    return a || b;
}

if (import.meta.hot) {
    // if (import.meta.hot.data.stuff) {
    //   stuff = import.meta.hot.data.stuff;
    // }

    // import.meta.hot.accept();

    import.meta.hot.dispose((data) => {
        input.mouse.dispose();
        input.keyboard.dispose();
        cancelAnimationFrame(animation_id);
        gui.destroy();
        // data.stuff = stuff;
    });
}

let animation_id: number;
const loading_screen_element = document.querySelector<HTMLDivElement>('#loading_screen');
if (loading_screen_element) {
    loading_screen_element.innerText = 'Press to start!';
    document.addEventListener('pointerdown', (_event) => {
        loading_screen_element.style.opacity = '0';
        animation_id = requestAnimationFrame(every_frame);
    }, { once: true });
}
else {
    animation_id = requestAnimationFrame(every_frame);
}
