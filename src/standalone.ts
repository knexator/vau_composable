import * as fs from 'fs';
import * as path from 'path';
import { applyFunktion, assertLiteral, casesFromSexpr, doAtom, equalSexprs, findFunktion, fnkToString, parseFnks, parseSexprLiteral, Scorer, sexprFromCases, sexprToString } from './model';
import { assert } from './kommon/kommon';

function fileContents(filePath: string | undefined): string {
    if (filePath === undefined) {
        console.error('Error: Please provide a file path as a command-line argument.');
        process.exit(1);
    }
    const resolvedPath = path.resolve(filePath);
    return fs.readFileSync(resolvedPath, 'utf8');
}

if (process.argv[2] === 'fnk2val') {
    const all_fnks = parseFnks(fileContents(process.argv[3]), '@');
    const fnk_name = parseSexprLiteral(process.argv[4], '@');
    const fnk = findFunktion(all_fnks, fnk_name);
    console.log(sexprToString(sexprFromCases(fnk.cases), '@'));
}
else if (process.argv[2] === 'val2fnk') {
    const raw = parseSexprLiteral(process.argv[3], '@');
    const cases = casesFromSexpr(raw);
    console.log(fnkToString({ name: doAtom('aaa'), cases: cases }, '@'));
}
else if (process.argv[2] === 'score') {
    // TODO: how to score individual puzzles?
    // ./vau score my_solutions.txt puzzles.txt -> speed, max stack depth, code size
    // TODO: puzzles.txt should also maybe be a folder
    const player_fnks = parseFnks(fileContents(process.argv[3]), '@');
    const target_fnks = parseFnks(fileContents(process.argv[4]), '@');
    const scorer = new Scorer(player_fnks);
    target_fnks.forEach((fnk) => {
        fnk.cases.forEach((xxx) => {
            assert(equalSexprs(assertLiteral(xxx.fn_name_template), doAtom('identity')));
            const cur_input = assertLiteral(xxx.pattern);
            const expected_output = assertLiteral(xxx.template);
            const actual_output = scorer.applyFunktion(fnk.name, cur_input);
            if (!equalSexprs(expected_output, actual_output)) {
                console.log(`Bad result for ${sexprToString(fnk.name, '@')} on ${sexprToString(cur_input, '@')}. Expected ${sexprToString(expected_output, '@')}, got ${sexprToString(actual_output, '@')}`);
                return;
            }
        });
    });
    console.log(`max depth: ${scorer.max_stack}`);
    console.log(`total time: ${scorer.total_time}`);
    console.log(`total size: ${scorer.total_code_size}`);
}
else {
    const all_fnks = parseFnks(fileContents(process.argv[2]), '@');
    const input = parseSexprLiteral(process.argv[4] === 'file' ? fileContents(process.argv[5]) : process.argv[4], '@');
    const fnk_name = parseSexprLiteral(process.argv[3], '@');
    console.time('eval');
    const result = applyFunktion(all_fnks, fnk_name, input);
    console.timeEnd('eval');
    console.log(sexprToString(result, '@'));
}
