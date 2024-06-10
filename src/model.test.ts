import { expect, test } from 'vitest';
import { FunktionDefinition, applyFunktion, assertLiteral, equalSexprs, sexprToString, fnkToString, parseFnks, parseSexprLiteral, parseSexprTemplate } from './model';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

    expect(actual_output).toStrictEqual(expected_output);
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

    expect(actual_output).toStrictEqual(expected_output);
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
                        fn_name_template: parseSexprTemplate(`#identity`),
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
        '\t\t#false -> #identity: #false;',
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
        #false -> #identity: #false;
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
        '\t\t#false -> #identity: #false;',
        '\t\t#true -> #equal?: (b . y);',
        '\t}',
        '\t(a . x) -> #eqAtoms?: (a . x);',
        '}',
    ].join('\n');

    expect(actual_repr).toBe(expected_repr);
});

test('some stored fnks', () => {
    const filePath = resolve(__dirname, '../design/save_slot_1.txt');
    const fileContent = readFileSync(filePath, 'utf-8');
    const fnks = parseFnks(fileContent);

    expect(applyFunktion(fnks, parseSexprLiteral(`#bubbleUpF1`), parseSexprLiteral(
        `(#a #b #f1 #c #d)`,
    ))).toStrictEqual(parseSexprLiteral(
        `(#f1 #a #b #c #d)`,
    ));

    expect(applyFunktion(fnks, parseSexprLiteral(`(#math #peano . #add)`), parseSexprLiteral(`(
        (#true #true) . (#true #true #true)
    )`))).toStrictEqual(parseSexprLiteral(`(#true #true #true #true #true)`));

    expect(applyFunktion(fnks, parseSexprLiteral(`(#brainfuck . #api)`), parseSexprLiteral(`(
        (#+ #+ #+ #. #+ #+ #.) . #nil
    )`))).toStrictEqual(parseSexprLiteral(`((#1 #1 #1) (#1 #1 #1 #1 #1))`));

    expect(applyFunktion(fnks, parseSexprLiteral(`(#brainfuck . #api)`), parseSexprLiteral(`(
        (#, #+ #+ #.) . ((#1 #1))
    )`))).toStrictEqual(parseSexprLiteral(`((#1 #1 #1 #1))`));

    expect(applyFunktion(fnks, parseSexprLiteral(`(#brainfuck . #api)`), parseSexprLiteral(`(
        (#, #[ #- #] #.) . ((#1 #1 #1))
    )`))).toStrictEqual(parseSexprLiteral(`( () )`));

    expect(applyFunktion(fnks, parseSexprLiteral(`(#brainfuck . #api)`), parseSexprLiteral(`(
        // >,[>,]<[<]>[.>]
        (#> #, #[ #> #, #] #< #[ #< #] #> #[ #. #> #]) . ((#1 #1 #1) (#1 #1) (#1 #1 #1 #1))
    )`))).toStrictEqual(parseSexprLiteral(`((#1 #1 #1) (#1 #1) (#1 #1 #1 #1))`));
});
