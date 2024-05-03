import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, fromCount, fromRange, objectMap, repeat, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { FunktionDefinition, SexprTemplate, parseSexprLiteral, parseSexprTemplate } from './model';
import { Drawer, nothingCollapsed, toggleCollapsed } from './drawer';

const input = new Input();
const canvas = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const drawer = new Drawer(canvas.getContext('2d')!);

const CONFIG = {
    _0_1: 0.0,
};

const gui = new GUI();
gui.add(CONFIG, '_0_1', 0, 1);

const x = parseSexprTemplate(`@x`);
const cur_fnk: FunktionDefinition = {
    name: { type: 'atom', value: 'testing_view' },
    cases: [
        {
            pattern: x,
            template: x,
            fn_name_template: x,
            next: [
                {
                    pattern: x,
                    template: x,
                    fn_name_template: x,
                    next: [
                        {
                            pattern: x,
                            template: x,
                            fn_name_template: x,
                            next: 'return',
                        },
                    ],
                },
                {
                    pattern: x,
                    template: x,
                    fn_name_template: x,
                    next: 'return',
                },
            ],
        },
        {
            pattern: x,
            template: x,
            fn_name_template: x,
            next: 'return',
        },
    ],
};
let cur_collapse = nothingCollapsed(cur_fnk.cases);

let last_timestamp_millis = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp_millis: number) {
    const delta_time = (cur_timestamp_millis - last_timestamp_millis) / 1000;
    last_timestamp_millis = cur_timestamp_millis;
    input.startFrame();
    twgl.resizeCanvasToDisplaySize(canvas);

    const rect = canvas.getBoundingClientRect();
    const raw_mouse_pos = new Vec2(input.mouse.clientX - rect.left, input.mouse.clientY - rect.top);
    const screen_size = new Vec2(canvas.width, canvas.height);

    drawer.clear();

    // // drawMolecule(cur_fnk.cases[0].pattern, {
    // drawer.drawMolecule(parseSexprTemplate('((@v1 . v1) . @v2)'), {
    //     pos: screen_size.mul(new Vec2(0.25, 0.5)),
    //     halfside: screen_size.y / 5,
    //     turns: CONFIG._0_1 + 0.5,
    //     // turns: .25,
    // });

    // drawer.drawPattern(parseSexprTemplate('((@v1 . v1) . @v2)'), {
    //     pos: screen_size.mul(new Vec2(0.75, 0.5)),
    //     halfside: screen_size.y / 5,
    //     turns: CONFIG._0_1 + 0.5,
    //     // turns: .25,
    // });

    const view = {
        pos: screen_size.mul(new Vec2(0.1, 0.15)),
        halfside: screen_size.y / 20,
        // turns: 0,
        turns: CONFIG._0_1,
    };
    drawer.drawFunktion(cur_fnk, view, cur_collapse);
    drawer.drawMolecule(parseSexprTemplate('((@v1 . v1) @v2)'), view);

    drawer.drawMolecule(parseSexprTemplate('@x'), {
        pos: screen_size.mul(new Vec2(0.625, 0.2125)),
        halfside: screen_size.y / 5.5,
        turns: 0,
    });

    const asdf = drawer.getAtPosition(cur_fnk, view, cur_collapse, raw_mouse_pos);
    if (asdf !== null && input.mouse.wasPressed(MouseButton.Left)) {
        cur_collapse = toggleCollapsed(cur_collapse, asdf);
    }

    // drawer.drawMolecule(parseSexprTemplate('(v2 . @v2)'), {
    //     // pos: screen_size.scale(.5).addXY(-100, -100),
    //     pos: raw_mouse_pos,
    //     halfside: screen_size.y / 5,
    // });

    animation_id = requestAnimationFrame(every_frame);
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
