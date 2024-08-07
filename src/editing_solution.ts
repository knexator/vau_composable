import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, getPoleAtPosition, getAtPosition, fakeCollapsed, offsetView, sexprAdressFromScreenPosition, getSexprGrandChildView, getFnkNameView } from './drawer';
import { ExecutingSolution, ExecutionState } from './executing_solution';
import { KeyCode, Keyboard, Mouse, MouseButton } from './kommon/input';
import { assertNotNull, at, assert, fromCount } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate, setAt, deletePole, addPoleAsFirstChild, getAtLocalAddress, setAtLocalAddress, parseSexprTemplate, parseSexprLiteral, SexprAddress, movePole, cloneSexpr, fixExtraPolesNeeded, isLiteral, SexprNullable, newFnk } from './model';
import { inRange } from './kommon/math';

type MouseLocation = FullAddress
    | { type: 'input', address: SexprAddress }
    | { type: 'toolbar', value: SexprTemplate, view: SexprView }
    | { type: 'cell', cell: number, address: SexprAddress }
    | { type: 'other_fnks', value: SexprLiteral, view: SexprView };
export class EditingSolution {
    private collapsed: Collapsed;

    private mouse_location: MouseLocation | null;
    // TODO: baaad
    public mouse_holding: SexprTemplate | null;

    constructor(
        private all_fnks: FunktionDefinition[],
        private fnk: FunktionDefinition,
        private input: SexprLiteral,
        private cells: SexprTemplate[],
        private previously_editing: EditingSolution | null = null,
    ) {
        this.collapsed = fakeCollapsed(nothingCollapsed(fnk.cases));
        // this.matched = nothingMatched(fnk.cases);
        this.mouse_location = null;
        this.mouse_holding = null;
        // this.cells = fromCount(3, _ => parseSexprTemplate('1'));
    }

    private *toolbarThings(main_view: SexprView): Generator<{ value: SexprTemplate, view: SexprView }, void, void> {
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

        for (let k = 0; k < 8; k++) {
            yield {
                value: { type: 'variable', value: k.toString() },
                view: {
                    pos: offsetView(main_view, new Vec2(k * 6 + 12, -4)).pos,
                    halfside: main_view.halfside / 3,
                    turns: main_view.turns,
                },
            };
        }
    }

    private *otherFnks(main_view: SexprView): Generator<{ value: SexprLiteral, view: SexprView }, void, void> {
        for (let k = 0; k < this.all_fnks.length; k++) {
            yield {
                value: this.all_fnks[k].name,
                view: {
                    pos: offsetView(main_view, new Vec2(-6 - Math.floor(k / 6) * 6, 15 + (k % 6) * 8)).pos,
                    halfside: main_view.halfside / 2,
                    turns: main_view.turns - 0.25,
                },
            };
        }

        // built in
        const built_in = ['#identity', '#eqAtoms?'].map(parseSexprLiteral);
        for (let k = 0; k < built_in.length; k++) {
            yield {
                value: built_in[k],
                view: {
                    pos: offsetView(main_view, new Vec2(0, 23 + k * 8)).pos,
                    halfside: main_view.halfside / 2,
                    turns: main_view.turns - 0.25,
                },
            };
        }
    }

    private newFnkButton(main_view: SexprView): { center: Vec2, radius: number } {
        return {
            center: offsetView(main_view, new Vec2(0, 13.5)).pos,
            radius: main_view.halfside / 2,
        };
    }

