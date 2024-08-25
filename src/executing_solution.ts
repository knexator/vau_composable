import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, fakeCollapsed, everythingCollapsedExceptFirsts, offsetView, getAtPosition, sexprAdressFromScreenPosition, getFnkNameView, rotateAndScaleView, getSexprGrandChildView, getCollapseAt, getCollapsedAfter, COLLAPSE_DURATION, scaleViewCentered, Camera, OverlappedThing, computeOffset } from './drawer';
import { EditingSolution, OverlappedEditingThing } from './editing_solution';
import { Mouse, MouseButton } from './kommon/input';
import { assert, assertNotNull, at, enumerate, eqArrays, firstNonNull, last, subdivideT, zip2, zip3, zip4 } from './kommon/kommon';
import { clamp01, in01, lerp, remap, remapClamped } from './kommon/math';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, validCaseAddress, SexprTemplate, getAtLocalAddress, SexprNullable, getCasesAfter, MatchCaseDefinition, builtIn_eqAtoms, applyFunktion, allVariableNames, KnownVariables, knownVariables, SexprAddress, FullAddress } from './model';

export type OverlappedExecutionThing = { parent_view: SexprView, full_address: FullAddress, value: SexprTemplate };

export function completeAddress(major: MatchCaseAddress, asdf: FullAddress['type'], cosa: OverlappedThing | null): OverlappedExecutionThing | null {
    if (cosa === null) return null;
    return {
        parent_view: cosa.parent_view,
        value: cosa.value,
        full_address: {
            type: asdf,
            major: major,
            minor: cosa.address,
        },
    };
}

export function asMainInput(cosa: OverlappedThing | null): OverlappedExecutionThing | null {
    return completeAddress([], 'template', cosa);
}

