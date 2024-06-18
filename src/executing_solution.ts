import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, fakeCollapsed, everythingCollapsedExceptFirsts, offsetView, getAtPosition, sexprAdressFromScreenPosition, getFnkNameView } from './drawer';
import { EditingSolution } from './editing_solution';
import { Mouse, MouseButton } from './kommon/input';
import { assertNotNull, last } from './kommon/kommon';
import { remap } from './kommon/math';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, validCaseAddress, SexprTemplate, getAtLocalAddress, SexprNullable } from './model';

type ExecutionResult = { type: 'success', result: SexprTemplate } | { type: 'failure', reason: string };

type ExecutionAnimationState =
    { type: 'input_moving_to_next_option', target: MatchCaseAddress }
    | { type: 'failing_to_match', which: MatchCaseAddress }
    | { type: 'matching', which: MatchCaseAddress }
    | { type: 'floating_bindings', bindings: FloatingBinding[], next_input_address: MatchCaseAddress }
    | { type: 'dissolve_bindings', bindings: FloatingBinding[], input_address: MatchCaseAddress }
    | { type: 'fading_out_to_child', return_address: MatchCaseAddress }
    | { type: 'fading_in_from_parent', source_address: MatchCaseAddress }
    | { type: 'fading_out_to_parent', parent_address: MatchCaseAddress, child_address: MatchCaseAddress }
    | { type: 'fading_in_from_child', return_address: MatchCaseAddress }
    | { type: 'waiting_for_child', return_address: MatchCaseAddress }
    | { type: 'breaking_to_tail_optimization' };

export class ExecutionState {
    private constructor(
        private parent: ExecutionState | null,
        private fnk: FunktionDefinition,
        private collapsed: Collapsed,
        private matched: MatchedInput[],
        private input: SexprLiteral,
        private animation: ExecutionAnimationState,
    ) { }

    static init(fnk: FunktionDefinition, input: SexprLiteral): ExecutionState {
        return new ExecutionState(
            null,
            fnk,
            fakeCollapsed(everythingCollapsedExceptFirsts(fnk.cases)),
            nothingMatched(fnk.cases),
            input,
            { type: 'input_moving_to_next_option', target: [0] },
            // { type: 'failing_to_match', which: [1, 0] },
            // { type: 'matching', which: [1] },
        );
    }

    private getViewOfMovingInput(view: SexprView, address: MatchCaseAddress, global_t: number = Infinity): SexprView {
        const chair_view = getView(view, {
            type: 'pattern',
            major: address,
            minor: [],
        }, this.collapsed, global_t);
        const unit = view.halfside / 4;
        return offsetView(chair_view, new Vec2(-11, 0));
    }

