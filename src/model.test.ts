import { expect, test } from 'vitest'
import { FunktionDefinition, applyFunktion, assertLiteral, equalSexprs, parseSexprLiteral, parseSexprTemplate } from './model'

test('funktion add', () => {
  const add: FunktionDefinition = {
    name: { type: 'atom', value: "add" },
    cases: [
      {
        pattern: parseSexprTemplate(`(0 . @y)`),
        template: parseSexprTemplate(`@y`),
        fn_name_template: parseSexprTemplate(`identity`),
        next: "return"
      },
      {
        pattern: parseSexprTemplate(`((succ . @x) . @y)`),
        template: parseSexprTemplate(`(@x . (succ . @y))`),
        fn_name_template: parseSexprTemplate(`add`),
        next: "return"
      },
    ]
  };
  const input = parseSexprLiteral(`((succ succ . 0) . (succ succ . 0))`);
  const expected_output = parseSexprLiteral(`(succ succ succ succ . 0)`);

  const actual_output = applyFunktion([add], parseSexprLiteral("add"), input);

  expect(equalSexprs(actual_output, expected_output)).toBe(true);
});

test('funktion bubbleUp', () => {
  const bubbleUp: FunktionDefinition = {
    name: { type: 'atom', value: "bubbleUp" },
    cases: [
      {
        pattern: parseSexprTemplate(`(X . @rest)`),
        template: parseSexprTemplate(`(X . @rest)`),
        fn_name_template: parseSexprTemplate(`identity`),
        next: "return"
      },
      // {
      //   pattern: parseSexprTemplate(`(@a X . @b)`),
      //   template: parseSexprTemplate(`(X @a . @b)`),
      //   fn_name_template: parseSexprTemplate(`identity`),
      //   next: "return"
      // },
      {
        pattern: parseSexprTemplate(`(@a . @b)`),
        template: parseSexprTemplate(`@b`),
        fn_name_template: parseSexprTemplate(`bubbleUp`),
        next: [
          {
            pattern: parseSexprTemplate(`(X . @rest)`),
            template: parseSexprTemplate(`(X @a . @rest)`),
            fn_name_template: parseSexprTemplate(`identity`),
            next: "return"
          },
        ]
      },
    ]
  };
  const input = parseSexprLiteral(`(a b X c d)`);
  const expected_output = parseSexprLiteral(`(X a b c d)`);

  const asdf = parseSexprLiteral("bubbleUp");
  const actual_output = applyFunktion([bubbleUp], asdf, input);

  expect(equalSexprs(actual_output, expected_output)).toBe(true);
});
