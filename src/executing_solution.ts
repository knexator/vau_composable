import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, fakeCollapsed, everythingCollapsedExceptFirsts, offsetView, getAtPosition, sexprAdressFromScreenPosition, getFnkNameView, rotateAndScaleView, getSexprGrandChildView } from './drawer';
import { EditingSolution } from './editing_solution';
import { Mouse, MouseButton } from './kommon/input';
import { assertNotNull, enumerate, eqArrays, last, subdivideT, zip2 } from './kommon/kommon';
import { lerp, remap } from './kommon/math';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, validCaseAddress, SexprTemplate, getAtLocalAddress, SexprNullable, getCasesAfter, MatchCaseDefinition, builtIn_eqAtoms, applyFunktion, allVariableNames } from './model';

type ExecutionResult = { type: 'success', result: SexprTemplate } | { type: 'failure', reason: string };

type ExecutionAnimationState =
    { type: 'input_moving_to_next_option', target: MatchCaseAddress }
    | { type: 'failing_to_match', which: MatchCaseAddress }
    | { type: 'matching', which: MatchCaseAddress }
    | { type: 'floating_bindings', bindings: FloatingBinding[], next_input_address: MatchCaseAddress }
    | { type: 'dissolve_bindings', bindings: FloatingBinding[], input_address: MatchCaseAddress }
    | { type: 'fading_out_to_child', return_address: MatchCaseAddress }
    | { type: 'fading_in_from_parent', source_address: MatchCaseAddress }
    | { type: 'skipping_computation', source_address: MatchCaseAddress, old_input: SexprLiteral } // fading in and also skipping computation
    | { type: 'fading_out_to_parent', parent_address: MatchCaseAddress, child_address: MatchCaseAddress }
    | { type: 'fading_in_from_child', return_address: MatchCaseAddress }
    | { type: 'waiting_for_child', return_address: MatchCaseAddress }
    | { type: 'breaking_to_tail_optimization' };

