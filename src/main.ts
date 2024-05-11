import * as twgl from 'twgl.js';
import GUI from 'lil-gui';
import { Input, KeyCode, Mouse, MouseButton } from './kommon/input';
import { DefaultMap, assertNotNull, fromCount, fromRange, last, objectMap, repeat, reversedForEach, zip2 } from './kommon/kommon';
import { mod, towards, lerp, inRange, clamp, argmax, argmin, max, remap, clamp01, randomInt, randomFloat, randomChoice, doSegmentsIntersect, closestPointOnSegment, roundTo } from './kommon/math';
import { initGL2, Vec2, Color, GenericDrawer, StatefulDrawer, CircleDrawer, m3, CustomSpriteDrawer, Transform, IRect, IColor, IVec2, FullscreenShader } from 'kanvas2d';
import { FunktionDefinition, MatchCaseAddress, SexprLiteral, SexprTemplate, assertLiteral, equalSexprs, fillFnkBindings, fillTemplate, generateBindings, getAt, getCaseAt, parseSexprLiteral, parseSexprTemplate, sexprToString } from './model';
import { Collapsed, Drawer, FloatingBinding, MatchedInput, SexprView, generateFloatingBindings, getView, lerpSexprView, nothingCollapsed, nothingMatched, toggleCollapsed, updateMatchedForMissingTemplate, updateMatchedForNewPattern } from './drawer';

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

type AsdfasdfAnimationState =
    { type: 'input_moving_to_next_option', target: MatchCaseAddress }
    | { type: 'failing_to_match', which: MatchCaseAddress }
    | { type: 'matching', which: MatchCaseAddress }
    | { type: 'floating_bindings', bindings: FloatingBinding[], next_input_address: MatchCaseAddress }
    | { type: 'dissolve_bindings', bindings: FloatingBinding[], input_address: MatchCaseAddress }
    | { type: 'fading_out_to_child', return_address: MatchCaseAddress }
    | { type: 'fading_in_from_parent', source_address: MatchCaseAddress }
    | { type: 'fading_out_to_parent', parent_address: MatchCaseAddress, child_address: MatchCaseAddress }
    | { type: 'fading_in_from_child', return_address: MatchCaseAddress };
class Asdfasdf {
    private constructor(
        private parent: Asdfasdf | null,
        private fnk: FunktionDefinition,
        private collapse: Collapsed[],
        private matched: MatchedInput[],
        private input: SexprLiteral,
        private animation: AsdfasdfAnimationState,
    ) { }

    static init(fnk: FunktionDefinition, input: SexprLiteral): Asdfasdf {
        return new Asdfasdf(
            null,
            fnk,
            nothingCollapsed(fnk.cases),
            nothingMatched(fnk.cases),
            input,
            { type: 'input_moving_to_next_option', target: [0] },
            // { type: 'failing_to_match', which: [1, 0] },
            // { type: 'matching', which: [1] },
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
            pos: chair_view.pos.add(new Vec2(-unit * 11, 0).rotateTurns(chair_view.turns)),
            halfside: chair_view.halfside, turns: chair_view.turns,
        };
    }

