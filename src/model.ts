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

import { single } from './kommon/kommon';
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

export type SexprAddress = ('l' | 'r')[];
export type MatchCaseAddress = number[];
export type FullAddress = { type: 'fn_name' | 'pattern' | 'template', major: MatchCaseAddress, minor: SexprAddress };

function getAtLocalAddress(haystack: SexprTemplate, address: SexprAddress): SexprTemplate | null {
    let result = haystack;
    for (let k = 0; k < address.length; k++) {
        if (result.type !== 'pair') return null;
        result = (address[k] === 'l') ? result.left : result.right;
    }
    return result;
}

function setAtLocalAddress(haystack: SexprTemplate, address: SexprAddress, needle: SexprTemplate): SexprTemplate {
    if (address.length === 0) return needle;
    if (haystack.type !== 'pair') throw new Error('can\'t setAtAddress, is not a pair');
    if (address[0] === 'l') {
        return { type: 'pair', right: haystack.right, left: setAtLocalAddress(haystack.left, address.slice(1), needle) };
    }
    else {
        return { type: 'pair', left: haystack.left, right: setAtLocalAddress(haystack.right, address.slice(1), needle) };
    }
}

type Binding = {
    variable_name: string,
    target_address: SexprAddress,
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

function concatAddresses(parent: SexprAddress, child: SexprAddress): SexprAddress {
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

function addressesOfVariableInSexpr(haystack: SexprTemplate, needle_name: string): SexprAddress[] {
    if (haystack.type === 'atom') {
        return [];
    }
    else if (haystack.type === 'variable') {
        return haystack.value === needle_name ? [[]] : [];
    }
    else if (haystack.type === 'pair') {
        return [
            ...addressesOfVariableInSexpr(haystack.left, needle_name).map(x => concatAddresses(['l'], x)),
            ...addressesOfVariableInSexpr(haystack.right, needle_name).map(x => concatAddresses(['r'], x)),
        ];
    }
    else {
        throw new Error('unreachable');
    }
}

export function addressesOfVariableInTemplates(haystack: MatchCaseDefinition, needle_name: string): FullAddress[] {
    function local(address: SexprAddress, place: 'template' | 'fn_name'): FullAddress {
        return { type: place, major: [], minor: address };
    }

    const local_results: FullAddress[] = [
        ...addressesOfVariableInSexpr(haystack.template, needle_name).map(x => local(x, 'template')),
        ...addressesOfVariableInSexpr(haystack.fn_name_template, needle_name).map(x => local(x, 'fn_name')),
    ];

    const inner_results: FullAddress[] = haystack.next === 'return'
        ? []
        : haystack.next.flatMap((next_case, k) => {
            return addressesOfVariableInTemplates(next_case, needle_name).map(x => ({
                type: x.type, minor: x.minor, major: [k, ...x.major],
            }));
        });

    return [...local_results, ...inner_results];
}

export function getAt(haystack: MatchCaseDefinition[], address: FullAddress): SexprTemplate | null {
    if (address.major.length === 0) throw new Error('unimplented');
    if (address.major.length === 1) {
        const match_case = haystack[single(address.major)];
        switch (address.type) {
            case 'fn_name':
                return getAtLocalAddress(match_case.fn_name_template, address.minor);
            case 'pattern':
                return getAtLocalAddress(match_case.pattern, address.minor);
            case 'template':
                return getAtLocalAddress(match_case.template, address.minor);
            default:
                throw new Error('unreachable');
        }
    }
    const next = haystack[address.major[0]].next;
    if (next === 'return') return null;
    return getAt(next, {
        type: address.type,
        major: address.major.slice(1),
        minor: address.minor,
    });
}

export function getCaseAt(fnk: FunktionDefinition, address: MatchCaseAddress): MatchCaseDefinition {
    if (address.length === 0) throw new Error('bad address');
    return getGrandChildCase(fnk.cases[address[0]], address.slice(1));
}

export function getGrandChildCase(parent_case: MatchCaseDefinition, address: MatchCaseAddress): MatchCaseDefinition {
    if (address.length === 0) return parent_case;
    if (parent_case.next === 'return') throw new Error('invalid address');
    return getGrandChildCase(parent_case.next[address[0]], address.slice(1));
}

export function changeVariablesToNull(thing: SexprTemplate): SexprNullable {
    switch (thing.type) {
        case 'variable':
            return { type: 'null' };
        case 'atom':
            return thing;
        case 'pair':
            return { type: 'pair', left: changeVariablesToNull(thing.left), right: changeVariablesToNull(thing.right) };
        default:
            throw new Error('unreachable');
    }
}
