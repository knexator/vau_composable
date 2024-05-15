import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, getPoleAtPosition, getAtPosition } from './drawer';
import { Mouse, MouseButton } from './kommon/input';
import { assertNotNull, last } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress } from './model';

export class EditingSolution {
    private collapsed: Collapsed[];
    private matched: MatchedInput[];

    private mouse_location: FullAddress | null;
    private mouse_holding: SexprTemplate | null;

    constructor(
        private all_fnks: FunktionDefinition[],
        private fnk: FunktionDefinition,
        private input: SexprLiteral,
    ) {
        this.collapsed = nothingCollapsed(fnk.cases);
        this.matched = nothingMatched(fnk.cases);
        this.mouse_location = null;
        this.mouse_holding = null;
    }

    draw(drawer: Drawer, global_t: number) {
        drawer.ctx.globalAlpha = 1;
        const main_view = this.getMainView(drawer.getScreenSize());

        drawer.drawFunktion(this.fnk, main_view, this.collapsed, global_t, this.matched);
        drawer.drawMolecule(this.input, main_view);

        if (this.mouse_holding !== null) {
            if (this.mouse_location !== null) {
                if (this.mouse_location.type === 'pattern') {
                    drawer.drawPattern(this.mouse_holding, getView(main_view, this.mouse_location));
                } else {
                    drawer.drawMolecule(this.mouse_holding, getView(main_view, this.mouse_location));
                }
            }
            drawer.drawMolecule(this.mouse_holding, this.getExtraView(drawer.getScreenSize()));
        }

        if (this.mouse_location !== null) {
            if (this.mouse_location.major.length === 0) {
                // TODO: proper view for fnk name
                drawer.highlightMolecule(getAtLocalAddress(this.fnk.name, this.mouse_location.minor)!.type, getView(main_view, this.mouse_location));
            } else if (this.mouse_location.type === 'pattern') {
                drawer.highlightPattern(getAt(this.fnk.cases, this.mouse_location)!.type, getView(main_view, this.mouse_location));
            } else {
                drawer.highlightMolecule(getAt(this.fnk.cases, this.mouse_location)!.type, getView(main_view, this.mouse_location));
            }
        }
    }

    update(drawer: Drawer, mouse: Mouse, global_t: number) {
        const view = this.getMainView(drawer.getScreenSize());

        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const pole = getPoleAtPosition(this.fnk, view, this.collapsed, raw_mouse_pos);
        if (pole !== null) {
            if (mouse.wasPressed(MouseButton.Left)) {
                this.collapsed = toggleCollapsed(this.collapsed, pole, global_t);
            } else if (mouse.wasPressed(MouseButton.Right)) {
                const new_cases = deletePole(this.fnk.cases, pole);
                if (new_cases !== 'return') {
                    this.fnk.cases = new_cases;
                    // TODO: respect collapsed & matched
                    this.collapsed = nothingCollapsed(this.fnk.cases);
                    this.matched = nothingMatched(this.fnk.cases);
                }
            }
        }

        this.mouse_location = getAtPosition(this.fnk, view, this.collapsed, raw_mouse_pos);
        if (this.mouse_location !== null && this.mouse_location.type === "fn_name" && mouse.wasPressed(MouseButton.Right)) {
            this.fnk.cases = addPoleAsFirstChild(this.fnk.cases, this.mouse_location.major);
            // TODO: respect collapsed & matched
            this.collapsed = nothingCollapsed(this.fnk.cases);
            this.matched = nothingMatched(this.fnk.cases);
        }

        if (this.mouse_holding === null) {
            if (this.mouse_location !== null && mouse.wasPressed(MouseButton.Left)) {
                if (this.mouse_location.major.length === 0) {
                    this.mouse_holding = getAtLocalAddress(this.fnk.name, this.mouse_location.minor);
                } else {
                    this.mouse_holding = getAt(this.fnk.cases, this.mouse_location);
                }
            }
        } else {
            if (!mouse.isDown(MouseButton.Left) && this.mouse_holding !== null) {
                if (this.mouse_location !== null) {
                    if (this.mouse_location.major.length === 0) {
                        try {
                            const lit = assertLiteral(setAtLocalAddress(this.fnk.name, this.mouse_location.minor, this.mouse_holding));
                            this.fnk.name = lit;
                        } catch {
                            // nothing
                        }
                    } else {
                        this.fnk.cases = setAt(this.fnk.cases, this.mouse_location, this.mouse_holding);
                    }
                }
                this.mouse_holding = null;
            }
        }
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

    private getExtraView(screen_size: Vec2): SexprView {
        return {
            pos: screen_size.mul(new Vec2(0.625, 0.2125)),
            halfside: screen_size.y / 5.5,
            turns: 0,
        };
    }
}
