import { Color, Transform, Vec2 } from 'kanvas2d';
import { DefaultMap, fromCount, reversedForEach, zip2 } from './kommon/kommon';
import { in01, inRange, lerp, remap } from './kommon/math';
import { FunktionDefinition, MatchCaseDefinition, SexprTemplate } from './model';

const COLLAPSE_DURATION = 0.2;
const SPIKE_PERC = 1 / 2;
type SexprView = { pos: Vec2, halfside: number, turns: number };

const COLORS = {
    background: Color.fromInt(0x6e6e6e),
    chair: Color.fromInt(0x4e6ebe),
    cons: Color.fromInt(0x404040),
    pole: Color.fromInt(0x404040),
    return: Color.fromInt(0xc06060),
};

export class Drawer {
    constructor(
        public ctx: CanvasRenderingContext2D,
    ) { }

    clear() {
        this.ctx.resetTransform();
        this.ctx.fillStyle = 'gray';
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }

    getAtPosition(fnk: FunktionDefinition, view: SexprView, collapsed: Collapsed[], position: Vec2): PoleAdress | null {
        // just return the address of the pole at position
        const cases = fnk.cases;

        function helper(cases: MatchCaseDefinition[], view: SexprView, collapsed: Collapsed[], position: Vec2): PoleAdress | null {
            if (cases.length === 0) return null;
            const unit = view.halfside / 4;
            if (collapsed[0].main.value) {
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
                        return [0];
                    }
                }

                if (cases.length > 1) {
                    const asdf = helper(cases.slice(1), {
                        pos: view.pos.add(new Vec2(0, 6 * unit).rotateTurns(view.turns)),
                        halfside: view.halfside,
                        turns: view.turns,
                    }, collapsed.slice(1), position);
                    if (asdf === null) return null;
                    asdf[0] += 1;
                    return asdf;
                }
                return null;
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
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                if (isPointInPolygon(position, points)) {
                    return [0];
                }
            }

