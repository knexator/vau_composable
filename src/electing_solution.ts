import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, Drawer, toggleCollapsed, getPoleAtPosition, getAtPosition, fakeCollapsed, offsetView, sexprAdressFromScreenPosition, getSexprGrandChildView, getFnkNameView, Camera, OverlappedThing, ensureCollapsed, everythingCollapsedExceptFirsts, rotateAndScaleView, scaleAndOffsetView } from './drawer';
import { asMainFnk2, asMainInput, asMainInput2, drawHangingCases, drawHangingCasesModern, ExecutingSolution, ExecutionState, OverlappedExecutionThing } from './executing_solution';
import { KeyCode, Keyboard, Mouse, MouseButton } from './kommon/input';
import { assertNotNull, at, assert, fromCount, firstNonNull, eqArrays, startsWith, commonPrefixLen, last, single, filterIndices, replace } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress, parseSexprTemplate, parseSexprLiteral, SexprAddress, movePole, cloneSexpr, fixExtraPolesNeeded, isLiteral, SexprNullable, newFnk, knownVariables, doAtom } from './model';
import { inRange } from './kommon/math';
import { EditingSolution } from './editing_solution';

export class ElectingSolution {
    constructor(
        private all_fnks: FunktionDefinition[],
    ) { }

    drawAndUpdate(drawer: Drawer, global_t: number, camera: Camera, mouse: Mouse, keyboard: Keyboard): ElectingSolution | EditingSolution | null {
        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const overlaps: (OverlappedThing | null)[] = [];

        const main_view = ExecutingSolution.getMainView(drawer.getScreenSize(), camera);

        // ExecutionState.drawMainFnkName(drawer, mouse_pos, main_view, this.fnk.name);
        drawer.line(main_view, [
            new Vec2(-2, 0),
            new Vec2(-50, 0),
        ]);

        for (const { value, view } of EditingSolution.otherFnksNew(this.all_fnks, main_view)) {
            if (drawer.drawMoleculePleaseAndReturnThingUnderMouse(mouse_pos, value, view) !== null) {
                overlaps.push({ kind: 'template', parent_view: view, value, address: [] });
            }
        }

        // test cases
        const test_case_view = offsetView(main_view, new Vec2(-20, -6));
        drawer.drawMoleculePlease(doAtom('nil'), test_case_view);
        drawer.drawMoleculePlease(doAtom('nil'), offsetView(test_case_view, new Vec2(-15, 0)));
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

        const overlapped = firstNonNull(overlaps);
        if (overlapped !== null) {
            drawer.highlightThing('fn_name', overlapped.value.type, overlapped.parent_view);
            EditingSolution.printName(overlapped.value, drawer);

            if (keyboard.wasPressed(KeyCode.Space)) {
                const fn_name = assertLiteral(overlapped.value);
                const fnk = this.all_fnks.find(x => equalSexprs(x.name, fn_name));
                if (fnk !== undefined) {
                    // TODO: use test case as input
                    // TODO: keep cells
                    return new EditingSolution(this.all_fnks, fnk, doAtom('nil'), fromCount(3, _ => doAtom('nil')));
                }
            }
        }

        return null;
    }
}