export function asMainFnk(cosa: OverlappedThing | null): OverlappedExecutionThing | null {
    return completeAddress([], 'fn_name', cosa);
}

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
    | { type: 'identity_specialcase_1', return_address: MatchCaseAddress }
    | { type: 'identity_specialcase_2', return_address: MatchCaseAddress }
    | { type: 'fading_out_to_parent', parent_address: MatchCaseAddress, child_address: MatchCaseAddress }
    | { type: 'fading_in_from_child', return_address: MatchCaseAddress }
    | { type: 'waiting_for_child', return_address: MatchCaseAddress }
    | { type: 'final_result' }
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
        // console.log(this.collapsed.main);
        // console.log(this.collapsed.inside.map(x => x.main.collapsed).join(','));
        switch (this.animation.type) {
            case 'final_result': {
                return { type: 'success', result: this.input };
            }
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
                return next_state;
                // if (bindings.length === 0) {
                //     return next_state.next(all_fnks, main_view, global_t);
                //     // const asdf = next_state.next(all_fnks, main_view, global_t);
                //     // if (!(asdf instanceof ExecutionState)) return asdf;
                //     // return asdf.next(all_fnks, main_view, global_t);
                // }
                // else {
                //     return next_state;
                // }
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

                if (this.parent.animation.type === 'breaking_to_tail_optimization') {
                    if (this.parent.parent === null) {
                        return this.withAnimation({ type: 'final_result' }).withParent(null);
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
            case 'identity_specialcase_1': {
                return this
                    .withAnimation({ type: 'fading_in_from_child', return_address: this.animation.return_address })
                    .next(all_fnks, main_view, global_t);
            }
            case 'identity_specialcase_2': {
                return this
                    .withAnimation({ type: 'fading_in_from_child', return_address: this.animation.return_address })
                    .next(all_fnks, main_view, global_t);
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
                        if (equalSexprs(fn_name, { type: 'atom', value: 'identity' })) {
                            if (this.parent !== null) {
                                if (this.parent.animation.type !== 'waiting_for_child') throw new Error('oops');
                                return this.parent
                                    .withAnimation({ type: 'identity_specialcase_2', return_address: this.parent.animation.return_address })
                                    .withInput(skipped_fn_result);
                            }
                            else {
                                return this.withAnimation({ type: 'final_result' }).withInput(skipped_fn_result);
                            }
                        }
                        else {
                            return this
                                .withParent(this.withAnimation({ type: 'breaking_to_tail_optimization' }))
                                .withAnimation({ type: 'skipping_computation', source_address: input_address, old_input: this.input })
                                .withInput(skipped_fn_result)
                                .withFakeFnk(fn_name);
                        }
                        // if (equalSexprs(fn_name, { type: 'atom', value: 'identity' }) && this.parent !== null) {
                        //     if (!(res instanceof ExecutionState)) throw new Error('unreachable');
                        //     return res.next(all_fnks, main_view, global_t);
                        // }
                        // else {
                        //     return res;
                        // }
                    }
                    else {
                        if (equalSexprs(fn_name, { type: 'atom', value: 'identity' })) {
                            return this
                                .withAnimation({ type: 'identity_specialcase_1', return_address: input_address })
                                .withInput(skipped_fn_result);
                        }
                        else {
                            return this
                                .withParent(this.withAnimation({ type: 'fading_out_to_child', return_address: input_address }))
                                .withAnimation({ type: 'skipping_computation', source_address: input_address, old_input: this.input })
                                .withInput(skipped_fn_result)
                                .withFakeFnk(fn_name);
                        }
                        // return res;
                        // if (equalSexprs(fn_name, { type: 'atom', value: 'identity' }) && this.parent !== null) {
                        //     if (!(res instanceof ExecutionState)) throw new Error('unreachable');
                        //     return res.next(all_fnks, main_view, global_t);
                        // }
                        // else {
                        //     return res;
                        // }
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
                        return this.withAnimation({ type: 'final_result' });
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

    draw(drawer: Drawer, anim_t: number, global_t: number, main_view: SexprView, mouse: Vec2): OverlappedExecutionThing | null {
        // console.log(this.animation.type);
        main_view = offsetView(main_view, new Vec2(24, 0));
        const overlaps: (OverlappedExecutionThing | null)[] = [];
        // drawer.drawFunktion(this.fnk, main_view, this.collapsed.inside, global_t, this.matched);
        switch (this.animation.type) {
            case 'final_result': {
                if (this.parent !== null) throw new Error('unreachable');
                // TODO: split this in 2 animations: input goes to base position, and then it goes big.
                // main_view = offsetView(main_view, new Vec2(lerp(32, 0, anim_t), 0)),
                main_view = lerpSexprView(
                    offsetView(main_view, new Vec2(32, 0)),
                    AfterExecutingSolution.getMainView(drawer.getScreenSize()),
                    anim_t);
                overlaps.push(this.drawMainInput(drawer, mouse, main_view));
                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-80, 0),
                ]);
                break;
            }
            case 'input_moving_to_next_option': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainInput(drawer, mouse, main_view));
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));
                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);
                const names = getNamesAt(knownVariables(this.fnk), this.animation.target.slice(0, -1)).main;
                const next = getCasesAfter(this.fnk, this.animation.target);
                const next_original = getCasesAfter(this.original_fnk, this.animation.target);
                const next_collaped = getCollapsedAfter(this.collapsed, this.animation.target);
                const next_names = getNamesAfter(knownVariables(this.original_fnk), this.animation.target);
                for (const [k, stuff] of enumerate(zip4(next, next_original, next_collaped, next_names))) {
                    const collapse_amount = collapseAmount(global_t, stuff[2].main);
                    if (k === 0) {
                        // assert(collapse_amount === 0);
                        drawer.drawCable(main_view, names, [
                            new Vec2(-5, 0),
                            new Vec2(-5, 16 - 12 * anim_t),
                            new Vec2(lerp(16, 10, collapse_amount), 16 - 12 * anim_t),
                        ]);
                    }
                    else {
                        drawer.drawCable(main_view, names, [
                            new Vec2(-5, Math.max(-2 + (k - anim_t), 0) * 18),
                            new Vec2(-5, -2 + (k - anim_t + 1) * 18),
                            new Vec2(lerp(16, 10, collapse_amount), -2 + (k - anim_t + 1) * 18),
                        ]);
                    }

                    overlaps.push(drawCase(mouse, drawer, global_t, stuff, offsetView(main_view,
                        k === 0
                            ? new Vec2(4, 12 * (1 - anim_t))
                            : new Vec2(4, 12 + 18 * (k - anim_t))), [...this.animation.target, k]));
                };
                break;
            }
            case 'failing_to_match': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainInput(drawer, mouse, main_view));
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));
                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(-2, 0),
                ]);
                const names = getNamesAt(knownVariables(this.fnk), this.animation.which.slice(0, -1)).main;

                const next = getCasesAfter(this.fnk, this.animation.which);
                const next_original = getCasesAfter(this.original_fnk, this.animation.which);
                const next_collaped = getCollapsedAfter(this.collapsed, this.animation.which);
                const next_names = getNamesAfter(knownVariables(this.original_fnk), this.animation.which);
                for (const [k, stuff] of enumerate(zip4(next, next_original, next_collaped, next_names))) {
                    const collapse_amount = collapseAmount(global_t, stuff[2].main);
                    if (k === 0) {
                        drawer.drawCable(main_view, names, [
                            new Vec2(-5, 0),
                            new Vec2(-5, 16 - 12),
                            new Vec2(lerp(16, 10, collapse_amount) - anim_t * 8, 16 - 12),
                        ]);
                    }
                    else if (k === 1) {
                        drawer.drawCable(main_view, names, [
                            new Vec2(-5, -2 + 6),
                            new Vec2(-5, -2 + 18),
                            new Vec2(lerp(16, 10, collapse_amount), -2 + 18),
                        ]);
                    }
                    else {
                        drawer.drawCable(main_view, names, [
                            new Vec2(-5, -2 + (k - 1) * 18),
                            new Vec2(-5, -2 + (k - 1 + 1) * 18),
                            new Vec2(lerp(16, 10, collapse_amount), -2 + (k - 1 + 1) * 18),
                        ]);
                    }

                    if (k === 0) {
                        overlaps.push(drawCase(mouse, drawer, global_t, stuff, offsetView(main_view,
                            subdivideT(anim_t, [
                                [0, 0.5, t => new Vec2(4 - t * 4, 0)],
                                [0.5, 1, t => new Vec2(t * 4, -t * 12)],
                            ]),
                        ), [...this.animation.which, k]));
                    }
                    else {
                        overlaps.push(drawCase(mouse, drawer, global_t, stuff, offsetView(main_view, new Vec2(4, 12 + 18 * (k - 1))), [...this.animation.which, k]));
                    }
                };
                break;
            }
            case 'matching': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainInput(drawer, mouse, main_view));
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));
                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);

                const names = getNamesAt(knownVariables(this.fnk), this.animation.which.slice(0, -1)).main;
                drawer.drawCable(main_view, names, [
                    new Vec2(-5, 0),
                    new Vec2(-5, 4),
                    new Vec2(lerp(16, 12, anim_t), 4),
                ]);
                const next = getCasesAfter(this.fnk, this.animation.which);
                const next_original = getCasesAfter(this.original_fnk, this.animation.which);
                const next_collaped = getCollapsedAfter(this.collapsed, this.animation.which);
                const next_names = getNamesAfter(knownVariables(this.original_fnk), this.animation.which);
                for (const [k, stuff] of enumerate(zip4(next, next_original, next_collaped, next_names))) {
                    if (k === 0) {
                        // main case being matched
                        overlaps.push(drawCase(mouse, drawer, global_t, stuff, offsetView(main_view,
                            new Vec2(4 - anim_t * 4, 0)), [...this.animation.which, k]));
                    }
                    else {
                        // sibling cases to be discarded
                        overlaps.push(drawCase(mouse, drawer, global_t, stuff, offsetView(main_view,
                            new Vec2(4 - anim_t * 24, 12 + 18 * (k - 1 + anim_t))), [...this.animation.which, k]));
                    }
                }
                break;
            }
            case 'floating_bindings': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainInput(drawer, mouse, scaleViewCentered(main_view, 1 - anim_t)));

                const v = getCaseAt(this.fnk, this.animation.next_input_address);
                if (v.next === 'return') {
                    overlaps.push(this.drawMainFnkName(drawer, mouse,
                        scaleViewCentered(main_view, 1 - anim_t)));
                }
                else {
                    overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));
                }

                drawer.line(main_view, [
                    new Vec2(-2, 0),
                    new Vec2(-50, 0),
                ]);

                const v_original = getCaseAt(this.original_fnk, this.animation.next_input_address);
                const v_collapse = getCollapseAt(this.collapsed, this.animation.next_input_address);
                const v_names = getNamesAt(knownVariables(this.original_fnk), this.animation.next_input_address);
                overlaps.push(drawCaseAfterMatched(anim_t, mouse, drawer, global_t, [v, v_original, v_collapse, v_names], main_view, this.animation.bindings, this.animation.next_input_address));
                break;
            }
            case 'fading_out_to_child': {
                main_view = offsetView(main_view, new Vec2(-14 * anim_t, 0));
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));

                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(lerp(32, 12, anim_t), 0),
                ]);

                drawer.line(main_view, [
                    new Vec2(-5, 0),
                    new Vec2(4, 0),
                ]);

                const main_stuff = this.getStuff(this.animation.return_address);
                const aaa2 = offsetView(main_view, new Vec2(lerp(0 - SMOOTH_PERC * 12, -8 - 12, anim_t), 0));
                overlaps.push(drawHangingCases(mouse, drawer, global_t, getFirstStuff(main_stuff), aaa2, 0, lerp(lerp(1, 0.5, SMOOTH_PERC), 0, anim_t), this.animation.return_address));
                break;
            }
            case 'fading_in_from_parent': {
                if (this.parent === null) throw new Error('unreachable');
                overlaps.push(this.parent.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse));
                overlaps.push(this.drawMainInput(drawer, mouse, offsetView(main_view, new Vec2(32 - 32 * anim_t, 0))));
                overlaps.push(completeAddress([], 'fn_name',
                    drawer.drawTemplateAndReturnThingUnderMouse(mouse, this.fnk.name, this.original_fnk.name, lerpSexprView(
                        rotateAndScaleView(offsetView(main_view, new Vec2(29, -2)), -1 / 4, 1 / 2),
                        rotateAndScaleView(offsetView(main_view, new Vec2(-5, -2)), -1 / 4, 1),
                        anim_t))));
                for (const [k, stuff] of enumerate(zip4(this.fnk.cases, this.original_fnk.cases, this.collapsed.inside, knownVariables(this.original_fnk).inside))) {
                    // const aaa = offsetView(main_view, new Vec2(lerp(38, 4, anim_t), 12 + 18 * k));
                    const aaa = offsetView(main_view, new Vec2(lerp(24, 4, anim_t), 12 + 18 * k + lerp(40, 0, anim_t)));
                    overlaps.push(drawCase(mouse, drawer, global_t, stuff, aaa, [k]));

                    drawer.drawCable(aaa, [], [
                        new Vec2(-9, k === 0 ? -12 : -14),
                        new Vec2(-9, 4),
                        new Vec2(12, 4),
                    ]);
                };
                break;
            }
            case 'skipping_computation': {
                if (this.parent === null) throw new Error('unreachable');
                overlaps.push(this.parent.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse));
                drawer.line(main_view, [
                    new Vec2(30, 0),
                    new Vec2(-50, 0),
                ]);
                const old_input = this.animation.old_input;
                subdivideT(anim_t, [
                    [0, 0.25, (t) => {
                        overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, old_input, offsetView(main_view, new Vec2(32, 0)))));
                        overlaps.push(asMainFnk(drawer.drawTemplateAndReturnThingUnderMouse(mouse, this.fnk.name, this.original_fnk.name, lerpSexprView(
                            rotateAndScaleView(offsetView(main_view, new Vec2(29, -2)), -1 / 4, 1 / 2),
                            rotateAndScaleView(offsetView(main_view, new Vec2(27, 4)), -1 / 4, 1),
                            t))));
                    }],
                    [0.25, 1, (t) => {
                        if (t < 0.5) {
                            overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, old_input, offsetView(main_view, new Vec2(32, 0)))));
                        }
                        else {
                            overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, offsetView(main_view, new Vec2(32, 0)))));
                        }
                        overlaps.push(asMainFnk(drawer.drawTemplateAndReturnThingUnderMouse(mouse, this.fnk.name, this.original_fnk.name, lerpSexprView(
                            rotateAndScaleView(offsetView(main_view, new Vec2(27, 4)), -1 / 4, 1),
                            rotateAndScaleView(offsetView(main_view, new Vec2(46, 4)), -1 / 4, 1),
                            t))));
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
            case 'identity_specialcase_1': {
                // if (this.parent === null) throw new Error('unreachable');
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, offsetView(main_view, new Vec2(32 - 32 * anim_t, 0)))));
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));

                drawer.line(main_view, [
                    new Vec2(30 - 32 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);

                const main_stuff = this.getStuff(this.animation.return_address);
                const aaa2 = offsetView(main_view, new Vec2(lerp(0 - SMOOTH_PERC * 12, -20, anim_t), 0));
                overlaps.push(drawHangingCases(mouse, drawer, global_t, getFirstStuff(main_stuff), aaa2, anim_t, lerp(lerp(1, 0.5, SMOOTH_PERC), 1, anim_t), this.animation.return_address));
                break;
            }
            case 'identity_specialcase_2': {
                main_view = offsetView(main_view, new Vec2(-14 * (1 - anim_t), 0));
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, offsetView(main_view, new Vec2(46 * (1 - anim_t), 0)))));
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));

                drawer.line(main_view, [
                    new Vec2(44 - 46 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);

                const main_stuff = this.getStuff(this.animation.return_address);
                const aaa2 = offsetView(main_view, new Vec2(-8 - 12, 0));
                overlaps.push(drawHangingCases(mouse, drawer, global_t, getFirstStuff(main_stuff), aaa2, anim_t, anim_t, this.animation.return_address));
                break;
            }
            case 'fading_out_to_parent': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, offsetView(main_view, new Vec2(32 - 32 * anim_t, 0)))));

                drawer.line(main_view, [
                    new Vec2(30 - 32 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);

                break;
            }
            case 'fading_in_from_child': {
                main_view = offsetView(main_view, new Vec2(-14 * (1 - anim_t), 0));
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));

                const main_stuff = this.getStuff(this.animation.return_address);
                const aaa2 = offsetView(main_view, new Vec2(-8 - 12, 0));
                overlaps.push(drawHangingCases(mouse, drawer, global_t, getFirstStuff(main_stuff), aaa2, anim_t, anim_t, this.animation.return_address));
                //  - 12 + anim_t * 12
                // const thing = getCasesAfter(this.fnk, this.animation.return_address)[0];
                // const names = getNamesAt(knownVariables(this.fnk), this.animation.return_address).main;
                // if (thing.next !== 'return') {
                //     thing.next.forEach((asdf, j) => {
                //         const aaa = offsetView(main_view, new Vec2(-8, 12 + 18 * j));
                //         // overlaps.push(drawer.drawPatternAndReturnThingUnderMouse(mouse, asdf.pattern,
                //                    offsetView(aaa, new Vec2(anim_t * 12, 0))));
                //         drawer.drawCable(aaa, names, [
                //             new Vec2(3, j === 0 ? -12 : -14),
                //             new Vec2(3, 4),
                //             new Vec2(12 + anim_t * 12, 4),
                //         ]);
                //     });
                // }
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
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                overlaps.push(this.drawMainFnkName(drawer, mouse, main_view));

                drawer.line(main_view, [
                    new Vec2(-50, 0),
                    new Vec2(12, 0),
                ]);

                drawer.line(main_view, [
                    new Vec2(-5, 0),
                    new Vec2(4, 0),
                ]);

                const main_stuff = this.getStuff(this.animation.return_address);
                const aaa2 = offsetView(main_view, new Vec2(-20, 0));
                overlaps.push(drawHangingCases(mouse, drawer, global_t, getFirstStuff(main_stuff), aaa2, 0, 0, this.animation.return_address));
                break;
            }
            case 'breaking_to_tail_optimization': {
                overlaps.push(this.parent?.draw(drawer, anim_t, global_t, offsetView(main_view, new Vec2(-24, 0)), mouse) ?? null);
                drawer.line(main_view, [
                    new Vec2(30 - 32 * anim_t, 0),
                    new Vec2(-50, 0),
                ]);
                break;
            }
            default: {
                throw new Error('unreachable');
            }
        }
        return firstNonNull(overlaps);
    }

    private getStuff(address: MatchCaseAddress): [MatchCaseDefinition[], MatchCaseDefinition[], Collapsed[], KnownVariables[]] {
        const next = getCasesAfter(this.fnk, address);
        const next_original = getCasesAfter(this.original_fnk, address);
        const next_collaped = getCollapsedAfter(this.collapsed, address);
        const next_names = getNamesAfter(knownVariables(this.original_fnk), address);
        return [next, next_original, next_collaped, next_names];
    }

    private drawMainInput(drawer: Drawer, mouse: Vec2, view: SexprView): OverlappedExecutionThing | null {
        return asMainInput(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, view));
    }

    private drawMainFnkName(drawer: Drawer, mouse: Vec2, view: SexprView): OverlappedExecutionThing | null {
        assert(equalSexprs(this.fnk.name, this.original_fnk.name));
        return ExecutionState.drawMainFnkName(drawer, mouse, view, this.fnk.name);
    }

    static drawMainFnkName(drawer: Drawer, mouse: Vec2, view: SexprView, name: SexprLiteral): OverlappedExecutionThing | null {
        return asMainFnk(drawer.drawTemplateAndReturnThingUnderMouse(mouse, name, name, rotateAndScaleView(offsetView(view, new Vec2(-5, -2)), -1 / 4, 1)));
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
    update(delta_time: number, drawer: Drawer, camera: Camera, global_t: number): AfterExecutingSolution | null {
        const view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);

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
    skip(drawer: Drawer, camera: Camera, global_t: number): AfterExecutingSolution {
        const view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);

        let next_state = this.cur_execution_state.next(this.all_fnks, view, global_t);
        while (next_state instanceof ExecutionState) {
            next_state = next_state.next(this.all_fnks, view, global_t);
        }

        return new AfterExecutingSolution(this.original_editing, next_state);
    }

    draw(drawer: Drawer, camera: Camera, global_t: number, mouse: Mouse) {
        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);
        const overlapped = this.cur_execution_state.draw(drawer, this.anim_t, global_t, view, raw_mouse_pos);
        if (overlapped !== null) {
            drawer.highlightMolecule(overlapped.value.type, getSexprGrandChildView(overlapped.parent_view, overlapped.full_address.minor));
            drawer.ctx.fillStyle = 'black';
            const screen_size = drawer.getScreenSize();
            drawer.ctx.font = `bold ${Math.floor(screen_size.y / 30)}px sans-serif`;
            drawer.ctx.textAlign = 'center';
            drawer.ctx.fillText(sexprToString(overlapped.value, '@'), screen_size.x * 0.5, screen_size.y * 0.95);
        }
    }

    public static getMainView(screen_size: Vec2, camera: Camera): SexprView {
        return camera.viewAt(new Vec2(0.15, 0.25), 1 / 17, screen_size.y);
    }

    public static getMainViewGood(screen_size: Vec2, camera: Camera): SexprView {
        return offsetView(this.getMainView(screen_size, camera), new Vec2(24, 0));
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
            drawer.drawMoleculePlease(this.result.result, AfterExecutingSolution.getMainView(drawer.getScreenSize()));
        }
        else {
            drawer.ctx.fillText('Error during execution!', screen_size.x * 0.5, screen_size.y * 0.4);
            drawer.ctx.fillText(this.result.reason, screen_size.x * 0.5, screen_size.y * 0.6);
        }
    }

    static getMainView(screen_size: Vec2): SexprView {
        const view = {
            pos: screen_size.mul(new Vec2(0.4, 0.6)),
            halfside: screen_size.y / 5,
            turns: 0,
        };
        return view;
    }
}

