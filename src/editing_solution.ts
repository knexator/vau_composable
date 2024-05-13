import { Vec2 } from '../../kanvas2d/dist/kanvas2d';
import { FloatingBinding, Collapsed, MatchedInput, nothingCollapsed, nothingMatched, SexprView, getView, generateFloatingBindings, updateMatchedForNewPattern, updateMatchedForMissingTemplate, Drawer, lerpSexprView, toggleCollapsed, getPoleAtPosition } from './drawer';
import { Mouse, MouseButton } from './kommon/input';
import { assertNotNull, last } from './kommon/kommon';
import { MatchCaseAddress, FunktionDefinition, SexprLiteral, generateBindings, getAt, getCaseAt, fillTemplate, fillFnkBindings, assertLiteral, equalSexprs, sexprToString, FullAddress, SexprTemplate } from './model';

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


        drawer.drawMolecule({
            type: 'atom', value: 'v1'
        }, getView(main_view, {
            type: 'fn_name',
            major: [0],
            minor: []
        }));
    }

    update(drawer: Drawer, mouse: Mouse, global_t: number) {
        const view = this.getMainView(drawer.getScreenSize());

        const rect = drawer.ctx.canvas.getBoundingClientRect();
        const raw_mouse_pos = new Vec2(mouse.clientX - rect.left, mouse.clientY - rect.top);

        const asdf = getPoleAtPosition(this.fnk, view, this.collapsed, raw_mouse_pos);
        if (asdf !== null && mouse.wasPressed(MouseButton.Left)) {
            this.collapsed = toggleCollapsed(this.collapsed, asdf, global_t);
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
}
