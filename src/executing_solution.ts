import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed } from './drawer';
import { Mouse, MouseButton } from './kommon/input';
import { assertNotNull, last } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString } from './model';

type ExecutionAnimationState =
    { type: 'input_moving_to_next_option', target: MatchCaseAddress }
    | { type: 'failing_to_match', which: MatchCaseAddress }
    | { type: 'matching', which: MatchCaseAddress }
    | { type: 'floating_bindings', bindings: FloatingBinding[], next_input_address: MatchCaseAddress }
    | { type: 'dissolve_bindings', bindings: FloatingBinding[], input_address: MatchCaseAddress }
    | { type: 'fading_out_to_child', return_address: MatchCaseAddress }
    | { type: 'fading_in_from_parent', source_address: MatchCaseAddress }
    | { type: 'fading_out_to_parent', parent_address: MatchCaseAddress, child_address: MatchCaseAddress }
    | { type: 'fading_in_from_child', return_address: MatchCaseAddress };

class ExecutionState {
    private constructor(
        private parent: ExecutionState | null,
        private fnk: FunktionDefinition,
        private collapse: Collapsed[],
        private matched: MatchedInput[],
        private input: SexprLiteral,
        private animation: ExecutionAnimationState,
    ) { }

    static init(fnk: FunktionDefinition, input: SexprLiteral): ExecutionState {
        return new ExecutionState(
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

    // TODO: these parameters are a code smell
    next(all_fnks: FunktionDefinition[], main_view: SexprView): ExecutionState | null {
        switch (this.animation.type) {
            case 'input_moving_to_next_option': {
                const asdf = generateBindings(this.input, getAt(this.fnk.cases, { type: 'pattern', minor: [], major: this.animation.target })!);
                return this.withAnimation({ type: asdf === null ? 'failing_to_match' : 'matching', which: this.animation.target });
            }
            case 'failing_to_match': {
                return this.withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.which.slice(0, -1), this.animation.which[this.animation.which.length - 1] + 1] });
            }
            case 'matching': {
                const bindings = generateFloatingBindings(this.input, this.fnk, this.animation.which, main_view);
                const new_matched = updateMatchedForNewPattern(this.matched, this.animation.which, getCaseAt(this.fnk, this.animation.which).pattern);
                return new ExecutionState(this.parent, this.fnk, this.collapse, new_matched, this.input,
                    { type: 'floating_bindings', bindings: bindings, next_input_address: this.animation.which });
            }
            case 'floating_bindings': {
                const new_input = fillTemplate(
                    getCaseAt(this.fnk, this.animation.next_input_address).template,
                    this.animation.bindings);
                const new_matched = updateMatchedForMissingTemplate(this.matched, this.animation.next_input_address);
                const new_fnk = fillFnkBindings(this.fnk, this.animation.bindings);
                return new ExecutionState(this.parent, new_fnk, this.collapse, new_matched, new_input,
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
                            return new ExecutionState(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapse, this.matched, this.input,
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
                        minor: [],
                    })));
                    const next_fnk = all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (next_fnk === undefined) {
                        // TODO: how to handle this user error?
                        throw new Error(`can't find function of name ${sexprToString(fn_name)}`);
                    }
                    return new ExecutionState(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }),
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
                return this.parent.withInput(this.input).next(all_fnks, main_view);
            }
            case 'fading_in_from_child': {
                const match_case = getCaseAt(this.fnk, this.animation.return_address);
                if (match_case.next === 'return') {
                    if (this.parent === null) {
                        return null;
                    }
                    else {
                        if (this.parent.animation.type !== 'fading_out_to_child') throw new Error('unreachable');
                        return new ExecutionState(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapse, this.matched, this.input,
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

    private withAnimation(new_animation: ExecutionAnimationState): ExecutionState {
        return new ExecutionState(this.parent, this.fnk, this.collapse, this.matched, this.input, new_animation);
    }

    private withInput(new_input: SexprLiteral): ExecutionState {
        return new ExecutionState(this.parent, this.fnk, this.collapse, this.matched, new_input, this.animation);
    }

    draw(drawer: Drawer, anim_t: number, global_t: number, main_view: SexprView) {
        const view: SexprView = {
            pos: main_view.pos, halfside: main_view.halfside, turns: main_view.turns,
        };

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
            this.parent.draw(drawer, anim_t, global_t, main_view);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, (1 - anim_t) * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            if (this.parent === null) throw new Error('unreachable');
            this.parent.draw(drawer, anim_t, global_t, main_view);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, anim_t * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else {
            drawer.ctx.globalAlpha = 1;
        }

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
            drawer.drawBindings(main_view, this.animation.bindings, anim_t);
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
                getView(main_view, { type: 'template', major: this.animation.source_address, minor: [] }),
                getView(view, { type: 'template', major: [], minor: [] }),
                anim_t,
            ));
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            drawer.drawMolecule(this.input, lerpSexprView(
                getView(main_view, { type: 'template', major: this.animation.child_address, minor: [] }),
                getView(main_view, { type: 'template', major: this.animation.parent_address, minor: [] }),
                anim_t,
            ));
        }
        else {
            throw new Error('unimplemented');
        }
    }
}

export class ExecutingSolution {
    cur_execution_state: ExecutionState;
    anim_t: number;
    constructor(
        private all_fnks: FunktionDefinition[],
        fnk: FunktionDefinition,
        input: SexprLiteral,
    ) {
        this.cur_execution_state = ExecutionState.init(fnk, input);
        this.anim_t = 0;
    }

    // TODO: drawer as a parameter is a code smell
    update(delta_time: number, drawer: Drawer) {
        const view = this.getMainView(drawer.getScreenSize());

        // TODO: handle the end of execution
        this.anim_t += delta_time;
        while (this.anim_t >= 1) {
            this.anim_t -= 1;
            this.cur_execution_state = this.cur_execution_state.next(this.all_fnks, view) ?? this.cur_execution_state;
        }
    }

    draw(drawer: Drawer) {
        const view = this.getMainView(drawer.getScreenSize());
        this.cur_execution_state.draw(drawer, this.anim_t, Infinity, view);
    }

    private getMainView(screen_size: Vec2): SexprView {
        const view = {
            pos: screen_size.mul(new Vec2(0.1, 0.175)),
            halfside: screen_size.y / 17,
            turns: 0,
            // turns: CONFIG._0_1,
        };
        return view;
    }
}