function collapseAmount(cur_time: number, collapsed: Collapsed['main']): number {
    const collapsed_t = clamp01((cur_time - collapsed.changedAt) / COLLAPSE_DURATION);
    return collapsed.collapsed ? collapsed_t : 1 - collapsed_t;
}

function drawCaseAfterMatched(anim_t: number, mouse: Vec2 | null, drawer: Drawer, cur_time: number, [v, v_original, collapsed, names]: [MatchCaseDefinition, MatchCaseDefinition, Collapsed, KnownVariables], view: SexprView, bindings: FloatingBinding[], cur_address: MatchCaseAddress, depth: number = 0): OverlappedExecutionThing | null {
    const main_case = depth === 0;
    const overlaps: (OverlappedExecutionThing | null)[] = [];
    const collapse_amount = collapseAmount(cur_time, collapsed.main);
    view = { halfside: view.halfside, pos: view.pos, turns: view.turns };
    view.halfside *= lerp(1, 0.5, collapse_amount);
    view = offsetView(view, new Vec2(0, collapse_amount * 4));
    if (depth === 1) {
        const old_alpha = drawer.ctx.globalAlpha;
        drawer.ctx.globalAlpha = 1;
        overlaps.push(completeAddress(cur_address, 'pattern', drawer.drawPatternAndReturnThingUnderMouse(mouse, v.pattern, view)));
        drawer.ctx.globalAlpha = old_alpha;
    }
    else {
        overlaps.push(completeAddress(cur_address, 'pattern', drawer.drawPatternAndReturnThingUnderMouse(mouse, v.pattern, !main_case ? view : scaleViewCentered(view, 1 - anim_t))));
    }
    if (collapse_amount < 0.2) {
        if (main_case) {
            drawer.line(view, [
                new Vec2(-2, 0),
                new Vec2(lerp(-2, 6, anim_t), 0),
            ]);
            drawer.line(view, [
                new Vec2(lerp(14, 6, anim_t), 0),
                new Vec2(lerp(14, 30, anim_t), 0),
            ]);
            drawer.drawCable(view, names.main, [
                new Vec2(lerp(14, 30, anim_t), 0),
                new Vec2(30, 0),
            ]);
        }
        else {
            drawer.drawCable(view, names.main, [
                new Vec2(14, 0),
                new Vec2(30, 0),
            ]);
        }
        bindings.forEach((b) => {
            if (eqArrays(b.target_address.major, cur_address)) {
                drawer.drawEmergingValue(b.value, getSexprGrandChildView(offsetView(view, new Vec2(32, 0)), b.target_address.minor), remapClamped(anim_t, 0, 0.6, 0, 1));
            }
        });
        overlaps.push(completeAddress(cur_address, 'template', drawer.drawTemplateAndReturnThingUnderMouse(mouse, v.template, v_original.template, offsetView(view, new Vec2(32, 0)))));
        overlaps.push(completeAddress(cur_address, 'fn_name', drawFnkName(drawer, mouse, v.fn_name_template, v_original.fn_name_template, view)));

        const x_off = main_case ? lerp(0, SMOOTH_PERC * 12, anim_t) : 0;
        // cant use drawHangingCases since it doesnt draw the bindings!
        const draw_children = lerp(1, lerp(1, 0.5, SMOOTH_PERC), anim_t);
        // overlaps.push(drawHangingCases(mouse, drawer, cur_time, [v, v_original, collapsed, names], offsetView(view, new Vec2(-x_off, 0)), 0, lerp(1, lerp(1, 0.5, SMOOTH_PERC), anim_t)));

        if (v.next !== 'return') {
            if (v_original.next === 'return') throw new Error('unreachable');
            for (const [k, x] of enumerate(zip4(v.next, v_original.next, collapsed.inside, names.inside))) {
                drawer.ctx.globalAlpha = draw_children;
                overlaps.push(drawCaseAfterMatched(anim_t, mouse, drawer, cur_time, x,
                    offsetView(view, new Vec2(12 - x_off, 12 + 18 * k)), bindings, [...cur_address, k], depth + 1));
                if (main_case) drawer.ctx.globalAlpha = 1;
                const aaa = offsetView(view, new Vec2(12 - x_off, 12 + 18 * k));
                drawer.drawCable(aaa, names.main, [
                    new Vec2(3, k === 0 ? -12 : -14),
                    new Vec2(3, 4),
                    new Vec2(lerp(12, 6, collapseAmount(cur_time, x[2].main)), 4),
                ]);
            }
        }
    }
    return firstNonNull(overlaps);
}