    draw(drawer: Drawer, global_t: number, view_offset: Vec2) {
        drawer.ctx.globalAlpha = 1;
        const main_view = this.getMainView(drawer.getScreenSize(), view_offset);

        {
            const { center, radius } = this.newFnkButton(main_view);
            drawer.ctx.beginPath();
            drawer.ctx.strokeStyle = 'black';
            drawer.drawCircle(center, radius);
            drawer.ctx.stroke();

            drawer.ctx.beginPath();
            drawer.ctx.moveTo(center.x - radius / 2, center.y);
            drawer.ctx.lineTo(center.x + radius / 2, center.y);
            drawer.ctx.moveTo(center.x, center.y - radius / 2);
            drawer.ctx.lineTo(center.x, center.y + radius / 2);
            drawer.ctx.stroke();
        }

        for (let k = 0; k < 3; k++) {
            drawer.drawMolecule(this.cells[k], this.getCellView(drawer.getScreenSize(), k));
        }

        drawer.drawFunktion(this.fnk, main_view, this.collapsed.inside, global_t, nothingMatched(this.fnk.cases));
        drawer.drawMolecule(this.input, main_view);

        for (const { value, view } of this.otherFnks(main_view)) {
            drawer.drawMolecule(value, view);
        }

        for (const { value, view } of this.toolbarThings(main_view)) {
            drawer.drawMolecule(value, view);
        }

        if (this.mouse_holding !== null) {
            if (this.mouse_location !== null) {
                if (this.mouse_location.type === 'toolbar' || this.mouse_location.type === 'other_fnks') {
                    // nothing
                }
                else if (this.mouse_location.type === 'input') {
                    drawer.drawMolecule(this.mouse_holding, getSexprGrandChildView(main_view, this.mouse_location.address));
                }
                // TODO: this case wouldnt be needed if getView worked for main fnk name
                else if (this.mouse_location.type === 'fn_name' && this.mouse_location.major.length === 0) {
                    drawer.drawMolecule(this.mouse_holding, getSexprGrandChildView(getFnkNameView(main_view), this.mouse_location.minor));
                }
                else if (this.mouse_location.type === 'pattern') {
                    drawer.drawPattern(this.mouse_holding, getView(main_view, this.mouse_location, this.collapsed));
                }
                else if (this.mouse_location.type === 'cell') {
                    drawer.drawMolecule(this.mouse_holding, getSexprGrandChildView(this.getCellView(drawer.getScreenSize(), this.mouse_location.cell), this.mouse_location.address));
                }
                else {
                    drawer.drawMolecule(this.mouse_holding, getView(main_view, this.mouse_location, this.collapsed));
                }
            }
            drawer.drawMolecule(this.mouse_holding, this.getExtraView(drawer.getScreenSize()));
        }

        if (this.mouse_location !== null) {
            if (this.mouse_location.type === 'toolbar') {
                if (this.mouse_holding === null) drawer.highlightMolecule(this.mouse_location.value.type, this.mouse_location.view);
            }
            else if (this.mouse_location.type === 'other_fnks') {
                if (this.mouse_holding === null) drawer.highlightMolecule(this.mouse_location.value.type, this.mouse_location.view);
            }
            else if (this.mouse_location.type === 'input') {
                drawer.highlightMolecule(getAtLocalAddress(this.input, this.mouse_location.address)!.type, getSexprGrandChildView(main_view, this.mouse_location.address));
            }
            else if (this.mouse_location.type === 'cell') {
                drawer.highlightMolecule(
                    this.getValueAtMouseLocation(this.mouse_location).type,
                    getSexprGrandChildView(this.getCellView(drawer.getScreenSize(), this.mouse_location.cell), this.mouse_location.address));
            }
            else if (this.mouse_location.major.length === 0) {
                drawer.highlightMolecule(getAtLocalAddress(this.fnk.name, this.mouse_location.minor)!.type,
                    getSexprGrandChildView(getFnkNameView(main_view), this.mouse_location.minor));
            }
            else if (this.mouse_location.type === 'pattern') {
                drawer.highlightPattern(getAt(this.fnk.cases, this.mouse_location)!.type, getView(main_view, this.mouse_location, this.collapsed));
            }
            else {
                drawer.highlightMolecule(getAt(this.fnk.cases, this.mouse_location)!.type, getView(main_view, this.mouse_location, this.collapsed));
            }
        }

        // print atom names
        if (this.mouse_location !== null && this.mouse_holding === null) {
            const hovered_value = this.getValueAtMouseLocation(this.mouse_location);
            drawer.ctx.fillStyle = 'black';
            const screen_size = drawer.getScreenSize();
            drawer.ctx.font = `bold ${Math.floor(screen_size.y / 30)}px sans-serif`;
            drawer.ctx.textAlign = 'center';
            drawer.ctx.fillText(sexprToString(hovered_value, '@'), screen_size.x * 0.5, screen_size.y * 0.95);
        }
    }

