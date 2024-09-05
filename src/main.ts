import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, assertNotNull, at, fromCount, fromRange, getFromStorage, last, objectMap, repeat, reversed, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { DEFAULT_CASE, FunktionDefinition, LevelDescription, MatchCaseAddress, MatchCaseDefinition, PersistenceStuff, SexprLiteral, SexprTemplate, assertLiteral, doAtom, doList, doPair, doVar, equalSexprs, fillFnkBindings, fillTemplate, fnkToString, generateBindings, getAt, getCaseAt, parseFnks, parseSexprLiteral, parseSexprTemplate, sexprToString } from './model';
import { Camera, Collapsed, Drawer } from './drawer';
import { AfterExecutingSolution, ExecutingSolution, ExecutionState } from './executing_solution';
import { EditingSolution } from './editing_solution';
import { ElectingSolution } from './electing_solution';
import { Random } from './kommon/random';

// TODO: duplicate vaus

const input = new Input();
const canvas = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const drawer = new Drawer(canvas.getContext('2d')!);

const CONFIG = {
    _0_1: 0.0,
};

// const gui = new GUI();
// gui.add(CONFIG, '_0_1', 0, 1).listen();

const default_fnks_2: FunktionDefinition[] = [
    {
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
    },
    {
        name: { type: 'atom', value: 'increment' },
        cases: [
            {
                pattern: parseSexprTemplate(`number`),
                template: parseSexprTemplate(`(#true . number)`),
                fn_name_template: parseSexprTemplate(`#identity`),
                next: 'return',
            },
        ],
    },
];

function lit2lit(a: string, b: string): { pattern: SexprTemplate, template: SexprTemplate, fn_name_template: SexprTemplate, next: 'return' } {
    return {
        pattern: doAtom(a),
        template: doAtom(b),
        fn_name_template: doAtom('identity'),
        next: 'return',
    };
}

function var2var(a: string, next: MatchCaseDefinition[] | 'return'): MatchCaseDefinition {
    return {
        pattern: doVar(a),
        template: doVar(a),
        fn_name_template: doAtom('identity'),
        next,
    };
}

const default_fnks: FunktionDefinition[] = [
    {
        name: doAtom('debug'),
        cases: [
            lit2lit('red', 'darkRed'),
            var2var('green', [
                lit2lit('red', 'red'),
                var2var('asdf', 'return'),
                var2var('hola', 'return'),
                var2var('buenas', 'return'),
            ]),
            var2var('asdf', 'return'),
            var2var('hola', 'return'),
            var2var('buenas', 'return'),
        ],
    },
    {
        name: doAtom('darken'),
        cases: [
            lit2lit('red', 'darkRed'),
            lit2lit('green', 'darkGreen'),
            lit2lit('blue', 'darkBlue'),
            lit2lit('yellow', 'darkYellow'),
            lit2lit('purple', 'darkPurple'),
        ],
    },
    {
        name: doAtom('extractCore'),
        cases: [
            {
                pattern: parseSexprTemplate('((#red . idk) . (value . #blue))'),
                template: parseSexprTemplate('value'),
                fn_name_template: doAtom('identity'),
                next: 'return',
            },
        ],
    },
    {
        name: doAtom('lighten'),
        cases: [
            lit2lit('red', 'lightRed'),
            lit2lit('green', 'lightGreen'),
            lit2lit('blue', 'lightBlue'),
            lit2lit('yellow', 'lightYellow'),
            lit2lit('purple', 'lightPurple'),
        ],
    },
    {
        name: doAtom('mix'),
        cases: [
            {
                pattern: parseSexprTemplate('(#white . value)'),
                template: parseSexprTemplate('value'),
                fn_name_template: doAtom('lighten'),
                next: 'return',
            },
            {
                pattern: parseSexprTemplate('(#black . value)'),
                template: parseSexprTemplate('value'),
                fn_name_template: doAtom('darken'),
                next: 'return',
            },
        ],
    },
    {
        name: doAtom('fullyLighten'),
        cases: [
            {
                pattern: parseSexprTemplate('dark'),
                template: parseSexprTemplate('dark'),
                fn_name_template: doAtom('lighten'),
                next: [{
                    pattern: parseSexprTemplate('middle'),
                    template: parseSexprTemplate('middle'),
                    fn_name_template: doAtom('lighten'),
                    next: 'return',
                }],
            },
        ],
    },
    {
        name: doAtom('hasRed'),
        cases: [
            {
                pattern: parseSexprTemplate('(#red . rest)'),
                template: parseSexprTemplate('#true'),
                fn_name_template: doAtom('identity'),
                next: 'return',
            },
            {
                pattern: parseSexprTemplate('(first . rest)'),
                template: parseSexprTemplate('rest'),
                fn_name_template: doAtom('hasRed'),
                next: 'return',
            },
            lit2lit('nil', 'false'),
        ],
    },
];