function drawCase(mouse: Vec2 | null, drawer: Drawer, cur_time: number,
    [v, v_original, collapsed, names]: [MatchCaseDefinition, MatchCaseDefinition, Collapsed, KnownVariables],
    view: SexprView, cur_address: MatchCaseAddress, show_children: boolean = true): OverlappedExecutionThing | null {
    const overlaps: (OverlappedExecutionThing | null)[] = [];
    const collapse_amount = collapseAmount(cur_time, collapsed.main);
    view = { halfside: view.halfside, pos: view.pos, turns: view.turns };
    view.halfside *= lerp(1, 0.5, collapse_amount);
    view = offsetView(view, new Vec2(0, collapse_amount * 4));
    overlaps.push(completeAddress(cur_address, 'pattern', drawer.drawPatternAndReturnThingUnderMouse(mouse, v.pattern, view)));
    if (collapse_amount < 0.2 && show_children) {
        overlaps.push(completeAddress(cur_address, 'template', drawer.drawTemplateAndReturnThingUnderMouse(mouse, v.template, v_original.template, offsetView(view, new Vec2(32, 0)))));
        overlaps.push(completeAddress(cur_address, 'fn_name', drawFnkName(drawer, mouse, v.fn_name_template, v_original.fn_name_template, view)));
        drawer.drawCable(view, names.main, [
            new Vec2(14, 0),
            new Vec2(30, 0),
        ]);

        overlaps.push(drawHangingCases(mouse, drawer, cur_time, [v, v_original, collapsed, names], view, 0, 1, cur_address, false));
    }
    return firstNonNull(overlaps);
}

