import { expect, test } from 'vitest';
import { FunktionDefinition, applyFunktion, assertLiteral, equalSexprs, fnkToString, parseFnks, parseSexprLiteral, parseSexprTemplate } from './model';

test('funktion add', () => {
    const add: FunktionDefinition = {
        name: { type: 'atom', value: 'add' },
        cases: [
            {
                pattern: parseSexprTemplate(`(#0 . y)`),
                template: parseSexprTemplate(`y`),
                fn_name_template: parseSexprTemplate(`#identity`),
                next: 'return',
            },
            {
                pattern: parseSexprTemplate(`((#succ . x) . y)`),
                template: parseSexprTemplate(`(x . (#succ . y))`),
                fn_name_template: parseSexprTemplate(`#add`),
                next: 'return',
            },
        ],
    };
    const input = parseSexprLiteral(`((#succ #succ . #0) . (#succ #succ . #0))`);
    const expected_output = parseSexprLiteral(`(#succ #succ #succ #succ . #0)`);

    const actual_output = applyFunktion([add], parseSexprLiteral('#add'), input);

    expect(equalSexprs(actual_output, expected_output)).toBe(true);
});

test('funktion bubbleUp', () => {
    const bubbleUp: FunktionDefinition = {
        name: { type: 'atom', value: 'bubbleUp' },
        cases: [
            {
                pattern: parseSexprTemplate(`(#X . rest)`),
                template: parseSexprTemplate(`(#X . rest)`),
                fn_name_template: parseSexprTemplate(`#identity`),
                next: 'return',
            },
            {
                pattern: parseSexprTemplate(`(a . b)`),
                template: parseSexprTemplate(`b`),
                fn_name_template: parseSexprTemplate(`#bubbleUp`),
                next: [
                    {
                        pattern: parseSexprTemplate(`(#X . rest)`),
                        template: parseSexprTemplate(`(#X a . rest)`),
                        fn_name_template: parseSexprTemplate(`#identity`),
                        next: 'return',
                    },
                ],
            },
        ],
    };
    const input = parseSexprLiteral(`(#a #b #X #c #d)`);
    const expected_output = parseSexprLiteral(`(#X #a #b #c #d)`);

    const asdf = parseSexprLiteral('#bubbleUp');
    const actual_output = applyFunktion([bubbleUp], asdf, input);

    expect(equalSexprs(actual_output, expected_output)).toBe(true);
});

test('repr of fnk', () => {
    const asdf: FunktionDefinition = {
        name: { type: 'atom', value: 'equal?' },
        cases: [
            {
                pattern: parseSexprTemplate(`((a . b) . (x . y))`),
                template: parseSexprTemplate(`(a . x)`),
                fn_name_template: parseSexprTemplate(`#equal?`),
                next: [
                    {
                        pattern: parseSexprTemplate(`#false`),
                        template: parseSexprTemplate(`#false`),
                        fn_name_template: parseSexprTemplate(`#quote`),
                        next: 'return',
                    },
                    {
                        pattern: parseSexprTemplate(`#true`),
                        template: parseSexprTemplate(`(b . y)`),
                        fn_name_template: parseSexprTemplate(`#equal?`),
                        next: 'return',
                    },
                ],
            },
            {
                pattern: parseSexprTemplate(`(a . x)`),
                template: parseSexprTemplate(`(a . x)`),
                fn_name_template: parseSexprTemplate(`#eqAtoms?`),
                next: 'return',
            },
        ],
    };
    const expected_repr = [
        '#equal? {',
        '\t((a . b) . (x . y)) -> #equal?: (a . x) {',
        '\t\t#false -> #quote: #false;',
        '\t\t#true -> #equal?: (b . y);',
        '\t}',
        '\t(a . x) -> #eqAtoms?: (a . x);',
        '}',
    ].join('\n');

    const actual_repr = fnkToString(asdf);

    expect(actual_repr).toBe(expected_repr);
});

test('parse fnk', () => {

    const source = `#equal? {
    ((a . b) . (x . y)) -> #equal?: (a . x) {
        #false -> #quote: #false;
        // here is a comment
        #true -> #equal?: (b . y); // comment at the end
    }
    (a . x) -> #eqAtoms?: (a . x);
}`;

    const actual_fnk = parseFnks(source)[0];
    const actual_repr = fnkToString(actual_fnk);

    const expected_repr = [
        '#equal? {',
        '\t((a . b) . (x . y)) -> #equal?: (a . x) {',
        '\t\t#false -> #quote: #false;',
        '\t\t#true -> #equal?: (b . y);',
        '\t}',
        '\t(a . x) -> #eqAtoms?: (a . x);',
        '}',
    ].join('\n');

    expect(actual_repr).toBe(expected_repr);
});