export class ExecutionState {
    constructor(
        public parent: ExecutionState | null,
        private fnk: FunktionDefinition,
        private collapsed: Collapsed,
        private matched: MatchedInput[],
        private input: SexprLiteral,
        private animation: ExecutionAnimationState,
        // public original_fnk: FunktionDefinition = structuredClone(fnk),
        public original_fnk: FunktionDefinition,
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
            structuredClone(fnk),
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
                    { type: 'floating_bindings', bindings: bindings, next_input_address: this.animation.which }, this.original_fnk);
                if (bindings.length === 0) {
                    return next_state.next(all_fnks, main_view, global_t);
                    // const asdf = next_state.next(all_fnks, main_view, global_t);
                    // if (!(asdf instanceof ExecutionState)) return asdf;
                    // return asdf.next(all_fnks, main_view, global_t);
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
                        { type: 'dissolve_bindings', bindings: this.animation.bindings, input_address: this.animation.next_input_address }, this.original_fnk)
                        .next(all_fnks, main_view, global_t);
                }
                catch {
                    return { type: 'failure', reason: 'Used an unbound variable!' };
                }
            }
            case 'skipping_computation': {
                if (this.parent === null || (this.parent.animation.type !== 'fading_out_to_child' && this.parent.animation.type !== 'breaking_to_tail_optimization')) throw new Error('unreachable');

                // TODO: fix this
                if (this.parent.animation.type === 'breaking_to_tail_optimization') {
                    if (this.parent.parent === null) {
                        return { type: 'success', result: this.input };
                    }
                    if (this.parent.parent.animation.type !== 'waiting_for_child') throw new Error('unreachable');
                    return this
                        .withAnimation({
                            type: 'fading_out_to_parent',
                            parent_address: this.parent.parent.animation.return_address,
                            child_address: this.animation.source_address,
                        })
                        .withParent(this.parent.parent.withAnimation({ type: 'fading_in_from_child', return_address: this.parent.parent.animation.return_address }));
                }
                else {
                    if (this.parent.animation.type !== 'fading_out_to_child') throw new Error('unreachable');

                    return this
                        .withAnimation({
                            type: 'fading_out_to_parent',
                            parent_address: this.parent.animation.return_address,
                            child_address: this.animation.source_address,
                        })
                        .withParent(this.parent.withAnimation({
                            type: 'fading_in_from_child',
                            return_address: this.parent.animation.return_address,
                        }));
                }
            }
            case 'dissolve_bindings': {
                const input_address = this.animation.input_address;
                const match_case = getCaseAt(this.fnk, input_address);
                const fn_name = assertLiteral(match_case.fn_name_template);
                const skipped_fn_result: SexprLiteral | null = equalSexprs(fn_name, { type: 'atom', value: 'identity' })
                    ? this.input
                    : equalSexprs(fn_name, { type: 'atom', value: 'eqAtoms?' })
                        ? builtIn_eqAtoms(this.input)
                        : null;
                if (skipped_fn_result !== null) {
                    if (match_case.next === 'return') {
                        return this
                            .withParent(this.withAnimation({ type: 'breaking_to_tail_optimization' }))
                            .withAnimation({ type: 'skipping_computation', source_address: input_address, old_input: this.input })
                            .withInput(skipped_fn_result)
                            .withFakeFnk(fn_name);
                    }
                    else {
                        return this
                            .withParent(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }))
                            .withAnimation({ type: 'skipping_computation', source_address: input_address, old_input: this.input })
                            .withInput(skipped_fn_result)
                            .withFakeFnk(fn_name);
                    }
                }
                else {
                    const next_fnk = all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (next_fnk === undefined) {
                        return { type: 'failure', reason: `Can't find function of name: ${sexprToString(fn_name)}` };
                    }

                    if (match_case.next === 'return') {
                        return new ExecutionState(
                            this.withAnimation({ type: 'breaking_to_tail_optimization' }),
                            next_fnk, fakeCollapsed(everythingCollapsedExceptFirsts(next_fnk.cases)), nothingMatched(next_fnk.cases), this.input,
                            { type: 'fading_in_from_parent', source_address: input_address }, structuredClone(next_fnk));
                    }
                    else {
                        return new ExecutionState(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }),
                            next_fnk, fakeCollapsed(everythingCollapsedExceptFirsts(next_fnk.cases)), nothingMatched(next_fnk.cases), this.input,
                            { type: 'fading_in_from_parent', source_address: input_address }, structuredClone(next_fnk));
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
                throw new Error(`unhandled: ${this.animation.type}`);
        }
    }

    private withFakeFnk(fn_name: SexprLiteral): ExecutionState | ExecutionResult {
        return new ExecutionState(this.parent, { name: fn_name, cases: [] }, this.collapsed, this.matched, this.input, this.animation, { name: fn_name, cases: [] });
    }

    private withAnimation(new_animation: ExecutionAnimationState): ExecutionState {
        return new ExecutionState(this.parent, this.fnk, this.collapsed, this.matched, this.input, new_animation, this.original_fnk);
    }

    private withInput(new_input: SexprLiteral): ExecutionState {
        return new ExecutionState(this.parent, this.fnk, this.collapsed, this.matched, new_input, this.animation, this.original_fnk);
    }

    private withParent(new_parent: ExecutionState | null): ExecutionState {
        return new ExecutionState(new_parent, this.fnk, this.collapsed, this.matched, this.input, this.animation, this.original_fnk);
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

    draw(drawer: Drawer, anim_t: number, global_t: number, main_view: SexprView, mouse: Mouse | null) {
        // console.log(this.animation.type);
        main_view = offsetView(main_view, new Vec2(24, 0));
        // drawer.drawFunktion(this.fnk, main_view, this.collapsed.inside, global_t, this.matched);
        switch (this.animation.type) {
            case 'input_moving_to_next_option': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawMoleculePlease(this.input, main_view);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));
                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);
                const next = getCasesAfter(this.fnk, this.animation.target);
                const next_original = getCasesAfter(this.original_fnk, this.animation.target);
                for (const [k, [v, v_original]] of enumerate(zip2(next, next_original))) {
                    drawCase(drawer, [v, v_original], offsetView(main_view,
                        k === 0
                            ? new Vec2(4, 12 * (1 - anim_t))
                            : new Vec2(4, 12 + 18 * (k - anim_t))));

                    if (k === 0) {
                        drawer.line(main_view, [
                            new Vec2(-5, 0),
                            new Vec2(-5, 16 - 12 * anim_t),
                            new Vec2(16, 16 - 12 * anim_t),
                        ]);
                    }
                    else {
                        drawer.line(main_view, [
                            new Vec2(-5, -2 + (k - anim_t) * 18),
                            new Vec2(-5, -2 + (k - anim_t + 1) * 18),
                            new Vec2(16, -2 + (k - anim_t + 1) * 18),
                        ]);
                    }
                };
                break;
            }
            case 'failing_to_match': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawMoleculePlease(this.input, main_view);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));
                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(-2, 0),
                ]);
                const next = getCasesAfter(this.fnk, this.animation.which);
                const next_original = getCasesAfter(this.original_fnk, this.animation.which);
                for (const [k, [v, v_original]] of enumerate(zip2(next, next_original))) {
                    if (k === 0) {
                        drawCase(drawer, [v, v_original], offsetView(main_view,
                            subdivideT(anim_t, [
                                [0, 0.5, t => new Vec2(4 - t * 4, 0)],
                                [0.5, 1, t => new Vec2(0, -t * 12)],
                            ]),
                        ));
                    }
                    else {
                        drawCase(drawer, [v, v_original], offsetView(main_view, new Vec2(4, 12 + 18 * (k - 1))));
                    }

                    if (k === 0) {
                        drawer.line(main_view, [
                            new Vec2(-5, 0),
                            new Vec2(-5, 16 - 12),
                            new Vec2(16 - anim_t * 8, 16 - 12),
                        ]);
                    }
                    else if (k === 1) {
                        drawer.line(main_view, [
                            new Vec2(-5, -2 + 6),
                            new Vec2(-5, -2 + 18),
                            new Vec2(16, -2 + 18),
                        ]);
                    }
                    else {
                        drawer.line(main_view, [
                            new Vec2(-5, -2 + (k - 1) * 18),
                            new Vec2(-5, -2 + (k - 1 + 1) * 18),
                            new Vec2(16, -2 + (k - 1 + 1) * 18),
                        ]);
                    }
                };
                break;
            }
            case 'matching': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawMoleculePlease(this.input, main_view);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));
                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);

                drawer.line(main_view, [
                    new Vec2(-5, 0),
                    new Vec2(-5, 4),
                    new Vec2(12, 4),
                ]);
                const next = getCasesAfter(this.fnk, this.animation.which);
                const next_original = getCasesAfter(this.original_fnk, this.animation.which);
                for (const [k, [v, v_original]] of enumerate(zip2(next, next_original))) {
                    if (k === 0) {
                        drawCase(drawer, [v, v_original], offsetView(main_view, new Vec2(4 - anim_t * 4, 0)));
                        if (v.next !== 'return') {
                            if (v_original.next === 'return') throw new Error('unreachable');
                            for (const [j, [asdf, asdf_original]] of enumerate(zip2(v.next, v_original.next))) {
                                const aaa = offsetView(main_view, new Vec2(16 - anim_t * 4, 12 + 18 * j));
                                drawCase(drawer, [asdf, asdf_original], aaa);
                                drawer.ctx.beginPath();
                                drawer.ctx.strokeStyle = 'black';
                                drawer.moveTo(offsetView(aaa, new Vec2(3, j === 0 ? -12 : -14)).pos);
                                drawer.lineTo(offsetView(aaa, new Vec2(3, 4)).pos);
                                drawer.lineTo(offsetView(aaa, new Vec2(12, 4)).pos);
                                drawer.ctx.stroke();
                            };
                        }
                    }
                    else {
                        drawCase(drawer, [v, v_original], offsetView(main_view,
                            new Vec2(4 - anim_t * 24, 12 + 18 * (k - 1 + anim_t))));
                    }
                }
                break;
            }
            case 'floating_bindings': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawMoleculePlease(this.input, main_view);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));

                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);

                const v = getCaseAt(this.fnk, this.animation.next_input_address);
                const v_original = getCaseAt(this.original_fnk, this.animation.next_input_address);
                drawCase(drawer, [v, v_original], main_view);
                if (v.next !== 'return') {
                    if (v_original.next === 'return') throw new Error('unreachable');
                    for (const [j, [asdf, asdf_original]] of enumerate(zip2(v.next, v_original.next))) {
                        const aaa = offsetView(main_view, new Vec2(12, 12 + 18 * j));
                        drawCase(drawer, [asdf, asdf_original], aaa);
                        drawer.line(aaa, [
                            new Vec2(3, j === 0 ? -12 : -14),
                            new Vec2(3, 4),
                            new Vec2(12, 4),
                        ]);
                    }
                }

                this.animation.bindings.forEach((x) => {
                    // TODO: draw all bindings // later: huh?
                    // TODO: bindings for rotated targets
                    if (eqArrays(x.target_address.major, x.source_address.major)) {
                        // if (x.target_address.major.length <= 1) {
                        const cur_view = lerpSexprView(
                            getSexprGrandChildView(main_view, x.source_address.minor),
                            // getView(main_view, x.source_address, this.collapsed),
                            // getView(main_view, x.target_address, this.collapsed),
                            getSexprGrandChildView(
                                offsetView(main_view, new Vec2(32, 0)),
                                x.target_address.minor),
                            anim_t);
                        // drawer.drawMoleculePlease(x.value, cur_view);
                        drawer.drawTemplate(x.value, { type: 'variable', value: x.variable_name }, cur_view);
                    }
                }, this);
                // this.animation.bindings
                // const next = getCasesAfter(this.fnk, this.animation.next_input_address.slice(0, -1));
                // drawCase(drawer, next[0], offsetView(main_view, new Vec2(0, 0)));
                break;
            }
            case 'dissolve_bindings': {
                throw new Error('no');
            }
            case 'fading_out_to_child': {
                main_view = offsetView(main_view, new Vec2(-14 * anim_t, 0));
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));
                const thing = getCasesAfter(this.fnk, this.animation.return_address)[0];

                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(lerp(32, 12, anim_t), 0),
                ]);

                drawer.line(main_view, [
                    new Vec2(-5, 0),
                    new Vec2(4, 0),
                ]);

                if (thing.next !== 'return') {
                    thing.next.forEach((asdf, j) => {
                        const aaa = offsetView(main_view, new Vec2(lerp(12, -8, anim_t), 12 + 18 * j));
                        drawer.drawPattern(asdf.pattern, aaa);
                        drawer.line(aaa, [
                            new Vec2(3, j === 0 ? -12 : -14),
                            new Vec2(3, 4),
                            new Vec2(12, 4),
                        ]);
                    });
                }
                break;
            }
            case 'fading_in_from_parent': {
                if (this.parent === null) throw new Error('unreachable');
                this.parent.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), null);
                drawer.drawMoleculePlease(this.input, offsetView(main_view, new Vec2(32 - 32 * anim_t, 0)));
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, lerpSexprView(
                    rotateAndScaleView(offsetView(main_view, new Vec2(29, -2)), -1 / 4, 1 / 2),
                    rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1),
                    anim_t));
                for (const [k, [v, v_original]] of enumerate(zip2(this.fnk.cases, this.original_fnk.cases))) {
                    const aaa = offsetView(main_view, new Vec2(lerp(38, 4, anim_t), 12 + 18 * k));
                    drawCase(drawer, [v, v_original], aaa);

                    drawer.line(aaa, [
                        new Vec2(-9, k === 0 ? -12 : -14),
                        new Vec2(-9, 4),
                        new Vec2(12, 4),
                    ]);
                };
                break;
            }
            case 'skipping_computation': {
                if (this.parent === null) throw new Error('unreachable');
                this.parent.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), null);
                drawer.line(main_view, [
                    new Vec2(30, 0),
                    new Vec2(-50, 0),
                ]);
                const old_input = this.animation.old_input;
                subdivideT(anim_t, [
                    [0, 0.25, (t) => {
                        drawer.drawMoleculePlease(old_input, offsetView(main_view, new Vec2(32, 0)));
                        drawer.drawTemplate(this.fnk.name, this.original_fnk.name, lerpSexprView(
                            rotateAndScaleView(offsetView(main_view, new Vec2(29, -2)), -1 / 4, 1 / 2),
                            rotateAndScaleView(offsetView(main_view, new Vec2(27, 4)), -1 / 4, 1),
                            t));
                    }],
                    [0.25, 1, (t) => {
                        if (t < 0.5) {
                            drawer.drawMoleculePlease(old_input, offsetView(main_view, new Vec2(32, 0)));
                        }
                        else {
                            drawer.drawMoleculePlease(this.input, offsetView(main_view, new Vec2(32, 0)));
                        }
                        drawer.drawTemplate(this.fnk.name, this.original_fnk.name, lerpSexprView(
                            rotateAndScaleView(offsetView(main_view, new Vec2(27, 4)), -1 / 4, 1),
                            rotateAndScaleView(offsetView(main_view, new Vec2(46, 4)), -1 / 4, 1),
                            t));
                    }],
                ]);

                // if (anim_t < .5) {
                //     drawer.drawMolecule(this.animation.old_input, offsetView(main_view, new Vec2(32, 0)));
                // } else {
                //     drawer.drawMolecule(this.input, offsetView(main_view, new Vec2(32, 0)));
                // }
                // drawer.drawMolecule(this.fnk.name, lerpSexprView(
                //     rotateAndScaleView(offsetView(main_view, new Vec2(29, -2)), -1 / 4, 1 / 2),
                //     rotateAndScaleView(offsetView(main_view, new Vec2(45, 4)), -1 / 4, 1),
                //     anim_t));
                break;
            }
            case 'fading_out_to_parent': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawMoleculePlease(this.input, offsetView(main_view, new Vec2(32 - 32 * anim_t, 0)));

                drawer.line(main_view, [
                    new Vec2(30 - 32 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);

                break;
            }
            case 'fading_in_from_child': {
                main_view = offsetView(main_view, new Vec2(-14 * (1 - anim_t), 0));
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));

                const thing = getCasesAfter(this.fnk, this.animation.return_address)[0];
                if (thing.next !== 'return') {
                    thing.next.forEach((asdf, j) => {
                        const aaa = offsetView(main_view, new Vec2(-8, 12 + 18 * j));
                        drawer.drawPattern(asdf.pattern, offsetView(aaa, new Vec2(anim_t * 12, 0)));
                        drawer.line(aaa, [
                            new Vec2(3, j === 0 ? -12 : -14),
                            new Vec2(3, 4),
                            new Vec2(12 + anim_t * 12, 4),
                        ]);
                    });
                }
                break;
            }
            // case 'skipping_child_computation': {
            //     this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
            //     drawer.drawMolecule(this.fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));
            //     drawer.drawMolecule(this.input, offsetView(main_view, new Vec2(lerp(32, 0, anim_t), 0)));

            //     drawer.line(main_view, [
            //         new Vec2(lerp(30, -2, anim_t), 0),
            //         new Vec2(-50, 0),
            //     ]);

            //     const thing = getCasesAfter(this.fnk, this.animation.return_address)[0];
            //     if (thing.next !== 'return') {
            //         thing.next.forEach((asdf, j) => {
            //             const aaa = offsetView(main_view, new Vec2(lerp(12, 4, anim_t), 12 + 18 * j));
            //             drawer.drawPattern(asdf.pattern, offsetView(aaa, new Vec2(0, 0)));
            //             drawer.line(aaa, [
            //                 new Vec2(lerp(3, -9, anim_t), j === 0 ? -12 : -14),
            //                 new Vec2(lerp(3, -9, anim_t), 4),
            //                 new Vec2(lerp(12, 12, anim_t), 4),
            //             ]);
            //         });
            //     }
            //     break;
            // }
            case 'waiting_for_child': {
                main_view = offsetView(main_view, new Vec2(-14, 0));
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.drawTemplate(this.fnk.name, this.original_fnk.name, rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1));

                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(12, 0),
                ]);

                drawer.line(main_view, [
                    new Vec2(-5, 0),
                    new Vec2(4, 0),
                ]);

                const thing = getCasesAfter(this.fnk, this.animation.return_address)[0];
                if (thing.next !== 'return') {
                    thing.next.forEach((asdf, j) => {
                        const aaa = offsetView(main_view, new Vec2(-8, 12 + 18 * j));
                        drawer.drawPattern(asdf.pattern, aaa);
                        drawer.ctx.beginPath();
                        drawer.ctx.strokeStyle = 'black';
                        drawer.moveTo(offsetView(aaa, new Vec2(3, j === 0 ? -12 : -14)).pos);
                        drawer.lineTo(offsetView(aaa, new Vec2(3, 4)).pos);
                        drawer.lineTo(offsetView(aaa, new Vec2(12, 4)).pos);
                        drawer.ctx.stroke();
                    });
                }
                break;
            }
            case 'breaking_to_tail_optimization': {
                this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse);
                drawer.line(main_view, [
                    new Vec2(30 - 32 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);
                break;
            }
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
        this.cur_execution_state = ExecutionState.init(structuredClone(original_fnk), original_input);
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
                // next_state.original_fnk = this.original_fnk;
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
            drawer.drawMoleculePlease(this.result.result, this.getMainView(drawer.getScreenSize()));
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

function drawCase(drawer: Drawer, [v, v_original]: [MatchCaseDefinition, MatchCaseDefinition], view: SexprView) {
    drawer.drawPattern(v.pattern, view);
    drawer.drawTemplate(v.template, v_original.template, offsetView(view, new Vec2(32, 0)));
    drawer.drawTemplate(v.fn_name_template, v_original.fn_name_template, rotateAndScaleView(offsetView(view, new Vec2(29, -2)), -1 / 4, 1 / 2));

    drawer.line(view, [
        new Vec2(14, 0),
        new Vec2(30, 0),
    ]);

    drawer.drawCable(view, allVariableNames(v_original.template), [
        new Vec2(14, 0),
        new Vec2(30, 0),
    ]);
}
