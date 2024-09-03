import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, Drawer, toggleCollapsed, getPoleAtPosition, getAtPosition, fakeCollapsed, offsetView, sexprAdressFromScreenPosition, getSexprGrandChildView, getFnkNameView, Camera, OverlappedThing, ensureCollapsed, everythingCollapsedExceptFirsts, rotateAndScaleView, scaleAndOffsetView } from './drawer';
import { asMainFnk2, asMainInput, asMainInput2, drawHangingCases, drawHangingCasesModern, ExecutingSolution, ExecutionState, OverlappedExecutionThing } from './executing_solution';
import { KeyCode, Keyboard, Mouse, MouseButton } from './kommon/input';
import { assertNotNull, at, assert, fromCount, firstNonNull, eqArrays, startsWith, commonPrefixLen, last, single, filterIndices, replace } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress, parseSexprTemplate, parseSexprLiteral, SexprAddress, movePole, cloneSexpr, fixExtraPolesNeeded, isLiteral, SexprNullable, newFnk, knownVariables, doAtom, LevelDescription, PersistenceStuff } from './model';
import { inRange } from './kommon/math';
import { EditingSolution } from './editing_solution';

export class ElectingSolution {
    constructor(
        private persistence: PersistenceStuff,
        private selected_name: { value: SexprLiteral, view: SexprView } | null = null,
        private cur_test_case_n: number = 0,
    ) { }

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

        for (const { value, view } of EditingSolution.otherFnksNew(this.all_fnks, main_view)) {
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
                if (this.selected_name !== null && equalSexprs(fn_name, this.selected_name.value)) {
                    const fnk = this.all_fnks.find(x => equalSexprs(x.name, fn_name));
                    if (fnk !== undefined) {
                        // TODO: use test case as input
                        return new EditingSolution(this.persistence, fnk, doAtom('nil'));
                    }
                }
                else {
                    this.selected_name = { value: fn_name, view: overlapped.parent_view };
                }
            }
        }

        if (this.selected_name !== null) {
            drawer.highlightThing('fn_name', this.selected_name.value.type, EditingSolution.viewOfFnk(this.selected_name.value, this.all_fnks, main_view));
            const level_description = this.all_levels.find(x => equalSexprs(x.name, this.selected_name!.value));
            if (level_description !== undefined) {
                drawer.ctx.fillStyle = 'black';
                const screen_size = drawer.getScreenSize();
                drawer.ctx.font = `bold ${Math.floor(screen_size.y / 30)}px sans-serif`;
                drawer.ctx.textAlign = 'center';
                drawer.ctx.fillText(level_description.description, screen_size.x * 0.5, screen_size.y * 0.5);

                // test cases
                const [sample_in, sample_out] = level_description.generate_test(this.cur_test_case_n);
                const test_case_view = scaleAndOffsetView(main_view, new Vec2(32, 0), 2);
                drawer.drawMoleculePlease(sample_out, test_case_view);
                drawer.drawMoleculePlease(sample_in, offsetView(test_case_view, new Vec2(-15, 0)));
                drawer.line(offsetView(test_case_view, new Vec2(-2.75, 0)), [
                    new Vec2(-3, 0),
                    new Vec2(0, 0),
                    new Vec2(-1, 1),
                    new Vec2(0, 0),
                    new Vec2(-1, -1),
                ]);
                const asdf1 = offsetView(test_case_view, new Vec2(-19, 2.5));
                if (drawer.drawPlus(mouse_pos, asdf1)) {
                    drawer.highlightPlus(asdf1);
                    if (mouse.wasPressed(MouseButton.Left)) {
                        this.cur_test_case_n -= 1;
                    }
                }
                const asdf2 = offsetView(test_case_view, new Vec2(-19, -2.5));
                if (drawer.drawPlus(mouse_pos, asdf2)) {
                    drawer.highlightPlus(asdf2);
                    if (mouse.wasPressed(MouseButton.Left)) {
                        this.cur_test_case_n += 1;
                    }
                }
            }
        }
        else {
            this.selected_name = {
                value: doAtom('reverse'), view: {
                    pos: Vec2.zero,
                    halfside: 0,
                    turns: 0,
                },
            };
        }

        return null;
    }
}