// tutorial levels:
// - hardcoded map
// - (a . b) => (hardcoded_map(a) . hardcoded_map(b))
// actual levels:
// - move X to front
// - areEqual
// - reverseList
// - remove all X from list
// - zip 2 lists together
// - [[e] * n for (e, n) in zip(elements, repeatCount)]
// - sum all numbers in list
// - dictLookup, maybe?
// - peano math
// - binary math
// - brainfuck
// - meta: parser
// - meta: interpreter
// - meta: compiler
// - sorting algorithm
// - something that is best solved with a tree
// - run-length encoding?
// - second most common element of list
// - DNA repair: "here is a list of common fail patterns, and their correct versions; apply it" (preparation for meta)

// import * as x from './sample_save.txt?raw';
// localStorage.setItem('vau_composable', x.default);

// const all_levels: LevelDescription[] = [
//     new LevelDescription(doAtom('reverse'), `Reverse the given list`, (n: number) => {
//         const rand = new Random(n.toString());
//         const misc_atoms = 'v1,v2,v3'.split(',').map(doAtom);
//         const asdf = fromCount(rand.int(0, 5), _ => rand.choice(misc_atoms));
//         return [
//             doList(asdf),
//             doList(reversed(asdf)),
//         ];
//     }),
// ];

const tutorial_levels: LevelDescription[] = [
    new LevelDescription(doAtom('map'), `map inputs to outputs`, (n: number) => {
        const pairs: [SexprLiteral, SexprLiteral][] = [
            [doAtom('france'), doAtom('paris')],
            [doAtom('spain'), doAtom('madrid')],
            [doAtom('portugal'), doAtom('lisbon')],
            [doAtom('germany'), doAtom('berlin')],
            [doAtom('italy'), doAtom('rome')],
        ];
        return pairs[mod(n, pairs.length)];
    }),
    new LevelDescription(doAtom('wrap'), `wrap up the thing`, (n: number) => {
        function helper(x: string): [SexprLiteral, SexprLiteral] {
            return [doAtom(x), parseSexprLiteral(`((#first . #${x}) . #last)`)];
        }
        const pairs: [SexprLiteral, SexprLiteral][] = [
            helper('france'),
            helper('spain'),
            helper('portugal'),
            helper('germany'),
            helper('italy'),
        ];
        return pairs[mod(n, pairs.length)];
    }),
    new LevelDescription(doAtom('unwrap'), `unwrap the thing and map it`, (n: number) => {
        const original_pairs: [SexprLiteral, SexprLiteral][] = [
            [doAtom('france'), doAtom('paris')],
            [doAtom('spain'), doAtom('madrid')],
            [doAtom('portugal'), doAtom('lisbon')],
            [doAtom('germany'), doAtom('berlin')],
            [doAtom('italy'), doAtom('rome')],
        ];

        const pairs: [SexprLiteral, SexprLiteral][] = original_pairs.map(([a, b]) => {
            return [doPair(doPair(doAtom('first'), a), doAtom('last')), b];
        });

        return pairs[mod(n, pairs.length)];
    }),
    new LevelDescription(doAtom('double'), `take 2 things, return 2 results`, (n: number) => {
        const original_pairs: [SexprLiteral, SexprLiteral][] = [
            [doAtom('france'), doAtom('paris')],
            [doAtom('spain'), doAtom('madrid')],
            [doAtom('portugal'), doAtom('lisbon')],
            [doAtom('germany'), doAtom('berlin')],
            [doAtom('italy'), doAtom('rome')],
        ];

        const rand = new Random(n.toString());
        const [in1, out1] = rand.choice(original_pairs);
        const [in2, out2] = rand.choice(original_pairs);
        return [doPair(in1, in2), doPair(out1, out2)];
    }),
];

const all_levels = tutorial_levels;

const persistence_stuff = getFromStorage('vau_persist2', str => PersistenceStuff.fromString(str, all_levels),
    new PersistenceStuff(all_levels, all_levels.map(l => ({ name: l.name, cases: [DEFAULT_CASE] })), fromCount(3, _ => parseSexprTemplate('1'))),
);

