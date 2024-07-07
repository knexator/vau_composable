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

export function isLiteral(x: SexprTemplate): boolean {
    if (x.type === 'variable') return false;
    if (x.type === 'atom') return true;
    if (x.type === 'pair') {
        return isLiteral(x.left) && isLiteral(x.right);
    }
    throw new Error('unreachable');
}

import { Collapsed } from './drawer';
import { addAt, at, deleteAt, or, replace, single } from './kommon/kommon';
import grammar from './sexpr.pegjs?raw';
import * as peggy from 'peggy';
const parser = peggy.generate(grammar);

export function parseSexprTemplate(input: string): SexprTemplate {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const raw_thing = parser.parse(input) as SexprLiteral;
    return raw_thing;
}

export function parseSexprLiteral(input: string): SexprLiteral {
    return assertLiteral(parseSexprTemplate(input));
}

function asListPlusSentinel(x: SexprTemplate): { list: SexprTemplate[], sentinel: { type: 'variable' | 'atom', value: string } } {
    if (x.type !== 'pair') {
        return { list: [], sentinel: x };
    }
    else {
        const { list: inner_list, sentinel } = asListPlusSentinel(x.right);
        return { list: [x.left, ...inner_list], sentinel };
    }
}

export function sexprToString(input: SexprTemplate, mode: '#' | '@' | '#@' = '#'): string {
    const { list, sentinel } = asListPlusSentinel(input);
    const sentinel_str = sentinel.type === 'atom'
        ? mode.includes('#') ? '#' + sentinel.value : sentinel.value
        : mode.includes('@') ? '@' + sentinel.value : sentinel.value;
    if (list.length === 0) {
        return sentinel_str;
    }
    else {
        if (sentinel.type === 'atom' && sentinel.value === 'nil') {
            return `(${list.map(x => sexprToString(x, mode)).join(' ')})`;
        }
        else {
            // option 1
            // return `(${list.map(x => sexprToString(x)).join(' ')} . ${sentinel_str})`

            // option 2
            if (input.type !== 'pair') throw new Error('unreachable');
            return `(${sexprToString(input.left, mode)} . ${sexprToString(input.right, mode)})`;
        }
    }
    // return `(${sexprToString(input.left)} . ${sexprToString(input.right)})`;
}

export function cloneSexpr(x: SexprTemplate): SexprTemplate {
    if (x.type === 'pair') {
        return {
            type: 'pair',
            left: cloneSexpr(x.left),
            right: cloneSexpr(x.right),
        };
    }
    else {
        return { type: x.type, value: x.value };
    }
}

export type SexprAddress = ('l' | 'r')[];
export type MatchCaseAddress = number[];
export type FullAddress = { type: 'fn_name' | 'pattern' | 'template', major: MatchCaseAddress, minor: SexprAddress };

export function getAtLocalAddress(haystack: SexprTemplate, address: SexprAddress): SexprTemplate | null {
    let result = haystack;
    for (let k = 0; k < address.length; k++) {
        if (result.type !== 'pair') return null;
        result = (address[k] === 'l') ? result.left : result.right;
    }
    return result;
}

