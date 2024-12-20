import * as fs from 'fs';
import * as path from 'path';
import { applyFunktion, findFunktion, parseFnks, parseSexprLiteral, sexprFromCases, sexprToString } from './model';

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
else {
    const all_fnks = parseFnks(fileContents(process.argv[2]), '@');
    const input = parseSexprLiteral(process.argv[4] === 'file' ? fileContents(process.argv[5]) : process.argv[4], '@');
    const fnk_name = parseSexprLiteral(process.argv[3], '@');
    console.time('eval');
    const result = applyFunktion(all_fnks, fnk_name, input);
    console.timeEnd('eval');
    console.log(sexprToString(result, '@'));
}