function drawCaseModern(mouse: Vec2 | null, drawer: Drawer, cur_time: number,
    [v, v_original, collapsed, names]: [MatchCaseDefinition, MatchCaseDefinition, Collapsed, KnownVariables],
    view: SexprView, cur_address: MatchCaseAddress, show_children: boolean = true): OverlappedEditingThing | null {
    const overlaps: (OverlappedEditingThing | null)[] = [];
    const collapse_amount = collapseAmount(cur_time, collapsed.main);
    view = { halfside: view.halfside, pos: view.pos, turns: view.turns };
    view.halfside *= lerp(1, 0.5, collapse_amount);
    view = offsetView(view, new Vec2(0, collapse_amount * 4));
    overlaps.push(completeAddress(cur_address, 'pattern', drawer.drawPatternAndReturnThingUnderMouse(mouse, v.pattern, view)));
    if (collapse_amount < 0.2 && show_children) {
        overlaps.push(completeAddress(cur_address, 'template', drawer.drawTemplateAndReturnThingUnderMouse(mouse, v.template, v_original.template, offsetView(view, new Vec2(32, 0)))));
        overlaps.push(completeAddress(cur_address, 'fn_name', drawFnkName(drawer, mouse, v.fn_name_template, v_original.fn_name_template, view)));
        drawer.drawCable(view, names.main, [
            new Vec2(14, 0),
            new Vec2(30, 0),
        ]);

        if (v.next !== 'return') {
            if (v_original.next === 'return') throw new Error('unreachable');
            overlaps.push(drawHangingCasesModern(mouse, drawer, cur_time,
                [v.next, v_original.next, collapsed.inside], names, cur_address,
                offsetView(view, new Vec2(20, 0)), 0, 1, false));
        }
        else {
            const plus_view = offsetView(view, new Vec2(16, 2));
            if (drawer.drawPlus(mouse, plus_view)) {
                overlaps.push({ value: 'pole', type: 'return', address: cur_address, screen_pos: plus_view.pos });
            }
        }
    }
    return firstNonNull(overlaps);
}

