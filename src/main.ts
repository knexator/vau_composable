import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, assertNotNull, fromCount, fromRange, getFromStorage, last, objectMap, repeat, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { FunktionDefinition, MatchCaseAddress, SexprLiteral, SexprTemplate, assertLiteral, equalSexprs, fillFnkBindings, fillTemplate, fnkToString, generateBindings, getAt, getCaseAt, parseFnks, parseSexprLiteral, parseSexprTemplate, sexprToString } from './model';
import { Collapsed, Drawer, FloatingBinding, MatchedInput, SexprView, generateFloatingBindings, getView, lerpSexprView, nothingCollapsed, nothingMatched, toggleCollapsed, updateMatchedForMissingTemplate, updateMatchedForNewPattern } from './drawer';
import { AfterExecutingSolution, ExecutingSolution } from './executing_solution';
import { EditingSolution } from './editing_solution';

// TODO: duplicate vaus

const input = new Input();
const canvas = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const drawer = new Drawer(canvas.getContext('2d')!);

const CONFIG = {
    _0_1: 0.0,
};

const gui = new GUI();
gui.add(CONFIG, '_0_1', 0, 1).listen();

const incrementTwice: FunktionDefinition = {
    name: { type: 'atom', value: 'incrementTwice' },
    cases: [
        {
            pattern: parseSexprTemplate(`first`),
            template: parseSexprTemplate(`first`),
            fn_name_template: parseSexprTemplate(`#increment`),
            next: [
                {
                    pattern: parseSexprTemplate(`second`),
                    template: parseSexprTemplate(`second`),
                    fn_name_template: parseSexprTemplate(`#increment`),
                    next: 'return',
                },
            ],
        },
    ],
};

const increment: FunktionDefinition = {
    name: { type: 'atom', value: 'increment' },
    cases: [
        {
            pattern: parseSexprTemplate(`number`),
            template: parseSexprTemplate(`(#true . number)`),
            fn_name_template: parseSexprTemplate(`#identity`),
            next: 'return',
        },
    ],
};

// FUTURE: proper validation
const all_fnks: FunktionDefinition[] = getFromStorage('vau_composable', str => parseFnks(str), [incrementTwice, increment]);
all_fnks.map(x => console.log(fnkToString(x)));
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const cells: SexprTemplate[] = getFromStorage('vau_composable_cells', str => JSON.parse(str) as SexprTemplate[], fromCount(3, _ => parseSexprTemplate('1')));
let cur_thing: EditingSolution | ExecutingSolution | AfterExecutingSolution = new EditingSolution(all_fnks, all_fnks[0], parseSexprLiteral('(#true #true #true)'), cells);
let view_offset = Vec2.zero;

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

    const global_t = cur_timestamp_millis / 1000;
    drawer.clear();

    const keymap: [KeyCode[], Vec2][] = [
        // [[KeyCode.KeyW, KeyCode.ArrowUp], Vec2.yneg],
        // [[KeyCode.KeyA, KeyCode.ArrowLeft], Vec2.xneg],
        // [[KeyCode.KeyS, KeyCode.ArrowDown], Vec2.ypos],
        // [[KeyCode.KeyD, KeyCode.ArrowRight], Vec2.xpos],
        [[KeyCode.ArrowUp], Vec2.yneg],
        [[KeyCode.ArrowLeft], Vec2.xneg],
        [[KeyCode.ArrowDown], Vec2.ypos],
        [[KeyCode.ArrowRight], Vec2.xpos],
    ];
    for (const [keys, dir] of keymap) {
        if (keys.some(k => input.keyboard.isDown(k))) {
            view_offset = view_offset.sub(dir.scale(1000 * delta_time));
        }
    }

    if (cur_thing instanceof EditingSolution) {
        cur_thing.draw(drawer, global_t, view_offset);
        if (input.keyboard.wasPressed(KeyCode.Space)) {
            cur_thing = cur_thing.startExecution();
        }
        else {
            cur_thing = cur_thing.update(drawer, input.mouse, input.keyboard, global_t, view_offset) ?? cur_thing;
        }
    }
    else if (cur_thing instanceof ExecutingSolution) {
        cur_thing.draw(drawer, view_offset, global_t);
        [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4, KeyCode.Digit5, KeyCode.Digit6].forEach((key, index) => {
            if (input.keyboard.wasPressed(key)) {
                if (!(cur_thing instanceof ExecutingSolution)) throw new Error('unreachable');
                cur_thing.speed = index * index;
            }
        });
        cur_thing = cur_thing.update(delta_time, drawer, view_offset, global_t) ?? cur_thing;
    }
    else if (cur_thing instanceof AfterExecutingSolution) {
        cur_thing.draw(drawer);
        if (input.keyboard.wasPressed(KeyCode.Escape)) {
            cur_thing = cur_thing.original_editing;
        }
        else if (input.mouse.wasPressed(MouseButton.Left)) {
            if (cur_thing.result.type === 'success') {
                const asdf = cur_thing.result.result;
                cur_thing = cur_thing.original_editing;
                cur_thing.mouse_holding = asdf;
            }
            else {
                cur_thing = cur_thing.original_editing;
            }
        }
    }

    if (input.keyboard.wasPressed(KeyCode.KeyQ)) {
        // localStorage.setItem('vau_composable', JSON.stringify(all_fnks));
        localStorage.setItem('vau_composable', all_fnks.map(x => fnkToString(x)).join('\n'));
        localStorage.setItem('vau_composable_cells', JSON.stringify(cells));
    }

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