    update(drawer: Drawer, mouse: Mouse, keyboard: Keyboard, global_t: number, offset: Vec2): EditingSolution | null {
        const main_view = this.getMainView(drawer.getScreenSize(), offset);

        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        {
            const { center, radius } = this.newFnkButton(main_view);
            if (mouse.wasPressed(MouseButton.Left) && raw_mouse_pos.sub(center).mag() <= radius) {
                this.all_fnks.push(newFnk(this.all_fnks));
            }
        }

        const pole = getPoleAtPosition(this.fnk, main_view, this.collapsed.inside, raw_mouse_pos);
        if (pole !== null) {
            if (pole.type === 'main') {
                if (mouse.wasPressed(MouseButton.Left)) {
                    this.collapsed.inside = toggleCollapsed(this.collapsed.inside, pole.address, global_t);
                }
                else if (mouse.wasPressed(MouseButton.Right)) {
                    const [new_cases, new_collapsed] = deletePole(this.fnk.cases, this.collapsed, pole.address);
                    if (new_cases !== 'return') {
                        this.fnk.cases = new_cases;
                        this.collapsed = fixExtraPolesNeeded(fakeCollapsed(new_collapsed));
                    }
                }
                else if (mouse.wheel != 0 || keyboard.wasPressed(KeyCode.KeyW) || keyboard.wasPressed(KeyCode.KeyS)) {
                    const move_up = mouse.wheel < 0 || keyboard.wasPressed(KeyCode.KeyW);
                    const [new_cases, new_collapsed] = movePole(this.fnk.cases, this.collapsed.inside, pole.address, move_up);
                    this.fnk.cases = new_cases;
                    this.collapsed = fixExtraPolesNeeded(fakeCollapsed(new_collapsed));
                }
            }
            else if (pole.type === 'add') {
                if (mouse.wasPressed(MouseButton.Left) || mouse.wasPressed(MouseButton.Right)) {
                    // TODO: add pole at the proper place
                    const [new_cases, new_collapsed] = addPoleAsFirstChild(this.fnk.cases, this.collapsed.inside, pole.address.slice(0, -1), global_t, []);
                    this.fnk.cases = new_cases;
                    this.collapsed = fixExtraPolesNeeded(fakeCollapsed(new_collapsed));
                }
            }
            else if (pole.type === 'return') {
                if (mouse.wasPressed(MouseButton.Left) || mouse.wasPressed(MouseButton.Right)) {
                    const [new_cases, new_collapsed] = addPoleAsFirstChild(this.fnk.cases, this.collapsed.inside, pole.address, global_t, []);
                    this.fnk.cases = new_cases;
                    this.collapsed = fixExtraPolesNeeded(fakeCollapsed(new_collapsed));
                }
            }
        }

        this.mouse_location = null;
        {
            const main_fnk_address = sexprAdressFromScreenPosition(raw_mouse_pos, this.fnk.name, getFnkNameView(main_view));
            if (main_fnk_address !== null) {
                this.mouse_location = { type: 'fn_name', major: [], minor: main_fnk_address };
            }
        }

        if (this.mouse_location === null) {
            this.mouse_location = getAtPosition(this.fnk, main_view, this.collapsed, raw_mouse_pos);
        }

        if (this.mouse_location === null) {
            const input_address = sexprAdressFromScreenPosition(raw_mouse_pos, this.input, main_view);
            if (input_address !== null) {
                this.mouse_location = { type: 'input', address: input_address };
            }
        }

        if (this.mouse_location === null) {
            for (const { value, view } of this.toolbarThings(main_view)) {
                if (sexprAdressFromScreenPosition(raw_mouse_pos, value, view) !== null) {
                    this.mouse_location = { type: 'toolbar', value, view };
                }
            }
        }

        if (this.mouse_location === null) {
            for (const { value, view } of this.otherFnks(main_view)) {
                if (sexprAdressFromScreenPosition(raw_mouse_pos, value, view) !== null) {
                    this.mouse_location = { type: 'other_fnks', value, view };
                }
            }
        }

        if (this.mouse_location === null) {
            for (let k = 0; k < 3; k++) {
                const asdf = sexprAdressFromScreenPosition(raw_mouse_pos, this.cells[k], this.getCellView(drawer.getScreenSize(), k));
                if (asdf !== null) {
                    this.mouse_location = { type: 'cell', cell: k, address: asdf };
                    break;
                }
            }
        }

        if (this.mouse_holding === null) {
            if (this.mouse_location !== null && mouse.wasPressed(MouseButton.Left)) {
                // pick up
                this.mouse_holding = cloneSexpr(this.getValueAtMouseLocation(this.mouse_location));
            }
            else if (this.mouse_location !== null && 
                (mouse.wasPressed(MouseButton.Middle) || keyboard.wasPressed(KeyCode.Enter))) {
                // go to function
                const name = this.getValueAtMouseLocation(this.mouse_location);
                if (isLiteral(name)) {
                    const lit_name = assertLiteral(name);
                    const other_fnk = this.all_fnks.find(v => equalSexprs(v.name, lit_name));
                    if (other_fnk !== undefined && other_fnk !== this.fnk) {
                        return new EditingSolution(this.all_fnks, other_fnk, this.input, this.cells, this.withoutInteractions());
                    }
                }
            }
            else if (this.mouse_location !== null && mouse.wasPressed(MouseButton.Right)) {
                // split
                const cur_value = this.getValueAtMouseLocation(this.mouse_location);
                const new_value: SexprTemplate = { type: 'pair', left: cloneSexpr(cur_value), right: cloneSexpr(cur_value) };
                this.dropValueAtMouseLocation(this.mouse_location, new_value);
            }
        }
        else {
            // Drop the holding thing
            if (!mouse.isDown(MouseButton.Left) && this.mouse_holding !== null) {
                if (this.mouse_location !== null) {
                    this.dropValueAtMouseLocation(this.mouse_location, this.mouse_holding);
                }
                this.mouse_holding = null;
            }
        }

        // change atom names
        if (this.mouse_location !== null && this.mouse_holding === null) {
            const hovered_value = this.getValueAtMouseLocation(this.mouse_location);
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

        if (keyboard.wasPressed(KeyCode.Escape) && this.previously_editing !== null) {
            return this.previously_editing;
        }

        return null;
    }

    withoutInteractions(): EditingSolution {
        this.mouse_location = null;
        this.mouse_holding = null;
        return this;
    }

    private dropValueAtMouseLocation(loc: MouseLocation, value: SexprTemplate): void {
        if (loc.type === 'toolbar' || loc.type === 'other_fnks') {
            // nothing
        }
        else if (loc.type === 'input') {
            try {
                this.input = assertLiteral(setAtLocalAddress(this.input, loc.address, value));
            }
            catch {
                // nothing
            }
        }
        else if (loc.type === 'cell') {
            this.cells[loc.cell] = setAtLocalAddress(
                this.cells[loc.cell], loc.address, value,
            );
        }
        else if (loc.major.length === 0) {
            try {
                const lit = assertLiteral(setAtLocalAddress(this.fnk.name, loc.minor, value));
                this.fnk.name = lit;
            }
            catch {
                // nothing
            }
        }
        else {
            this.fnk.cases = setAt(this.fnk.cases, loc, value);
        }
    }

    private getValueAtMouseLocation(loc: MouseLocation): SexprTemplate {
        if (loc.type === 'toolbar') {
            return loc.value;
        }
        else if (loc.type === 'other_fnks') {
            return loc.value;
        }
        else if (loc.type === 'input') {
            return assertNotNull(getAtLocalAddress(this.input, loc.address));
        }
        else if (loc.type === 'cell') {
            return assertNotNull(getAtLocalAddress(this.cells[loc.cell], loc.address));
        }
        else if (loc.major.length === 0) {
            return assertNotNull(getAtLocalAddress(this.fnk.name, loc.minor));
        }
        else {
            return assertNotNull(getAt(this.fnk.cases, loc));
        }
    }

    startExecution() {
        return new ExecutingSolution(this.all_fnks, this.fnk, this.input, this);
    }

    private getMainView(screen_size: Vec2, offset: Vec2): SexprView {
        const view = {
            pos: screen_size.mul(new Vec2(0.1, 0.175)).add(offset),
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

    private getCellView(screen_size: Vec2, k: number): SexprView {
        assert(inRange(k, 0, 3));
        return {
            pos: screen_size.mul(new Vec2(0.7775, 0.5 + k * 0.1975)),
            halfside: screen_size.y * 0.5 / 5.5,
            turns: 0,
        };
    }
}
