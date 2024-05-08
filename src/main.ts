import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, fromCount, fromRange, last, objectMap, repeat, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { FunktionDefinition, MatchCaseAddress, SexprLiteral, SexprTemplate, parseSexprLiteral, parseSexprTemplate } from './model';
import { Collapsed, Drawer, FloatingBinding, MatchedInput, SexprView, getView, lerpSexprView, nothingCollapsed, nothingMatched, toggleCollapsed } from './drawer';

const input = new Input();
const canvas = document.querySelector<HTMLCanvasElement>('#ctx_canvas')!;
const drawer = new Drawer(canvas.getContext('2d')!);

const CONFIG = {
    _0_1: 0.0,
    nextAnim: nextAnim,
};

const gui = new GUI();
gui.add(CONFIG, '_0_1', 0, 1).listen();
gui.add(CONFIG, 'nextAnim');

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

class Asdfasdf {
    private constructor(
        private fnk: FunktionDefinition,
        private collapse: Collapsed[],
        private matched: MatchedInput[],
        private input: SexprLiteral,
        private animation:
            { type: 'input_moving_to_next_option', target: MatchCaseAddress }
            | { type: 'failing_to_match', which: MatchCaseAddress },
    ) { }

    static init(fnk: FunktionDefinition, input: SexprLiteral): Asdfasdf {
        return new Asdfasdf(
            fnk,
            nothingCollapsed(fnk.cases),
            nothingMatched(fnk.cases),
            input,
            // { type: 'input_moving_to_next_option', target: [0] },
            { type: 'failing_to_match', which: [1, 0] },
        );
    }

    private getViewOfMovingInput(view: SexprView, address: MatchCaseAddress): SexprView {
        const chair_view = getView(view, {
            type: 'pattern',
            major: address,
            minor: [],
        });
        const unit = view.halfside / 4;
        return {
            pos: chair_view.pos.add(new Vec2(-unit * 23, 0).rotateTurns(chair_view.turns)),
            halfside: chair_view.halfside, turns: chair_view.turns,
        };
    }

    next(): Asdfasdf {
        switch (this.animation.type) {
            case 'input_moving_to_next_option': {
                return new Asdfasdf(this.fnk, this.collapse, this.matched, this.input,
                    { type: 'failing_to_match', which: this.animation.target });
            }
            case 'failing_to_match': {
                return new Asdfasdf(this.fnk, this.collapse, this.matched, this.input,
                    { type: 'input_moving_to_next_option', target: [...this.animation.which.slice(0, -1), this.animation.which[this.animation.which.length - 1] + 1] });
            }
            default:
                throw new Error('unhandled');
        }
    }

    draw(drawer: Drawer, anim_t: number, global_t: number) {
        const view = this.getMainView();

        drawer.drawFunktion(this.fnk, view, this.collapse, global_t, this.matched);
        if (this.animation.type === 'input_moving_to_next_option') {
            const source_view = (last(this.animation.target) === 0)
                ? getView(view, {
                    type: 'template',
                    major: this.animation.target.slice(0, -1),
                    minor: [],
                })
                : this.getViewOfMovingInput(view, [...this.animation.target.slice(0, -1), last(this.animation.target) - 1]);
            drawer.drawMolecule(this.input, lerpSexprView(
                source_view,
                this.getViewOfMovingInput(view, this.animation.target),
                anim_t,
            ));
        }
        else if (this.animation.type === 'failing_to_match') {
            const base_view = this.getViewOfMovingInput(view, this.animation.which);
            // const base_view = this.getViewOfMovingInput(view, this.animation.which + 1);
            const unit = base_view.halfside / 4;
            drawer.drawMolecule(this.input, {
                pos: base_view.pos.addX((anim_t - 1) * (anim_t - 0) * 4 * -unit * 11),
                halfside: base_view.halfside,
                turns: base_view.turns,
            });
        }
        else {
            drawer.drawMolecule(this.input, {
                pos: view.pos,
                halfside: view.halfside,
                turns: view.turns,
            });
        }
    }

    update(drawer: Drawer, mouse: Mouse, global_t: number) {
        const view = this.getMainView();

        const rect = canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(input.mouse.clientX - rect.left, input.mouse.clientY - rect.top);

        const asdf = drawer.getAtPosition(this.fnk, view, this.collapse, raw_mouse_pos);
        if (asdf !== null && input.mouse.wasPressed(MouseButton.Left)) {
            this.collapse = toggleCollapsed(this.collapse, asdf, global_t);
        }
    }

    private getMainView(): SexprView {
        const screen_size = new Vec2(canvas.width, canvas.height);
        const view = {
            pos: screen_size.mul(new Vec2(0.1, 0.175)),
            halfside: screen_size.y / 17,
            turns: 0,
            // turns: CONFIG._0_1,
        };
        return view;
    }
}

let cur_asdfasdf = Asdfasdf.init({
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
}, parseSexprLiteral('(1 2 X 3 4)'));

function nextAnim() {
    CONFIG._0_1 = 0;
    cur_asdfasdf = cur_asdfasdf.next();
}

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

    cur_asdfasdf.update(drawer, input.mouse, cur_timestamp_millis / 1000);
    cur_asdfasdf.draw(drawer, CONFIG._0_1, cur_timestamp_millis / 1000);

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
