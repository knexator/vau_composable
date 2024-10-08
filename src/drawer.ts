import { Color, Transform, Vec2 } from 'kanvas2d';
import { DefaultMap, DefaultMapExtra, assert, assertNotNull, at, fromCount, or, replace, reversedForEach, single, zip2 } from './kommon/kommon';
import { in01, inRange, isPointInPolygon, lerp, mod, randomFloat, randomInt, remap } from './kommon/math';
import { SexprAddress, FunktionDefinition, MatchCaseDefinition, MatchCaseAddress, SexprLiteral, SexprNullable, SexprTemplate, addressesOfVariableInTemplates, generateBindings, FullAddress, changeVariablesToNull, getCaseAt, allCases, countExtraPolesNeeded, getAtLocalAddress, allVariableNames } from './model';
import Rand from 'rand-seed';
import { Random } from './kommon/random';
import { Mouse } from './kommon/input';

export const COLLAPSE_DURATION = 0.15;
const SPIKE_PERC = 1 / 2;
export type SexprView = { pos: Vec2, halfside: number, turns: number };
export type OverlappedThing = { kind: 'template' | 'pattern', parent_view: SexprView, address: SexprAddress, value: SexprTemplate };

const COLORS = {
    chair: Color.fromInt(0x4e6ebe),
    cons: Color.fromInt(0x404040),
    pole: Color.fromInt(0x404040),
    return: Color.fromInt(0xc06060),
};

export class Camera {
    // an object at [camera.topleft] will be drawn on the top left of the screen
    // an object at [camera.topleft.addX(scale)] will be drawn one screen height to the right of that
    constructor(
        public topleft: Vec2 = Vec2.zero,
        public scale: number = 1,
    ) { }

    worldToScreen([world_pos, world_size]: [Vec2, number], screen_side: number): [Vec2, number] {
        const screen_pos = world_pos.sub(this.topleft).scale(screen_side / this.scale);
        const screen_size = world_size * (screen_side / this.scale);
        return [screen_pos, screen_size];
    }

    screenToWorld([screen_pos, screen_size]: [Vec2, number], screen_side: number): [Vec2, number] {
        const world_pos = screen_pos.scale(this.scale / screen_side).add(this.topleft);
        const world_size = screen_size * (this.scale / screen_side);
        return [world_pos, world_size];
    }

    viewAt(world_pos: Vec2, world_size: number, screen_side: number): SexprView {
        const [pos, halfside] = this.worldToScreen([world_pos, world_size], screen_side);
        return { pos, halfside, turns: 0 };
    }

    move(dir: Vec2, dt: number) {
        this.topleft = this.topleft.add(dir.scale(this.scale * dt));
    }

    zoomInner(mouse_screen_pos: Vec2, screen_side: number, factor: number) {
        const [mouse_world_pos, _] = this.screenToWorld([mouse_screen_pos, 0], screen_side);
        const delta = this.topleft.sub(mouse_world_pos);
        this.scale /= factor;
        this.topleft = mouse_world_pos.add(delta.scale(1 / factor));
    }

    zoom(wheel: number, mouse_screen_pos: Vec2, screen_side: number, factor: number = 1.1) {
        if (wheel === 0) return;
        this.zoomInner(mouse_screen_pos, screen_side, wheel < 0 ? factor : 1 / factor);
    }
}

export class Drawer {
    constructor(
        public ctx: CanvasRenderingContext2D,
    ) { }

    drawFnkAttachPoint(view: SexprView) {
        this.ctx.strokeStyle = 'black';
        this.ctx.beginPath();
        this.drawArc(view.pos, 0.25 * view.halfside, 0, 1);
        this.ctx.stroke();

        this.line(view, [
            new Vec2(0, -1),
            new Vec2(0, -3),
        ]);
    }

    drawAttachPoint(view: SexprView) {
        this.ctx.strokeStyle = 'black';
        this.ctx.beginPath();
        this.drawArc(view.pos, 0.25 * view.halfside, 0, 1);
        this.ctx.stroke();
    }