            if (cases[0].next !== 'return') {
                const asdf = helper(cases[0].next, {
                    pos: view.pos.add(new Vec2(28, 10).scale(unit).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed[0].inside, position);
                if (asdf !== null) {
                    return [0, ...asdf];
                }
            }

            if (cases.length > 1) {
                const extra_poles = countExtraPolesNeeded(cases[0]);
                const asdf = helper(cases.slice(1), {
                    pos: view.pos.add(new Vec2(0, 18 * unit * (1 + extra_poles)).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed.slice(1), position);
                if (asdf === null) return null;
                asdf[0] += 1;
                return asdf;
            }

            return null;
        }

        return helper(cases, view, collapsed, position);
    }

    drawFunktion(fnk: FunktionDefinition, view: SexprView, collapsed: Collapsed[], cur_time: number): void {
        const unit = view.halfside / 4;
        this.drawMolecule(fnk.name, {
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
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        this.drawMatchers(fnk.cases, view, collapsed, cur_time);
    }

    drawMolecule(data: SexprTemplate, view: SexprView) {
        this.drawMoleculeNonRecursive(data, view);
        if (data.type === 'pair') {
            this.drawMolecule(data.left, getSexprChildView(view, true));
            this.drawMolecule(data.right, getSexprChildView(view, false));
        }
    }

    drawPattern(data: SexprTemplate, view: SexprView) {
        this.drawPatternNonRecursive(data, view);
        if (data.type === 'pair') {
            this.drawPattern(data.left, getPatternChildView(view, true));
            this.drawPattern(data.right, getPatternChildView(view, false));
        }
    }

    private drawMatchers(cases: MatchCaseDefinition[], view: SexprView, collapsed: Collapsed[], cur_time: number) {
        if (cases.length === 0) return;
        const unit = view.halfside / 4;
        const collapsed_t = (cur_time - collapsed[0].main.changedAt) / COLLAPSE_DURATION;
        if (in01(collapsed_t)) {
            const collapse_amount = collapsed[0].main.value ? collapsed_t : 1 - collapsed_t;

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
                    new Vec2(-2, -1),
                ].map(v => v.addXY(7, 7))
                    .map(v => v.scale(unit))
                    .map(v => v.rotateTurns(view.turns))
                    .map(v => view.pos.add(v));

                const points = Array(...zip2(points_full, points_tiny)).map(([a, b]) => Vec2.lerp(a, b, collapse_amount));

                this.ctx.beginPath();
                this.ctx.fillStyle = COLORS.pole.toHex();
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
                    new Vec2(23, 12),
                    new Vec2(17, 8),
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
                }, collapsed.slice(1), cur_time);
            }
            return;
        }
        if (collapsed[0].main.value) {
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
                this.moveTo(points[0]);
                for (let k = 1; k < points.length; k++) {
                    this.lineTo(points[k]);
                }
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            this.drawPattern(cases[0].pattern, {
                pos: view.pos.add(new Vec2(17, 8).scale(unit).rotateTurns(view.turns)),
                halfside: view.halfside / 2,
                turns: view.turns,
            });

            if (cases.length > 1) {
                this.drawMatchers(cases.slice(1), {
                    pos: view.pos.add(new Vec2(0, 6 * unit).rotateTurns(view.turns)),
                    halfside: view.halfside,
                    turns: view.turns,
                }, collapsed.slice(1), cur_time);
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
                new Vec2(-2, -1),
            ].map(v => v.addXY(7, 7))
                .map(v => v.scale(unit))
                .map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));

            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.pole.toHex();
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }

        this.drawSingleMatchCase(cases[0], {
            pos: view.pos.add(new Vec2(28, 10).scale(unit).rotateTurns(view.turns)),
            halfside: view.halfside,
            turns: view.turns,
        }, collapsed[0].inside, cur_time);

        if (cases.length > 1) {
            const extra_poles = countExtraPolesNeeded(cases[0]);
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
            }, collapsed.slice(1), cur_time);
        }
    }

    private drawSingleMatchCase(match_case: MatchCaseDefinition, view: SexprView, collapsed: Collapsed[], cur_time: number) {
        const unit = view.halfside / 4;
        this.drawMolecule(match_case.template, view);
        this.drawPattern(match_case.pattern, {
            pos: view.pos.add(new Vec2(-5, 2).scale(unit).rotateTurns(view.turns)),
            halfside: view.halfside,
            turns: view.turns,
        });
        this.drawMolecule(match_case.fn_name_template, {
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
            this.moveTo(points[0]);
            for (let k = 1; k < points.length; k++) {
                this.lineTo(points[k]);
            }
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else {
            this.drawMatchers(match_case.next, view, collapsed, cur_time);
        }
    }

    private drawMoleculeNonRecursive(data: SexprTemplate, view: SexprView) {
        if (data.type === 'variable') {
            const points = [
                new Vec2(-view.halfside * SPIKE_PERC, 0),
                new Vec2(0, -view.halfside),
                new Vec2(view.halfside * 3, -view.halfside),
                new Vec2(view.halfside * (3 + SPIKE_PERC), 0),
                new Vec2(view.halfside * 3, view.halfside),
                new Vec2(0, view.halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = colorFromAtom(data.value).withAlpha(0.2).toHex(true);
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
            const middle_right_pos = new Vec2(-halfside, 0);
            const points = [
                new Vec2(halfside * SPIKE_PERC, 0),
                new Vec2(0, -halfside),
                middle_right_pos.add(new Vec2(0, -halfside)),
                middle_right_pos.add(new Vec2(SPIKE_PERC * halfside / 2, -halfside / 2)),
                middle_right_pos,
                middle_right_pos.add(new Vec2(SPIKE_PERC * halfside / 2, halfside / 2)),
                middle_right_pos.add(new Vec2(0, halfside)),
                new Vec2(0, halfside),
            ].map(v => v.rotateTurns(view.turns))
                .map(v => view.pos.add(v));
            this.ctx.beginPath();
            this.ctx.fillStyle = COLORS.cons.toHex();
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
            this.moveTo(view.pos.add(new Vec2(view.halfside * SPIKE_PERC, 0).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(0, -view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(-view.halfside, -view.halfside).rotateTurns(view.turns)));
            profile.forEach(({ x: time, y: offset }) => {
                const thing = new Vec2(-view.halfside + offset * view.halfside, lerp(-view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            reversedForEach(profile, ({ x: time, y: offset }) => {
                const thing = new Vec2(-view.halfside - offset * view.halfside, lerp(view.halfside, 0, time));
                this.lineTo(view.pos.add(thing.rotateTurns(view.turns)));
            });
            this.lineTo(view.pos.add(new Vec2(-view.halfside, view.halfside).rotateTurns(view.turns)));
            this.lineTo(view.pos.add(new Vec2(0, view.halfside).rotateTurns(view.turns)));
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }
        else {
            this.drawMoleculeNonRecursive(data, {
                pos: view.pos,
                halfside: view.halfside,
                turns: view.turns + 0.5,
            });
        }
    }

    private drawCircle(center: Vec2, radius: number) {
        this.ctx.moveTo(center.x + radius, center.y);
        this.ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    }

    private moveTo(pos: Vec2) {
        this.ctx.moveTo(pos.x, pos.y);
    }

    private lineTo(pos: Vec2) {
        this.ctx.lineTo(pos.x, pos.y);
    }

    private fillText(text: string, pos: Vec2) {
        this.ctx.fillText(text, pos.x, pos.y);
    }
}

type Collapsed = { main: { value: boolean, changedAt: number }, inside: Collapsed[] };

export function nothingCollapsed(cases: MatchCaseDefinition[]): Collapsed[] {
    function helper(match_case: MatchCaseDefinition): Collapsed {
        return {
            main: { value: false, changedAt: -Infinity },
            inside: match_case.next === 'return' ? [] : match_case.next.map(helper),
        };
    }
    return cases.map(helper);
}

type PoleAdress = number[];

export function toggleCollapsed(collapsed: Collapsed[], which: PoleAdress, cur_time: number): Collapsed[] {
    if (which.length === 0) throw new Error('bad address at toggleCollapsed');
    if (which.length === 1) {
        const result = structuredClone(collapsed);
        result[which[0]].main.value = !result[which[0]].main.value;
        result[which[0]].main.changedAt = cur_time;
        return result;
    }
    else {
        const result = structuredClone(collapsed);
        result[which[0]].inside = toggleCollapsed(collapsed[which[0]].inside, which.slice(1), cur_time);
        return result;
    }
}

function getSexprChildView(parent: SexprView, is_left: boolean): SexprView {
    return {
        pos: parent.pos.add(new Vec2(parent.halfside / 2, (is_left ? -1 : 1) * parent.halfside / 2).rotateTurns(parent.turns)),
        halfside: parent.halfside / 2,
        turns: parent.turns,
    };
}

function getPatternChildView(parent: SexprView, is_left: boolean): SexprView {
    return {
        pos: parent.pos.add(new Vec2(-parent.halfside, (is_left ? -1 : 1) * parent.halfside / 2).rotateTurns(parent.turns)),
        halfside: parent.halfside / 2,
        turns: parent.turns,
    };
}

export function countExtraPolesNeeded(match_case: MatchCaseDefinition): number {
    if (match_case.next === 'return') return 0;
    if (match_case.next.length === 1) return 1;
    return match_case.next.length + match_case.next.map(countExtraPolesNeeded).reduce((a: number, b: number) => a + b, 0);
}

const colorFromAtom: (atom: string) => Color = (() => {
    const generated = new Map<string, Color>();
    generated.set('nil', new Color(0.5, 0.5, 0.5));
    generated.set('true', new Color(0.5, 0.9, 0.5));
    generated.set('false', new Color(0.9, 0.5, 0.5));
    generated.set('input', new Color(0.1, 0.6, 0.6));
    generated.set('output', Color.fromInt(0xb8a412));
    generated.set('v1', new Color(0.9, 0.9, 0.3));
    generated.set('v2', new Color(0.3, 0.9, 0.9));
    generated.set('v3', new Color(0.9, 0.3, 0.9));
    generated.set('f1', Color.fromInt(0x9E008B));
    `#ff0000
    #ffff00
    #c71585
    #00fa9a
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
            color = new Color(Math.random(), Math.random(), Math.random(), 1);
            generated.set(atom, color);
            return color;
        }
    };
})();

// (y_time, x_offset), with x_offset in terms of halfside
// (0, 0) & (1, 0) are implicit
type AtomProfile = Vec2[];
const atom_shapes = new DefaultMap<string, AtomProfile>(_ => [], new Map(Object.entries({
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

// generated by GPT
function isPointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
    let inside = false;
    const { x: px, y: py } = point;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const { x: pxi, y: pyi } = polygon[i];
        const { x: pxj, y: pyj } = polygon[j];

        const intersect = ((pyi > py) !== (pyj > py))
            && (px < (pxj - pxi) * (py - pyi) / (pyj - pyi) + pxi);
        if (intersect) inside = !inside;
    }

    return inside;
}