export function drawHangingCases(mouse: Vec2 | null, drawer: Drawer, cur_time: number,
    [v, v_original, collapsed, names]: [MatchCaseDefinition, MatchCaseDefinition, Collapsed, KnownVariables],
    view: SexprView, extended: number, showing_children: number, cur_address: MatchCaseAddress, main_case: boolean = true): OverlappedExecutionThing | null {
    const overlaps: (OverlappedExecutionThing | null)[] = [];
    if (v.next !== 'return') {
        if (v_original.next === 'return') throw new Error('unreachable');
        for (const [k, x] of enumerate(zip4(v.next, v_original.next, collapsed.inside, names.inside))) {
            const aaa = offsetView(view, new Vec2(12, 12 + 18 * k));
            drawer.drawCable(aaa, names.main, [
                new Vec2(3, k === 0 ? -12 : -14),
                new Vec2(3, 4),
                new Vec2(lerp(12, 6, collapseAmount(cur_time, x[2].main)) + 12 * extended, 4),
            ]);

            if (showing_children > 0) {
                if (showing_children < 1) {
                    drawer.ctx.globalAlpha = showing_children;
                    overlaps.push(drawCase(mouse, drawer, cur_time, x, offsetView(view, new Vec2(12 + 12 * extended, 12 + 18 * k)), [...cur_address, k], true));
                    drawer.ctx.globalAlpha = 1;
                }
                else {
                    overlaps.push(drawCase(mouse, drawer, cur_time, x, offsetView(view, new Vec2(12 + 12 * extended, 12 + 18 * k)), [...cur_address, k], true));
                }
            }
            if (main_case) {
                overlaps.push(drawCase(mouse, drawer, cur_time, x, offsetView(view, new Vec2(12 + 12 * extended, 12 + 18 * k)), [...cur_address, k], false));
            }
        }
    }
    return firstNonNull(overlaps);
}

