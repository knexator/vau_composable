import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, Drawer, toggleCollapsed, getPoleAtPosition, getAtPosition, fakeCollapsed, offsetView, sexprAdressFromScreenPosition, getSexprGrandChildView, getFnkNameView, Camera, OverlappedThing, ensureCollapsed, everythingCollapsedExceptFirsts, rotateAndScaleView, scaleAndOffsetView } from './drawer';
import { asMainFnk2, asMainInput, asMainInput2, drawHangingCases, drawHangingCasesModern, ExecutingSolution, ExecutionState, OverlappedExecutionThing } from './executing_solution';
import { KeyCode, Keyboard, Mouse, MouseButton } from './kommon/input';
import { assertNotNull, at, assert, fromCount, firstNonNull, eqArrays, startsWith, commonPrefixLen, last, single, filterIndices, replace } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress, parseSexprTemplate, parseSexprLiteral, SexprAddress, movePole, cloneSexpr, fixExtraPolesNeeded, isLiteral, SexprNullable, newFnk, knownVariables, doAtom, PersistenceStuff } from './model';
import { inRange } from './kommon/math';
import { ElectingSolution, TestCaseViewer } from './electing_solution';

export type OverlappedEditingThing =
    | ({ type: 'main' } & OverlappedExecutionThing)
    | { type: 'pole', kind: 'add' | 'return', address: MatchCaseAddress, view: SexprView }
    | { type: 'other_fnk', value: SexprLiteral, view: SexprView }
    | { type: 'toolbar', value: SexprTemplate, view: SexprView }
    | { type: 'test_case', value: SexprTemplate, view: SexprView }
    | { type: 'cell', cell: number, address: SexprAddress, value: SexprTemplate, view: SexprView };
export class EditingSolution {
    private collapsed: Collapsed;

    // TODO: baaad
    public mouse_holding: SexprTemplate | null;
    private input: SexprLiteral;

    constructor(
        private persistence: PersistenceStuff,
        private fnk: FunktionDefinition,
        private test_case_viewer: TestCaseViewer,
    ) {
        this.collapsed = fakeCollapsed(everythingCollapsedExceptFirsts(fnk.cases));
        this.mouse_holding = null;
        this.input = test_case_viewer.getInput();
    }

    private get all_fnks() {
        return this.persistence.user_fnks;
    }

    private get cells() {
        return this.persistence.cells;
    }

    private *toolbarThingsNew(main_view: SexprView): Generator<{ value: SexprTemplate, view: SexprView }, void, void> {
        const atom_values: SexprLiteral[] = [
            parseSexprLiteral('(#nil . #nil)'),
            ...['#nil', '#true', '#false', '#input', '#output', '#v1', '#v2', '#v3', '#f1', '#f2', '#f3', '#f4'].map(parseSexprLiteral),
        ];

        for (let k = 0; k < 12; k++) {
            yield {
                value: at(atom_values, k),
                view: {
                    pos: offsetView(main_view, new Vec2(k * 4 + 12, -8)).pos,
                    halfside: main_view.halfside / 3,
                    turns: main_view.turns,
                },
            };
        }

        for (let k = 0; k < 12; k++) {
            yield {
                value: { type: 'variable', value: k.toString() },
                view: {
                    pos: offsetView(main_view, new Vec2(k * 4 + 12, -4)).pos,
                    halfside: main_view.halfside / 3,
                    turns: main_view.turns,
                },
            };
        }
    }

    static viewOfFnk(name: SexprLiteral, all_fnks: FunktionDefinition[], main_view: SexprView): SexprView {
        for (const { value, view } of EditingSolution.otherFnksNew(all_fnks, main_view)) {
            if (equalSexprs(name, value)) return view;
        }
        throw new Error('bad name');
    }

    static *otherFnksNew(all_fnks: FunktionDefinition[], main_view: SexprView): Generator<{ value: SexprLiteral, view: SexprView }, void, void> {
        main_view = offsetView(main_view, new Vec2(-14, 8));

        // special functions
        const built_in = ['#identity', '#eqAtoms?'].map(parseSexprLiteral);
        for (let k = 0; k < built_in.length; k++) {
            yield {
                value: built_in[k],
                view: {
                    pos: offsetView(main_view, new Vec2(-12 - k * 6, 0)).pos,
                    halfside: main_view.halfside / 2,
                    turns: main_view.turns - 0.25,
                },
            };
        }

        // the rest
        for (let k = 0; k < all_fnks.length; k++) {
            yield {
                value: all_fnks[k].name,
                view: {
                    pos: offsetView(main_view, new Vec2(-(k % 5) * 6, 8 + Math.floor(k / 5) * 8)).pos,
                    halfside: main_view.halfside / 2,
                    turns: main_view.turns - 0.25,
                },
            };
        }
    }