    highlightPlus(view: SexprView) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'cyan';
        this.ctx.lineWidth = 2;
        this.drawCircle(view.pos, view.halfside / 2);
        this.ctx.stroke();
        this.ctx.lineWidth = 1;
    }

    highlightThing(
        kind: 'template' | 'pattern' | 'fn_name',
        type: 'pair' | 'variable' | 'atom',
        view: SexprView,
    ) {
        if (kind === 'pattern') {
            this.highlightPattern(type, view);
        }
        else {
            this.highlightMolecule(type, view);
        }
    }

    line(view: SexprView, points: Vec2[]): void {
        if (points.length < 2) return;
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'black';
        this.moveTo(offsetView(view, points[0]).pos);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(offsetView(view, points[k]).pos);
        }
        this.ctx.stroke();
    }

    drawPlus(mouse_pos: Vec2 | null, view: SexprView): boolean {
        const r = 1;
        this.line(view, [
            new Vec2(-r, 0),
            new Vec2(r, 0),
        ]);
        this.line(view, [
            new Vec2(0, -r),
            new Vec2(0, r),
        ]);
        if (mouse_pos === null) return false;
        return computeOffset(view, mouse_pos).mag() < 2;
    }

    drawArrow(mouse_pos: Vec2 | null, dir: 'up' | 'down', view: SexprView): boolean {
        const r = 1;
        const s = dir === 'up' ? 1 : -1;
        this.line(view, [
            new Vec2(-r, s * r / 2),
            new Vec2(0, -s * r / 2),
            new Vec2(r, s * r / 2),
        ]);
        if (mouse_pos === null) return false;
        return computeOffset(view, mouse_pos).mag() < 2;
    }

    drawCable(view: SexprView, variable_names: string[], points: Vec2[]) {
        if (points.length < 2) return;
        this.ctx.beginPath();
        this.ctx.strokeStyle = cable_patterns.get([view.halfside, variable_names]);
        this.ctx.lineWidth = 5 * view.halfside / 22;
        this.moveTo(offsetView(view, points[0]).pos);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(offsetView(view, points[k]).pos);
        }
        this.ctx.save();
        this.translate(offsetView(view, at(points, -1)).pos.addY(10));
        this.ctx.stroke();
        this.ctx.restore();
        this.ctx.lineWidth = 1;
    }

    getScreenSize(): Vec2 {
        return new Vec2(this.ctx.canvas.width, this.ctx.canvas.height);
    }

    clear() {
        this.ctx.globalAlpha = 1;
        this.ctx.resetTransform();
        this.ctx.fillStyle = 'gray';
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }

    drawFunktion(fnk: FunktionDefinition, view: SexprView, collapsed: Collapsed[], cur_time: number, matched: MatchedInput[]): void {
        const unit = view.halfside / 4;
        this.drawMoleculePlease(fnk.name, {
            pos: view.pos.add(new Vec2(-unit * 5, -unit * 2).rotateTurns(view.turns)),
            halfside: view.halfside,
            turns: view.turns - 0.25,
        });
        { // initial chair
            const points = [
                new Vec2(-2, 0),
                new Vec2(-1, -2),
                new Vec2(-5, 0),
                new Vec2(-5, 6),
                new Vec2(-3, 7),
                new Vec2(5, 7),
                new Vec2(5, 6),
                new Vec2(7, 7),
                new Vec2(11, 5),
                new Vec2(11, 4),
                new Vec2(0, 4),
            ].map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.chair.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        this.drawMatchers(fnk.cases, view, collapsed, cur_time, matched);
    }

    // drawMoleculeAndReturnThingUnderMouse(data: SexprTemplate, view: SexprView, mouse_screen_pos: Vec2): { address: SexprAddress, value: SexprTemplate } | null {
    //     this.drawMoleculeNonRecursive(data, view);
    //     if (data.type === 'pair') {
    //         this.drawMolecule(data.left, getSexprChildView(view, true));
    //         this.drawMolecule(data.right, getSexprChildView(view, false));
    //     }
    //     const address = sexprAdressFromScreenPosition(mouse_screen_pos, data, view);
    //     if (address === null) return null;
    //     return { address, value: assertNotNull(getAtLocalAddress(data, address)) };
    // }
    drawPatternAndReturnThingUnderMouse(mouse_screen_pos: Vec2 | null, cur_data: SexprTemplate, view: SexprView): OverlappedThing | null {
        this.drawPattern(cur_data, view);
        if (mouse_screen_pos === null) return null;
        const address = patternAdressFromScreenPosition(mouse_screen_pos, cur_data, view);
        if (address === null) return null;
        return { kind: 'pattern', address, value: assertNotNull(getAtLocalAddress(cur_data, address)), parent_view: view };
    }

    drawTemplateAndReturnThingUnderMouse(mouse_screen_pos: Vec2 | null, cur_data: SexprTemplate, original_data: SexprTemplate, view: SexprView): OverlappedThing | null {
        this.drawTemplate(cur_data, original_data, view);
        return this.returnTemplateUnderMouse(mouse_screen_pos, cur_data, view);
    }

    returnTemplateUnderMouse(mouse_screen_pos: Vec2 | null, cur_data: SexprTemplate, view: SexprView): OverlappedThing | null {
        if (mouse_screen_pos === null) return null;
        const address = sexprAdressFromScreenPosition(mouse_screen_pos, cur_data, view);
        if (address === null) return null;
        return { kind: 'template', address, value: assertNotNull(getAtLocalAddress(cur_data, address)), parent_view: view };
    }

    drawMoleculePleaseAndReturnThingUnderMouse(mouse_screen_pos: Vec2 | null, data: SexprTemplate, view: SexprView): OverlappedThing | null {
        return this.drawTemplateAndReturnThingUnderMouse(mouse_screen_pos, data, data, view);
    }

    drawMoleculePlease(data: SexprTemplate, view: SexprView) {
        this.drawTemplate(data, data, view);
    }

    drawPlease(type: FullAddress['type'], data: SexprTemplate, view: SexprView) {
        if (type === 'pattern') {
            this.drawPattern(data, view);
        }
        else {
            this.drawTemplate(data, data, view);
        }
    }

    drawTemplate(cur_data: SexprTemplate, original_data: SexprTemplate, view: SexprView) {
        switch (original_data.type) {
            case 'atom':
                if (cur_data.type !== 'atom') throw new Error('unreachable');
                this.drawMoleculeNonRecursive(original_data, view);
                break;
            case 'pair': {
                if (cur_data.type !== 'pair') throw new Error('unreachable');
                this.drawMoleculeNonRecursive(cur_data, view);
                this.drawTemplate(cur_data.left, original_data.left, getSexprChildView(view, true));
                this.drawTemplate(cur_data.right, original_data.right, getSexprChildView(view, false));

                const vars_left = allVariableNames(original_data.left);
                const vars_right = allVariableNames(original_data.right);
                if (vars_left.length > 0) {
                    this.drawCable(view, vars_left, [
                        new Vec2(-2, 0),
                        new Vec2(0, -2),
                        new Vec2(1, -2),
                    ]);
                }
                if (vars_right.length > 0) {
                    this.drawCable(view, vars_right, [
                        new Vec2(-2, 0),
                        new Vec2(0, 2),
                        new Vec2(1, 2),
                    ]);
                }
                break;
            }
            case 'variable':
                if (cur_data.type === 'variable') {
                    this.drawMoleculeNonRecursive(original_data, view);
                }
                else {
                    this.drawMoleculePlease(cur_data, view);
                    this.drawBoundedVariable(original_data.value, view);
                }
                break;
            default:
                throw new Error('unreachable');
        }
        // this.drawMoleculeNonRecursive(data, view);
    }

    drawEmergingValue(data: SexprLiteral, view: SexprView, emerged: number): void {
        this.ctx.fillStyle = 'red';
        this.ctx.save();
        this.ctx.beginPath();
        const points = [
            new Vec2(view.halfside * -SPIKE_PERC, 0),
            new Vec2(view.halfside * 0, -view.halfside),
            new Vec2(view.halfside * 3, -view.halfside),
            new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
            new Vec2(view.halfside * 3, view.halfside),
            new Vec2(view.halfside * 0, view.halfside),
        ].map(v => v.rotateTurns(view.turns))
            .map(v => view.pos.add(v));
        this.ctx.beginPath();
        this.moveTo(points[0]);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(points[k]);
        }
        this.ctx.closePath();
        this.ctx.clip();

        this.drawMoleculePlease(data, offsetView(view, new Vec2(lerp(-5, 0, emerged), 0)));

        this.ctx.restore();
    }

    // drawMolecule(data: SexprNullable, view: SexprView) {
    //     this.drawMoleculeNonRecursive(data, view);
    //     if (data.type === 'pair') {
    //         this.drawMolecule(data.left, getSexprChildView(view, true));
    //         this.drawMolecule(data.right, getSexprChildView(view, false));
    //     }
    // }

    drawPattern(data: SexprTemplate, view: SexprView) {
        this.drawPatternNonRecursive(data, view);
        if (data.type === 'pair') {
            this.drawPattern(data.left, getSexprChildView(view, true));
            this.drawPattern(data.right, getSexprChildView(view, false));

            const vars_left = allVariableNames(data.left);
            const vars_right = allVariableNames(data.right);
            if (vars_left.length > 0) {
                this.drawCable(view, vars_left, [
                    new Vec2(14, 0),
                    new Vec2(11, -2),
                    new Vec2(9, -2),
                ]);
            }
            if (vars_right.length > 0) {
                this.drawCable(view, vars_right, [
                    new Vec2(14, 0),
                    new Vec2(11, 2),
                    new Vec2(9, 2),
                ]);
            }
        }
    }

    // drawBindings(parent_view: SexprView, bindings: FloatingBinding[], t: number, collapsed: Collapsed) {
    //     bindings.forEach((x) => {
    //         const cur_view = lerpSexprView(x.source_view, getView(parent_view, x.target_address, collapsed), t);
    //         this.drawPatternNonRecursive({ type: 'variable', value: x.variable_name }, cur_view);
    //         this.drawMolecule(x.value, cur_view);
    //     }, this);
    // }

    drawBindingsNew(parent_view: SexprView, bindings: FloatingBinding[], t: number, collapsed: Collapsed) {
        bindings.forEach((x) => {
            const cur_view = lerpSexprView(getView(parent_view, x.source_address, collapsed), getView(parent_view, x.target_address, collapsed), t);
            this.drawTemplate(x.value, { type: 'variable', value: x.variable_name }, cur_view);
        }, this);
    }

    private drawPatternWithoutVariables(data: SexprTemplate, view: SexprView) {
        if (data.type === 'variable') return;
        this.drawPatternNonRecursive(data, view);
        if (data.type === 'pair') {
            this.drawPatternWithoutVariables(data.left, getSexprChildView(view, true));
            this.drawPatternWithoutVariables(data.right, getSexprChildView(view, false));
        }
    }

    private drawMatchers(cases: MatchCaseDefinition[], view: SexprView, collapsed: Collapsed[], cur_time: number, matched: MatchedInput[]) {
        if (cases.length === 0) return;
        const unit = view.halfside / 4;
        const collapsed_t = (cur_time - collapsed[0].main.changedAt) / COLLAPSE_DURATION;
        if (in01(collapsed_t)) {
            const collapse_amount = collapsed[0].main.collapsed ? collapsed_t : 1 - collapsed_t;

            {
                const points_tiny = [
                    new Vec2(0, 0),
                    new Vec2(4, -2),
                    new Vec2(4, -1),
                    new Vec2(3, 1),
                    new Vec2(4, 3),
                    new Vec2(4, 4),
                    new Vec2(0, 6),
                    new Vec2(-2, 5),
                    new Vec2(-2, 4),
                    new Vec2(-2, 3),
                    new Vec2(-2, 2),
                    new Vec2(-2, 1),
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                const points_full = [
                    new Vec2(0, 0),
                    new Vec2(4, -2),
                    new Vec2(4, 1),
                    new Vec2(2, 5),
                    new Vec2(4, 9),
                    new Vec2(4, 16),
                    new Vec2(0, 18),
                    new Vec2(-2, 17),
                    new Vec2(-2, 6),
                    new Vec2(-4, 5),
                    new Vec2(-4, 3),
                    new Vec2(-2, 2),
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                const points = Array(...zip2(points_full, points_tiny)).map(([a, b]) => Vec2.lerp(a, b, collapse_amount));

                this.ctx.beginPath();
                this.ctx.fillStyle = COLORS.pole.toHex();
                this.ctx.strokeStyle = 'black';
                this.moveTo(points[0]);
                for (let k = 1; k < points.length; k++) {
                    this.lineTo(points[k]);
                }
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            this.drawPattern(cases[0].pattern, {
                pos: view.pos.add(Vec2.lerp(
                    new Vec2(11, 12),
                    new Vec2(11, 8),
                    collapse_amount,
                ).scale(unit).rotateTurns(view.turns)),
                halfside: lerp(view.halfside, view.halfside / 2, collapse_amount),
                turns: view.turns,
            });

            if (cases.length > 1) {
                this.drawMatchers(cases.slice(1), {
                    pos: view.pos.add(new Vec2(0, lerp(18, 6, collapse_amount) * unit).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed.slice(1), cur_time, matched.slice(1));
            }
            return;
        }
        if (collapsed[0].main.collapsed) {
            { // tiny pole
                const points = [
                    new Vec2(0, 0),
                    new Vec2(4, -2),
                    new Vec2(4, -1),
                    new Vec2(3, 1),
                    new Vec2(4, 3),
                    new Vec2(4, 4),
                    new Vec2(0, 6),
                    new Vec2(-2, 5),
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                this.ctx.beginPath();
                this.ctx.fillStyle = COLORS.pole.toHex();
                this.ctx.strokeStyle = 'black';
                this.moveTo(points[0]);
                for (let k = 1; k < points.length; k++) {
                    this.lineTo(points[k]);
                }
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            this.drawPattern(cases[0].pattern, {
                pos: view.pos.add(new Vec2(11, 8).scale(unit).rotateTurns(view.turns)),
                halfside: view.halfside / 2,
                turns: view.turns,
            });

            if (cases.length > 1) {
                this.drawMatchers(cases.slice(1), {
                    pos: view.pos.add(new Vec2(0, 6 * unit).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed.slice(1), cur_time, matched.slice(1));
            }
            return;
        }

        { // dented pole
            const points = [
                new Vec2(0, 0),
                new Vec2(4, -2),
                new Vec2(4, 1),
                new Vec2(2, 5),
                new Vec2(4, 9),
                new Vec2(4, 16),
                new Vec2(0, 18),
                new Vec2(-2, 17),
                new Vec2(-2, 6),
                new Vec2(-4, 5),
                new Vec2(-4, 3),
                new Vec2(-2, 2),
                new Vec2(-2, -1),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.pole.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            const cross_points = [
                new Vec2(1, 0),
                new Vec2(-1, 0),
                new Vec2(0, 1),
                new Vec2(0, -1),
            ].map(v => v.addXY(-2.5, 4))
                .map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.lineWidth = 2;
            this.moveTo(cross_points[0]);
            this.lineTo(cross_points[1]);
            this.moveTo(cross_points[2]);
            this.lineTo(cross_points[3]);
            this.ctx.stroke();
            this.ctx.lineWidth = 1;
        }

        this.drawSingleMatchCase(cases[0], {
            pos: view.pos.add(new Vec2(28, 10).scale(unit).rotateTurns(view.turns)),
            halfside: view.halfside,
            turns: view.turns,
        }, collapsed[0].inside, cur_time, matched[0]);

        if (cases.length > 1) {
            const extra_poles = collapsed[0].main.extra_poles;
            for (let k = 0; k < extra_poles; k++) {
                const points = [
                    new Vec2(0, 0),
                    new Vec2(4, -2),
                    new Vec2(4, 16),
                    new Vec2(0, 18),
                    new Vec2(-2, 17),
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7 + (1 + k) * 18))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                this.ctx.beginPath();
                this.ctx.fillStyle = COLORS.pole.toHex();
                this.ctx.strokeStyle = 'black';
                this.moveTo(points[0]);
                for (let k = 1; k < points.length; k++) {
                    this.lineTo(points[k]);
                }
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }
            this.drawMatchers(cases.slice(1), {
                pos: view.pos.add(new Vec2(0, 18 * unit * (1 + extra_poles)).rotateTurns(view.turns)),
                halfside: view.halfside,
                turns: view.turns,
            }, collapsed.slice(1), cur_time, matched.slice(1));
        }
    }

    private drawSingleMatchCase(match_case: MatchCaseDefinition, view: SexprView, collapsed: Collapsed[], cur_time: number, matched: MatchedInput) {
        const unit = view.halfside / 4;

        if (matched.new_pattern !== null) {
            // @ts-expect-error idk why new_pattern might be nullable
            this.drawMoleculePlease(matched.new_pattern, {
                pos: view.pos.add(new Vec2(-17, 2).scale(unit).rotateTurns(view.turns)),
                halfside: view.halfside,
                turns: view.turns,
            });
            this.drawPatternWithoutVariables(match_case.pattern, {
                pos: view.pos.add(new Vec2(-17, 2).scale(unit).rotateTurns(view.turns)),
                halfside: view.halfside,
                turns: view.turns,
            });
        }
        else {
            this.drawPattern(match_case.pattern, {
                pos: view.pos.add(new Vec2(-17, 2).scale(unit).rotateTurns(view.turns)),
                halfside: view.halfside,
                turns: view.turns,
            });
        }

        if (!matched.missing_template) {
            this.drawMoleculePlease(match_case.template, view);
        }

        this.drawMoleculePlease(match_case.fn_name_template, {
            pos: view.pos.add(new Vec2(-3, -2).scale(unit).rotateTurns(view.turns)),
            halfside: view.halfside / 2,
            turns: view.turns - 0.25,
        });
        { // chair
            const points = [
                new Vec2(-2, 0),
                new Vec2(-1, -2),
                new Vec2(-3, -1),
                new Vec2(-5, -2),
                new Vec2(-3, 2),
                new Vec2(-5, 6),
                new Vec2(-17, 6),
                new Vec2(-17, 7),
                new Vec2(-3, 7),
                new Vec2(5, 7),
                new Vec2(5, 6),
                new Vec2(7, 7),
                new Vec2(11, 5),
                new Vec2(11, 4),
                new Vec2(0, 4),
            ].map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.chair.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        if (match_case.next === 'return') {
            const points = [
                new Vec2(0, 0),
                new Vec2(-2, -1),
                new Vec2(-2, 0),
                new Vec2(-10, 0),
                new Vec2(-8, 1),
                new Vec2(-2, 1),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.return.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else {
            this.drawMatchers(match_case.next, view, collapsed, cur_time, matched.inside);
        }
    }

    highlightMolecule(type: SexprTemplate['type'], view: SexprView) {
        let points: Vec2[];
        // if (type === 'variable') {
        //     points = [
        //         new Vec2(-view.halfside * SPIKE_PERC, 0),
        //         new Vec2(0, -view.halfside),
        //         new Vec2(view.halfside * 3, -view.halfside),
        //         new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
        //         new Vec2(view.halfside * 3, view.halfside),
        //         new Vec2(0, view.halfside),
        //     ].map(v => v.rotateTurns(view.turns))
        //         .map(v => view.pos.add(v));
        // }
        // else if (type === 'atom') {
        if (type !== 'pair') {
            points = [
                new Vec2(-view.halfside * SPIKE_PERC, 0),
                new Vec2(0, -view.halfside),
                new Vec2(view.halfside * 2, -view.halfside),
                new Vec2(view.halfside * 2, view.halfside),
                new Vec2(0, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
        }
        else {
            points = [
                new Vec2(-view.halfside * SPIKE_PERC, 0),
                new Vec2(0, -view.halfside),
                new Vec2(view.halfside * (2 + SPIKE_PERC), -view.halfside),
                new Vec2(view.halfside * (2 + SPIKE_PERC), view.halfside),
                new Vec2(0, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
        }
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'cyan';
        this.moveTo(points[0]);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(points[k]);
        }
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.lineWidth = 1;
    }

    highlightPattern(type: SexprTemplate['type'], view: SexprView) {
        let points: Vec2[];
        // if (type === 'variable') {
        //     points = [
        //         new Vec2(-view.halfside * SPIKE_PERC, 0),
        //         new Vec2(0, -view.halfside),
        //         new Vec2(view.halfside * 3, -view.halfside),
        //         new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
        //         new Vec2(view.halfside * 3, view.halfside),
        //         new Vec2(0, view.halfside),
        //     ].map(v => v.rotateTurns(view.turns))
        //         .map(v => view.pos.add(v));
        // }
        // else if (type === 'atom') {
        if (type !== 'pair') {
            points = [
                new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
                new Vec2(view.halfside * 3, -view.halfside),
                new Vec2(view.halfside * 2, -view.halfside),
                new Vec2(view.halfside * 2, view.halfside),
                new Vec2(view.halfside * 3, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
        }
        else {
            points = [
                new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
                new Vec2(view.halfside * 3, -view.halfside),
                new Vec2(view.halfside * 0.5, -view.halfside),
                new Vec2(view.halfside * 0.5, view.halfside),
                new Vec2(view.halfside * 3, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
        }
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'cyan';
        this.moveTo(points[0]);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(points[k]);
        }
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.lineWidth = 1;
    }

    private drawBoundedVariable(name: string, view: SexprView) {
        const points = [
            new Vec2(-view.halfside * SPIKE_PERC, 0),
            new Vec2(0, -view.halfside),
            new Vec2(view.halfside * 0.5, -view.halfside),
            new Vec2(view.halfside * (0.5 - SPIKE_PERC), 0),
            new Vec2(view.halfside * 0.5, view.halfside),
            new Vec2(0, view.halfside),
        ].map(v => v.rotateTurns(view.turns))
            .map(v => view.pos.add(v));
        this.ctx.beginPath();
        this.ctx.fillStyle = colorFromAtom(name).toHex();
        this.ctx.strokeStyle = 'black';
        this.moveTo(points[0]);
        for (let k = 1; k < points.length; k++) {
            this.lineTo(points[k]);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
    }

    private drawMoleculeNonRecursive(data: SexprNullable, view: SexprView) {
        if (data.type === 'variable') {
            const points = [
                new Vec2(-view.halfside * SPIKE_PERC, 0),
                new Vec2(0, -view.halfside),
                new Vec2(view.halfside * 0.5, -view.halfside),
                new Vec2(view.halfside * (0.5 - SPIKE_PERC), 0),
                new Vec2(view.halfside * 0.5, view.halfside),
                new Vec2(0, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = colorFromAtom(data.value).toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else if (data.type === 'atom') {
            const profile = atom_shapes.get(data.value);
            this.ctx.beginPath();
            this.ctx.fillStyle = colorFromAtom(data.value).toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(view.pos.add(new Vec2(-view.halfside * SPIKE_PERC, 0).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(0, -view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(view.halfside * 2, -view.halfside).rotateTurns(view.turns)));
            profile.forEach(({ x: time, y: offset }) => {
                const thing = new Vec2(view.halfside * 2 + offset * view.halfside, lerp(-view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            reversedForEach(profile, ({ x: time, y: offset }) => {
                const thing = new Vec2(view.halfside * 2 - offset * view.halfside, lerp(view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            this.lineTo(view.pos.add(new Vec2(view.halfside * 2, view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(0, view.halfside).rotateTurns(view.turns)));
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else if (data.type === 'null') {
            return;
        }
        else {
            const halfside = view.halfside;
            const middle_right_pos = new Vec2(halfside / 2, 0);
            const points = [
                new Vec2(-halfside * SPIKE_PERC, 0),
                new Vec2(0, -halfside),
                middle_right_pos.add(new Vec2(0, -halfside)),
                middle_right_pos.add(new Vec2(-SPIKE_PERC * halfside / 2, -halfside / 2)),
                middle_right_pos,
                middle_right_pos.add(new Vec2(-SPIKE_PERC * halfside / 2, halfside / 2)),
                middle_right_pos.add(new Vec2(0, halfside)),
                new Vec2(0, halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.cons.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    private drawPatternNonRecursive(data: SexprTemplate, view: SexprView) {
        if (data.type === 'pair') {
            const halfside = view.halfside;
            const middle_right_pos = new Vec2(halfside * 2, 0);
            const points = [
                new Vec2((3 + SPIKE_PERC) * halfside, 0),
                new Vec2(3 * halfside, -halfside),
                middle_right_pos.add(new Vec2(0, -halfside)),
                middle_right_pos.add(new Vec2(SPIKE_PERC * halfside / 2, -halfside / 2)),
                middle_right_pos,
                middle_right_pos.add(new Vec2(SPIKE_PERC * halfside / 2, halfside / 2)),
                middle_right_pos.add(new Vec2(0, halfside)),
                new Vec2(3 * halfside, halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.cons.toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else if (data.type === 'atom') {
            const profile = atom_shapes.get(data.value);
            this.ctx.beginPath();
            this.ctx.fillStyle = colorFromAtom(data.value).toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(view.pos.add(new Vec2(view.halfside * SPIKE_PERC + view.halfside * 3, 0).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(view.halfside * 3, -view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(-view.halfside + view.halfside * 3, -view.halfside).rotateTurns(view.turns)));
            profile.forEach(({ x: time, y: offset }) => {
                const thing = new Vec2(-view.halfside + view.halfside * 3 + offset * view.halfside, lerp(-view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            reversedForEach(profile, ({ x: time, y: offset }) => {
                const thing = new Vec2(-view.halfside + view.halfside * 3 - offset * view.halfside, lerp(view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            this.lineTo(view.pos.add(new Vec2(-view.halfside + view.halfside * 3, view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(view.halfside * 3, view.halfside).rotateTurns(view.turns)));
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else {
            const points = [
                new Vec2(-view.halfside * (-SPIKE_PERC - 2.5), 0),
                new Vec2(view.halfside * 2.5, -view.halfside),
                new Vec2(view.halfside * 3, -view.halfside),
                new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
                new Vec2(view.halfside * 3, view.halfside),
                new Vec2(view.halfside * 2.5, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = colorFromAtom(data.value).toHex();
            this.ctx.strokeStyle = 'black';
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    drawCircle(center: Vec2, radius: number) {
        this.ctx.moveTo(center.x + radius, center.y);
        this.ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    }

    drawArc(center: Vec2, radius: number, start_angle: number, end_angle: number) {
        this.ctx.moveTo(center.x + radius, center.y);
        this.ctx.arc(center.x, center.y, radius, start_angle, end_angle * 2 * Math.PI);
    }

    moveTo(pos: Vec2) {
        this.ctx.moveTo(pos.x, pos.y);
    }

    translate(pos: Vec2) {
        this.ctx.translate(pos.x, pos.y);
    }

    lineTo(pos: Vec2) {
        this.ctx.lineTo(pos.x, pos.y);
    }

    private fillText(text: string, pos: Vec2) {
        this.ctx.fillText(text, pos.x, pos.y);
    }

    text(text: string, view: SexprView) {
        // const screen_size = this.getScreenSize();
        this.ctx.font = `bold ${Math.floor(view.halfside * 5)}px sans-serif`;
        console.log(view.halfside);
        this.ctx.textAlign = 'center';
        this.fillText(text, view.pos);
    }
}

export function lerpSexprView(a: SexprView, b: SexprView, t: number): SexprView {
    return {
        pos: Vec2.lerp(a.pos, b.pos, t),
        halfside: lerp(a.halfside, b.halfside, t),
        turns: lerp(a.turns, b.turns, t),
    };
}

export type FloatingBinding = {
    // source_view: SexprView,
    source_address: FullAddress,
    target_address: FullAddress,
    variable_name: string,
    value: SexprLiteral,
};

export type MatchedInput = { new_pattern: null | SexprNullable, missing_template: boolean, inside: MatchedInput[] };

export function nothingMatched(cases: MatchCaseDefinition[]): MatchedInput[] {
    function helper(match_case: MatchCaseDefinition): MatchedInput {
        return {
            new_pattern: null,
            missing_template: false,
            inside: match_case.next === 'return' ? [] : match_case.next.map(helper),
        };
    }
    return cases.map(helper);
}

export function updateMatchedForNewPattern(cur: MatchedInput[], address: MatchCaseAddress, pattern: SexprTemplate): MatchedInput[] {
    if (address.length === 0) throw new Error('bad address');
    if (address.length === 1) {
        return replace(cur, {
            new_pattern: changeVariablesToNull(pattern),
            missing_template: cur[single(address)].missing_template,
            inside: cur[single(address)].inside,
        }, single(address));
    }
    else {
        return replace(cur, {
            new_pattern: cur[address[0]].new_pattern,
            missing_template: cur[address[0]].missing_template,
            inside: updateMatchedForNewPattern(cur[address[0]].inside, address.slice(1), pattern),
        }, address[0]);
    }
}

export function updateMatchedForMissingTemplate(cur: MatchedInput[], address: MatchCaseAddress): MatchedInput[] {
    if (address.length === 0) throw new Error('bad address');
    if (address.length === 1) {
        return replace(cur, {
            new_pattern: cur[single(address)].new_pattern,
            missing_template: true,
            inside: cur[single(address)].inside,
        }, single(address));
    }
    else {
        return replace(cur, {
            new_pattern: cur[address[0]].new_pattern,
            missing_template: cur[address[0]].missing_template,
            inside: updateMatchedForMissingTemplate(cur[address[0]].inside, address.slice(1)),
        }, address[0]);
    }
}

export type Collapsed = { main: { collapsed: boolean, changedAt: number, extra_poles: number }, inside: Collapsed[] };
// export type FnkCollapsed = { main: null, inside: Collapsed[] }; // TODO: use this instead of Collapsed[]

// TODO: code smell, this is a sign we should be using Collapsed instead of Collapsed[]
export function fakeCollapsed(children: Collapsed[]): Collapsed {
    return { main: { collapsed: false, changedAt: -Infinity, extra_poles: 0 }, inside: children };
}

export function nothingCollapsed(cases: MatchCaseDefinition[]): Collapsed[] {
    function helper(match_case: MatchCaseDefinition): Collapsed {
        return {
            main: { collapsed: false, changedAt: -Infinity, extra_poles: countExtraPolesNeeded(match_case) },
            inside: match_case.next === 'return' ? [] : match_case.next.map(helper),
        };
    }
    return cases.map(helper);
}

export function everythingCollapsedExceptFirsts(cases: MatchCaseDefinition[]): Collapsed[] {
    function helper(match_case: MatchCaseDefinition, index: number): Collapsed {
        return {
            main: { collapsed: index > 0, changedAt: -Infinity, extra_poles: countExtraPolesNeeded(match_case) },
            inside: match_case.next === 'return' ? [] : match_case.next.map(helper),
        };
    }
    return cases.map(helper);
}

export function getCollapsedAfter(collapsed_main: Collapsed, address: MatchCaseAddress): Collapsed[] {
    const siblings = address.length === 1 ? collapsed_main.inside : getCollapseAt(collapsed_main, address.slice(0, -1)).inside;
    return siblings.slice(at(address, -1));
}

export function getCollapseAt(collapse: Collapsed, address: MatchCaseAddress): Collapsed {
    if (address.length === 0) {
        return collapse;
    }
    else {
        const [head, ...tail] = address;
        return getCollapseAt(at(collapse.inside, head), tail);
    }
}

export function toggleCollapsed(collapsed: Collapsed[], which: MatchCaseAddress, cur_time: number): Collapsed[] {
    if (which.length === 0) throw new Error('bad address at toggleCollapsed');
    if (which.length === 1) {
        const result = structuredClone(collapsed);
        result[which[0]].main.collapsed = !result[which[0]].main.collapsed;
        result[which[0]].main.changedAt = cur_time;
        return result;
    }
    else {
        const result = structuredClone(collapsed);
        result[which[0]].inside = toggleCollapsed(collapsed[which[0]].inside, which.slice(1), cur_time);
        return result;
    }
}

export function ensureCollapsed(collapsed: Collapsed[], cur_time: number, callback: (addr: MatchCaseAddress, cur_value: boolean) => boolean): Collapsed[] {
    function helper(collapsed: Collapsed, cur_address: MatchCaseAddress): Collapsed {
        const new_val = callback(cur_address, collapsed.main.collapsed);
        return {
            main: (new_val === collapsed.main.collapsed)
                ? collapsed.main
                : { collapsed: new_val, changedAt: cur_time, extra_poles: 0 },
            inside: collapsed.inside.map((v, k) => helper(v, [...cur_address, k])),
        };
    }

    return collapsed.map((v, k) => {
        return helper(v, [k]);
    });
}

function getSexprChildView(parent: SexprView, is_left: boolean): SexprView {
    return {
        pos: parent.pos.add(new Vec2(parent.halfside / 2, (is_left ? -1 : 1) * parent.halfside / 2).rotateTurns(parent.turns)),
        halfside: parent.halfside / 2,
        turns: parent.turns,
    };
}

export function getSexprGrandChildView(parent: SexprView, path: SexprAddress): SexprView {
    if (path.length === 0) return parent;
    return getSexprGrandChildView(getSexprChildView(parent, path[0] === 'l'), path.slice(1));
}

// TODO: take global_t into account
export function getView(parent: SexprView, path: FullAddress, collapsed: Collapsed, global_t: number = Infinity): SexprView {
    const unit = parent.halfside / 4;
    if (collapsed.main.collapsed) {
        if (path.major.length === 0 && path.type === 'pattern') {
            return getSexprGrandChildView({
                pos: offsetView(parent, new Vec2(-17, -2)).pos,
                halfside: parent.halfside / 2,
                turns: parent.turns,
            }, path.minor);
        }
        else {
            return { pos: parent.pos, halfside: 0, turns: parent.turns };
        }
    }
    else if (path.major.length === 0) {
        switch (path.type) {
            case 'fn_name':
                return getSexprGrandChildView({
                    pos: parent.pos.add(new Vec2(-3, -2).scale(unit).rotateTurns(parent.turns)),
                    halfside: parent.halfside / 2,
                    turns: parent.turns - 0.25,
                }, path.minor);
            case 'pattern':
                return getSexprGrandChildView({
                    pos: parent.pos.add(new Vec2(-17, 2).scale(unit).rotateTurns(parent.turns)),
                    halfside: parent.halfside,
                    turns: parent.turns,
                }, path.minor);
            case 'template':
                return getSexprGrandChildView(parent, path.minor);
            default:
                throw new Error('unreachable');
        }
    }
    else {
        const n_poles = collapsed.inside.slice(0, path.major[0]).map(x => x.main.collapsed ? 1 / 3 : 1 + x.main.extra_poles).reduce((a, b) => a + b, 0);
        return getView({
            pos: parent.pos.add(new Vec2(28 * unit, 10 * unit + 18 * unit * n_poles).rotateTurns(parent.turns)),
            halfside: parent.halfside,
            turns: parent.turns,
        }, { type: path.type, minor: path.minor, major: path.major.slice(1) }, at(collapsed.inside, path.major[0]));
    }
}

export function getFnkNameView(parent: SexprView): SexprView {
    return {
        pos: offsetView(parent, new Vec2(-5, -2)).pos,
        halfside: parent.halfside,
        turns: parent.turns - 0.25,
    };
}

const colorFromAtom: (atom: string) => Color = (() => {
    const generated = new Map<string, Color>();
    generated.set('X', new Color(0.1, 0.6, 0.3));
    generated.set('nil', new Color(0.45, 0.45, 0.45));
    generated.set('true', new Color(0.5, 0.9, 0.5));
    generated.set('false', new Color(0.9, 0.5, 0.5));
    generated.set('input', new Color(0.1, 0.6, 0.6));
    generated.set('output', Color.fromInt(0xb8a412));
    generated.set('v1', new Color(0.9, 0.9, 0.3));
    generated.set('v2', new Color(0.3, 0.9, 0.9));
    generated.set('v3', new Color(0.9, 0.3, 0.9));
    generated.set('f1', Color.fromInt(0x9E008B));
    generated.set('france', Color.fromInt(0xFA00FF));
    generated.set('paris', Color.fromInt(0xFF8EEC));
    generated.set('spain', Color.fromInt(0xFFB600));
    generated.set('madrid', Color.fromInt(0xFFE18E));
    generated.set('portugal', Color.fromInt(0x00E5FF));
    generated.set('lisbon', Color.fromInt(0x9EFFF2));
    `#ff0000
    #ffff00
    #00fa9a
    #c71585
    #0000ff
    #1e90ff
    #ffdab9`.trim().split('\n').forEach((s, k) => {
            generated.set(k.toString(), Color.fromHex(s));
        });

    return (atom: string) => {
        let color = generated.get(atom);
        if (color !== undefined) {
            return color;
        }
        else {
            const rand = new Rand(atom);
            color = new Color(rand.next(), rand.next(), rand.next(), 1);
            generated.set(atom, color);
            return color;
        }
    };
})();

function randomShape(name: string) {
    const rand = new Random(name);
    return fromCount(rand.int(2, 15), _ => new Vec2(rand.float(0, 1), rand.float(-0.2, 0.2))).sort((a, b) => a.x - b.x);
}

// (y_time, x_offset), with x_offset in terms of halfside
// (0, 0) & (1, 0) are implicit
type AtomProfile = Vec2[];
const atom_shapes = new DefaultMap<string, AtomProfile>(name => randomShape(name), new Map(Object.entries({
    identity: [],
    nil: [new Vec2(0.75, -0.25)],
    input: [new Vec2(0.2, 0.2), new Vec2(0.8, 0.2)],
    output: [new Vec2(0.2, -0.2), new Vec2(0.8, -0.2)],
    true: fromCount(10, (k) => {
        const t = k / 10;
        return new Vec2(t, -0.2 * Math.sin(t * Math.PI));
    }),
    false: [new Vec2(1 / 6, 0.2), new Vec2(0.5, -0.2), new Vec2(5 / 6, 0.2)],
    v1: [new Vec2(0.2, 0.2), new Vec2(0.4, -0.2), new Vec2(0.7, 0.2)],
    // "v2": [new Vec2(.1, 0), new Vec2(.3, -.2), new Vec2(.5, 0), new Vec2(.8, .2), new Vec2(.95, 0)],
    // "v2": [new Vec2(.2, 0), new Vec2(.5, .2), new Vec2(.8, 0)],
    // "v2": fromCount(3, k => {
    //   let x2 = (k+1)/3;
    //   let x1 = x2 - .05;
    //   if (k === 2) {
    //     return [new Vec2(x1, .2 - x1 * .1)];
    //   } else {
    //     return [new Vec2(x1, .2 - x1 * .1), new Vec2(x2, - x2 * .1)];
    //   }
    // }).flat(1),
    v2: fromCount(3, (k) => {
        const d = 0.05;
        const raw = [new Vec2(k / 3, 0), new Vec2((k + 1) / 3 - d, 0.2), new Vec2((k + 1) / 3 - d / 2, 0.1)];

        const transform = findTransformationWithFixedOrigin({ source: new Vec2(1 - d / 2, 0.1), target: new Vec2(1, 0) });
        return raw.map(transform);
    }).flat(1),
    // "v2": [new Vec2(.25, .2), new Vec2(.3, 0), new Vec2(.55, .2), new Vec2(.6, 0), new Vec2(.85, .2), new Vec2(.9, 0)],
    v3: fromCount(2, (k) => {
        const c = (2 * k + 1) / 4;
        const s = 0.6 / 4;
        return [new Vec2(c - s, 0), new Vec2(c, -0.25), new Vec2(c + s, 0)];
    }).flat(1),
    // "f1": [new Vec2(.3, -.2), new Vec2(.5, 0), new Vec2(.8, .2)],
    f1: [new Vec2(0.3, -0.2), new Vec2(0.4, -0.07), new Vec2(0.5, 0.03), new Vec2(0.6, 0.1), new Vec2(0.7, 0.17), new Vec2(0.8, 0.2), new Vec2(0.85, 0.2)],
    // "f1": [new Vec2(.3, -.2), new Vec2(.4, -.05), new Vec2(.5, .05), new Vec2(.6, .15), new Vec2(.8, .2)],
    // "f1": [new Vec2(.5, .25)],
})));

function findTransformationWithFixedOrigin({ source, target }: { source: Vec2, target: Vec2 }): (v: Vec2) => Vec2 {
    const transform = Transform.from2Examples([Vec2.zero, Vec2.zero], [source, target]);
    // let scaling_factor = target.mag() / source.mag();
    // let delta_radians = target.radians() - source.radians();
    // return (v: Vec2) => v.rotate(delta_radians).scale(scaling_factor);
    return (v: Vec2) => transform.globalFromLocal(v);
}

export function generateFloatingBindings(input: SexprLiteral, fnk: FunktionDefinition, address: MatchCaseAddress): FloatingBinding[] {
    const match_case = getCaseAt(fnk, address);
    const bindings = generateBindings(input, match_case.pattern);
    if (bindings === null) throw new Error('no bindings');
    return bindings.flatMap((x) => {
        const target_addresses = addressesOfVariableInTemplates(match_case, x.variable_name);
        return target_addresses.map(target => ({
            source_address: {
                type: 'pattern',
                major: address,
                minor: x.variable_address,
            },
            // source_view: getView(parent_view, {
            //     type: 'pattern',
            //     major: address,
            //     minor: x.variable_address,
            // }, collapsed),
            target_address: {
                type: target.type, minor: target.minor,
                major: [...address, ...target.major],
            },
            variable_name: x.variable_name,
            value: x.value,
        }));
    });
}

export function getPoleAtPosition(fnk: FunktionDefinition, view: SexprView, collapsed: Collapsed[], position: Vec2): { type: 'main' | 'add' | 'return', address: MatchCaseAddress } | null {
    // just return the address of the pole at position
    const cases = fnk.cases;

    function helper(cases: MatchCaseDefinition[], view: SexprView, collapsed: Collapsed[], position: Vec2): ReturnType<typeof getPoleAtPosition> {
        if (cases.length === 0) return null;
        const unit = view.halfside / 4;
        if (collapsed[0].main.collapsed) {
            { // tiny pole
                const points = [
                    new Vec2(0, 0),
                    new Vec2(4, -2),
                    new Vec2(4, -1),
                    new Vec2(3, 1),
                    new Vec2(4, 3),
                    new Vec2(4, 4),
                    new Vec2(0, 6),
                    new Vec2(-2, 5),
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                if (isPointInPolygon(position, points)) {
                    return { type: 'main', address: [0] };
                }
            }

            if (cases.length > 1) {
                const asdf = helper(cases.slice(1), {
                    pos: view.pos.add(new Vec2(0, 6 * unit).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed.slice(1), position);
                if (asdf === null) return null;
                asdf.address[0] += 1;
                return asdf;
            }
            return null;
        }

        { // dented pole
            const pole_body = [
                new Vec2(0, 0),
                new Vec2(4, -2),
                new Vec2(4, 1),
                new Vec2(2, 5),
                new Vec2(4, 9),
                new Vec2(4, 16),
                new Vec2(0, 18),
                new Vec2(-2, 17),
                new Vec2(-2, -1),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            if (isPointInPolygon(position, pole_body)) {
                return { type: 'main', address: [0] };
            }

            const pole_spike = [
                new Vec2(-2, 6),
                new Vec2(-4, 5),
                new Vec2(-4, 3),
                new Vec2(-2, 2),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            if (isPointInPolygon(position, pole_spike)) {
                return { type: 'add', address: [0] };
            }
        }

        if (cases[0].next !== 'return') {
            const asdf = helper(cases[0].next, offsetView(view, new Vec2(28, 10)), collapsed[0].inside, position);
            if (asdf !== null) {
                asdf.address = [0, ...asdf.address];
                return asdf;
            }
        }
        else {
            const points = [
                new Vec2(0, 0),
                new Vec2(-2, -1),
                new Vec2(-2, 0),
                new Vec2(-10, 0),
                new Vec2(-8, 1),
                new Vec2(-2, 1),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => offsetView(view, new Vec2(28, 10)).pos.add(v));

            if (isPointInPolygon(position, points)) {
                return { type: 'return', address: [0] };
            }
        }

        if (cases.length > 1) {
            const extra_poles = collapsed[0].main.extra_poles;
            const asdf = helper(cases.slice(1), {
                pos: view.pos.add(new Vec2(0, 18 * unit * (1 + extra_poles)).rotateTurns(view.turns)),
                halfside: view.halfside,
                turns: view.turns,
            }, collapsed.slice(1), position);
            if (asdf === null) return null;
            asdf.address[0] += 1;
            return asdf;
        }

        return null;
    }

    return helper(cases, view, collapsed, position);
}

export function getAtPosition(fnk: FunktionDefinition, view: SexprView, collapsed: Collapsed, position: Vec2): FullAddress | null {
    for (const { address, match_case } of allCases(fnk.cases)) {
        for (const [sexpr, type] of zip2([match_case.template, match_case.pattern, match_case.fn_name_template], ['template', 'pattern', 'fn_name'] as const)) {
            const fn = type === 'pattern' ? patternAdressFromScreenPosition : sexprAdressFromScreenPosition;
            const minor_address = fn(position, sexpr, getView(view, {
                type: type,
                major: address,
                minor: [],
            }, collapsed));
            if (minor_address !== null) return {
                type: type,
                major: address,
                minor: minor_address,
            };
        }
    }
    return null;
}

export function sexprAdressFromScreenPosition(screen_pos: Vec2, data: SexprTemplate, view: SexprView): SexprAddress | null {
    const delta_pos = screen_pos.sub(view.pos).scale(1 / view.halfside).rotateTurns(-view.turns);
    if (!inRange(delta_pos.y, -1, 1)) return null;
    // if (data.type === 'atom') {
    if (data.type !== 'pair') {
        const max_x = 2;
        if (inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * SPIKE_PERC, max_x)) {
            return [];
        }
        else {
            return null;
        }
    }
    // else if (data.type === 'variable') {
    //     const max_x = 3 + (1 - Math.abs(delta_pos.y)) * SPIKE_PERC;
    //     if (inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * SPIKE_PERC, max_x)) {
    //         return [];
    //     }
    //     else {
    //         return null;
    //     }
    // }
    else {
        // are we selecting a subchild?
        if (data.type === 'pair' && delta_pos.x >= 0.5 - SPIKE_PERC / 2) {
            const is_left = delta_pos.y <= 0;
            const maybe_child = sexprAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getSexprChildView(view, is_left));
            if (maybe_child !== null) {
                return [is_left ? 'l' : 'r', ...maybe_child];
            }
        }
        // no subchild, stricter selection than atom:
        if (inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * SPIKE_PERC, 0.5)) {
            // path to this
            return [];
        }
        else {
            return null;
        }
    }
}

function patternAdressFromScreenPosition(screen_pos: Vec2, data: SexprTemplate, view: SexprView): SexprAddress | null {
    const delta_pos = screen_pos.sub(view.pos).scale(1 / view.halfside).rotateTurns(-view.turns);
    if (!inRange(delta_pos.y, -1, 1)) return null;
    // if (data.type === 'atom') {
    if (data.type !== 'pair') {
        return inRange(delta_pos.x, 2, 3 - (Math.abs(delta_pos.y) - 1) * SPIKE_PERC) ? [] : null;
    }
    // else if (data.type === 'variable') {
    //     return inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * SPIKE_PERC, 3 - (Math.abs(delta_pos.y) - 1) * SPIKE_PERC) ? [] : null;
    // }
    else {
        // are we selecting a subchild?
        if (3 - delta_pos.x >= 0.5 - SPIKE_PERC / 2) {
            const is_left = delta_pos.y <= 0;
            const maybe_child = patternAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getSexprChildView(view, is_left));
            if (maybe_child !== null) {
                return [is_left ? 'l' : 'r', ...maybe_child];
            }
        }
        // no subchild, stricter selection than atom:
        if (inRange(3 - delta_pos.x, (Math.abs(delta_pos.y) - 1) * SPIKE_PERC, 1)) {
            // path to this
            return [];
        }
        else {
            return null;
        }
    }
}

export function offsetView(view: SexprView, units: Vec2): SexprView {
    return {
        halfside: view.halfside, turns: view.turns,
        pos: view.pos.add(units.scale(view.halfside / 4).rotateTurns(view.turns)),
    };
}

export function scaleAndOffsetView(view: SexprView, units: Vec2, scale: number): SexprView {
    return {
        halfside: view.halfside * scale, turns: view.turns,
        pos: view.pos.add(units.scale(view.halfside / 4).rotateTurns(view.turns)),
    };
}

export function computeOffset(view: SexprView, point: Vec2): Vec2 {
    return point.sub(view.pos).scale(4 / view.halfside).rotateTurns(-view.turns);
}

export function rotateAndScaleView(view: SexprView, turns: number, scale: number): SexprView {
    return { halfside: view.halfside * scale, turns: view.turns + turns, pos: view.pos };
}

export function scaleViewCentered(view: SexprView, scale: number): SexprView {
    const offset = view.halfside * remap(scale, 0, 1, 3 / 2, 0);
    return { halfside: view.halfside * scale, turns: view.turns, pos: view.pos.add(new Vec2(offset, 0).rotateTurns(view.turns)) };
}

function patternForCable([halfside, variable_names]: [number, string[]]): CanvasPattern {
    const canvas = document.createElement('canvas');
    const ctx = assertNotNull(canvas.getContext('2d'));
    if (variable_names.length === 0) {
        canvas.width = 10;
        canvas.height = 10;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return assertNotNull(ctx.createPattern(canvas, 'repeat'));
    }
    if (variable_names.length === 1) {
        canvas.width = 10;
        canvas.height = 10;
        ctx.fillStyle = colorFromAtom(variable_names[0]).toHex();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return assertNotNull(ctx.createPattern(canvas, 'repeat'));
    }
    const w = Math.max(1, Math.floor(15 * halfside / 22));
    canvas.width = variable_names.length * w;
    canvas.height = w * 4 * variable_names.length;
    ctx.transform(1, 0, -0.50, 1, 0, 0);
    for (let k = 0; k <= variable_names.length * 4; k++) {
        ctx.fillStyle = colorFromAtom(variable_names[mod(k, variable_names.length)]).toHex();
        ctx.fillRect(k * w, 0, w, canvas.height);
    }
    return assertNotNull(ctx.createPattern(canvas, 'repeat'));
}

const cable_patterns = new DefaultMapExtra<[number, string[]], string, CanvasPattern>(
    ([halfside, variable_names]) => `${Math.round(halfside)}:${variable_names.join(' ')}`, patternForCable);