export function drawHangingCasesModern(mouse: Vec2 | null, drawer: Drawer, cur_time: number,
    [v, v_original, collapsed]: [MatchCaseDefinition[], MatchCaseDefinition[], Collapsed[]],
    parent_names: KnownVariables, cur_address: MatchCaseAddress,
    view: SexprView, extended: number, showing_children: number, main_case: boolean = true): OverlappedEditingThing | null {
    const overlaps: (OverlappedEditingThing | null)[] = [];
    view = offsetView(view, new Vec2(-20, 0));
    let v_offset = 0;
    for (const [k, x] of enumerate(zip4(v, v_original, collapsed, parent_names.inside))) {
        const collapsed = collapseAmount(cur_time, x[2].main);
        const v_offset_delta = lerp(10, 6, collapsed);
        v_offset += v_offset_delta;
        const aaa = offsetView(view, new Vec2(12, v_offset));
        const extended_amount = (main_case ? 12 : 4) - 2 * (1 - collapsed);
        drawer.drawCable(aaa, parent_names.main, [
            new Vec2(3, -v_offset_delta),
            new Vec2(3, 4),
            new Vec2(lerp(12, 6, collapsed) + extended_amount, 4),
        ]);
        if (showing_children > 0) {
            if (showing_children < 1) {
                drawer.ctx.globalAlpha = showing_children;
                overlaps.push(drawCaseModern(mouse, drawer, cur_time, x, offsetView(aaa, new Vec2(extended_amount, 0)), [...cur_address, k], true));
                drawer.ctx.globalAlpha = 1;
            }
            else {
                overlaps.push(drawCaseModern(mouse, drawer, cur_time, x, offsetView(aaa, new Vec2(extended_amount, 0)), [...cur_address, k], true));
            }
        }

        const plus_offset = new Vec2(1.2, 2);
        if (drawer.drawPlus(mouse, offsetView(aaa, plus_offset))) {
            overlaps.push({ value: 'pole', type: 'add', address: [...cur_address, k], screen_pos: offsetView(aaa, plus_offset).pos });
        }
    }
    return firstNonNull(overlaps);
}