    drawAndUpdate(drawer: Drawer, global_t: number, camera: Camera, mouse: Mouse, keyboard: Keyboard): EditingSolution | ElectingSolution | null {
        return this.drawAndUpdateNew(drawer, global_t, camera, mouse, keyboard);
    }

    private drawAndUpdateNew(drawer: Drawer, global_t: number, camera: Camera, mouse: Mouse, keyboard: Keyboard): ElectingSolution | EditingSolution | null {
        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const overlaps: (OverlappedEditingThing | null)[] = [];
        // overlaps.push(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse, this.input, main_view));

        const main_view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);

        let already_overlapped = false;
        {
            const create_fnk_button_view = scaleAndOffsetView(main_view, new Vec2(-14, 6), 2);
            if (drawer.drawPlus(mouse_pos, create_fnk_button_view) && this.mouse_holding === null) {
                already_overlapped = true;
                drawer.highlightPlus(create_fnk_button_view);
                if (mouse.wasPressed(MouseButton.Left)) {
                    this.all_fnks.push(newFnk(this.all_fnks));
                }
            }
        }

        overlaps.push(asMainInput2(drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, this.input, main_view)));
        overlaps.push(toMain(ExecutionState.drawMainFnkName(drawer, mouse_pos, main_view, this.fnk.name)));
        drawer.line(main_view, [
            new Vec2(-2, 0),
            new Vec2(-50, 0),
        ]);
        overlaps.push(drawHangingCasesModern(mouse_pos, drawer, global_t,
            [this.fnk.cases, this.fnk.cases, this.collapsed.inside],
            knownVariables(this.fnk), [],
            main_view, 1, 1, 1, true, null));
        // overlaps.push(drawHangingCases(mouse_pos, drawer, global_t,
        //     [this.fnk.cases[0], this.fnk.cases[0], this.collapsed, knownVariables(this.fnk)],
        //     main_view, 1, 1));
        // const asdf = ExecutionState.init(this.fnk, this.input);
        // overlaps.push(asdf.draw(drawer, 0, global_t, main_view, mouse_pos));

        for (const { value, view } of EditingSolution.otherFnksNew(this.all_fnks, main_view)) {
            const asdf = drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view);
            if (asdf !== null) {
                overlaps.push({ type: 'other_fnk', value, view });
            }
        }

        for (const { value, view } of this.toolbarThingsNew(main_view)) {
            const asdf = drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view);
            if (asdf !== null) {
                overlaps.push({ type: 'toolbar', value, view });
            }
        }

        for (let k = 0; k < 3; k++) {
            const value = this.cells[k];
            const view = this.getCellView(drawer.getScreenSize(), k);
            const asdf = drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view);
            if (asdf !== null) {
                overlaps.unshift({
                    type: 'cell', address: asdf.address, cell: k,
                    value: assertNotNull(getAtLocalAddress(value, asdf.address)),
                    view: getSexprGrandChildView(view, asdf.address),
                });
            }
        }

        // TODO
        // test cases
        const test_case_view = offsetView(main_view, new Vec2(-20, -6));
        function helper(mouse_pos: Vec2, value: SexprLiteral, view: SexprView): OverlappedEditingThing | null {
            const asdf = drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view);
            if (asdf === null) return null;
            return { type: 'test_case', value, view };
        }
        overlaps.push(
            helper(mouse_pos, this.test_case_viewer.getInput(), offsetView(test_case_view, new Vec2(-15, 0))),
            helper(mouse_pos, doAtom('nil'), test_case_view),
        );
        drawer.line(offsetView(test_case_view, new Vec2(-2.75, 0)), [
            new Vec2(-3, 0),
            new Vec2(0, 0),
            new Vec2(-1, 1),
            new Vec2(0, 0),
            new Vec2(-1, -1),
        ]);
        // const asdf1 = offsetView(test_case_view, new Vec2(-19, 2.5));
        // drawer.drawPlus(null, asdf1);
        // drawer.highlightPlus(asdf1);
        // const asdf2 = offsetView(test_case_view, new Vec2(-19, -2.5));
        // drawer.drawPlus(null, asdf2);
        // drawer.highlightPlus(asdf2);

        const overlapped = already_overlapped ? null : firstNonNull(overlaps);
        if (overlapped !== null) {
            if (overlapped.type === 'pole') {
                if (this.mouse_holding === null) {
                    drawer.highlightPlus(overlapped.view);
                }
            }
            else if (overlapped.type === 'other_fnk' || overlapped.type === 'toolbar' || overlapped.type === 'test_case') {
                if (this.mouse_holding === null) {
                    drawer.highlightThing('fn_name', overlapped.value.type, overlapped.view);
                    EditingSolution.printName(overlapped.value, drawer);
                }
            }
            else if (overlapped.type === 'cell') {
                const value = assertNotNull(getAtLocalAddress(this.cells[overlapped.cell], overlapped.address));
                drawer.highlightThing('template', value.type, overlapped.view);
                EditingSolution.printName(value, drawer);
            }
            else if (overlapped.type === 'main') {
                drawer.highlightThing(overlapped.full_address.type, overlapped.value.type, getSexprGrandChildView(overlapped.parent_view, overlapped.full_address.minor));
                EditingSolution.printName(overlapped.value, drawer);

                const major = overlapped.full_address.major;
                this.collapsed.inside = ensureCollapsed(this.collapsed.inside, global_t, (addr, cur_value) => {
                    if (eqArrays(addr, major)) return false;
                    if (startsWith(addr, major)) return cur_value;
                    if (startsWith(major, addr)) return false;
                    if (major.length === addr.length && commonPrefixLen(major, addr) === major.length - 1) return !eqArrays(addr, overlapped.full_address.major);
                    return cur_value;
                });
            }
            else {
                const _: never = overlapped;
            }
        }

        if (this.mouse_holding !== null) {
            drawer.drawMoleculePlease(this.mouse_holding, this.getExtraView(drawer.getScreenSize()));
        }

        // change atom names
        if (overlapped !== null && overlapped.type !== 'pole' && this.mouse_holding === null) {
            const hovered_value = overlapped.value;
            if (hovered_value.type === 'atom' || hovered_value.type === 'variable') {
                if (keyboard.wasPressed(KeyCode.Backspace)) {
                    hovered_value.value = hovered_value.value.slice(0, -1);
                }
                else {
                    if (!(['(', ')', ' ', '{', '}', ':', ';'].includes(keyboard.text))) {
                        hovered_value.value += keyboard.text;
                    }
                }
            }
        }

        if (keyboard.wasPressed(KeyCode.Escape)) {
            return new ElectingSolution(this.persistence);
        }

        if (overlapped !== null && overlapped.type === 'pole') {
            if (mouse.wasReleased(MouseButton.Left)) this.mouse_holding = null;
            if (overlapped.kind === 'add') {
                if (mouse.wasPressed(MouseButton.Left)) {
                    // TODO: add pole at the proper place
                    const [new_cases, new_collapsed] = addPoleAsFirstChild(this.fnk.cases, this.collapsed.inside, overlapped.address.slice(0, -1), global_t, []);
                    this.fnk.cases = new_cases;
                    this.collapsed = ensureValidCollapse(new_collapsed, global_t);
                }
                else if (mouse.wasPressed(MouseButton.Right)) {
                    const [new_cases, new_collapsed] = deletePole(this.fnk.cases, this.collapsed, overlapped.address);
                    if (new_cases !== 'return') {
                        this.fnk.cases = new_cases;
                        this.collapsed = ensureValidCollapse(new_collapsed, global_t);
                    }
                }
                else if (keyboard.wasPressed(KeyCode.KeyW) || keyboard.wasPressed(KeyCode.KeyS)) {
                    const move_up = keyboard.wasPressed(KeyCode.KeyW);
                    const [new_cases, new_collapsed] = movePole(this.fnk.cases, this.collapsed.inside, overlapped.address, move_up);
                    this.fnk.cases = new_cases;
                    this.collapsed = ensureValidCollapse(new_collapsed, global_t);
                }
            }
            else if (overlapped.kind === 'return') {
                if (mouse.wasPressed(MouseButton.Left)) {
                    const [new_cases, new_collapsed] = addPoleAsFirstChild(this.fnk.cases, this.collapsed.inside, overlapped.address, global_t, []);
                    this.fnk.cases = new_cases;
                    this.collapsed = ensureValidCollapse(new_collapsed, global_t);
                }
            }
        }
        else {
            if (this.mouse_holding === null) {
                if (overlapped !== null) {
                    const cur_value = overlapped.value;
                    if (mouse.wasPressed(MouseButton.Left)) {
                        // pick up
                        this.mouse_holding = cloneSexpr(cur_value);
                    }
                    else if (keyboard.wasPressed(KeyCode.Enter)) {
                        // go to function
                        if (isLiteral(cur_value)) {
                            const lit_name = assertLiteral(cur_value);
                            const other_fnk = this.all_fnks.find(v => equalSexprs(v.name, lit_name));
                            if (other_fnk !== undefined && other_fnk !== this.fnk) {
                                return new EditingSolution(this.persistence, other_fnk, this.test_case_viewer);
                            }
                        }
                    }
                    else if (mouse.wasPressed(MouseButton.Right)) {
                        // split
                        const new_value: SexprTemplate = { type: 'pair', left: cloneSexpr(cur_value), right: cloneSexpr(cur_value) };
                        this.setAtGeneralized(overlapped, new_value);
                    }
                }
            }
            else {
                if (overlapped !== null) {
                    this.drawMouseHoldingAt(drawer, overlapped, this.mouse_holding);
                }
                if (mouse.wasReleased(MouseButton.Left)) {
                    if (overlapped !== null) {
                        this.setAtGeneralized(overlapped, this.mouse_holding);
                    }
                    this.mouse_holding = null;
                }
            }
        }

        return null;
    }

    static printName(value: SexprTemplate, drawer: Drawer) {
        drawer.ctx.fillStyle = 'black';
        const screen_size = drawer.getScreenSize();
        drawer.ctx.font = `bold ${Math.floor(screen_size.y / 30)}px sans-serif`;
        drawer.ctx.textAlign = 'center';
        return drawer.ctx.fillText(sexprToString(value, '@'), screen_size.x * 0.5, screen_size.y * 0.95);
    }

    private drawMouseHoldingAt(drawer: Drawer, overlapped: OverlappedEditingThing, mouse_holding: SexprTemplate) {
        if (overlapped.type === 'main') {
            if (overlapped.type !== 'main' || overlapped.full_address.major.length > 0 || isLiteral(mouse_holding)) {
                drawer.drawPlease(overlapped.full_address.type, mouse_holding, getSexprGrandChildView(overlapped.parent_view, overlapped.full_address.minor));
            }
        }
        else if (overlapped.type === 'other_fnk' || overlapped.type === 'toolbar' || overlapped.type === 'test_case' || overlapped.type === 'pole') {
            // pass
        }
        else if (overlapped.type === 'cell') {
            drawer.drawPlease('template', mouse_holding, overlapped.view);
        }
        else {
            const _: never = overlapped;
            throw new Error('unreachable');
        }
    }

    private setAtGeneralized(overlapped: OverlappedEditingThing, new_value: SexprTemplate) {
        if (overlapped.type === 'main') {
            this.setAt(overlapped.full_address, new_value);
        }
        else if (overlapped.type === 'other_fnk' || overlapped.type === 'toolbar' || overlapped.type === 'test_case' || overlapped.type === 'pole') {
            // pass
        }
        else if (overlapped.type === 'cell') {
            this.cells[overlapped.cell] = setAtLocalAddress(
                this.cells[overlapped.cell], overlapped.address, new_value,
            );
        }
        else {
            const _: never = overlapped;
            throw new Error('unreachable');
        }
    }

    private setAt(full_address: FullAddress, value: SexprTemplate) {
        if (full_address.major.length > 0) {
            this.fnk.cases = setAt(this.fnk.cases, full_address, value);
        }
        else if (full_address.type === 'fn_name') {
            if (isLiteral(value)) {
                this.fnk.name = assertLiteral(setAtLocalAddress(this.fnk.name, full_address.minor, value));
            }
        }
        else if (full_address.type === 'template') {
            if (isLiteral(value)) {
                this.input = assertLiteral(setAtLocalAddress(this.input, full_address.minor, value));
            }
        }
        else {
            assert(false);
        }
    }

    startExecution(global_t: number) {
        return new ExecutingSolution(this.all_fnks, this.fnk, this.input, this, global_t, this.collapsed);
    }

    private getExtraView(screen_size: Vec2): SexprView {
        return {
            pos: screen_size.mul(new Vec2(0.75, 0.2125)),
            halfside: screen_size.y / 5.5,
            turns: 0,
        };
    }

    private getCellView(screen_size: Vec2, k: number): SexprView {
        assert(inRange(k, 0, 3));
        return {
            pos: screen_size.mul(new Vec2(0.875, 0.5 + k * 0.1975)),
            halfside: screen_size.y * 0.5 / 5.5,
            turns: 0,
        };
    }
}

function toMain(x: OverlappedExecutionThing | null): OverlappedEditingThing | null {
    if (x === null) return null;
    return Object.assign({ type: 'main' as const }, x);
}

function ensureValidCollapse(c: Collapsed[], global_t: number): Collapsed {
    function ensureExactlyOneUncollapsed(asdf: Collapsed[]): Collapsed[] {
        const uncollapsed = filterIndices(asdf, x => !x.main.collapsed);
        if (uncollapsed.length === 1) {
            const cur = asdf[single(uncollapsed)];
            return replace(asdf, {
                main: cur.main,
                inside: ensureExactlyOneUncollapsed(cur.inside),
            }, single(uncollapsed));
        }
        else if (uncollapsed.length === 0) {
            return ensureCollapsed(asdf, global_t, (addr, val) => last(addr) !== 0);
        }
        else {
            return ensureCollapsed(asdf, global_t, (addr, val) => last(addr) !== 0);
        }
    }

    return fixExtraPolesNeeded(fakeCollapsed(ensureExactlyOneUncollapsed(c)));
}