    next(): Asdfasdf | null {
        switch (this.animation.type) {
            case 'input_moving_to_next_option': {
                const asdf = generateBindings(this.input, getAt(this.fnk.cases, { type: 'pattern', minor: [], major: this.animation.target })!);
                return this.withAnimation({ type: asdf === null ? 'failing_to_match' : 'matching', which: this.animation.target });
            }
            case 'failing_to_match': {
                return this.withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.which.slice(0, -1), this.animation.which[this.animation.which.length - 1] + 1] });
            }
            case 'matching': {
                const bindings = generateFloatingBindings(this.input, this.fnk, this.animation.which, this.getMainView());
                const new_matched = updateMatchedForNewPattern(this.matched, this.animation.which, getCaseAt(this.fnk, this.animation.which).pattern);
                return new Asdfasdf(this.parent, this.fnk, this.collapse, new_matched, this.input,
                    { type: 'floating_bindings', bindings: bindings, next_input_address: this.animation.which });
            }
            case 'floating_bindings': {
                const new_input = fillTemplate(
                    getCaseAt(this.fnk, this.animation.next_input_address).template,
                    this.animation.bindings);
                const new_matched = updateMatchedForMissingTemplate(this.matched, this.animation.next_input_address);
                const new_fnk = fillFnkBindings(this.fnk, this.animation.bindings);
                return new Asdfasdf(this.parent, new_fnk, this.collapse, new_matched, new_input,
                    { type: 'dissolve_bindings', bindings: this.animation.bindings, input_address: this.animation.next_input_address });
            }
            case 'dissolve_bindings': {
                const match_case = getCaseAt(this.fnk, this.animation.input_address);
                const fn_name = assertLiteral(match_case.fn_name_template);
                if (equalSexprs(fn_name, { type: 'atom', value: 'identity' })) {
                    if (match_case.next === 'return') {
                        if (this.parent === null) {
                            return null;
                        }
                        else {
                            if (this.parent.animation.type !== 'fading_out_to_child') throw new Error('unreachable');
                            return new Asdfasdf(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapse, this.matched, this.input,
                                { type: 'fading_out_to_parent', parent_address: this.parent.animation.return_address, child_address: this.animation.input_address });
                        }
                    }
                    else {
                        return this.withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.input_address, 0] });
                    }
                }
                else {
                    const input_address = this.animation.input_address;
                    const fn_name = assertLiteral(assertNotNull(getAt(this.fnk.cases, {
                        type: 'fn_name',
                        major: input_address,
                        minor: []
                    })));
                    const next_fnk = all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (next_fnk === undefined) {
                        // TODO: how to handle this user error?
                        throw new Error(`can't find function of name ${sexprToString(fn_name)}`);
                    }
                    return new Asdfasdf(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }),
                        next_fnk, nothingCollapsed(next_fnk.cases), nothingMatched(next_fnk.cases), this.input,
                        { type: 'fading_in_from_parent', source_address: input_address });
                }
            }
            case 'fading_out_to_child':
                throw new Error('unreachable');
            case 'fading_in_from_parent':
                return this.withAnimation({ type: 'input_moving_to_next_option', target: [0] });
            case 'fading_out_to_parent': {
                if (this.parent === null) throw new Error('unreachable');
                return this.parent.next();
            }
            case 'fading_in_from_child': {
                const match_case = getCaseAt(this.fnk, this.animation.return_address);
                if (match_case.next === 'return') {
                    if (this.parent === null) {
                        return null;
                    }
                    else {
                        if (this.parent.animation.type !== 'fading_out_to_child') throw new Error('unreachable');
                        return new Asdfasdf(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapse, this.matched, this.input,
                            { type: 'fading_out_to_parent', parent_address: this.parent.animation.return_address, child_address: this.animation.return_address });
                    }
                }
                else {
                    return this.withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.return_address, 0] });
                }
            }
            default:
                throw new Error('unhandled');
        }
    }

    withAnimation(new_animation: AsdfasdfAnimationState): Asdfasdf | null {
        return new Asdfasdf(this.parent, this.fnk, this.collapse, this.matched, this.input, new_animation);
    }

    draw(drawer: Drawer, anim_t: number, global_t: number) {
        const view = this.getMainView();

        if (this.animation.type === 'fading_out_to_child') {
            view.pos = view.pos.add(Vec2.both(anim_t * view.halfside));
            drawer.ctx.globalAlpha = 1 - anim_t;
        }
        else if (this.animation.type === 'fading_in_from_child') {
            view.pos = view.pos.add(Vec2.both((1 - anim_t) * view.halfside));
            drawer.ctx.globalAlpha = anim_t;
        }
        else if (this.animation.type === 'fading_in_from_parent') {
            if (this.parent === null) throw new Error('unreachable');
            this.parent.draw(drawer, anim_t, global_t);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, (1 - anim_t) * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            if (this.parent === null) throw new Error('unreachable');
            this.parent.draw(drawer, anim_t, global_t);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, anim_t * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else {
            drawer.ctx.globalAlpha = 1;
        }
        // if (is_child) {
        //     view.pos = view.pos.add(Vec2.both(view.halfside));
        //     drawer.ctx.globalAlpha = .2;
        // } else {
        //     if (this.parent !== null) {
        //         this.parent.draw(drawer, 1, global_t, true);
        //     }
        //     drawer.ctx.globalAlpha = 1;
        // }

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
            drawer.drawMolecule(this.input, lerpSexprView(
                this.getViewOfMovingInput(view, this.animation.which),
                getView(view, { type: 'pattern', major: this.animation.which, minor: [] }),
                (anim_t - 1) * (anim_t - 0) * -4,
            ));
        }
        else if (this.animation.type === 'matching') {
            drawer.drawMolecule(this.input, lerpSexprView(
                this.getViewOfMovingInput(view, this.animation.which),
                getView(view, { type: 'pattern', major: this.animation.which, minor: [] }),
                anim_t,
            ));
        }
        else if (this.animation.type === 'floating_bindings') {
            drawer.drawBindings(this.getMainView(), this.animation.bindings, anim_t);
        }
        else if (this.animation.type === 'dissolve_bindings') {
            this.animation.bindings.forEach((binding) => {
                const base_view = getView(view, binding.target_address);
                drawer.drawPattern({ type: 'variable', value: binding.variable_name }, {
                    pos: base_view.pos, turns: base_view.turns,
                    halfside: base_view.halfside * (1 - anim_t),
                });
                // draw twice to match the opacity
                drawer.drawPattern({ type: 'variable', value: binding.variable_name }, {
                    pos: base_view.pos, turns: base_view.turns,
                    halfside: base_view.halfside * (1 - anim_t),
                });
            });
            drawer.drawMolecule(this.input, getView(view, { type: 'template', major: this.animation.input_address, minor: [] }));
        }
        else if (this.animation.type === 'fading_out_to_child') {
            // nothing
        }
        else if (this.animation.type === 'fading_in_from_child') {
            // nothing
        }
        else if (this.animation.type === 'fading_in_from_parent') {
            //  view = ;
            drawer.drawMolecule(this.input, lerpSexprView(
                getView(this.getMainView(), { type: 'template', major: this.animation.source_address, minor: [] }),
                getView(view, { type: 'template', major: [], minor: [] }),
                anim_t,
            ));
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            drawer.drawMolecule(this.input, lerpSexprView(
                getView(this.getMainView(), { type: 'template', major: this.animation.child_address, minor: [] }),
                getView(this.getMainView(), { type: 'template', major: this.animation.parent_address, minor: [] }),
                anim_t,
            ));
        }
        else {
            throw new Error('unimplemented');
        }
    }

    update(drawer: Drawer, mouse: Mouse, global_t: number) {
        const view = this.getMainView();

        const rect = canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const asdf = drawer.getAtPosition(this.fnk, view, this.collapse, raw_mouse_pos);
        if (asdf !== null && mouse.wasPressed(MouseButton.Left)) {
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

let all_fnks = [asdfTest, bubbleUpFnk];

let cur_asdfasdf = Asdfasdf.init(asdfTest,
    // let cur_asdfasdf = Asdfasdf.init(bubbleUpFnk,
    parseSexprLiteral('(v1 v2 X v3 v1)'));
// parseSexprLiteral('(X 3 4)'));

function nextAnim() {
    CONFIG._0_1 = 0;
    cur_asdfasdf = cur_asdfasdf.next() ?? cur_asdfasdf;
}

let paused = true;
let anim_t = 0;

// cur_matched[1].main = { type: 'pair', left: { type: 'null' }, right: { type: 'null' } };
// let cur_bindings: FloatingBinding[] | null = null;

let last_timestamp_millis = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp_millis: number) {
    const delta_time = (cur_timestamp_millis - last_timestamp_millis) / 1000;
    last_timestamp_millis = cur_timestamp_millis;
    input.startFrame();
    twgl.resizeCanvasToDisplaySize(canvas);

    if (input.keyboard.wasPressed(KeyCode.Space)) {
        paused = !paused;
    }

    if (!paused) {
        anim_t = CONFIG._0_1;
        anim_t += delta_time;
        while (anim_t >= 1) {
            anim_t -= 1;
            cur_asdfasdf = cur_asdfasdf.next() ?? cur_asdfasdf;
        }
        CONFIG._0_1 = anim_t;
    }

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
