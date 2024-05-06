export type FunktionDefinition = {
    name: SexprLiteral,
    cases: MatchCaseDefinition[],
};

export type MatchCaseDefinition = {
    pattern: SexprTemplate,
    template: SexprTemplate,
    fn_name_template: SexprTemplate,
    next: 'return' | MatchCaseDefinition[],
};

export type SexprTemplate =
    { type: 'variable', value: string }
    | { type: 'atom', value: string }
    | { type: 'pair', left: SexprTemplate, right: SexprTemplate };

export type SexprLiteral =
    { type: 'atom', value: string }
    | { type: 'pair', left: SexprLiteral, right: SexprLiteral };

export type SexprNullable =
    { type: 'null' }
    | { type: 'variable', value: string }
    | { type: 'atom', value: string }
    | { type: 'pair', left: SexprNullable, right: SexprNullable };


export function assertLiteral(x: SexprTemplate): SexprLiteral {
    if (x.type === 'variable') throw new Error('Template is not fully resolved');
    if (x.type === 'pair') {
        return {
            type: 'pair',
            left: assertLiteral(x.left),
            right: assertLiteral(x.right),
        };
    }
    return x;
}

import grammar from './sexpr.pegjs?raw';
import * as peggy from 'peggy';
const parser = peggy.generate(grammar);

export function parseSexprTemplate(input: string): SexprTemplate {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const raw_thing = parser.parse(input) as SexprLiteral;

    function helper(x: SexprLiteral): SexprTemplate {
        if (x.type === 'pair') {
            return { type: 'pair', left: helper(x.left), right: helper(x.right) };
        }
        else {
            if (x.value[0] === '@') {
                return { type: 'variable', value: x.value.slice(1) };
            }
            else {
                return x;
            }
        }
    }

    return helper(raw_thing);
}

export function parseSexprLiteral(input: string): SexprLiteral {
    return assertLiteral(parseSexprTemplate(input));
}

export function toString(input: SexprTemplate): string {
    if (input.type === 'atom') return input.value;
    if (input.type === 'variable') return '@' + input.value;
    return `(${toString(input.left)} . ${toString(input.right)})`;
}

function clone(x: SexprTemplate): SexprTemplate {
    if (x.type === 'pair') {
        return {
            type: 'pair',
            left: clone(x.left),
            right: clone(x.right),
        };
    }
    else {
        return { type: x.type, value: x.value };
    }
}

export type Address = ('l' | 'r')[];

function getAtAddress(haystack: SexprTemplate, address: Address): SexprTemplate | null {
    let result = haystack;
    for (let k = 0; k < address.length; k++) {
        if (result.type !== 'pair') return null;
        result = (address[k] === 'l') ? result.left : result.right;
    }
    return result;
}

function setAtAddress(haystack: SexprTemplate, address: Address, needle: SexprTemplate): SexprTemplate {
    if (address.length === 0) return needle;
    if (haystack.type !== 'pair') throw new Error('can\'t setAtAddress, is not a pair');
    if (address[0] === 'l') {
        return { type: 'pair', right: haystack.right, left: setAtAddress(haystack.left, address.slice(1), needle) };
    }
    else {
        return { type: 'pair', left: haystack.left, right: setAtAddress(haystack.right, address.slice(1), needle) };
    }
}

type Binding = {
    variable_name: string,
    target_address: Address,
    value: SexprLiteral,
};

export function generateBindings(argument: SexprLiteral, template: SexprTemplate): Binding[] | null {
    if (template.type === 'atom') {
        if (argument.type === 'atom' && argument.value === template.value) {
            return [];
        }
        else {
            return null;
        }
    }
    else if (template.type === 'variable') {
        return [{ variable_name: template.value, target_address: [], value: structuredClone(argument) }];
    }
    else {
        if (argument.type !== 'pair') return null;
        const left_match = generateBindings(argument.left, template.left);
        const right_match = generateBindings(argument.right, template.right);
        if (left_match === null || right_match === null) {
            return null;
        }
        else {
            return [
                ...left_match.map(({ variable_name, target_address, value }) => ({
                    variable_name, value,
                    target_address: concatAddresses(['l'], target_address),
                })),
                ...right_match.map(({ variable_name, target_address, value }) => ({
                    variable_name, value,
                    target_address: concatAddresses(['r'], target_address),
                })),
            ];
        }
    }
}

function concatAddresses(parent: Address, child: Address): Address {
    return [...parent, ...child];
}

export function equalSexprs(a: SexprLiteral, b: SexprLiteral): boolean {
    if (a.type === 'atom' && b.type === 'atom') return a.value === b.value;
    if (a.type === 'pair' && b.type === 'pair') {
        return equalSexprs(a.left, b.left) && equalSexprs(a.right, b.right);
    }
    return false;
}

function findFunktion(all_fnks: FunktionDefinition[], fnk_name: SexprLiteral): FunktionDefinition {
    for (const fnk of all_fnks) {
        if (equalSexprs(fnk.name, fnk_name)) return fnk;
    }
    throw new Error('Couldnt find the requrest funktion');
}

export function applyFunktion(all_fnks: FunktionDefinition[], fnk_name: SexprLiteral, argument: SexprLiteral): SexprLiteral {
    if (fnk_name.type === 'atom' && fnk_name.value === 'identity') return argument;
    const fnk = findFunktion(all_fnks, fnk_name);
    return applyMatchOptions(all_fnks, fnk.cases, argument, []);
}

function applyMatchOptions(all_fnks: FunktionDefinition[], cases: MatchCaseDefinition[], argument: SexprLiteral, parent_bindings: Binding[]): SexprLiteral {
    for (const match_case_definition of cases) {
        const cur_bindings = generateBindings(argument, match_case_definition.pattern);
        if (cur_bindings === null) continue;
        const all_bindings = parent_bindings.concat(cur_bindings);
        const next_fn_name = fillTemplate(match_case_definition.fn_name_template, all_bindings);
        const next_arg = fillTemplate(match_case_definition.template, all_bindings);
        const next_value = applyFunktion(all_fnks, next_fn_name, next_arg);
        if (match_case_definition.next === 'return') {
            return next_value;
        }
        else {
            return applyMatchOptions(all_fnks, match_case_definition.next, next_value, all_bindings);
        }
    }
    throw new Error('No matching cases');
}

function fillTemplate(template: SexprTemplate, bindings: Binding[]): SexprLiteral {
    if (template.type === 'atom') {
        return template;
    }
    else if (template.type === 'variable') {
        const binding = bindings.find(b => b.variable_name === template.value);
        if (binding === undefined) throw new Error('Unbound variable while filling a template');
        return binding.value;
    }
    else {
        return {
            type: 'pair',
            left: fillTemplate(template.left, bindings),
            right: fillTemplate(template.right, bindings),
        };
    }
}
