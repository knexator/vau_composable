import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, Drawer, toggleCollapsed, getPoleAtPosition, getAtPosition, fakeCollapsed, offsetView, sexprAdressFromScreenPosition, getSexprGrandChildView, getFnkNameView, Camera, OverlappedThing, ensureCollapsed, everythingCollapsedExceptFirsts, rotateAndScaleView, scaleAndOffsetView } from './drawer';
import { asMainFnk2, asMainInput, asMainInput2, drawHangingCases, drawHangingCasesModern, ExecutingSolution, ExecutionState, OverlappedExecutionThing } from './executing_solution';
import { KeyCode, Keyboard, Mouse, MouseButton } from './kommon/input';
import { assertNotNull, at, assert, fromCount, firstNonNull, eqArrays, startsWith, commonPrefixLen, last, single, filterIndices, replace } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress, parseSexprTemplate, parseSexprLiteral, SexprAddress, movePole, cloneSexpr, fixExtraPolesNeeded, isLiteral, SexprNullable, newFnk, knownVariables, doAtom, LevelDescription, PersistenceStuff, NULL_DESCRIPTION } from './model';
import { inRange } from './kommon/math';
import { EditingSolution } from './editing_solution';

// TODO: multiple solutions per level

export class ElectingSolution {
    private selected: {
        value: SexprLiteral,
        test_case_viewer: TestCaseViewer,
        level: LevelDescription,
    } | null;

    constructor(
        private persistence: PersistenceStuff,
        fn_name: SexprLiteral | null = null,
    ) {
        if (fn_name === null) {
            this.selected = null;
        }
        else {
            const level_description = this.all_levels.find(x => equalSexprs(x.name, fn_name)) ?? NULL_DESCRIPTION;
            this.selected = { value: fn_name, level: level_description, test_case_viewer: new TestCaseViewer(level_description) };
        }
    }

    private get all_fnks() {
        return this.persistence.user_fnks;
    }

    private get all_levels() {
        return this.persistence.levels;
    }

    drawAndUpdate(drawer: Drawer, global_t: number, camera: Camera, mouse: Mouse, keyboard: Keyboard): ElectingSolution | EditingSolution | null {
        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const overlaps: (OverlappedThing | null)[] = [];

        const main_view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);

        // ExecutionState.drawMainFnkName(drawer, mouse_pos, main_view, this.fnk.name);
        // drawer.line(main_view, [
        //     new Vec2(-2, 0),
        //     new Vec2(-50, 0),
        // ]);

        for (const { value, view } of EditingSolution.otherFnks(this.all_fnks, main_view)) {
            if (value.type === 'atom' && (value.value === 'identity' || value.value === 'eqAtoms?')) continue;
            if (drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view) !== null) {
                overlaps.push({ kind: 'template', parent_view: view, value, address: [] });
            }
        }

        const overlapped = firstNonNull(overlaps);
        if (overlapped !== null) {
            const fn_name = assertLiteral(overlapped.value);
            drawer.highlightThing('fn_name', overlapped.value.type, overlapped.parent_view);
            EditingSolution.printName(overlapped.value, drawer);

            if (mouse.wasPressed(MouseButton.Left)) {
                if (this.selected !== null && equalSexprs(fn_name, this.selected.value)) {
                    const fnk = this.all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (fnk !== undefined) {
                        // TODO: use test case as input
                        return new EditingSolution(this.persistence, fnk, this.selected.test_case_viewer);
                    }
                }
                else {
                    const level_description = this.all_levels.find(x => equalSexprs(x.name, fn_name)) ?? NULL_DESCRIPTION;
                    this.selected = { value: fn_name, level: level_description, test_case_viewer: new TestCaseViewer(level_description) };
                }
            }
        }

        if (this.selected !== null) {
            drawer.highlightThing('fn_name', this.selected.value.type, EditingSolution.viewOfFnk(this.selected.value, this.all_fnks, main_view));

            drawer.ctx.fillStyle = 'black';
            drawer.text(this.selected.level.description, scaleAndOffsetView(main_view, new Vec2(20, 20), 0.15));

            const overlapped = this.selected.test_case_viewer.drawAndUpdateFromElecting(drawer, mouse_pos, mouse.wasPressed(MouseButton.Left), main_view);
            if (overlapped !== null) {
                drawer.highlightMolecule(overlapped.value.type, getSexprGrandChildView(overlapped.parent_view, overlapped.address));
                EditingSolution.printName(overlapped.value, drawer);
            }

            if (keyboard.wasPressed(KeyCode.Escape)) {
                this.selected = null;
            }
        }

        return null;
    }
}

export class TestCaseViewer {
    constructor(
        private level: LevelDescription,
        private cur_test_case_n: number = 0,
    ) { }

    getInput(): SexprLiteral {
        const [sample_in, sample_out] = this.level.generate_test(this.cur_test_case_n);
        return sample_in;
    }

    drawAndUpdateFromEditing(drawer: Drawer, mouse_pos: Vec2, was_mouse_pressed: boolean, main_view: SexprView): OverlappedThing | null {
        const test_case_view = offsetView(main_view, new Vec2(-20, -6));
        return this.drawAndUpdate(drawer, mouse_pos, was_mouse_pressed, test_case_view);
    }

    private drawAndUpdate(drawer: Drawer, mouse_pos: Vec2, was_mouse_pressed: boolean, test_case_view: SexprView): OverlappedThing | null {
        const [sample_in, sample_out] = this.level.generate_test(this.cur_test_case_n);
        const overlaps = [
            drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, sample_out, test_case_view),
            drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, sample_in, offsetView(test_case_view, new Vec2(-15, 0))),
        ];
        drawer.line(offsetView(test_case_view, new Vec2(-2.75, 0)), [
            new Vec2(-3, 0),
            new Vec2(0, 0),
            new Vec2(-1, 1),
            new Vec2(0, 0),
            new Vec2(-1, -1),
        ]);
        const asdf1 = offsetView(test_case_view, new Vec2(-19, 2.5));
        if (drawer.drawArrow(mouse_pos, 'down', asdf1)) {
            drawer.highlightPlus(asdf1);
            if (was_mouse_pressed) {
                this.cur_test_case_n -= 1;
            }
        }
        const asdf2 = offsetView(test_case_view, new Vec2(-19, -2.5));
        if (drawer.drawArrow(mouse_pos, 'up', asdf2)) {
            drawer.highlightPlus(asdf2);
            if (was_mouse_pressed) {
                this.cur_test_case_n += 1;
            }
        }
        return firstNonNull(overlaps);
    }

    drawAndUpdateFromElecting(drawer: Drawer, mouse_pos: Vec2, was_mouse_pressed: boolean, main_view: SexprView) {
        const test_case_view = scaleAndOffsetView(main_view, new Vec2(32, 0), 2);
        return this.drawAndUpdate(drawer, mouse_pos, was_mouse_pressed, test_case_view);
    }
}