let cur_thing: ElectingSolution | EditingSolution | ExecutingSolution | AfterExecutingSolution = new ElectingSolution(persistence_stuff);
// let cur_thing: ElectingSolution | EditingSolution | ExecutingSolution | AfterExecutingSolution = new EditingSolution(all_fnks, all_fnks[0], parseSexprLiteral('(#true #true #true)'), cells);
let camera = new Camera();

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

    const rect = drawer.ctx.canvas.getBoundingClientRect();
    const raw_mouse_pos = new Vec2(input.mouse.clientX - rect.left, input.mouse.clientY - rect.top);
    const screen_size = new Vec2(rect.width, rect.height);

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
            camera.move(dir, delta_time * 1.5);
        }
    }
    camera.zoom(input.mouse.wheel, raw_mouse_pos, screen_size.y);

    if (cur_thing instanceof ElectingSolution) {
        cur_thing = cur_thing.drawAndUpdate(drawer, global_t, camera, input.mouse, input.keyboard) ?? cur_thing;
    }
    else if (cur_thing instanceof EditingSolution) {
        cur_thing = cur_thing.drawAndUpdate(drawer, global_t, camera, input.mouse, input.keyboard) ?? cur_thing;
        if (cur_thing instanceof EditingSolution && input.keyboard.wasPressed(KeyCode.Space)) {
            cur_thing = cur_thing.startExecution(global_t);
        }
    }
    else if (cur_thing instanceof ExecutingSolution) {
        cur_thing.draw(drawer, camera, global_t, input.mouse);
        [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4, KeyCode.Digit5, KeyCode.Digit6, KeyCode.Digit7, KeyCode.Digit8].forEach((key, index) => {
            if (input.keyboard.wasPressed(key)) {
                if (!(cur_thing instanceof ExecutingSolution)) throw new Error('unreachable');
                cur_thing.speed = [0, 1, 2, 3, 4, 8, 16][index] ?? index * index;
            }
        });
        if (input.keyboard.wasPressed(KeyCode.Escape)) {
            cur_thing = cur_thing.skip(global_t);
        }
        else {
            cur_thing = cur_thing.update(delta_time, global_t) ?? cur_thing;
        }
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
    else {
        const _: never = cur_thing;
    }

    if (input.keyboard.wasPressed(KeyCode.KeyR)) {
        camera = new Camera();
    }

    if (input.keyboard.wasPressed(KeyCode.KeyQ)) {
        localStorage.setItem('vau_persist', persistence_stuff.toString());
        // // localStorage.setItem('vau_composable', JSON.stringify(all_fnks));
        // localStorage.setItem('vau_composable', all_fnks.map(x => fnkToString(x)).join('\n'));
        // localStorage.setItem('vau_composable_cells', JSON.stringify(cells));
    }
    if (input.keyboard.wasPressed(KeyCode.KeyC)) {
        const savedata = persistence_stuff.user_fnks.map(x => fnkToString(x)).join('\n');
        void navigator.clipboard.writeText(savedata);
    }
    // if (input.keyboard.wasPressed(KeyCode.KeyV)) {
    //     void navigator.clipboard.readText().then((text) => {
    //         localStorage.setItem('vau_composable', text);
    //     });
    // }

    animation_id = requestAnimationFrame(every_frame);
}

if (import.meta.hot) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (import.meta.hot.data.cur_thing !== undefined) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-member-access
        const old_thing = import.meta.hot.data.cur_thing as ExecutingSolution;
        if (old_thing.constructor.name == 'ExecutingSolution') {
            console.log('stuff');
            cur_thing = old_thing;
            Object.setPrototypeOf(cur_thing, ExecutingSolution.prototype);
            // cur_thing = Object.assign(new ExecutingSolution(), old_thing);

            let cosa = cur_thing.cur_execution_state;
            Object.setPrototypeOf(cosa, ExecutionState.prototype);
            while (cosa.parent !== null) {
                Object.setPrototypeOf(cosa.parent, ExecutionState.prototype);
                cosa = cosa.parent;
            }

            // cur_thing.cur_execution_state = Object.assign(new ExecutionState(), cur_thing.cur_execution_state);
            // let cosa = cur_thing.cur_execution_state;
            // while (cosa.parent) {
            //     cosa.parent = Object.assign(new ExecutionState(), cosa.parent);
            //     cosa = cosa.parent;
            // }

            // Object.getOwnPropertyNames(ExecutionState.prototype).forEach((name) => {
            //     if (name !== 'constructor') {
            //         cur_thing.cur_execution_state[name] = ExecutionState.prototype[name];
            //     }
            // });
        }
    }

    if (import.meta.hot === undefined) throw new Error('unreachable');
    import.meta.hot.accept();
    import.meta.hot.accept('./executing_solution.ts', (_) => { });

    import.meta.hot.dispose((data) => {
        input.mouse.dispose();
        input.keyboard.dispose();
        cancelAnimationFrame(animation_id);
        // gui.destroy();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        data.cur_thing = cur_thing;
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