    // TODO: these parameters are a code smell
    next(all_fnks: FunktionDefinition[], main_view: SexprView, global_t: number): ExecutionState | ExecutionResult {
        switch (this.animation.type) {
            case 'input_moving_to_next_option': {
                const asdf = generateBindings(this.input, getAt(this.fnk.cases, { type: 'pattern', minor: [], major: this.animation.target })!);
                return this.withAnimation({ type: asdf === null ? 'failing_to_match' : 'matching', which: this.animation.target });
            }
            case 'failing_to_match': {
                const new_target = nextMatchCaseSibling(this.animation.which);
                if (!validCaseAddress(this.fnk, new_target)) {
                    return { type: 'failure', reason: 'Ran out of options!' };
                }
                let new_collapsed = structuredClone(this.collapsed);
                new_collapsed = fakeCollapsed(toggleCollapsed(new_collapsed.inside, this.animation.which, global_t));
                new_collapsed = fakeCollapsed(toggleCollapsed(new_collapsed.inside, nextMatchCaseSibling(this.animation.which), global_t));

                const next = this.withAnimation({ type: 'input_moving_to_next_option', target: new_target });
                next.collapsed = new_collapsed;
                return next;
            }
            case 'matching': {
                const bindings = generateFloatingBindings(this.input, this.fnk, this.animation.which, this.getActualMainView(main_view), this.collapsed);
                const new_matched = updateMatchedForNewPattern(this.matched, this.animation.which, getCaseAt(this.fnk, this.animation.which).pattern);
                const next_state = new ExecutionState(this.parent, this.fnk, this.collapsed, new_matched, this.input,
                    { type: 'floating_bindings', bindings: bindings, next_input_address: this.animation.which });
                if (bindings.length === 0) {
                    const asdf = next_state.next(all_fnks, main_view, global_t);
                    if (!(asdf instanceof ExecutionState)) return asdf;
                    return asdf.next(all_fnks, main_view, global_t);
                }
                else {
                    return next_state;
                }
            }
            case 'floating_bindings': {
                try {
                    const new_input = fillTemplate(
                        getCaseAt(this.fnk, this.animation.next_input_address).template,
                        this.animation.bindings);
                    const new_matched = updateMatchedForMissingTemplate(this.matched, this.animation.next_input_address);
                    const new_fnk = fillFnkBindings(this.fnk, this.animation.bindings);
                    return new ExecutionState(this.parent, new_fnk, this.collapsed, new_matched, new_input,
                        { type: 'dissolve_bindings', bindings: this.animation.bindings, input_address: this.animation.next_input_address });
                }
                catch {
                    return { type: 'failure', reason: 'Used an unbound variable!' };
                }
            }
            case 'dissolve_bindings': {
                const match_case = getCaseAt(this.fnk, this.animation.input_address);
                const fn_name = assertLiteral(match_case.fn_name_template);
                if (equalSexprs(fn_name, { type: 'atom', value: 'identity' })) {
                    if (match_case.next === 'return') {
                        if (this.parent === null) {
                            // OJO: unchecked
                            return { type: 'success', result: this.input };
                        }
                        else {
                            if (this.parent.animation.type !== 'waiting_for_child') throw new Error('unreachable');
                            return new ExecutionState(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapsed, this.matched, this.input,
                                { type: 'fading_out_to_parent', parent_address: this.parent.animation.return_address, child_address: this.animation.input_address });
                        }
                    }
                    else {
                        return this.withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.input_address, 0] });
                    }
                }
                else if (equalSexprs(fn_name, { type: 'atom', value: 'eqAtoms?' })) {
                    const result = builtIn_eqAtoms(this.input);
                    if (match_case.next === 'return') {
                        if (this.parent === null) {
                            // OJO: unchecked
                            return { type: 'success', result: this.input };
                        }
                        else {
                            if (this.parent.animation.type !== 'waiting_for_child') throw new Error('unreachable');
                            return new ExecutionState(this.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.animation.return_address }), this.fnk, this.collapsed, this.matched,
                                result, { type: 'fading_out_to_parent', parent_address: this.parent.animation.return_address, child_address: this.animation.input_address });
                        }
                    }
                    else {
                        return this
                            .withAnimation({ type: 'input_moving_to_next_option', target: [...this.animation.input_address, 0] })
                            .withInput(result);
                    }
                }
                else {
                    const input_address = this.animation.input_address;
                    const match_case = getCaseAt(this.fnk, input_address);
                    const fn_name = assertLiteral(match_case.fn_name_template);
                    const next_fnk = all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (next_fnk === undefined) {
                        return { type: 'failure', reason: `Can't find function of name: ${sexprToString(fn_name)}` };
                    }

                    if (match_case.next === 'return') {
                        return new ExecutionState(
                            this.withAnimation({ type: 'breaking_to_tail_optimization' }),
                            next_fnk, fakeCollapsed(everythingCollapsedExceptFirsts(next_fnk.cases)), nothingMatched(next_fnk.cases), this.input,
                            { type: 'fading_in_from_parent', source_address: input_address });
                    }
                    else {
                        return new ExecutionState(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }),
                            next_fnk, fakeCollapsed(everythingCollapsedExceptFirsts(next_fnk.cases)), nothingMatched(next_fnk.cases), this.input,
                            { type: 'fading_in_from_parent', source_address: input_address });
                    }
                }
            }
            case 'fading_out_to_child':
                throw new Error('unreachable');
            case 'fading_in_from_parent':
                if (this.parent === null || (this.parent.animation.type !== 'fading_out_to_child' && this.parent.animation.type !== 'breaking_to_tail_optimization')) throw new Error('unreachable');
                if (this.parent.animation.type === 'breaking_to_tail_optimization') {
                    return this.withAnimation({ type: 'input_moving_to_next_option', target: [0] })
                        .withParent(this.parent.parent);
                }
                else {
                    return this.withAnimation({ type: 'input_moving_to_next_option', target: [0] })
                        .withParent(this.parent.withAnimation({ type: 'waiting_for_child', return_address: this.parent.animation.return_address }));
                }
            case 'fading_out_to_parent': {
                if (this.parent === null) throw new Error('unreachable');
                return this.parent.withInput(this.input).next(all_fnks, main_view, global_t);
            }
            case 'fading_in_from_child': {
                const match_case = getCaseAt(this.fnk, this.animation.return_address);
                if (match_case.next === 'return') {
                    if (this.parent === null) {
                        // OJO: unchecked
                        return { type: 'success', result: this.input };
                    }
                    else {
                        if (this.parent.animation.type !== 'waiting_for_child') throw new Error('unreachable');
                        return this.withParent(
                            this.parent.withAnimation({
                                type: 'fading_in_from_child',
                                return_address: this.parent.animation.return_address,
                            }),
                        ).withAnimation({
                            type: 'fading_out_to_parent', parent_address: this.parent.animation.return_address,
                            child_address: this.animation.return_address,
                        });
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
        return new ExecutionState(this.parent, this.fnk, this.collapsed, this.matched, this.input, new_animation);
    }

    private withInput(new_input: SexprLiteral): ExecutionState {
        return new ExecutionState(this.parent, this.fnk, this.collapsed, this.matched, new_input, this.animation);
    }

    private withParent(new_parent: ExecutionState | null): ExecutionState {
        return new ExecutionState(new_parent, this.fnk, this.collapsed, this.matched, this.input, this.animation);
    }

    private getActualMainView(main_view: SexprView): SexprView {
        if (this.parent !== null) {
            main_view = this.parent.getActualMainView(main_view);
            if (this.parent.animation.type === 'fading_out_to_child'
                || this.parent.animation.type === 'waiting_for_child'
                || this.parent.animation.type === 'fading_in_from_child') {
                main_view = getView(main_view, {
                    major: this.parent.animation.return_address,
                    minor: [],
                    type: 'template',
                }, this.parent.collapsed);
                return main_view;
            }
            else if (this.parent.animation.type === 'breaking_to_tail_optimization') {
                return main_view;
            }
            else {
                throw new Error('unreachable');
            }
        }
        else {
            return main_view;
        }
    }

    draw(drawer: Drawer, anim_t: number, global_t: number, main_view: SexprView, mouse: Mouse) {
        const original_main_view = {
            pos: new Vec2(main_view.pos.x, main_view.pos.y), halfside: main_view.halfside, turns: main_view.turns,
        };
        main_view = this.getActualMainView(main_view);

        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        let hovered_value: SexprTemplate | null = null;

        if (this.parent !== null) {
            this.parent.draw(drawer, anim_t, global_t, original_main_view, mouse);
        }

        const view: SexprView = {
            pos: main_view.pos, halfside: main_view.halfside, turns: main_view.turns,
        };

        if (this.animation.type === 'fading_out_to_child') {
            // view.pos = view.pos.add(Vec2.both(anim_t * view.halfside));
            drawer.ctx.globalAlpha = remap(anim_t, 0, 1, 1, 0.1);
        }
        else if (this.animation.type === 'fading_in_from_child') {
            // view.pos = view.pos.add(Vec2.both((1 - anim_t) * view.halfside));
            drawer.ctx.globalAlpha = remap(anim_t, 0, 1, 0.1, 1);
        }
        else if (this.animation.type === 'waiting_for_child') {
            drawer.ctx.globalAlpha = 0.1;
        }
        else if (this.animation.type === 'breaking_to_tail_optimization') {
            view.pos = view.pos.add(Vec2.both(anim_t * view.halfside));
            drawer.ctx.globalAlpha = 0.1;
        }
        else if (this.animation.type === 'fading_in_from_parent') {
            if (this.parent === null) throw new Error('unreachable');
            // this.parent.draw(drawer, anim_t, global_t, original_main_view);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, (1 - anim_t) * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            if (this.parent === null) throw new Error('unreachable');
            // this.parent.draw(drawer, anim_t, global_t, original_main_view);
            drawer.ctx.globalAlpha = 1;

            view.pos = view.pos.add(new Vec2(0, anim_t * 18 * view.halfside));
            // drawer.ctx.globalAlpha = anim_t;
        }
        else {
            drawer.ctx.globalAlpha = 1;
        }

        drawer.drawFunktion(this.fnk, view, this.collapsed.inside, global_t, this.matched);
        {
            const maybe_address = getAtPosition(this.fnk, view, this.collapsed, raw_mouse_pos);
            if (maybe_address !== null) {
                hovered_value = getAt(this.fnk.cases, maybe_address);
            }
            const maybe_main_fnk_address = sexprAdressFromScreenPosition(raw_mouse_pos, this.fnk.name, getFnkNameView(view));
            if (maybe_main_fnk_address !== null) {
                hovered_value = getAtLocalAddress(this.fnk.name, maybe_main_fnk_address);
            }
        }

        if (this.animation.type === 'input_moving_to_next_option') {
            const source_view = (last(this.animation.target) === 0)
                ? getView(view, {
                    type: 'template',
                    major: this.animation.target.slice(0, -1),
                    minor: [],
                }, this.collapsed)
                : this.getViewOfMovingInput(view, [...this.animation.target.slice(0, -1), last(this.animation.target) - 1], global_t);
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, lerpSexprView(
                source_view,
                this.getViewOfMovingInput(view, this.animation.target, global_t),
                anim_t,
            ), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'failing_to_match') {
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, lerpSexprView(
                this.getViewOfMovingInput(view, this.animation.which),
                getView(view, { type: 'pattern', major: this.animation.which, minor: [] }, this.collapsed),
                (anim_t - 1) * (anim_t - 0) * -4,
            ), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'matching') {
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, lerpSexprView(
                this.getViewOfMovingInput(view, this.animation.which),
                getView(view, { type: 'pattern', major: this.animation.which, minor: [] }, this.collapsed),
                anim_t,
            ), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'floating_bindings') {
            drawer.drawBindingsNew(main_view, this.animation.bindings, anim_t, this.collapsed);
        }
        else if (this.animation.type === 'dissolve_bindings') {
            this.animation.bindings.forEach((binding) => {
                const base_view = getView(view, binding.target_address, this.collapsed);
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
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, getView(view, { type: 'template', major: this.animation.input_address, minor: [] }, this.collapsed), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'fading_out_to_child') {
            // nothing
        }
        else if (this.animation.type === 'fading_in_from_child') {
            // nothing
        }
        else if (this.animation.type === 'fading_in_from_parent') {
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, lerpSexprView(
                getView(this.parent!.getActualMainView(original_main_view), { type: 'template', major: this.animation.source_address, minor: [] }, assertNotNull(this.parent).collapsed),
                getView(view, { type: 'template', major: [], minor: [] }, this.collapsed),
                anim_t,
            ), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'fading_out_to_parent') {
            hovered_value = drawer.drawMoleculeAndReturnThingUnderMouse(this.input, lerpSexprView(
                getView(main_view, { type: 'template', major: this.animation.child_address, minor: [] }, this.collapsed),
                getView(this.parent!.getActualMainView(original_main_view), { type: 'template', major: this.animation.parent_address, minor: [] }, assertNotNull(this.parent).collapsed),
                anim_t,
            ), raw_mouse_pos)?.value ?? hovered_value;
        }
        else if (this.animation.type === 'waiting_for_child') {
            // nothing
        }
        else if (this.animation.type === 'breaking_to_tail_optimization') {
            // nothing
        }
        else {
            throw new Error('unimplemented');
        }

        // print atom names
        if (hovered_value !== null) {
            drawer.ctx.fillStyle = 'black';
            const screen_size = drawer.getScreenSize();
            drawer.ctx.font = `bold ${Math.floor(screen_size.y / 30)}px sans-serif`;
            drawer.ctx.textAlign = 'center';
            drawer.ctx.fillText(sexprToString(hovered_value, '@'), screen_size.x * 0.5, screen_size.y * 0.95);
        }
    }
}

export class ExecutingSolution {
    cur_execution_state: ExecutionState;
    anim_t: number;
    public speed: number = 1;
    constructor(
        private all_fnks: FunktionDefinition[],
        original_fnk: FunktionDefinition,
        original_input: SexprLiteral,
        private original_editing: EditingSolution,
    ) {
        this.cur_execution_state = ExecutionState.init(original_fnk, original_input);
        this.anim_t = 0;
    }

    // TODO: drawer as a parameter is a code smell
    update(delta_time: number, drawer: Drawer, view_offset: Vec2, global_t: number): AfterExecutingSolution | null {
        const view = this.getMainView(drawer.getScreenSize(), view_offset);

        this.anim_t += delta_time * this.speed;
        while (this.anim_t >= 1) {
            this.anim_t -= 1;
            const next_state = this.cur_execution_state.next(this.all_fnks, view, global_t);
            if (next_state instanceof ExecutionState) {
                this.cur_execution_state = next_state;
            }
            else {
                return new AfterExecutingSolution(this.original_editing, next_state);
            }
        }
        return null;
    }

    // TODO: drawer as a parameter is a code smell
    skip(drawer: Drawer, view_offset: Vec2, global_t: number): AfterExecutingSolution {
        const view = this.getMainView(drawer.getScreenSize(), view_offset);

        let next_state = this.cur_execution_state.next(this.all_fnks, view, global_t);
        while (next_state instanceof ExecutionState) {
            next_state = next_state.next(this.all_fnks, view, global_t);
        }

        return new AfterExecutingSolution(this.original_editing, next_state);
    }

    draw(drawer: Drawer, view_offset: Vec2, global_t: number, mouse: Mouse) {
        const view = this.getMainView(drawer.getScreenSize(), view_offset);
        this.cur_execution_state.draw(drawer, this.anim_t, global_t, view, mouse);
    }

    private getMainView(screen_size: Vec2, view_offset: Vec2): SexprView {
        const view = {
            pos: screen_size.mul(new Vec2(0.1, 0.175)).add(view_offset),
            halfside: screen_size.y / 17,
            turns: 0,
            // turns: CONFIG._0_1,
        };
        return view;
    }
}

function builtIn_eqAtoms(input: SexprLiteral): SexprLiteral {
    const falseAtom: SexprLiteral = { type: 'atom', value: 'false' };
    const trueAtom: SexprLiteral = { type: 'atom', value: 'true' };
    if (input.type === 'atom') return falseAtom;
    if (input.left.type !== 'atom' || input.right.type !== 'atom') return falseAtom;
    return (input.left.value === input.right.value) ? trueAtom : falseAtom;
}

function nextMatchCaseSibling(thing: MatchCaseAddress): MatchCaseAddress {
    return [...thing.slice(0, -1), thing[thing.length - 1] + 1];
}

export class AfterExecutingSolution {
    constructor(
        public original_editing: EditingSolution,
        // TODO: baaaad
        public result: ExecutionResult,
    ) { }

    draw(drawer: Drawer) {
        drawer.ctx.fillStyle = 'black';
        const screen_size = drawer.getScreenSize();
        drawer.ctx.font = `bold ${Math.floor(screen_size.y / 15)}px sans-serif`;
        drawer.ctx.textAlign = 'center';
        if (this.result.type === 'success') {
            drawer.ctx.fillText('Got this result:', screen_size.x * 0.5, screen_size.y * 0.3);
            drawer.drawMolecule(this.result.result, this.getMainView(drawer.getScreenSize()));
        }
        else {
            drawer.ctx.fillText('Error during execution!', screen_size.x * 0.5, screen_size.y * 0.4);
            drawer.ctx.fillText(this.result.reason, screen_size.x * 0.5, screen_size.y * 0.6);
        }
    }

    private getMainView(screen_size: Vec2): SexprView {
        const view = {
            pos: screen_size.mul(new Vec2(0.4, 0.6)),
            halfside: screen_size.y / 5,
            turns: 0,
        };
        return view;
    }
}
