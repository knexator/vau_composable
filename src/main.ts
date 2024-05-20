import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, assertNotNull, fromCount, fromRange, last, objectMap, repeat, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { FunktionDefinition, MatchCaseAddress, SexprLiteral, SexprTemplate, assertLiteral, equalSexprs, fillFnkBindings, fillTemplate, generateBindings, getAt, getCaseAt, parseSexprLiteral, parseSexprTemplate, sexprToString } from './model';
import { Collapsed, Drawer, FloatingBinding, MatchedInput, SexprView, generateFloatingBindings, getView, lerpSexprView, nothingCollapsed, nothingMatched, toggleCollapsed, updateMatchedForMissingTemplate, updateMatchedForNewPattern } from './drawer';
import { ExecutingSolution } from './executing_solution';
import { EditingSolution } from './editing_solution';

const input = new Input();
const canvas = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const drawer = new Drawer(canvas.getContext('2d')!);

const CONFIG = {
    _0_1: 0.0,
};

const gui = new GUI();
gui.add(CONFIG, '_0_1', 0, 1).listen();

// const x = parseSexprTemplate(`@x`);
// const cur_fnk: FunktionDefinition = {
//     name: { type: 'atom', value: 'testing_view' },
//     cases: [
//         {
//             pattern: x,
//             template: x,
//             fn_name_template: x,
//             next: [
//                 {
//                     pattern: x,
//                     template: x,
//                     fn_name_template: x,
//                     next: [
//                         {
//                             pattern: x,
//                             template: x,
//                             fn_name_template: x,
//                             next: 'return',
//                         },
//                     ],
//                 },
//                 {
//                     pattern: x,
//                     template: x,
//                     fn_name_template: x,
//                     next: 'return',
//                 },
//             ],
//         },
//         {
//             pattern: x,
//             template: x,
//             fn_name_template: x,
//             next: 'return',
//         },
//     ],
// };

const asdfTest: FunktionDefinition = {
    name: { type: 'atom', value: 'asdfTest' },
    cases: [
        {
            pattern: parseSexprTemplate(`(v1 . @thing)`),
            template: parseSexprTemplate(`@thing`),
            fn_name_template: parseSexprTemplate(`asdfTest`),
            next: 'return',
        },
        {
            pattern: parseSexprTemplate(`@thing`),
            template: parseSexprTemplate(`(X . @thing)`),
            fn_name_template: parseSexprTemplate(`bubbleUp`),
            next: 'return',
        },
    ],
};

const bubbleUpFnk: FunktionDefinition = {
    name: { type: 'atom', value: 'bubbleUp' },
    cases: [
        {
            pattern: parseSexprTemplate(`(X . @rest)`),
            template: parseSexprTemplate(`(X . @rest)`),
            fn_name_template: parseSexprTemplate(`identity`),
            next: 'return',
        },
        {
            pattern: parseSexprTemplate(`(@a . @b)`),
            template: parseSexprTemplate(`@b`),
            fn_name_template: parseSexprTemplate(`bubbleUp`),
            next: [
                {
                    pattern: parseSexprTemplate(`(X . @rest)`),
                    template: parseSexprTemplate(`(X @a . @rest)`),
                    fn_name_template: parseSexprTemplate(`identity`),
                    next: 'return',
                },
            ],
        },
    ],
};

let all_fnks: FunktionDefinition[];
let cur_thing: EditingSolution | ExecutingSolution;
let view_offset = Vec2.zero;

const stored = localStorage.getItem('vau_composable');
if (stored === null) {
    all_fnks = [asdfTest, bubbleUpFnk];
    cur_thing = new EditingSolution(all_fnks, bubbleUpFnk, parseSexprLiteral('(v1 v2 X v3 v1)'));
}
else {
    // FUTURE: validation
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    all_fnks = JSON.parse(stored);
    cur_thing = new EditingSolution(all_fnks, all_fnks[0], parseSexprLiteral('(v1 v2 X v3 v1)'));
}

// const cur_execution = new ExecutingSolution(all_fnks, bubbleUpFnk,
//     parseSexprLiteral('(v1 v2 X v3 v1)'));
// parseSexprLiteral('(X 3 4)'));

// cur_matched[1].main = { type: 'pair', left: { type: 'null' }, right: { type: 'null' } };
// let cur_bindings: FloatingBinding[] | null = null;

let last_timestamp_millis = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp_millis: number) {
    const delta_time = (cur_timestamp_millis - last_timestamp_millis) / 1000;
    last_timestamp_millis = cur_timestamp_millis;
    input.startFrame();
    twgl.resizeCanvasToDisplaySize(canvas);

    drawer.clear();

    const keymap: [KeyCode[], Vec2][] = [
        [[KeyCode.KeyW, KeyCode.ArrowUp], Vec2.yneg],
        [[KeyCode.KeyA, KeyCode.ArrowLeft], Vec2.xneg],
        [[KeyCode.KeyS, KeyCode.ArrowDown], Vec2.ypos],
        [[KeyCode.KeyD, KeyCode.ArrowRight], Vec2.xpos],
    ];
    for (const [keys, dir] of keymap) {
        if (keys.some(k => input.keyboard.isDown(k))) {
            view_offset = view_offset.sub(dir.scale(1000 * delta_time));
        }
    }

    if (cur_thing instanceof EditingSolution) {
        cur_thing.draw(drawer, cur_timestamp_millis / 1000, view_offset);
        if (input.keyboard.wasPressed(KeyCode.Space)) {
            cur_thing = cur_thing.startExecution();
        }
        else {
            cur_thing = cur_thing.update(drawer, input.mouse, cur_timestamp_millis / 1000, view_offset) ?? cur_thing;
        }
    }
    else if (cur_thing instanceof ExecutingSolution) {
        cur_thing.draw(drawer, view_offset);
        [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4].forEach((key, index) => {
            if (input.keyboard.wasPressed(key)) {
                if (!(cur_thing instanceof ExecutingSolution)) throw new Error('unreachable');
                cur_thing.speed = index * index;
            }
        });
        cur_thing = cur_thing.update(delta_time, drawer, view_offset) ?? cur_thing;
    }

    if (input.keyboard.wasPressed(KeyCode.KeyQ)) {
        localStorage.setItem('vau_composable', JSON.stringify(all_fnks));
    }

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

    // if (cur_bindings === null) {
    // cur_bindings = drawer.generateFloatingBindings(cur_input, cur_fnk.cases, view)!;
    // }

    // drawer.drawBindings(cur_bindings, CONFIG._0_1);

    // drawer.drawMolecule(parseSexprTemplate('@x'), {
    //     pos: screen_size.mul(new Vec2(0.625, 0.2125)),
    //     halfside: screen_size.y / 5.5,
    //     turns: 0,
    // });

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