function drawFnkName(drawer: Drawer, mouse: Vec2 | null, name: SexprTemplate, name_original: SexprTemplate, view: SexprView): OverlappedThing | null {
    const fnk_view = rotateAndScaleView(offsetView(view, new Vec2(29, -2)), -1 / 4, 1 / 2);
    if (name_original.type === 'atom' && name_original.value === 'identity') {
        return drawer.returnTemplateUnderMouse(mouse, name, fnk_view);
    }
    return drawer.drawTemplateAndReturnThingUnderMouse(mouse, name, name_original, fnk_view);
}

function getNamesAt(vars: KnownVariables, address: MatchCaseAddress): KnownVariables {
    if (address.length === 0) {
        return vars;
    }
    else {
        const [head, ...tail] = address;
        return getNamesAt(at(vars.inside, head), tail);
    }
}

function getNamesAfter(names_main: KnownVariables, address: MatchCaseAddress): KnownVariables[] {
    const siblings = address.length === 1 ? names_main.inside : getNamesAt(names_main, address.slice(0, -1)).inside;
    return siblings.slice(at(address, -1));
}
function firstChild(return_address: MatchCaseAddress): MatchCaseAddress {
    return [...return_address, 0];
}

function getFirstStuff([a, b, c, d]: [MatchCaseDefinition[], MatchCaseDefinition[], Collapsed[], KnownVariables[]]): [MatchCaseDefinition, MatchCaseDefinition, Collapsed, KnownVariables] {
    return [a[0], b[0], c[0], d[0]];
}

const SMOOTH_PERC = 1;