export function setAtLocalAddress(haystack: SexprTemplate, address: SexprAddress, needle: SexprTemplate): SexprTemplate {
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
    variable_address: SexprAddress,
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
        return [{ variable_name: template.value, variable_address: [], value: structuredClone(argument) }];
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
                ...left_match.map(({ variable_name, variable_address, value }) => ({
                    variable_name, value,
                    variable_address: concatAddresses(['l'], variable_address),
                })),
                ...right_match.map(({ variable_name, variable_address, value }) => ({
                    variable_name, value,
                    variable_address: concatAddresses(['r'], variable_address),
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
    throw new Error(`Couldn't find the requested funktion: ${sexprToString(fnk_name)}`);
}

export function applyFunktion(all_fnks: FunktionDefinition[], fnk_name: SexprLiteral, argument: SexprLiteral): SexprLiteral {
    if (fnk_name.type === 'atom' && fnk_name.value === 'identity') return argument;
    if (fnk_name.type === 'atom' && fnk_name.value === 'eqAtoms?') return builtIn_eqAtoms(argument);
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
    throw new Error(`No matching cases for argument ${sexprToString(argument)}; cases are [${cases.map(x => sexprToString(x.pattern)).join(', ')}]`);
}

export function fillTemplate(template: SexprTemplate, bindings: { variable_name: string, value: SexprLiteral }[]): SexprLiteral {
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

export function setAt(haystack: MatchCaseDefinition[], address: FullAddress, value: SexprTemplate): MatchCaseDefinition[] {
    if (address.major.length === 0) throw new Error('unimplented');
    if (address.major.length === 1) {
        const old_match_case = haystack[single(address.major)];
        const new_match_case: MatchCaseDefinition = {
            pattern: old_match_case.pattern,
            template: old_match_case.template,
            fn_name_template: old_match_case.fn_name_template,
            next: old_match_case.next,
        };
        switch (address.type) {
            case 'fn_name':
                new_match_case.fn_name_template = setAtLocalAddress(old_match_case.fn_name_template, address.minor, value);
                break;
            case 'pattern':
                new_match_case.pattern = setAtLocalAddress(old_match_case.pattern, address.minor, value);
                break;
            case 'template':
                new_match_case.template = setAtLocalAddress(old_match_case.template, address.minor, value);
                break;
            default:
                throw new Error('unreachable');
        }
        return replace(haystack, new_match_case, single(address.major));
    }
    const match_case = haystack[address.major[0]];
    if (match_case.next === 'return') throw new Error('bad address');
    const index = address.major[0];
    return replace(haystack, {
        pattern: match_case.pattern, template: match_case.template, fn_name_template: match_case.fn_name_template,
        next: setAt(match_case.next, {
            type: address.type,
            major: address.major.slice(1),
            minor: address.minor,
        }, value),
    }, index);
}

export function fixExtraPolesNeeded(collapsed: Collapsed): Collapsed {
    collapsed.main.extra_poles = countExtraPolesNeededFromCollapsed(collapsed);
    collapsed.inside = collapsed.inside.map(x => fixExtraPolesNeeded(x));
    return collapsed;

    function countExtraPolesNeededFromCollapsed(asdf: Collapsed): number {
        if (asdf.inside.length === 0) return 0;
        if (asdf.inside.length === 1) return 1;
        return asdf.inside.length + asdf.inside.map(countExtraPolesNeededFromCollapsed).reduce((a: number, b: number) => a + b, 0);
    }
}

export function countExtraPolesNeeded(match_case: MatchCaseDefinition): number {
    if (match_case.next === 'return') return 0;
    if (match_case.next.length === 1) return 1;
    return match_case.next.length + match_case.next.map(countExtraPolesNeeded).reduce((a: number, b: number) => a + b, 0);
}

export function deletePole(haystack: MatchCaseDefinition[], collapsed: Collapsed, address: MatchCaseAddress): [MatchCaseDefinition[] | 'return', Collapsed[]] {
    if (address.length === 0) throw new Error('unimplented');
    if (address.length === 1) {
        if (haystack.length === 1) {
            if (single(address) !== 0) throw new Error('bad address');
            return ['return', []];
        }
        else {
            return [deleteAt(haystack, single(address)), deleteAt(collapsed.inside, single(address))];
        }
    }
    const index = address[0];
    const match_case = haystack[index];
    if (match_case.next === 'return') throw new Error('bad address');
    const [new_next, new_collapsed] = deletePole(match_case.next, collapsed.inside[index], address.slice(1));
    return [
        replace(haystack, {
            pattern: match_case.pattern, template: match_case.template, fn_name_template: match_case.fn_name_template,
            next: new_next,
        }, index),
        replace(collapsed.inside, {
            main: collapsed.main,
            inside: new_collapsed,
        }, index),
    ];
}

export function movePole(haystack: MatchCaseDefinition[], collapsed: Collapsed[], address: MatchCaseAddress, up: boolean): [MatchCaseDefinition[], Collapsed[]] {
    if (address.length === 0) throw new Error('unimplented');
    if (address.length === 1) {
        const index = single(address);
        if (haystack.length === 1) {
            if (index !== 0) throw new Error('bad address');
            return [haystack, collapsed];
        }
        else {
            if (up && index === 0) return [haystack, collapsed];
            if (!up && index === haystack.length - 1) return [haystack, collapsed];
            const moved = at(haystack, index);
            return [
                addAt(deleteAt(haystack, index), moved, up ? index - 1 : index + 1),
                addAt(deleteAt(collapsed, index), at(collapsed, index), up ? index - 1 : index + 1),
            ];
        }
    }
    const index = address[0];
    const match_case = haystack[index];
    if (match_case.next === 'return') throw new Error('bad address');
    const [new_next, new_collapsed] = movePole(match_case.next, collapsed[index].inside, address.slice(1), up);
    return [
        replace(haystack, {
            pattern: match_case.pattern, template: match_case.template, fn_name_template: match_case.fn_name_template,
            next: new_next,
        }, index),
        replace(collapsed, {
            main: collapsed[index].main,
            inside: new_collapsed,
        }, index),
    ];
}

export function newFnk(all_fnks: FunktionDefinition[]): FunktionDefinition {
    return {
        name: { type: 'atom', value: all_fnks.length.toString() },
        cases: [defaultMatchCase('X')],
    };
}

function defaultMatchCase(var_name: string): MatchCaseDefinition {
    return {
        pattern: { type: 'variable', value: var_name },
        template: { type: 'variable', value: var_name },
        fn_name_template: parseSexprTemplate('#identity'),
        next: 'return',
    };
}

export function addPoleAsFirstChild(haystack: MatchCaseDefinition[], collapsed: Collapsed[], address: MatchCaseAddress, global_t: number, used_variables: string[]): [MatchCaseDefinition[], Collapsed[]] {
    const DEFAULT_MATCH_CASE_COLLAPSE: Collapsed = {
        main: {
            collapsed: false,
            changedAt: global_t,
            extra_poles: 0,
        },
        inside: [],
    };

    if (address.length === 0) {
        return [
            addAt(haystack, defaultMatchCase(newVariableName(used_variables)), 0),
            addAt(collapsed, DEFAULT_MATCH_CASE_COLLAPSE, 0),
        ];
    }
    const index = address[0];
    const match_case = haystack[index];
    const new_used_variables = [...used_variables, ...allVariableNames(match_case.pattern)];
    if (match_case.next === 'return') {
        if (address.length > 1) throw new Error('bad address');
        return [
            replace(haystack, {
                pattern: match_case.pattern, template: match_case.template, fn_name_template: match_case.fn_name_template,
                next: [defaultMatchCase(newVariableName(new_used_variables))],
            }, index),
            replace(collapsed, {
                main: collapsed[index].main,
                inside: [DEFAULT_MATCH_CASE_COLLAPSE],
            }, index),
        ];
    }
    const [new_next, new_collapsed] = addPoleAsFirstChild(match_case.next, collapsed[index].inside, address.slice(1), global_t, new_used_variables);
    return [
        replace(haystack, {
            pattern: match_case.pattern, template: match_case.template, fn_name_template: match_case.fn_name_template,
            next: new_next,
        }, index),
        replace(collapsed, {
            main: collapsed[index].main,
            inside: new_collapsed,
        }, index),
    ];
}

export function validCaseAddress(fnk: FunktionDefinition, address: MatchCaseAddress): boolean {
    try {
        getCaseAt(fnk, address);
        return true;
    }
    catch (error) {
        return false;
    }
}

export function getCaseAt(fnk: FunktionDefinition, address: MatchCaseAddress): MatchCaseDefinition {
    if (address.length === 0) throw new Error('bad address');
    return getGrandChildCase(at(fnk.cases, address[0]), address.slice(1));
}

export function getGrandChildCase(parent_case: MatchCaseDefinition, address: MatchCaseAddress): MatchCaseDefinition {
    if (address.length === 0) return parent_case;
    if (parent_case.next === 'return') throw new Error('invalid address');
    return getGrandChildCase(at(parent_case.next, address[0]), address.slice(1));
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

export function fillFnkBindings(original: FunktionDefinition, bindings: { value: SexprLiteral, target_address: FullAddress }[]): FunktionDefinition {
    let new_cases = original.cases;
    for (const binding of bindings) {
        new_cases = setAt(new_cases, binding.target_address, binding.value);
    }
    return { name: original.name, cases: new_cases };
}

export function* allCases(cases: MatchCaseDefinition[], parent_address: MatchCaseAddress = []): Generator<{
    address: MatchCaseAddress,
    match_case: MatchCaseDefinition,
}, void, void> {
    for (let k = 0; k < cases.length; k++) {
        const match_case = cases[k];
        yield { match_case, address: [...parent_address, k] };
        if (match_case.next !== 'return') {
            yield* allCases(match_case.next, [...parent_address, k]);
        }
    }
}

export function fnkToString(fnk: FunktionDefinition): string {
    function caseToString(match_case: MatchCaseDefinition, depth: number): string {
        const body = '\t'.repeat(depth) + sexprToString(match_case.pattern) + ' -> '
            + sexprToString(match_case.fn_name_template) + ': '
            + sexprToString(match_case.template);
        if (match_case.next === 'return') {
            return body + ';';
        }
        else {
            return body + ' {\n' + match_case.next.map(c => caseToString(c, depth + 1)).join('\n') + '\n' + '\t'.repeat(depth) + '}';
        }
    }

    return sexprToString(fnk.name) + ' {\n' + fnk.cases.map(c => caseToString(c, 1)).join('\n') + '\n}';
}

export function parseFnks(input: string): FunktionDefinition[] {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const raw_thing = parser.parse(input) as FunktionDefinition[];
    return raw_thing;
}

export function allVariableNames(thing: SexprNullable): string[] {
    switch (thing.type) {
        case 'variable':
            return [thing.value];
        case 'atom':
        case 'null':
            return [];
        case 'pair':
            return [...allVariableNames(thing.right), ...allVariableNames(thing.left)];
    }
}

function newVariableName(taken: string[]): string {
    let k = 0;
    let name = k.toString();
    while (taken.includes(name)) {
        k += 1;
        name = k.toString();
    }
    return name;
}

export function getCasesAfter(fnk: FunktionDefinition, address: MatchCaseAddress): MatchCaseDefinition[] {
    const siblings = address.length === 1 ? fnk.cases : getCaseAt(fnk, address.slice(0, -1)).next;
    if (siblings === 'return') throw new Error('unreachable');
    return siblings.slice(at(address, -1));
}

export function builtIn_eqAtoms(input: SexprLiteral): SexprLiteral {
    const falseAtom: SexprLiteral = { type: 'atom', value: 'false' };
    const trueAtom: SexprLiteral = { type: 'atom', value: 'true' };
    if (input.type === 'atom') return falseAtom;
    if (input.left.type !== 'atom' || input.right.type !== 'atom') return falseAtom;
    return (input.left.value === input.right.value) ? trueAtom : falseAtom;
}
